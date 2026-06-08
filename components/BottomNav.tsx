'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Search, BookOpen, Heart, Camera } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { getReviewCount } from '@/lib/firestore/cards';

const FAB_SIZE = 72;

const navItems = [
  { href: '/', icon: Home, label: 'Home' },
  { href: '/collection', icon: Search, label: 'Suchen' },
  null, // FAB placeholder
  { href: '/binders', icon: BookOpen, label: 'Sammlungen' },
  { href: '/wishlist', icon: Heart, label: 'Wunschliste' },
];

export function BottomNav() {
  const pathname = usePathname();
  const [reviewCount, setReviewCount] = useState(0);

  const fetchCount = useCallback(() => {
    getReviewCount().then(setReviewCount).catch(() => {});
  }, []);

  useEffect(() => {
    fetchCount();
    window.addEventListener('review-count-changed', fetchCount);
    return () => window.removeEventListener('review-count-changed', fetchCount);
  }, [fetchCount]);

  if (pathname === '/scanner') return null;

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  // Leicht nach oben versetzt: nur minimal über den Nav-Rand ragen
  const fabStyle: React.CSSProperties = {
    width: FAB_SIZE,
    height: FAB_SIZE,
    marginTop: -10,
    flexShrink: 0,
    background: 'var(--pokedex-red)',
    boxShadow: '0 4px 20px rgba(220,38,38,0.45)',
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 grid items-center justify-items-center bg-card/95 backdrop-blur-xl"
      style={{ gridTemplateColumns: 'repeat(5, 1fr)', height: 'calc(68px + env(safe-area-inset-bottom, 0px))', paddingBottom: 'env(safe-area-inset-bottom, 0px)', boxShadow: '0 -4px 24px rgba(30,40,80,0.08), 0 -1px 0 rgba(30,40,80,0.05)' }}
    >
      {navItems.map((item, i) => {
        if (item === null) {
          return (
            <div key="fab" className="relative flex items-center justify-center" style={{ width: FAB_SIZE }}>
              <Link
                href="/scanner"
                className="flex items-center justify-center rounded-full shadow-xl"
                style={fabStyle}
                aria-label="Karte scannen"
              >
                <Camera size={28} color="#fff" />
              </Link>
              {reviewCount > 0 && (
                <span
                  className="absolute min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-white text-[10px] font-bold px-1"
                  style={{ background: '#f59e0b', pointerEvents: 'none', top: 0, right: -2 }}
                >
                  {reviewCount > 99 ? '99+' : reviewCount}
                </span>
              )}
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
