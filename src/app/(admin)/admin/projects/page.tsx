import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/rbac';
import { PageHeader, EmptyState } from '@/components/ui/page-header';
import { ProjectForm } from './project-form';
import { toggleProjectActive } from './actions';

export const metadata: Metadata = { title: 'Projects' };
export const dynamic = 'force-dynamic';

export default async function AdminProjectsPage() {
  const admin = await requireAdmin();

  const projects = await prisma.project.findMany({
    where: { organizationId: admin.organizationId },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });

  return (
    <>
      <PageHeader
        title="Projects"
        description="Projects available in the booking form's Project Name dropdown."
      />

      <p className="mb-6 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        These will be synced from your Google Sheet in Phase 7. Until the sheet exists,
        add them here. Projects are <strong>deactivated, never deleted</strong>, so
        existing bookings keep resolving their project.
      </p>

      <div className="mb-8">
        <ProjectForm />
      </div>

      {projects.length === 0 ? (
        <EmptyState>
          No projects yet. Add one above — a booking form cannot be created without at
          least one active project.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Name</th>
                <th scope="col" className="px-4 py-3 font-semibold">Code</th>
                <th scope="col" className="px-4 py-3 font-semibold">Location</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {projects.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    {p.externalCode ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{p.location ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        p.isActive
                          ? 'rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700'
                          : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600'
                      }
                    >
                      {p.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <form action={toggleProjectActive}>
                      <input type="hidden" name="id" value={p.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                      >
                        {p.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
