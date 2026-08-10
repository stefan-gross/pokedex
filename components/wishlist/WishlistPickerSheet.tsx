'use client';

import { useState } from 'react';
import { Check, Plus, Heart } from 'lucide-react';
import { Sheet } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/**
 * Auswahl-Drawer für MANUELLE Wunschlisten (Mehrfach-Toggle) — im Gegensatz zum
 * single-select `CollectionPickerSheet` schließt er NICHT bei jedem Tap, sondern
 * togglet die Karte auf/von der jeweiligen Liste (Häkchen). Unten „Neue
 * Wunschliste" (Inline-Eingabe). Automatische (Vorlagen-)Listen tauchen hier
 * bewusst nicht auf — sie sind sync-verwaltet und nicht manuell änderbar.
 */
export function WishlistPickerSheet({
  open, onClose, manualLists, memberIds, onToggle, onCreate,
}: {
  open: boolean;
  onClose: () => void;
  manualLists: { id: string; name: string }[];
  /** listIds, auf denen die Karte aktuell liegt. */
  memberIds: Set<string>;
  onToggle: (listId: string) => void;
  onCreate: (name: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const submitCreate = () => {
    const n = name.trim();
    if (!n) return;
    onCreate(n);
    setName('');
    setCreating(false);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Auf Wunschliste" dragToClose elevated>
      <div className="flex flex-col">
        {manualLists.length === 0 && !creating && (
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
              <Heart
                size={18}
                fill={member ? '#ef4444' : 'none'}
                stroke={member ? '#ef4444' : 'currentColor'}
                className={member ? 'shrink-0' : 'shrink-0 text-glass-muted'}
              />
              <span className="flex-1 truncate text-role-body text-glass">{l.name}</span>
              {member && <Check size={18} className="shrink-0 text-glass" />}
            </button>
          );
        })}

        {creating ? (
          <div className="flex items-center gap-2 pt-3">
            <Input value={name} onChange={setName} placeholder="Name der Wunschliste" size="sm" autoFocus className="flex-1" />
            <Button variant="primary" size="sm" onClick={submitCreate} disabled={!name.trim()}>Anlegen</Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="w-full flex items-center gap-3 px-1 py-3 text-left text-glass"
          >
            <Plus size={18} className="shrink-0" />
            <span className="text-role-body">Neue Wunschliste</span>
          </button>
        )}
      </div>
    </Sheet>
  );
}
