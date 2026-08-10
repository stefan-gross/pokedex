'use client';

import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Sheet } from '@/components/ui/modal';
import { BinderIcon } from '@/lib/binder-icons';
import { CreateWishlistModal } from '@/components/wishlist/CreateWishlistModal';

export interface ManualListMeta {
  id: string;
  name: string;
  icon?: string;
  color?: string;
}

/**
 * Auswahl-Drawer für MANUELLE Wunschlisten (Mehrfach-Toggle) — togglet die
 * Karte auf/von der jeweiligen Liste (Häkchen), schließt NICHT bei jedem Tap.
 * „Neue Wunschliste" öffnet den vollen `CreateWishlistModal` (Name+Icon+Farbe),
 * derselbe wie in der Übersicht. Automatische (Vorlagen-)Listen erscheinen hier
 * bewusst nicht — sie sind sync-verwaltet.
 */
export function WishlistPickerSheet({
  open, onClose, manualLists, memberIds, onToggle, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  manualLists: ManualListMeta[];
  /** listIds, auf denen die Karte aktuell liegt. */
  memberIds: Set<string>;
  onToggle: (listId: string) => void;
  /** Neue Liste wurde angelegt → id (Aufrufer nimmt die Karte auf). */
  onCreated: (listId: string) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <Sheet open={open} onClose={onClose} title="Wunschlisten" dragToClose elevated>
        <div className="flex flex-col">
          {manualLists.length === 0 && (
            <p className="text-role-label text-glass-muted px-1 pb-1 pt-1">
              Noch keine manuelle Wunschliste — leg eine an.
            </p>
          )}

          {manualLists.map(l => {
            const member = memberIds.has(l.id);
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => onToggle(l.id)}
                className="w-full flex items-center gap-3 px-1 py-3 text-left border-b border-[var(--border)] last:border-b-0"
              >
                <BinderIcon
                  name={l.icon ?? 'cards'}
                  size={20}
                  className={l.color ? 'shrink-0' : 'shrink-0 text-glass-muted'}
                  style={l.color ? { color: l.color } : undefined}
                />
                <span className="flex-1 truncate text-role-body text-glass">{l.name}</span>
                {member && <Check size={18} className="shrink-0" style={{ color: 'var(--pokedex-blue)' }} />}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="w-full flex items-center gap-3 px-1 py-3 text-left text-glass"
          >
            <Plus size={18} className="shrink-0" />
            <span className="text-role-body">Neue Wunschliste</span>
          </button>
        </div>
      </Sheet>

      {createOpen && (
        <CreateWishlistModal
          onClose={() => setCreateOpen(false)}
          onSaved={(id) => { setCreateOpen(false); onCreated(id); }}
        />
      )}
    </>
  );
}
