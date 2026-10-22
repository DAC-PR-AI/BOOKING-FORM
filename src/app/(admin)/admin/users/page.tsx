import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/rbac';
import { PageHeader } from '@/components/ui/page-header';

export const metadata: Metadata = { title: 'Users' };
export const dynamic = 'force-dynamic';

const IST = 'Asia/Kolkata';

function formatIst(value: Date | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: IST,
  }).format(value);
}

export default async function AdminUsersPage() {
  const admin = await requireAdmin();

  const users = await prisma.user.findMany({
    where: { organizationId: admin.organizationId },
    include: { role: true },
    orderBy: [{ role: { name: 'asc' } }, { name: 'asc' }],
  });

  return (
    <>
      <PageHeader
        title="Users"
        description="Every account and its role. There is no public sign-up — accounts are created here."
      />

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">Name</th>
              <th scope="col" className="px-4 py-3 font-semibold">Email</th>
              <th scope="col" className="px-4 py-3 font-semibold">Role</th>
              <th scope="col" className="px-4 py-3 font-semibold">Status</th>
              <th scope="col" className="px-4 py-3 font-semibold">Last signed in</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                <td className="px-4 py-3 text-gray-600">{u.email}</td>
                <td className="px-4 py-3 text-gray-600">{u.role.label}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      u.isActive
                        ? 'rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700'
                        : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600'
                    }
                  >
                    {u.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">{formatIst(u.lastLoginAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-gray-500">
        Creating and editing users from this screen arrives in Phase 7. Seed accounts are
        defined in <code className="font-mono">prisma/seed.ts</code>.
      </p>
    </>
  );
}
