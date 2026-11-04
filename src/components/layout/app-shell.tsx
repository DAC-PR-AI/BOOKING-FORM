import Link from 'next/link';
import type { RoleName } from '@prisma/client';
import { logout } from '@/app/(auth)/login/actions';
import type { SessionUser } from '@/lib/auth/session';
import { unreadCount } from '@/lib/notify/dispatch';
import { NavLinks, type NavItem } from './nav-links';

function navFor(role: RoleName): NavItem[] {
  switch (role) {
    case 'ADMIN':
      return [
        { href: '/dashboard', label: 'Dashboard' },
        { href: '/forms', label: 'All Forms' },
        { href: '/admin/users', label: 'Role Master & Users' },
        { href: '/admin/projects', label: 'Projects' },
        { href: '/admin/audit', label: 'Audit' },
        { href: '/admin/system', label: 'System' },
      ];
    case 'SALES_EXECUTIVE':
      return [
        { href: '/dashboard', label: 'Dashboard' },
        { href: '/forms', label: 'My Forms' },
      ];
    case 'SALES_COORDINATOR':
      return [
        { href: '/dashboard', label: 'Dashboard' },
        { href: '/coordinator/queue', label: 'To validate' },
      ];
    default:
      return [
        { href: '/dashboard', label: 'Dashboard' },
        { href: '/signatory/queue', label: 'Pending for me' },
      ];
  }
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'DA';
  if (parts.length === 1) return (parts[0] ?? 'DA').slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}

export async function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const nav = navFor(user.role.name);
  const unread = await unreadCount(user.id);
  const initials = initialsOf(user.name);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur-md shadow-2xs">
        {/* Full-width navy/orange architectural top stripe */}
        <div
          className="h-1 w-full bg-gradient-to-r from-dac-navy-900 via-dac-navy-600 to-dac-orange-500"
          aria-hidden="true"
        />

        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-2.5 px-4 py-3">
          <Link
            href="/"
            className="flex items-center gap-3 text-sm font-bold tracking-tight text-slate-900 transition hover:opacity-90"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/dac-logo.png"
              alt="DAC Developers"
              className="h-8 w-auto object-contain"
            />
            <span className="hidden h-5 w-px bg-slate-200 sm:inline-block" aria-hidden="true" />
            <span className="flex flex-col leading-none">
              <span className="text-sm font-bold text-dac-navy-900">DAC Booking Portal</span>
              <span className="mt-0.5 text-[10px] font-medium tracking-wider text-slate-400 uppercase">
                Allotment &amp; Approvals
              </span>
            </span>
          </Link>

          <NavLinks items={nav} />

          <div className="ml-auto flex items-center gap-2.5 sm:gap-3">
            <Link
              href="/notifications"
              className="relative inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:border-slate-300 hover:bg-white"
              aria-label={
                unread === 0
                  ? 'Notifications'
                  : `Notifications, ${unread} unread`
              }
            >
              <svg
                className="h-3.5 w-3.5 text-slate-500"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
                />
              </svg>
              <span>Notifications</span>
              {unread > 0 ? (
                <span className="inline-flex min-w-4.5 items-center justify-center rounded-full bg-dac-orange-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-2xs">
                  {unread > 99 ? '99+' : unread}
                </span>
              ) : null}
            </Link>

            <div className="hidden sm:flex items-center gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/60 px-2.5 py-1">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-dac-navy-800 text-[11px] font-bold text-white shadow-2xs"
              >
                {initials}
              </span>
              <span className="text-left text-xs leading-tight">
                <span className="block font-semibold text-slate-900">{user.name}</span>
                <span className="block text-[11px] font-medium text-dac-navy-700">
                  {user.role.label}
                </span>
              </span>
            </div>

            <form action={logout}>
              <button
                type="submit"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-2xs transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>

      <footer className="border-t border-slate-200/80 bg-white px-4 py-4">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/dac-logo.png"
              alt="DAC"
              className="h-5 w-auto object-contain opacity-85"
            />
            <span className="font-medium text-slate-700">DAC Developers Pvt Ltd</span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span>All times shown in IST</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            <span className="font-medium text-slate-600">Domain restricted: @dacdevelopers.com</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
