'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Search, Archive, Heart, Camera, Settings, Layers } from 'lucide-react';

/**
 * Tablet-Seitenleiste (iPad, ab `md`). Ersetzt auf großen Screens die
 * mobile Bottom-Bar (`BottomNav`, die sich ab `md` selbst ausblendet).
 *
 *  - Nur ab `md` sichtbar (`hidden md:flex`) — Phones behalten die Bottom-Bar.
 *  - Auf `/scanner` NICHT gerendert: der Scanner ist Vollbild-Kamera mit
 *    eigenem dunklen Chrome und eigener schwebender Leiste.
 *
 * Optik = schwebendes Glas-Rail (wie die Home-Tab-Bar), liegt über dem
 * bunten `GlassBackground`. Breite/Position sind mit dem Main-Padding in
 * `app/(app)/layout.tsx` abgestimmt (CSS-Var `--sidenav-w`).
 */

const navItems = [
  { href: '/',          icon: Home,    label: 'Home' },
  { href: '/collection', icon: Search,  label: 'Suchen' },
  { href: '/binders',   icon: Archive, label: 'Karten' },
  { href: '/sets',      icon: Layers,  label: 'Sets' },
  { href: '/wishlist',  icon: Heart,   label: 'Wunschliste' },
];

export function SideNav() {
  const pathname = usePathname();
  // Scanner = Vollbild-Kamera mit eigenem Chrome → kein Rail.
  if (pathname === '/scanner') return null;

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  const scanFabStyle: React.CSSProperties = {
    background: 'rgba(139,92,246,0.85)',
    backdropFilter: 'blur(10px) saturate(1.4)',
    WebkitBackdropFilter: 'blur(10px) saturate(1.4)',
    border: '1.5px solid rgba(255,255,255,0.5)',
    boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.6), 0 0 26px rgba(139,92,246,0.55), 0 6px 20px rgba(0,0,0,0.4)',
  };

  return (
    <nav
      className="hidden md:flex fixed z-40 flex-col glass"
      style={{
        left: 12,
        top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        bottom: 12,
        width: 'calc(var(--sidenav-w) - 24px)',
        borderRadius: 26,
        padding: 16,
      }}
    >
      {/* Wortmarke */}
      <div className="px-2 pt-1 pb-4">
        <span className="text-role-h2 text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.2)]">Pokédex</span>
      </div>

      {/* Scan-Button — prominenter lila Glas-Button (ersetzt den Bottom-FAB) */}
      <Link
        href="/scanner"
        className="flex items-center gap-3 rounded-2xl px-3.5 py-3 mb-3 text-white font-semibold active:scale-[.98] transition-transform"
        style={scanFabStyle}
      >
        <Camera size={22} strokeWidth={2} />
        <span className="text-role-title text-white">Scannen</span>
      </Link>

      {/* Nav-Items */}
      <div className="flex flex-col gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-2xl px-3.5 py-2.5 transition-colors text-glass"
              style={
                active
                  ? { background: 'rgba(49,130,206,0.16)', boxShadow: 'inset 0 0 0 0.5px rgba(49,130,206,0.4)', color: 'var(--pokedex-blue)' }
                  : { opacity: 0.8 }
              }
            >
              <Icon size={22} strokeWidth={1.8} fill={active ? 'currentColor' : 'none'} />
              <span className="text-role-title" style={{ fontWeight: active ? 700 : 500 }}>{item.label}</span>
            </Link>
          );
        })}
      </div>

      {/* Einstellungen — unten verankert */}
      <Link
        href="/settings"
        className="mt-auto flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-glass transition-colors"
        style={pathname.startsWith('/settings')
          ? { background: 'rgba(49,130,206,0.16)', boxShadow: 'inset 0 0 0 0.5px rgba(49,130,206,0.4)', color: 'var(--pokedex-blue)' }
          : { opacity: 0.8 }}
      >
        <Settings size={22} strokeWidth={1.8} />
        <span className="text-role-title" style={{ fontWeight: pathname.startsWith('/settings') ? 700 : 500 }}>Einstellungen</span>
      </Link>
    </nav>
  );
}
