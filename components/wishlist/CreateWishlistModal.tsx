'use client';

import { useState } from 'react';
import { Sheet } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IconPicker } from '@/components/binder/IconPicker';
import { addWishlist, updateWishlist } from '@/lib/firestore/wishlists';
import type { WishlistDoc } from '@/types';

// Gleiche Palette/Akzente wie CreateBinderModal → einheitliches Erlebnis.
const COLORS = ['#1a1a1a', '#ffffff', '#e53e3e', '#4299e1', '#ecc94b', '#48bb78', '#667eea'];
const ACCENT = '#e53e3e';
const ADD_ACCENT = '#2f855a';
const PRIMARY_ACCENT = '#3182ce';

/**
 * Erstellen/Bearbeiten einer manuellen Wunschliste — Name + Icon + Farbe,
 * analog zu `CreateBinderModal` (derselbe `IconPicker` + dieselbe Farbpalette).
 * Wird sowohl in der Wunschlisten-Übersicht („+"/Stift) als auch im
 * Kartendetail-Drawer („Neue Wunschliste") verwendet. `onSaved` liefert die
 * (neue) Listen-ID, damit der Drawer die Karte gleich aufnehmen kann.
 */
export function CreateWishlistModal({
  existing, onClose, onSaved, onBack, title,
}: {
  existing?: WishlistDoc;
  onClose: () => void;
  onSaved: (id: string) => void;
  onBack?: () => void;
  title?: string;
}) {
  const [name, setName]   = useState(existing?.name ?? '');
  const [icon, setIcon]   = useState(existing?.icon ?? 'star');
  const [color, setColor] = useState(existing?.color ?? '#e53e3e');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      if (existing) {
        await updateWishlist(existing.id, { name: name.trim(), icon, color });
        onSaved(existing.id);
      } else {
        const id = await addWishlist(name.trim(), { icon, color });
        onSaved(id);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      onBack={onBack}
      title={title ?? (existing ? 'Wunschliste bearbeiten' : 'Neue Wunschliste')}
      dragToClose
      elevated
      footer={
        <Button
          variant="primary"
          accentColor={existing ? PRIMARY_ACCENT : ADD_ACCENT}
          size="lg"
          className="w-full"
          onClick={save}
          disabled={!name.trim() || saving}
        >
          {saving ? 'Speichern…' : existing ? 'Änderungen speichern' : 'Wunschliste erstellen'}
        </Button>
      }
    >
      <div className="mb-3">
        <label className="text-xs text-muted-foreground mb-1 block">Name</label>
        <Input value={name} onChange={setName} placeholder="z.B. Flohmarkt, Cardmarket" autoFocus />
      </div>

      <div className="mb-3">
        <label className="text-xs text-muted-foreground mb-1.5 block">Icon</label>
        <IconPicker value={icon} onChange={setIcon} accent={ACCENT} />
      </div>

      <div className="mb-3">
        <label className="text-xs text-muted-foreground mb-1 block">Farbe</label>
        <div className="flex gap-1">
          {COLORS.map(c => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className="w-11 h-11 rounded-full border-2 transition-all"
              style={{
                background: c,
                borderColor: color === c ? 'transparent' : 'rgba(0,0,0,0.12)',
                boxShadow: color === c ? `0 0 0 2px var(--background), 0 0 0 4px ${c}` : undefined,
              }}
            />
          ))}
        </div>
      </div>
    </Sheet>
  );
}
