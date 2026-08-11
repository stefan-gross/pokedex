'use client';

import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Sheet } from '@/components/ui/modal';
import { BinderIcon } from '@/lib/binder-icons';
import { AutomaticBadge } from '@/components/binder/CollectionTypeBadge';
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
 * derselbe wie in der Übersicht. Automatische (Vorlagen-)Listen sind NICHT
 * umschaltbar (sync-verwaltet), werden aber — sofern die Karte auf ihnen liegt —
 * unten als reine Information angezeigt (`autoLists`), damit man auch aus der
 * Suche heraus sieht, ob/in welcher automatischen Sammlung eine Karte steckt.
 */
export function WishlistPickerSheet({
  open, onClose, manualLists, memberIds, onToggle, onCreated, autoLists = [],
}: {
  open: boolean;
  onClose: () => void;
  manualLists: ManualListMeta[];
  /** listIds, auf denen die Karte aktuell liegt. */
  memberIds: Set<string>;
  onToggle: (listId: string) => void;
  /** Neue Liste wurde angelegt → id (Aufrufer nimmt die Karte auf). */
  onCreated: (listId: string) => void;
  /** Automatische Listen, auf denen die Karte liegt — nur zur Information. */
  autoLists?: ManualListMeta[];
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

          {/* Automatische Listen (read-only): zeigt, in welchen automatischen
              Sammlungen die Karte fehlt/liegt — kein Toggle, nur Information. */}
          {autoLists.length > 0 && (
            <div className="mt-2 pt-2 border-t border-[var(--border)]">
              <p className="text-role-label text-glass-muted px-1 pb-1">
                Automatisch · über die Sammlung verwaltet
              </p>
              {autoLists.map(l => (
                <div key={l.id} className="w-full flex items-center gap-3 px-1 py-2.5 opacity-80">
                  <BinderIcon
                    name={l.icon ?? 'cards'}
                    size={20}
                    className={l.color ? 'shrink-0' : 'shrink-0 text-glass-muted'}
                    style={l.color ? { color: l.color } : undefined}
                  />
                  <span className="flex-1 truncate text-role-body text-glass">{l.name}</span>
                  <AutomaticBadge size="sm" />
                </div>
              ))}
            </div>
          )}
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
