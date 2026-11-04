import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/rbac';
import { allowedAuthDomain } from '@/lib/auth/google';
import { userSyncStatus } from '@/lib/users/sync';
import { PageHeader } from '@/components/ui/page-header';
import { UserRoleForm } from './user-role-form';
import { UserSyncPanel } from './user-sync-panel';
import {
  toggleUserActive,
  updateRoleMasterDetails,
  updateUserRoleMapping,
} from './actions';

export const metadata: Metadata = { title: 'Role Master & Users' };
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
  const domain = allowedAuthDomain();

  const [roles, users, syncStatus] = await Promise.all([
    prisma.role.findMany({
      include: {
        users: {
          where: { organizationId: admin.organizationId },
          orderBy: { name: 'asc' },
        },
        flowSteps: {
          orderBy: { orderIndex: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.user.findMany({
      where: { organizationId: admin.organizationId },
      include: { role: true },
      orderBy: [{ isActive: 'desc' }, { role: { name: 'asc' } }, { name: 'asc' }],
    }),
    userSyncStatus(admin.organizationId),
  ]);

  const roleOptions = roles.map((r) => ({
    id: r.id,
    name: r.name,
    label: r.label,
  }));

  return (
    <>
      <PageHeader
        title="Role Master & Staff Mapping"
        description={`Central Role Master (roles table) and multi-user mapping. Only @${domain} Google Workspace accounts can authenticate.`}
      />

      {/* Google Sheet Sync Panel */}
      <UserSyncPanel status={syncStatus} />

      {/* 1. Add & Map Staff Member to Role */}
      <UserRoleForm roles={roleOptions} domain={domain} />

      {/* 2. Role Master Table */}
      <section className="mb-10">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Role Master (<code className="font-mono text-xs text-dac-navy-700">roles</code>)
            </h2>
            <p className="text-xs text-slate-600">
              Each Role ID can have multiple staff members mapped to it. Any active member mapped to a signatory role can claim and sign that stage.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200/90 bg-white shadow-xs">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-xs uppercase tracking-wider text-slate-600">
              <tr>
                <th scope="col" className="px-4 py-3.5 font-semibold">Role Code &amp; ID</th>
                <th scope="col" className="px-4 py-3.5 font-semibold">Label &amp; Description</th>
                <th scope="col" className="px-4 py-3.5 font-semibold">Pipeline Stage</th>
                <th scope="col" className="px-4 py-3.5 font-semibold">
                  Mapped Staff ({users.filter((u) => u.isActive).length} active)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {roles.map((r) => {
                const activeUsers = r.users.filter((u) => u.isActive);
                const inactiveUsers = r.users.filter((u) => !u.isActive);
                const stepLabels = r.flowSteps.map((s) => `Step ${s.orderIndex}: ${s.label}`);

                return (
                  <tr key={r.id} className="align-top transition hover:bg-slate-50/70">
                    <td className="px-4 py-3.5">
                      <span className="inline-block rounded-md bg-dac-navy-50 px-2.5 py-0.5 font-mono text-xs font-bold text-dac-navy-800">
                        {r.name}
                      </span>
                      <div className="mt-1 font-mono text-[11px] text-slate-400" title="Role Master UUID">
                        ID: {r.id.slice(0, 8)}…
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      <form action={updateRoleMasterDetails} className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
                        <input type="hidden" name="roleId" value={r.id} />
                        <input
                          name="label"
                          defaultValue={r.label}
                          aria-label={`${r.name} label`}
                          className="w-36 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-900 focus:border-dac-navy-600 focus:outline-none"
                        />
                        <input
                          name="description"
                          defaultValue={r.description ?? ''}
                          placeholder="Role description"
                          aria-label={`${r.name} description`}
                          className="min-w-48 flex-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 focus:border-dac-navy-600 focus:outline-none"
                        />
                        <button
                          type="submit"
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
                        >
                          Save
                        </button>
                      </form>
                    </td>

                    <td className="px-4 py-3.5 text-xs text-slate-600">
                      {stepLabels.length > 0 ? (
                        <div className="space-y-1">
                          {stepLabels.map((lbl) => (
                            <span
                              key={lbl}
                              className="block rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900 border border-amber-200/60"
                            >
                              {lbl}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400">System / Management</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        {activeUsers.map((u) => (
                          <span
                            key={u.id}
                            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800"
                            title={`${u.email} (User ID: ${u.id})`}
                          >
                            {u.name}
                            <span className="text-[10px] font-normal text-emerald-600">({u.email})</span>
                          </span>
                        ))}
                        {inactiveUsers.map((u) => (
                          <span
                            key={u.id}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500 line-through"
                            title={`Inactive: ${u.email}`}
                          >
                            {u.name}
                          </span>
                        ))}
                        {r.users.length === 0 ? (
                          <span className="text-xs italic text-amber-600">No users mapped</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. User <-> Role ID Mapping Directory */}
      <section>
        <div className="mb-3">
          <h2 className="text-base font-bold text-slate-900">
            Staff Directory &amp; Role ID Mapping (<code className="font-mono text-xs text-dac-navy-700">users.role_id → roles.id</code>)
          </h2>
          <p className="text-xs text-slate-600">
            Reassign any user to a different Role ID or revoke their portal access immediately.
          </p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200/90 bg-white shadow-xs">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-xs uppercase tracking-wider text-slate-600">
              <tr>
                <th scope="col" className="px-4 py-3.5 font-semibold">User &amp; ID</th>
                <th scope="col" className="px-4 py-3.5 font-semibold">Email</th>
                <th scope="col" className="px-4 py-3.5 font-semibold">Mapped Role (Role Master)</th>
                <th scope="col" className="px-4 py-3.5 font-semibold">Status</th>
                <th scope="col" className="px-4 py-3.5 font-semibold">Last Signed In</th>
                <th scope="col" className="px-4 py-3.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const isSelf = u.id === admin.id;
                return (
                  <tr key={u.id} className="transition hover:bg-slate-50/70">
                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-slate-900">{u.name}</div>
                      <div className="font-mono text-[11px] text-slate-400">
                        User ID: {u.id.slice(0, 8)}…
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs text-slate-700">{u.email}</td>
                    <td className="px-4 py-3.5">
                      <form action={updateUserRoleMapping} className="flex items-center gap-2">
                        <input type="hidden" name="userId" value={u.id} />
                        <select
                          name="roleId"
                          defaultValue={u.roleId}
                          aria-label={`Role for ${u.name}`}
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 focus:border-dac-navy-600 focus:outline-none"
                        >
                          {roles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.label} ({r.name})
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
                        >
                          Map Role
                        </button>
                      </form>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={
                          u.isActive
                            ? 'rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700'
                            : 'rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600'
                        }
                      >
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-slate-500">{formatIst(u.lastLoginAt)}</td>
                    <td className="px-4 py-3.5 text-right">
                      {!isSelf ? (
                        <form action={toggleUserActive} className="inline">
                          <input type="hidden" name="userId" value={u.id} />
                          <button
                            type="submit"
                            className={
                              u.isActive
                                ? 'rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-100'
                                : 'rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100'
                            }
                          >
                            {u.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        </form>
                      ) : (
                        <span className="text-xs italic text-slate-400">Current session</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
