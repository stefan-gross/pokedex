'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Search } from 'lucide-react';
import { getAllSets, filterSets, type TcgSet } from '@/lib/firestore/sets';
import { SERIES_NAMES_DE } from '@/lib/card-constants';
import { resolveMasterSetTemplate } from '@/lib/template-binders/resolve';
import { CreateBinderModal } from './CreateBinderModal';
import type { BinderTemplate } from '@/types';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

/** Einstieg für Vorlagen-Binder — aktuell nur Master-Set (Phase 1, siehe
 *  Plan „Vorlagen-Binder"). Illustrator/Pokédex/Evolutionslinie nutzen
 *  bereits denselben Sync-/Sperren-/Hinweis-Mechanismus (lib/template-
 *  binders/*), brauchen hier nur noch ihren eigenen Parameter-Picker als
 *  Folgeschritt. Nach der Set-Auswahl übergibt dieser Screen an das
 *  bestehende `CreateBinderModal` (Name/Icon/Farbe/Größe bleiben dort wie
 *  gewohnt änderbar). */
export function CreateTemplateBinderModal({ onClose, onSaved }: Props) {
  const [setQuery, setSetQuery] = useState('');
  const [allSets, setAllSets] = useState<TcgSet[]>([]);
  const [selectedSet, setSelectedSet] = useState<TcgSet | null>(null);
  const [slotCount, setSlotCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const setsLoadedRef = useRef(false);

  useEffect(() => {
    if (!setsLoadedRef.current) {
      setsLoadedRef.current = true;
      getAllSets().then(setAllSets).catch(() => {});
    }
  }, []);

  const filteredSets = useMemo(() => filterSets(allSets, setQuery).slice(0, 15), [allSets, setQuery]);

  async function pickSet(s: TcgSet) {
    setSelectedSet(s);
    setSlotCount(null);
    setLoadingCount(true);
    try {
      const slots = await resolveMasterSetTemplate(s.id);
      setSlotCount(slots.length);
    } finally {
      setLoadingCount(false);
    }
  }

  // Schritt 2: Slot-Anzahl bestätigt → ab hier übernimmt das normale
  // Erstellen-Modal (Name/Icon/Farbe/Größe editierbar).
  if (selectedSet && slotCount != null) {
    const template: BinderTemplate = { type: 'masterSet', setId: selectedSet.id };
    return (
      <CreateBinderModal
        templateDraft={template}
        initialName={selectedSet.nameDe ?? selectedSet.name}
        initialIcon={`set:${selectedSet.id}`}
        initialColor="#4299e1"
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end">
      <div className="absolute inset-0 transition-opacity duration-[250ms] glass-sheet-backdrop" onClick={onClose} />
      <div className="relative w-full rounded-t-2xl glass-sheet max-h-[85dvh] flex flex-col">
        <div className="w-9 h-1 rounded-full bg-[rgba(46,46,50,0.2)] dark:bg-white/30 mx-auto mt-3 mb-1 shrink-0" />
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Master-Set anlegen</h2>
            <button onClick={onClose} className="w-11 h-11 rounded-full glass-inner flex items-center justify-center" aria-label="Schließen">
              <X size={20} />
            </button>
          </div>

          {selectedSet ? (
            <div className="text-center py-6">
              <p className="text-sm font-semibold mb-1">{selectedSet.nameDe ?? selectedSet.name}</p>
              <p className="text-xs text-muted-foreground">
                {loadingCount ? 'Ermittle Kartenanzahl…' : `${slotCount} Slots`}
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                Wähle eine Erweiterung — der Binder füllt sich automatisch mit
                allen Karten (vorhandene + fehlende), eine Kachel pro Nummer.
              </p>
              <div className="relative mb-2">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  type="search"
                  value={setQuery}
                  onChange={e => setSetQuery(e.target.value)}
                  placeholder="Name oder Kürzel (z.B. PAF)"
                  className="w-full h-9 pl-7 pr-3 rounded-lg glass-inner text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                />
              </div>
              {allSets.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">Lade Sets…</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {filteredSets.map(s => (
                    <button
                      key={s.id}
                      onClick={() => pickSet(s)}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg glass-inner text-left"
                    >
                      <div className="w-14 shrink-0 flex items-center justify-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={s.logoUrl ?? `https://images.pokemontcg.io/${s.id}/logo.png`}
                          alt={s.id}
                          className="max-h-7 max-w-[56px] object-contain"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate">{s.nameDe ?? s.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{SERIES_NAMES_DE[s.series] ?? s.series}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
