import { AppShell } from '@/components/layout/app-shell';
import { requireUser } from '@/lib/auth/rbac';

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
