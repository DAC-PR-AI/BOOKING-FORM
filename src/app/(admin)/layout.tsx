import { AppShell } from '@/components/layout/app-shell';
import { requireAdmin } from '@/lib/auth/rbac';

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireAdmin();
  return <AppShell user={user}>{children}</AppShell>;
}
