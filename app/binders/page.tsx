'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { getBinders, deleteBinder } from '@/lib/firestore/binders';
import { CreateBinderModal } from '@/components/binder/CreateBinderModal';
import type { BinderDoc } from '@/types';

export default function BindersPage() {
  const [binders, setBinders] = useState<BinderDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    try {
      const data = await getBinders();
      setBinders(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="px-4 pt-12 pb-4 flex items-center justify-between border-b border-border">
        <div>
          <h1 className="text-2xl font-bold">Mappen</h1>
          <p className="text-sm text-muted-foreground">{binders.length} {binders.length === 1 ? 'Mappe' : 'Mappen'}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-white"
          style={{ background: 'var(--pokedex-red)' }}
        >
          <Plus size={20} />
        </button>
      </div>

      <div className="px-4 py-4">
        {loading && (
          <div className="flex justify-center pt-12">
            <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && binders.length === 0 && (
          <div className="text-center pt-16 space-y-3">
            <div className="text-5xl">📁</div>
            <p className="font-semibold">Noch keine Mappen</p>
            <p className="text-sm text-muted-foreground">Erstelle deine erste Mappe, um Karten zu organisieren</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ background: 'var(--pokedex-red)' }}
            >
              Erste Mappe erstellen
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {binders.map(binder => (
            <BinderTile key={binder.id} binder={binder} onDeleted={load} />
          ))}
        </div>
      </div>

      {showCreate && (
        <CreateBinderModal
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}

function BinderTile({ binder, onDeleted }: { binder: BinderDoc; onDeleted: () => void }) {
  const total = binder.cardIds.length + (binder.wishlistCardIds?.length ?? 0);
  const bgColor = binder.color ?? 'var(--pokedex-red)';

  return (
    <Link
      href={`/binders/${binder.id}`}
      className="relative rounded-2xl border border-border bg-card overflow-hidden flex flex-col min-h-[120px] active:scale-[.98] transition-transform"
    >
      {/* Color bar */}
      <div className="h-1.5 w-full" style={{ background: bgColor }} />

      <div className="flex-1 p-3 flex flex-col justify-between">
        <div className="flex items-start gap-2">
          <span className="text-2xl leading-none">{binder.icon ?? '📁'}</span>
          <div className="min-w-0">
            <div className="font-semibold text-sm leading-tight truncate">{binder.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{binder.size}er Mappe</div>
          </div>
        </div>

        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-muted-foreground">
            {binder.cardIds.length} Karten
            {(binder.wishlistCardIds?.length ?? 0) > 0 && (
              <span className="ml-1" style={{ color: '#ed64a6' }}>
                +{binder.wishlistCardIds.length} ♥
              </span>
            )}
          </span>
          <div
            className="text-xs font-bold px-2 py-0.5 rounded-full"
            style={{ background: `${bgColor}20`, color: bgColor }}
          >
            {total}/{binder.size}
          </div>
        </div>
      </div>
    </Link>
  );
}
