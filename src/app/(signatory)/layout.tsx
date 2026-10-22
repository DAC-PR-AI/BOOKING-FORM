import { AppShell } from '@/components/layout/app-shell';
import { requireRole, SIGNATORY_ROLES } from '@/lib/auth/rbac';

/**
 * Guard for the whole signatory area. A non-signatory gets 404, not 403 —
 * the existence of this area is not something to confirm to the wrong role.
 */
export default async function SignatoryLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireRole(...SIGNATORY_ROLES);
  return <AppShell user={user}>{children}</AppShell>;
}
