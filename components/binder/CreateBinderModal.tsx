'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Search } from 'lucide-react';
import { addBinder, updateBinder } from '@/lib/firestore/binders';
import { BINDER_ICON_KEYS, BinderIcon } from '@/lib/binder-icons';
import { EnergyIcon } from '@/components/ui/EnergyIcon';
import { ButtonGroup } from '@/components/ui/button-group';
import { TCG_TYPES } from '@/lib/hooks/useCardBrowser';
import { getAllSets, filterSets, type TcgSet } from '@/lib/firestore/sets';
import { SERIES_NAMES_DE } from '@/lib/card-constants';
import { BINDER_SIZES, type BinderSize } from '@/lib/binder-sizes';
import { initialSheetCount } from '@/lib/binder-sheets';
import type { BinderDoc, BinderPage } from '@/types';

type PickerTab = 'icons' | 'types' | 'set';

const COLORS = ['#e53e3e', '#ed8936', '#ecc94b', '#48bb78', '#38b2ac', '#4299e1', '#667eea', '#ed64a6'];

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

/** Getönter Glas-Chip für den primären Aktions-Button — dasselbe Rezept wie
 *  der Scan-FAB (BottomNav) und die Aktions-Buttons auf der Sammlungsseite. */
function tintedGlassStyle(hex: string): React.CSSProperties {
  const rgb = hexToRgb(hex);
  return {
    background: `rgba(${rgb},0.85)`,
    backdropFilter: 'blur(10px) saturate(1.4)',
    WebkitBackdropFilter: 'blur(10px) saturate(1.4)',
    border: '1.5px solid rgba(255,255,255,0.5)',
    boxShadow: `inset 0 1px 2px rgba(255,255,255,0.6), 0 0 14px rgba(${rgb},0.5), 0 4px 12px rgba(0,0,0,0.3)`,
  };
}

interface Props {
  existing?: BinderDoc;
  onClose: () => void;
  onSaved: () => void;
}

export function CreateBinderModal({ existing, onClose, onSaved }: Props) {
  const [collectionType, setCollectionType] = useState<'binder' | 'box'>(existing?.collectionType ?? 'binder');
  const [name,   setName]   = useState(existing?.name ?? '');
  const [icon,   setIcon]   = useState(existing?.icon ?? 'folder');
  const [color,  setColor]  = useState(existing?.color ?? '#e53e3e');
  const [size,     setSize]     = useState<BinderSize>((existing?.size as BinderSize) ?? 9);
  const [capacity, setCapacity] = useState<string>(existing?.capacity != null ? String(existing.capacity) : '');
  const [pageBg,   setPageBg]   = useState<'black' | 'white' | 'transparent'>(existing?.pageBackground ?? 'black');
  const [saving,   setSaving]   = useState(false);
  const [pickerTab,  setPickerTab]  = useState<PickerTab>('icons');
  const [setQuery,   setSetQuery]   = useState('');
  const [allSets,    setAllSets]    = useState<TcgSet[]>([]);
  const setsLoadedRef = useRef(false);

  const isBinder = collectionType === 'binder';

  useEffect(() => {
    if (pickerTab === 'set' && !setsLoadedRef.current) {
      setsLoadedRef.current = true;
      getAllSets().then(setAllSets).catch(() => {});
    }
  }, [pickerTab]);

  const filteredSets = useMemo(
    () => filterSets(allSets, setQuery).slice(0, 15),
    [allSets, setQuery],
  );

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // Beim Bearbeiten: leeres Feld → null (löscht den Wert in Firestore).
      // Beim Neu-Erstellen: leeres Feld → undefined (Feld wird gar nicht geschrieben).
      const parsedCapacity = capacity.trim() === ''
        ? (existing ? null : undefined)
        : Math.max(1, Math.floor(Number(capacity)));
      const data = {
        name: name.trim(),
        icon,
        color,
        collectionType,
        ...(isBinder ? { size, capacity: parsedCapacity, pageBackground: pageBg } : {}),
      };
      if (existing) {
        await updateBinder(existing.id, data);
      } else {
        // Bei Neuanlage: leere Blätter direkt mit anlegen, damit der User
        // sofort durchblättern kann. Anzahl aus Capacity berechnet (1 Blatt = 2 Pages).
        const sheetCount = isBinder ? initialSheetCount(parsedCapacity, size) : 0;
        const initialPages: BinderPage[] = isBinder
          ? Array.from({ length: sheetCount * 2 }, () => ({ slots: Array(size).fill(null) }))
          : [];
        await addBinder({
          ...data,
          size: isBinder ? size : 9,
          sortOrder: Date.now(),
          ...(initialPages.length > 0 ? { pages: initialPages } : {}),
        });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full rounded-t-2xl glass border-t border-white/20 dark:border-white/10 flex flex-col max-h-[85dvh] mb-16">
        <div className="w-10 h-1 rounded-full bg-white/30 mx-auto mt-3 mb-1 shrink-0" />
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-2">

        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-glass">{existing ? 'Sammlung bearbeiten' : 'Neue Sammlung'}</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-full glass-inner flex items-center justify-center text-glass">
            <X size={14} />
          </button>
        </div>

        {/* Typ-Auswahl — nur beim Erstellen */}
        {!existing && (
          <div className="mb-4">
            <label className="text-xs text-glass-muted mb-1.5 block">Typ</label>
            <div className="grid grid-cols-2 gap-2">
              {([['binder', 'folder', 'Binder', 'Ordner mit Seitenraster'], ['box', 'box', 'Box', 'Offene Box ohne Limit']] as const).map(
                ([val, iconKey, label, sub]) => (
                  <button
                    key={val}
                    onClick={() => {
                      setCollectionType(val);
                      setIcon(val === 'box' ? 'box' : 'folder');
                    }}
                    className={`flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-xl border-2 transition-colors text-left ${collectionType === val ? '' : 'glass-inner'}`}
                    style={{
                      borderColor: collectionType === val ? color : 'transparent',
                      background: collectionType === val ? `${color}15` : undefined,
                    }}
                  >
                    <BinderIcon name={iconKey} size={22} className="mt-0.5" style={{ color: collectionType === val ? color : undefined }} />
                    <span className="text-sm font-semibold mt-1 text-glass">{label}</span>
                    <span className="text-[10px] text-glass-muted">{sub}</span>
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {/* Name */}
        <div className="mb-3">
          <label className="text-xs text-glass-muted mb-1 block">Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={isBinder ? 'z.B. Elektro-Stars' : 'z.B. Hoenn-Box'}
            className="w-full h-10 px-3 rounded-xl glass-inner text-glass text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-glass-muted"
          />
        </div>

        {/* Icon picker */}
        <div className="mb-3">
          <label className="text-xs text-glass-muted mb-1.5 block">Icon</label>

          {/* Tabs */}
          <ButtonGroup
            className="mb-2"
            value={pickerTab}
            onChange={setPickerTab}
            options={[
              { value: 'icons', label: 'Basis' },
              { value: 'types', label: 'Typen' },
              { value: 'set',   label: 'Sets' },
            ]}
          />

          {/* Basis */}
          {pickerTab === 'icons' && (
            <div className="flex flex-wrap gap-2">
              {BINDER_ICON_KEYS.map(key => (
                <button
                  key={key}
                  onClick={() => setIcon(key)}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center border-2 transition-colors ${icon === key ? '' : 'glass-inner'}`}
                  style={{ borderColor: icon === key ? color : 'transparent', background: icon === key ? `${color}20` : undefined }}
                >
                  <BinderIcon name={key} size={18} style={{ color: icon === key ? color : 'var(--muted-foreground)' }} />
                </button>
              ))}
            </div>
          )}

          {/* Typen */}
          {pickerTab === 'types' && (
            <div className="flex flex-wrap gap-2">
              {TCG_TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => setIcon(`type:${t}`)}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center border-2 transition-colors ${icon === `type:${t}` ? '' : 'glass-inner'}`}
                  style={{ borderColor: icon === `type:${t}` ? color : 'transparent', background: icon === `type:${t}` ? `${color}20` : undefined }}
                >
                  <EnergyIcon type={t} size={24} />
                </button>
              ))}
            </div>
          )}

          {/* Sets */}
          {pickerTab === 'set' && (
            <div>
              <div className="relative mb-2">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-glass-muted pointer-events-none" />
                <input
                  type="search"
                  value={setQuery}
                  onChange={e => setSetQuery(e.target.value)}
                  placeholder="Name oder Kürzel (z.B. PAL)"
                  className="w-full h-8 pl-7 pr-3 rounded-lg glass-inner text-glass text-xs focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-glass-muted"
                />
              </div>
              {allSets.length === 0 ? (
                <p className="text-xs text-glass-muted text-center py-3">Lade Sets…</p>
              ) : filteredSets.length === 0 ? (
                <p className="text-xs text-glass-muted text-center py-3">Kein Set gefunden</p>
              ) : (
                <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                  {filteredSets.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setIcon(`set:${s.id}`)}
                      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg border-2 text-left transition-colors ${icon === `set:${s.id}` ? '' : 'glass-inner'}`}
                      style={{
                        borderColor: icon === `set:${s.id}` ? color : 'transparent',
                        background:  icon === `set:${s.id}` ? `${color}20` : undefined,
                      }}
                    >
                      {/* Logo */}
                      <div className="w-14 shrink-0 flex items-center justify-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={s.logoUrl ?? `https://images.pokemontcg.io/${s.id}/logo.png`}
                          alt={s.id}
                          className="max-h-7 max-w-[56px] object-contain"
                          onError={e => {
                            const img = e.currentTarget as HTMLImageElement;
                            const en = `https://images.pokemontcg.io/${s.id}/logo.png`;
                            if (img.src !== en) img.src = en;
                          }}
                        />
                      </div>
                      {/* Name + Serie */}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate text-glass">{s.nameDe ?? s.name}</div>
                        <div className="text-[10px] text-glass-muted truncate">
                          {SERIES_NAMES_DE[s.series] ?? s.series}
                        </div>
                      </div>
                      {/* Kürzel-Badge */}
                      {s.ptcgoCode && (
                        <span
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded-md border shrink-0 text-glass"
                          style={{ borderColor: 'currentcolor' }}
                        >
                          {s.ptcgoCode}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Color picker */}
        <div className="mb-3">
          <label className="text-xs text-glass-muted mb-1 block">Farbe</label>
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

        {/* Größe + Kapazität — nur für Binder */}
        {isBinder && (
          <>
            <div className="mb-5">
              <label className="text-xs text-glass-muted mb-1 block">Seitenlayout</label>
              <ButtonGroup
                value={String(size)}
                onChange={v => setSize(Number(v) as BinderSize)}
                options={BINDER_SIZES.map(s => ({ value: String(s.value), label: s.label }))}
              />
            </div>

            <div className="mb-5">
              <label className="text-xs text-glass-muted mb-1 block">
                Kapazität <span className="text-glass-muted/60">(optional)</span>
              </label>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={capacity}
                onChange={e => setCapacity(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="z.B. 400 — wie viele Karten passen rein?"
                className="w-full h-10 rounded-md glass-inner text-glass px-3 text-sm placeholder:text-glass-muted"
              />
            </div>

            <div className="mb-5">
              <label className="text-xs text-glass-muted mb-1 block">Seiten-Hintergrund</label>
              <ButtonGroup
                value={pageBg}
                onChange={setPageBg}
                options={[
                  { value: 'black',       label: <>
                    <span className="w-3.5 h-3.5 rounded-sm border border-white/30 shrink-0" style={{ background: '#1a1a1a' }} /> Schwarz
                  </> },
                  { value: 'white',       label: <>
                    <span className="w-3.5 h-3.5 rounded-sm border border-white/30 shrink-0" style={{ background: '#f3f4f6' }} /> Weiß
                  </> },
                  { value: 'transparent', label: <>
                    <span className="w-3.5 h-3.5 rounded-sm border border-white/30 shrink-0" style={{ background: 'rgba(127,127,127,0.18)' }} /> Halbtransparent
                  </> },
                ]}
              />
            </div>
          </>
        )}

        </div>{/* end scroll container */}

        {/* Sticky footer */}
        <div className="px-4 pb-safe pt-2 border-t border-white/20 dark:border-white/10 shrink-0">
          <button
            onClick={save}
            disabled={!name.trim() || saving}
            className="w-full h-11 rounded-xl font-semibold text-sm text-white disabled:opacity-40"
            style={tintedGlassStyle(color)}
          >
            {saving ? 'Speichern…' : existing ? 'Änderungen speichern' : 'Sammlung erstellen'}
          </button>
        </div>
      </div>
    </div>
  );
}
