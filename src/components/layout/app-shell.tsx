import Link from 'next/link';
import type { RoleName } from '@prisma/client';
import { logout } from '@/app/(auth)/login/actions';
import type { SessionUser } from '@/lib/auth/session';

type NavItem = { href: string; label: string };

function navFor(role: RoleName): NavItem[] {
  switch (role) {
    case 'ADMIN':
      return [
        { href: '/dashboard', label: 'Dashboard' },
        { href: '/admin/users', label: 'Users' },
        { href: '/admin/projects', label: 'Projects' },
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

export function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const nav = navFor(user.role.name);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-gray-200 bg-white">
        {/* navy/orange accent, echoing the paper form */}
        <div className="flex h-1" aria-hidden="true">
          <div className="w-24 bg-dac-navy-700" />
          <div className="w-10 bg-dac-orange-500" />
        </div>

        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="text-sm font-semibold tracking-tight text-gray-900">
            DAC Booking Portal
          </Link>

          <nav className="flex items-center gap-4" aria-label="Main">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-gray-600 transition hover:text-dac-navy-700"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="text-right text-xs leading-tight">
              <span className="block font-medium text-gray-900">{user.name}</span>
              <span className="block text-gray-500">{user.role.label}</span>
            </span>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>

      <footer className="border-t border-gray-200 bg-white px-4 py-3">
        <p className="mx-auto w-full max-w-6xl text-xs text-gray-500">
          DAC Developers Pvt Ltd · all times shown in IST
        </p>
      </footer>
    </div>
  );
}
