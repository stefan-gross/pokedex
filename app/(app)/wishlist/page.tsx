'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Heart, Lock } from 'lucide-react';
import { getWishlists, ensureDefaultWishlist } from '@/lib/firestore/wishlists';
import type { WishlistDoc } from '@/types';

/** Übersicht aller Wunschlisten — analog zur Sammlungsübersicht
 *  (app/(app)/binders/page.tsx), da es beliebig viele Vorlagen-Wunschlisten
 *  zusätzlich zur normalen geben kann (eine Tab-Leiste wäre damit schnell
 *  unübersichtlich). Freie Liste immer zuerst, danach Vorlagen-Listen. */
export default function WishlistOverviewPage() {
  const [lists, setLists] = useState<WishlistDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const fetched = await getWishlists();
        const hasFree = fetched.some(l => !l.templateBinderId);
        const all = hasFree ? fetched : [...fetched, await ensureDefaultWishlist()];
        all.sort((a, b) => (a.templateBinderId ? 1 : 0) - (b.templateBinderId ? 1 : 0));
        setLists(all);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex justify-center pt-16">
        <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24">
      <div className="px-4 pt-4 pb-4">
        <h1 className="text-role-h1 text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.18)]">Wunschlisten</h1>
        <p className="text-role-body text-glass-muted">{lists.length} {lists.length === 1 ? 'Liste' : 'Listen'}</p>
      </div>

      <div className="px-4 grid grid-cols-2 gap-3">
        {lists.map(list => (
          <WishlistTile key={list.id} list={list} />
        ))}
      </div>
    </div>
  );
}

function WishlistTile({ list }: { list: WishlistDoc }) {
  const isTemplate = !!list.templateBinderId;
  const count = list.items.length;
  return (
    <Link
      href={`/wishlist/${list.id}`}
      className="relative aspect-[3/4] rounded-2xl glass-inner flex flex-col items-center justify-center gap-2 px-3 text-center active:scale-[.98] transition-transform"
    >
      {isTemplate && (
        <span className="absolute top-2.5 right-2.5 text-glass-muted">
          <Lock size={13} />
        </span>
      )}
      <Heart size={28} className="text-glass-muted" />
      <span className="text-sm font-semibold text-glass truncate max-w-full">{list.name}</span>
      <span className="text-xs text-glass-muted">{count} {count === 1 ? 'Karte' : 'Karten'}</span>
    </Link>
  );
}
