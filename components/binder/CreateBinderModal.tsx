'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { addBinder, updateBinder } from '@/lib/firestore/binders';
import type { BinderDoc } from '@/types';

const ICONS = ['📁', '📦', '⚡', '🔥', '💧', '🌿', '🌸', '🌙', '⭐', '🎴', '🏆', '💎', '🐉', '🗃️'];
const COLORS = ['#e53e3e', '#ed8936', '#ecc94b', '#48bb78', '#38b2ac', '#4299e1', '#667eea', '#ed64a6'];
const SIZES: { value: 9 | 12 | 16 | 18; label: string }[] = [
  { value: 9,  label: '9er (3×3)'  },
  { value: 12, label: '12er (3×4)' },
  { value: 16, label: '16er (4×4)' },
  { value: 18, label: '18er (3×6)' },
];

interface Props {
  existing?: BinderDoc;
  onClose: () => void;
  onSaved: () => void;
}

export function CreateBinderModal({ existing, onClose, onSaved }: Props) {
  const [collectionType, setCollectionType] = useState<'binder' | 'box'>(existing?.collectionType ?? 'binder');
  const [name,   setName]   = useState(existing?.name ?? '');
  const [icon,   setIcon]   = useState(existing?.icon ?? '📁');
  const [color,  setColor]  = useState(existing?.color ?? '#e53e3e');
  const [size,   setSize]   = useState<9 | 12 | 16 | 18>(existing?.size ?? 9);
  const [saving, setSaving] = useState(false);

  const isBinder = collectionType === 'binder';

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const data = {
        name: name.trim(),
        icon,
        color,
        collectionType,
        ...(isBinder ? { size } : {}),
      };
      if (existing) {
        await updateBinder(existing.id, data);
      } else {
        await addBinder({ ...data, size: isBinder ? size : 9, sortOrder: Date.now() });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full rounded-t-2xl bg-card border-t border-border p-4">
        <div className="w-10 h-1 rounded-full bg-border mx-auto mb-4" />

        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">{existing ? 'Sammlung bearbeiten' : 'Neue Sammlung'}</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
            <X size={14} />
          </button>
        </div>

        {/* Typ-Auswahl — nur beim Erstellen */}
        {!existing && (
          <div className="mb-4">
            <label className="text-xs text-muted-foreground mb-1.5 block">Typ</label>
            <div className="grid grid-cols-2 gap-2">
              {([['binder', '📁', 'Binder', 'Ordner mit Seitenraster'], ['box', '📦', 'Box', 'Offene Box ohne Limit']] as const).map(
                ([val, emoji, label, sub]) => (
                  <button
                    key={val}
                    onClick={() => {
                      setCollectionType(val);
                      setIcon(val === 'box' ? '📦' : '📁');
                    }}
                    className="flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-xl border-2 transition-colors text-left"
                    style={{
                      borderColor: collectionType === val ? color : 'var(--border)',
                      background: collectionType === val ? `${color}15` : 'var(--secondary)',
                    }}
                  >
                    <span className="text-xl leading-none">{emoji}</span>
                    <span className="text-sm font-semibold mt-1">{label}</span>
                    <span className="text-[10px] text-muted-foreground">{sub}</span>
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {/* Name */}
        <div className="mb-3">
          <label className="text-xs text-muted-foreground mb-1 block">Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={isBinder ? 'z.B. Elektro-Stars' : 'z.B. Hoenn-Box'}
            className="w-full h-10 px-3 rounded-xl border border-border bg-secondary text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Icon picker */}
        <div className="mb-3">
          <label className="text-xs text-muted-foreground mb-1 block">Icon</label>
          <div className="flex flex-wrap gap-2">
            {ICONS.map(i => (
              <button
                key={i}
                onClick={() => setIcon(i)}
                className="w-9 h-9 rounded-xl text-lg flex items-center justify-center border-2 transition-colors"
                style={{ borderColor: icon === i ? color : 'transparent', background: icon === i ? `${color}20` : 'var(--secondary)' }}
              >
                {i}
              </button>
            ))}
          </div>
        </div>

        {/* Color picker */}
        <div className="mb-3">
          <label className="text-xs text-muted-foreground mb-1 block">Farbe</label>
          <div className="flex gap-2">
            {COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="w-7 h-7 rounded-full border-2 border-transparent transition-all"
                style={{
                  background: c,
                  boxShadow: color === c ? `0 0 0 2px var(--background), 0 0 0 4px ${c}` : undefined,
                }}
              />
            ))}
          </div>
        </div>

        {/* Größe — nur für Binder */}
        {isBinder && (
          <div className="mb-5">
            <label className="text-xs text-muted-foreground mb-1 block">Größe</label>
            <div className="flex gap-2 flex-wrap">
              {SIZES.map(s => (
                <button
                  key={s.value}
                  onClick={() => setSize(s.value)}
                  className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors"
                  style={{
                    borderColor: size === s.value ? color : 'var(--border)',
                    background: size === s.value ? `${color}20` : 'var(--secondary)',
                    color: size === s.value ? color : undefined,
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isBinder && <div className="mb-5" />}

        <button
          onClick={save}
          disabled={!name.trim() || saving}
          className="w-full h-11 rounded-xl font-semibold text-sm text-white disabled:opacity-40"
          style={{ background: color }}
        >
          {saving ? 'Speichern…' : existing ? 'Änderungen speichern' : 'Sammlung erstellen'}
        </button>
      </div>
    </div>
  );
}
