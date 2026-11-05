import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'DAC Booking Portal',
    template: '%s · DAC Booking Portal',
  },
  description: 'Booking form portal for DAC Developers Pvt Ltd.',
  icons: {
    icon: '/brand/dac-logo.png',
    shortcut: '/brand/dac-logo.png',
    apple: '/brand/dac-logo.png',
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-full font-sans antialiased">{children}</body>
    </html>
  );
}
