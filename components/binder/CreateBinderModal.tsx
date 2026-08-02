'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { addBinder, updateBinder } from '@/lib/firestore/binders';
import { syncTemplateBinders } from '@/lib/template-binders/sync';
import { BINDER_ICON_KEYS, BinderIcon } from '@/lib/binder-icons';
import { EnergyIcon } from '@/components/ui/EnergyIcon';
import { ButtonGroup } from '@/components/ui/button-group';
import { Sheet } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TCG_TYPES } from '@/lib/hooks/useCardBrowser';
import { getAllSets, filterSets, type TcgSet } from '@/lib/firestore/sets';
import { SERIES_NAMES_DE } from '@/lib/card-constants';
import { BINDER_SIZES, type BinderSize } from '@/lib/binder-sizes';
import { initialSheetCount } from '@/lib/binder-sheets';
import type { BinderDoc, BinderPage, BinderTemplate } from '@/types';

type PickerTab = 'icons' | 'types' | 'set';

const COLORS = ['#1a1a1a', '#ffffff', '#e53e3e', '#4299e1', '#ecc94b', '#48bb78', '#667eea'];

/** Fixer Akzent für die Auswahl-Hervorhebungen im Drawer (Typ-/Icon-Picker)
 *  — bewusst UNABHÄNGIG von der gewählten Sammlungsfarbe, sonst würde z.B.
 *  ein weißer/schwarzer Farbwahl die Hervorhebungen mitverfärben. */
const ACCENT = '#e53e3e';
// Footer-Button: Neu anlegen = Hinzufügen-Grün (wie die "Neue Sammlung"-
// Kachel/CTA anderswo), Bestehendes bearbeiten = normales Primary-Blau.
const ADD_ACCENT = '#2f855a';
const PRIMARY_ACCENT = '#3182ce';

interface Props {
  existing?: BinderDoc;
  /** Gesetzt = Vorlagen-Binder wird angelegt (Illustrator/Pokédex/
   *  Evolutionslinie/Master-Set) — Name/Icon/Farbe unten sind Vorschläge,
   *  die vor dem Erstellen noch angepasst werden können; Typ ist dann
   *  immer 'binder' (kein Box-Vorlagen-Binder, da Vorlagen positionale
   *  Slots brauchen). Nach dem Erstellen läuft sofort ein erster Sync,
   *  damit der Binder nicht leer bleibt, bis der nächste Cron-Lauf kommt. */
  templateDraft?: BinderTemplate;
  initialName?: string;
  initialIcon?: string;
  initialColor?: string;
  onClose: () => void;
  onSaved: () => void;
}

export function CreateBinderModal({ existing, templateDraft, initialName, initialIcon, initialColor, onClose, onSaved }: Props) {
  const [collectionType, setCollectionType] = useState<'binder' | 'box'>(existing?.collectionType ?? 'binder');
  const [name,   setName]   = useState(existing?.name ?? initialName ?? '');
  const [icon,   setIcon]   = useState(existing?.icon ?? initialIcon ?? 'folder');
  const [color,  setColor]  = useState(existing?.color ?? initialColor ?? '#e53e3e');
  const [size,     setSize]     = useState<BinderSize>((existing?.size as BinderSize) ?? 9);
  const [capacity, setCapacity] = useState<string>(existing?.capacity != null ? String(existing.capacity) : '');
  const [pageBg,   setPageBg]   = useState<'black' | 'white' | 'transparent'>(existing?.pageBackground ?? 'black');
  const [saving,   setSaving]   = useState(false);
  const initialIconValue = existing?.icon ?? initialIcon ?? 'folder';
  const [pickerTab,  setPickerTab]  = useState<PickerTab>(
    initialIconValue.startsWith('set:') ? 'set' : initialIconValue.startsWith('type:') ? 'types' : 'icons',
  );
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
        const newId = await addBinder({
          ...data,
          size: isBinder ? size : 9,
          sortOrder: Date.now(),
          ...(templateDraft ? { template: templateDraft } : {}),
          ...(initialPages.length > 0 ? { pages: initialPages } : {}),
        });
        // Vorlagen-Binder sofort einmal befüllen, statt auf den nächsten
        // Cron-Lauf zu warten.
        if (templateDraft) await syncTemplateBinders({ binderIds: [newId] });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={existing ? 'Sammlung bearbeiten' : 'Neue Sammlung'}
      footer={
        <Button
          variant="primary"
          accentColor={existing ? PRIMARY_ACCENT : ADD_ACCENT}
          size="lg"
          className="w-full"
          onClick={save}
          disabled={!name.trim() || saving}
        >
          {saving ? 'Speichern…' : existing ? 'Änderungen speichern' : 'Sammlung erstellen'}
        </Button>
      }
    >
        {/* Typ-Auswahl — nur beim Erstellen, nicht für Vorlagen-Binder
            (immer 'binder', da Vorlagen positionale Slots brauchen) */}
        {!existing && !templateDraft && (
          <div className="mb-4">
            <label className="text-xs text-muted-foreground mb-1.5 block">Typ</label>
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
                      borderColor: collectionType === val ? ACCENT : 'transparent',
                      background: collectionType === val ? `${ACCENT}15` : undefined,
                    }}
                  >
                    <BinderIcon name={iconKey} size={22} className="mt-0.5" style={{ color: collectionType === val ? ACCENT : undefined }} />
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
          <Input
            value={name}
            onChange={setName}
            placeholder={isBinder ? 'z.B. Elektro-Stars' : 'z.B. Hoenn-Box'}
          />
        </div>

        {/* Icon picker */}
        <div className="mb-3">
          <label className="text-xs text-muted-foreground mb-1.5 block">Icon</label>

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
                  className={`w-11 h-11 rounded-xl flex items-center justify-center border-2 transition-colors ${icon === key ? '' : 'glass-inner'}`}
                  style={{ borderColor: icon === key ? ACCENT : 'transparent', background: icon === key ? `${ACCENT}20` : undefined }}
                >
                  <BinderIcon name={key} size={18} style={{ color: icon === key ? ACCENT : 'var(--muted-foreground)' }} />
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
                  className={`w-11 h-11 rounded-xl flex items-center justify-center border-2 transition-colors ${icon === `type:${t}` ? '' : 'glass-inner'}`}
                  style={{ borderColor: icon === `type:${t}` ? ACCENT : 'transparent', background: icon === `type:${t}` ? `${ACCENT}20` : undefined }}
                >
                  <EnergyIcon type={t} size={24} />
                </button>
              ))}
            </div>
          )}

          {/* Sets */}
          {pickerTab === 'set' && (
            <div>
              <Input
                variant="search"
                size="sm"
                className="mb-2"
                value={setQuery}
                onChange={setSetQuery}
                onClear={() => setSetQuery('')}
                placeholder="Name oder Kürzel (z.B. PAL)"
              />
              {allSets.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">Lade Sets…</p>
              ) : filteredSets.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">Kein Set gefunden</p>
              ) : (
                <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                  {filteredSets.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setIcon(`set:${s.id}`)}
                      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg border-2 text-left transition-colors ${icon === `set:${s.id}` ? '' : 'glass-inner'}`}
                      style={{
                        borderColor: icon === `set:${s.id}` ? ACCENT : 'transparent',
                        background:  icon === `set:${s.id}` ? `${ACCENT}20` : undefined,
                      }}
                    >
                      {/* Logo */}
                      <div className="w-14 shrink-0 flex items-center justify-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={s.logoUrl ?? ""}
                          alt={s.id}
                          className="max-h-7 max-w-[56px] object-contain"
                          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                        />
                      </div>
                      {/* Name + Serie */}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate">{s.nameDe ?? s.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {SERIES_NAMES_DE[s.series] ?? s.series}
                        </div>
                      </div>
                      {/* Kürzel-Badge */}
                      {s.ptcgoCode && (
                        <span
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded-md border shrink-0"
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

        {/* Größe + Kapazität — nur für Binder */}
        {isBinder && (
          <>
            <div className="mb-5">
              <label className="text-xs text-muted-foreground mb-1 block">Seitenlayout</label>
              <ButtonGroup
                value={String(size)}
                onChange={v => setSize(Number(v) as BinderSize)}
                options={BINDER_SIZES.map(s => ({ value: String(s.value), label: s.label }))}
              />
            </div>

            <div className="mb-5">
              <label className="text-xs text-muted-foreground mb-1 block">
                Kapazität <span className="text-muted-foreground/60">(optional)</span>
              </label>
              <Input
                type="number"
                value={capacity}
                onChange={v => setCapacity(v.replace(/[^0-9]/g, ''))}
                placeholder="z.B. 400 — wie viele Karten passen rein?"
              />
            </div>

            <div className="mb-5">
              <label className="text-xs text-muted-foreground mb-1 block">Seiten-Hintergrund</label>
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

    </Sheet>
  );
}
