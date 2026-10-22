import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { homePathFor } from '@/lib/auth/rbac';

export default async function RootPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  redirect(homePathFor(user.role.name));
}
