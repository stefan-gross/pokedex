'use client';

import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Sheet } from '@/components/ui/modal';
import { BinderIcon } from '@/lib/binder-icons';
import { readableTextColor } from '@/lib/color-utils';
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
          {manualLists.length === 0 ? (
            <p className="text-role-label text-glass-muted px-1 pb-1 pt-1">
              Noch keine manuelle Wunschliste — leg eine an.
            </p>
          ) : (
            <p className="text-role-label text-glass-muted px-1 pb-2">Eine oder mehrere auswählen</p>
          )}

          {/* Pills in Übersicht-Reihenfolge. Jede Pill trägt Logo + Farbe +
              Name; enthalten = volle Deckkraft + Häkchen, nicht enthalten =
              gedimmt ohne Häkchen (Unterscheidung auch bei weißen Listen). */}
          <div className="flex flex-wrap gap-2">
            {manualLists.map(l => (
              <ListPill key={l.id} meta={l} member={memberIds.has(l.id)} onClick={() => onToggle(l.id)} />
            ))}

            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 min-h-11 px-3.5 rounded-full text-role-label text-glass-muted"
              style={{ border: '1px dashed var(--border-strong)' }}
            >
              <Plus size={16} className="shrink-0" />
              Neu
            </button>
          </div>

          {manualLists.length > 0 && (
            <div className="flex items-center gap-3 mt-3 px-1 text-role-label text-glass-muted">
              <span className="inline-flex items-center gap-1"><Check size={13} /> enthalten</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded-full bg-[var(--pokedex-red)] opacity-40" />
                gedimmt = nicht enthalten
              </span>
            </div>
          )}

          {/* Automatische Listen (read-only): zeigt, in welchen automatischen
              Sammlungen die Karte liegt — kein Toggle, nur Information. */}
          {autoLists.length > 0 && (
            <div className="mt-4 pt-3 border-t border-[var(--border)]">
              <p className="text-role-label text-glass-muted px-1 pb-2">In automatischer Wunschliste:</p>
              <div className="flex flex-wrap gap-2">
                {autoLists.map(l => (
                  <ListPill key={l.id} meta={l} readOnly />
                ))}
              </div>
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

/** Eine Wunschlisten-Pill: immer Logo + Hintergrundfarbe + Name.
 *  - manuell (`onClick`): Toggle — enthalten (`member`) = volle Deckkraft +
 *    Häkchen, sonst gedimmt ohne Häkchen.
 *  - `readOnly` (automatische Liste): kein Toggle, statt Häkchen ein „A"-Badge.
 *  Helle/weiße Farben (dunkle Kontrastschrift) bekommen eine feine Kontur,
 *  damit die Pill auf hellem Grund sichtbar bleibt. */
function ListPill({ meta, member, readOnly, onClick }: {
  meta: ManualListMeta;
  member?: boolean;
  readOnly?: boolean;
  onClick?: () => void;
}) {
  const bg = meta.color;
  const fg = bg ? readableTextColor(bg) : undefined;
  const lightBg = fg === '#1a1a1a';
  const className = `inline-flex items-center gap-1.5 ${readOnly ? 'min-h-9 pl-2.5 pr-1.5' : 'min-h-11 pl-2.5 pr-3.5'} rounded-full text-role-label font-medium transition-opacity ${bg ? '' : 'glass-inner text-glass'}`;
  const style: React.CSSProperties = {
    ...(bg ? { background: bg, color: fg } : {}),
    ...(lightBg ? { border: '1px solid rgba(0,0,0,0.14)' } : {}),
    ...(!readOnly && !member ? { opacity: 0.4 } : {}),
  };
  const inner = (
    <>
      <BinderIcon
        name={meta.icon ?? 'cards'}
        size={18}
        className={bg ? 'shrink-0' : 'shrink-0 text-glass-muted'}
        style={bg ? { color: fg } : undefined}
      />
      <span className="truncate max-w-[10rem]">{meta.name}</span>
      {readOnly ? (
        <span
          className="inline-flex items-center justify-center rounded-full text-[11px] font-semibold shrink-0"
          style={{ width: 18, height: 18, background: 'rgba(255,255,255,0.92)', color: '#1a1a1a' }}
          aria-label="Automatische Wunschliste"
          title="Automatische Wunschliste"
        >
          A
        </span>
      ) : member ? (
        <Check size={17} className="shrink-0" style={bg ? { color: fg } : { color: 'var(--pokedex-blue)' }} />
      ) : null}
    </>
  );

  if (readOnly) {
    return <div className={className} style={style} title="Automatisch verwaltet">{inner}</div>;
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={member} className={className} style={style}>
      {inner}
    </button>
  );
}
