import { AppShell } from '@/components/layout/app-shell';
import { requireRole } from '@/lib/auth/rbac';

export default async function CoordinatorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireRole('SALES_COORDINATOR');
  return <AppShell user={user}>{children}</AppShell>;
}
