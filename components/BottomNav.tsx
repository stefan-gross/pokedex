'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Search, BookOpen, Heart, Camera } from 'lucide-react';

const navItems = [
  { href: '/', icon: Home, label: 'Home' },
  { href: '/collection', icon: Search, label: 'Suchen' },
  null, // FAB placeholder
  { href: '/binders', icon: BookOpen, label: 'Mappen' },
  { href: '/wishlist', icon: Heart, label: 'Wunschliste' },
];

export function BottomNav() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around bg-card border-t border-border"
      style={{ height: 'calc(68px + env(safe-area-inset-bottom, 0px))', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {navItems.map((item, i) => {
        if (item === null) {
          return (
            <div key="fab" className="relative flex items-center justify-center" style={{ width: 56 }}>
              <Link
                href="/scanner"
                className="absolute -top-6 flex items-center justify-center rounded-full shadow-lg"
                style={{ width: 56, height: 56, background: 'var(--pokedex-red)' }}
                aria-label="Karte scannen"
              >
                <Camera size={24} color="#fff" />
              </Link>
            </div>
          );
        }
        const Icon = item.icon;
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="flex flex-col items-center gap-0.5 px-3 py-1 min-w-[56px]"
            style={{ color: active ? 'var(--pokedex-red)' : 'var(--muted-foreground)' }}
          >
            <Icon size={22} strokeWidth={active ? 2.5 : 1.8} />
            <span className="text-[10px] font-medium">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
