import { BottomNav } from '@/components/BottomNav';
import AuthRefresh from '@/components/AuthRefresh';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthRefresh />
      {/* Covers iPhone status bar / Dynamic Island area */}
      <div className="fixed inset-x-0 top-0 h-safe-top bg-background z-50" />
      <main className="pb-nav min-h-screen pt-safe">{children}</main>
      <BottomNav />
    </>
  );
}
