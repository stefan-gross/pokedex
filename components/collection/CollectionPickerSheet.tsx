'use client';

import { Sheet } from '@/components/ui/modal';
import { BinderIcon } from '@/lib/binder-icons';

export interface CollectionPickItem {
  /** Binder-Id, oder `null` für „Unsortiert"/Ablage (Kartendetail-Semantik). */
  id: string | null;
  /** BinderIcon-Name (Set-Logo/Energie/Lucide) — siehe `lib/binder-icons`. */
  icon: string;
  name: string;
  /** Gedämpfter Zusatz rechts (z.B. „Automatisch", „Empfohlen"). */
  hint?: string;
  /** Optionale Icon-Farbe (z.B. Binder-Farbe); sonst gedämpftes Glas. */
  color?: string;
}

export interface CollectionPickGroup {
  /** Überschrift der Gruppe (z.B. „Vorschläge", „Manuelle Sammlungen"). */
  label?: string;
  items: CollectionPickItem[];
}

/**
 * Wiederverwendbarer Zielsammlungs-Picker als Bottom-Sheet — extrahiert aus dem
 * bis dahin inline in `CardDetailSheet` liegenden „Verschieben nach"-Sheet.
 * Jede Gruppe (Vorschläge/Empfohlen · Manuelle Sammlungen · Ablage) rendert
 * eine Zeile pro Ziel (Icon/Logo + Name + optionaler Hinweis). Der Trigger +
 * das `open`-State liegen beim Aufrufer (im Kartendetail ein Standort-Button,
 * im Scanner ein Sammlungs-Feld) — hier nur das Sheet selbst.
 */
export function CollectionPickerSheet({
  open, onClose, title = 'Sammlung wählen', groups, onPick, fromScanner = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  groups: CollectionPickGroup[];
  onPick: (id: string | null) => void;
  /** Scanner liegt über dem Kamerabild → Sheet immer dunkel (forceDark). */
  fromScanner?: boolean;
}) {
  const visible = groups.filter(g => g.items.length > 0);
  return (
    // Scanner ist bereits `fixed inset-0 overflow-hidden` → Body-Scroll-Lock dort
    // unnötig und verursacht auf iOS einen Sprung; deshalb im Scanner aus.
    <Sheet open={open} onClose={onClose} title={title} forceDark={fromScanner} lockScroll={!fromScanner} dragToClose elevated>
      <div className="flex flex-col">
        {visible.map((g, gi) => (
          <div key={g.label ?? gi} className="flex flex-col">
            {g.label && (
              <p className={`text-role-label text-glass-muted px-1 pb-1 ${gi === 0 ? 'pt-1' : 'pt-3'}`}>{g.label}</p>
            )}
            {g.items.map(it => (
              <button
                key={it.id ?? '__unsorted__'}
                type="button"
                onClick={() => { onClose(); onPick(it.id); }}
                className="w-full flex items-center gap-3 px-1 py-3 text-left border-b border-[var(--border)] last:border-b-0"
              >
                <BinderIcon
                  name={it.icon}
                  size={18}
                  className={it.color ? 'shrink-0' : 'shrink-0 text-glass-muted'}
                  style={it.color ? { color: it.color } : undefined}
                />
                <span className="flex-1 truncate text-role-body text-glass">{it.name}</span>
                {it.hint && <span className="text-[11px] text-glass-muted shrink-0">{it.hint}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
