import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth/rbac';
import { PageHeader, EmptyState } from '@/components/ui/page-header';
import { markAllRead, markRead } from './actions';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

function formatIst(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(d);
}

/**
 * The in-app queue — the system of record for who has been told what.
 *
 * Email is a best-effort digest layered on top (Resend's free tier allows 100
 * messages a day, so one per signature would run out at about eleven
 * bookings). If email fails entirely, nothing is lost: this page still shows
 * every notification, and the work queues themselves are unaffected.
 */
export default async function NotificationsPage() {
  const user = await requireUser();

  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const unread = notifications.filter((n) => n.readAt === null);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Notifications"
          description={
            unread.length === 0
              ? 'Everything here has been read.'
              : `${unread.length} unread.`
          }
        />
        {unread.length > 0 ? (
          <form action={markAllRead}>
            <button
              type="submit"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Mark all as read
            </button>
          </form>
        ) : null}
      </div>

      {notifications.length === 0 ? (
        <EmptyState>
          Nothing yet. You will be told here when a booking needs you, when one you raised is
          sent back, and when one completes.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {notifications.map((notification) => {
            const isUnread = notification.readAt === null;

            return (
              <li
                key={notification.id}
                className={`rounded-lg border p-4 ${
                  isUnread ? 'border-dac-navy-700/30 bg-white' : 'border-gray-200 bg-gray-50'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p
                      className={`text-sm ${
                        isUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-600'
                      }`}
                    >
                      {isUnread ? (
                        <span
                          aria-hidden
                          className="mr-2 inline-block h-2 w-2 rounded-full bg-dac-orange-500 align-middle"
                        />
                      ) : null}
                      {notification.title}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">{notification.body}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      {formatIst(notification.createdAt)}
                      {isUnread ? null : ' · read'}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {notification.link ? (
                      <Link
                        href={notification.link}
                        className="rounded-md bg-dac-navy-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-dac-navy-900"
                      >
                        Open
                      </Link>
                    ) : null}
                    {isUnread ? (
                      <form action={markRead.bind(null, notification.id)}>
                        <button
                          type="submit"
                          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                        >
                          Mark read
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
