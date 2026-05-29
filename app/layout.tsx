import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { BottomNav } from '@/components/BottomNav';
import AuthRefresh from '@/components/AuthRefresh';

const geistSans = Geist({ variable: '--font-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Pokédex',
  description: 'Pokémon-Kartensammlung verwalten',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Pokédex' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f0f2f8' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1117' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AuthRefresh />
        <main className="pb-nav min-h-screen">{children}</main>
        <BottomNav />
      </body>
    </html>
  );
}
