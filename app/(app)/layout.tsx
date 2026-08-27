'use client';

import { usePathname } from 'next/navigation';
import { BottomNav } from '@/components/BottomNav';
import AuthRefresh from '@/components/AuthRefresh';
import { GlassBackground } from '@/components/GlassBackground';
import { ColdStartSplash } from '@/components/ColdStartSplash';
import { EdgeSwipeGuard } from '@/components/EdgeSwipeGuard';
import { DebugSafeArea } from '@/components/DebugSafeArea';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Scanner hat sein eigenes (dunkles Kamera-)Chrome — der bunte Glas-
  // Hintergrund gilt für alle anderen Screens (Handoff design_handoff_home_glass).
  const isScanner = pathname === '/scanner';

  return (
    <>
      {/* Splash NICHT auf dem Scanner: der hat eigenes dunkles Kamera-Chrome,
          und iOS lädt die PWA bei Kamera-Nutzung gern neu (neue Session) → der
          Splash würde sonst mitten im Scannen auftauchen. */}
      {!isScanner && <ColdStartSplash />}
      <EdgeSwipeGuard />
      <DebugSafeArea />
      <AuthRefresh />
      {!isScanner && <GlassBackground />}
      {/* Covers iPhone status bar / Dynamic Island area */}
      <div className={`fixed inset-x-0 top-0 h-safe-top z-50 ${isScanner ? 'bg-background' : ''}`} />
      <main className="pb-nav min-h-screen pt-safe">{children}</main>
      <BottomNav />
    </>
  );
}
