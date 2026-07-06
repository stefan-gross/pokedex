'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import type { CardInfo } from '@/lib/card-info';
import type { CardCondition, CardLanguage, CardVariant, CardDoc, BinderDoc } from '@/types';
import { addCard, getCardsByTcgId } from '@/lib/firestore/cards';
import { getBinders, addCardToBinder, ensureDefaultBinder } from '@/lib/firestore/binders';
import { LANGUAGES, CONDITIONS, VARIANT_LABELS } from '@/lib/card-constants';
import { CardPrice } from '@/components/card/CardPrice';
import { BinderIcon } from '@/lib/binder-icons';
import { useSetMeta } from '@/lib/hooks/use-set-meta';
import { CardNameLabel } from '@/components/card/CardNameLabel';

const CLOSE_ANIM_MS = 250;

const CONDITION_COLOR: Record<string, string> = {
  NM: '#48bb78', LP: '#facc15', MP: '#fb923c', HP: '#f87171', Poor: '#9ca3af',
};

interface Props {
  card: CardInfo;
  preVariant?: CardVariant;
  preCondition?: CardCondition;
  preLanguage?: CardLanguage;
  /** Scanner liegt immer über dem Kamerabild — Drawer dort unabhängig vom
   *  App-Theme immer dunkel darstellen (via erzwungener `.dark`-Klasse). */
  fromScanner?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** Ein Hinzufügen-Drawer für die ganze App (Scanner, Suche, Kartendetail) —
 *  Liquid-Glass-Design, folgt dem App-Theme; im Scanner per erzwungener
 *  `.dark`-Klasse immer dunkel (siehe Handoff design_handoff_add_drawer). */
export function AddToCollectionModal({
  card, preVariant, preCondition, preLanguage,
  fromScanner = false,
  onClose, onSaved,
}: Props) {
  const [variant, setVariant] = useState<CardVariant>(preVariant ?? (card.variants?.[0] as CardVariant) ?? 'standard');
  const variantOptions: CardVariant[] = (card.variants && card.variants.length > 0 ? card.variants : ['standard']) as CardVariant[];
  const [condition, setCondition] = useState<CardCondition>(preCondition ?? 'NM');
  const [language, setLanguage] = useState<CardLanguage>(preLanguage ?? 'de');

  // DE-Setname + gedruckte Nummer/Gesamtzahl (z.B. "052/172") — exakt wie bei
  // der gescannten Karte (RecognizedCardLarge), statt der rohen Katalog-Felder.
  const setMeta = useSetMeta(card.setId, undefined, card.setName);
  const cardNumBase = card.number.split('/')[0].padStart(3, '0');
  const cardNumTotal = setMeta?.printedTotal ? String(setMeta.printedTotal).padStart(3, '0') : null;
  const cardNumDisplay = cardNumTotal ? `${cardNumBase}/${cardNumTotal}` : card.number;

  const [allBinders, setAllBinders] = useState<BinderDoc[]>([]);
  const [ownedCopies, setOwnedCopies] = useState<CardDoc[]>([]);

  // Sammlungen, die genau dieses Exemplar (Zustand+Sprache+Variante) schon
  // enthalten, werden nicht mehr angeboten — sonst könnte man ein exaktes
  // Duplikat in dieselbe Sammlung doppelt einsortieren. '' = Default-Binder.
  const matchingBinderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const copy of ownedCopies) {
      if (copy.variant !== variant || copy.condition !== condition || copy.language !== language) continue;
      const binder = allBinders.find(b => b.cardIds.includes(copy.id));
      // Der echte Default-Binder (isDefault) zählt genauso als Sentinel '' wie
      // "in gar keinem Binder" — beides zeigt in der UI als "Meine Sammlung".
      ids.add(binder && !binder.isDefault ? binder.id : '');
    }
    return ids;
  }, [ownedCopies, allBinders, variant, condition, language]);

  const binderOptions = useMemo(
    () => allBinders.filter(b => !b.isDefault && !matchingBinderIds.has(b.id)),
    [allBinders, matchingBinderIds]
  );
  // Fallback: Default-Option bleibt sichtbar, wenn sonst keine Sammlung übrig wäre
  // (verhindert ein leeres Dropdown, falls jede Sammlung diese Kombination schon hat).
  const showDefaultOption = !matchingBinderIds.has('') || binderOptions.length === 0;

  // '' = Default-Binder „Meine Sammlung" (vorausgewählt)
  const [selectedBinderId, setSelectedBinderId] = useState<string>('');
  useEffect(() => {
    const validIds = new Set([...(showDefaultOption ? [''] : []), ...binderOptions.map(b => b.id)]);
    if (!validIds.has(selectedBinderId)) {
      setSelectedBinderId(showDefaultOption ? '' : (binderOptions[0]?.id ?? ''));
    }
  }, [selectedBinderId, binderOptions, showDefaultOption]);

  const [saving, setSaving] = useState(false);

  // Slide-In + Swipe-Down — gleiche Mechanik wie CardDetailSheet
  const [visible, setVisible] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragStartYRef = useRef<number | null>(null);

  useEffect(() => {
    const r = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(r);
  }, []);

  useEffect(() => {
    getBinders().then(setAllBinders).catch(() => {});
    getCardsByTcgId(card.id).then(setOwnedCopies).catch(() => {});
  }, [card.id]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, CLOSE_ANIM_MS);
  };

  const save = async () => {
    setSaving(true);
    try {
      const cardId = await addCard({
        tcgId: card.id,
        name: card.name,
        setId: card.setId,
        setName: card.setName,
        series: card.series,
        number: card.number,
        rarity: card.rarity,
        pokemonType: card.types?.[0],
        supertype: card.supertype,
        variant,
        condition,
        language,
        isFoil: variant === 'holo',
        isFirstEd: variant === '1st-ed',
        quantity: 1,
        tcgImageUrl: card.imgLargeDe || card.imgLarge,
      });
      const binderId = selectedBinderId || await ensureDefaultBinder();
      await addCardToBinder(binderId, cardId);
      onSaved();
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setSaving(false);
    }
  };

  const sheetTransition = dragStartYRef.current != null ? 'none' : `transform ${CLOSE_ANIM_MS}ms ease-out`;

  // Portal direkt in document.body: verhindert, dass das Modal in einem
  // trapped Stacking-Context landet (z.B. Scanner-Root ist selbst `position: fixed`,
  // was IMMER einen eigenen Stacking-Context erzeugt — jedes z-index darin wird nur
  // lokal verglichen und kann nie über Geschwister-Elemente wie die BottomNav
  // hinausragen, egal wie hoch der Wert ist).
  return createPortal((
    <div className={fromScanner ? 'dark fixed inset-0 z-[100] flex items-end' : 'fixed inset-0 z-[100] flex items-end'}>
      <div
        className="absolute inset-0 transition-opacity duration-[250ms] bg-[rgba(240,242,248,0.5)] [backdrop-filter:saturate(0.55)_brightness(1.06)_blur(2px)] [-webkit-backdrop-filter:saturate(0.55)_brightness(1.06)_blur(2px)] dark:bg-[rgba(8,7,12,0.35)] dark:[backdrop-filter:saturate(0.5)_brightness(0.42)_blur(2px)] dark:[-webkit-backdrop-filter:saturate(0.5)_brightness(0.42)_blur(2px)]"
        style={{ opacity: visible ? 1 : 0 }}
        onClick={handleClose}
      />

      <div
        className="relative w-full rounded-t-[26px] bg-[rgba(255,255,255,0.42)] dark:bg-[rgba(28,29,38,0.4)] border-t border-[rgba(255,255,255,0.85)] dark:border-[rgba(255,255,255,0.18)] shadow-[0_-12px_40px_rgba(0,0,0,0.18)] dark:shadow-[0_-12px_40px_rgba(0,0,0,0.5)] [backdrop-filter:blur(34px)_saturate(1.5)] [-webkit-backdrop-filter:blur(34px)_saturate(1.5)] max-h-[90dvh] flex flex-col text-foreground"
        style={{
          transform: visible ? `translateY(${dragY}px)` : 'translateY(100%)',
          transition: sheetTransition,
          padding: '12px 18px calc(22px + env(safe-area-inset-bottom, 0px))',
          colorScheme: fromScanner ? 'dark' : undefined,
        }}
      >
        {/* Handle — Swipe-Down zum Schließen */}
        <div
          className="flex items-center justify-center -mt-1 mb-3 py-2 cursor-grab shrink-0"
          style={{ touchAction: 'none' }}
          onPointerDown={e => {
            dragStartYRef.current = e.clientY;
            setDragY(0);
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={e => {
            if (dragStartYRef.current == null) return;
            const dy = e.clientY - dragStartYRef.current;
            setDragY(Math.max(0, dy));
          }}
          onPointerUp={e => {
            if (dragStartYRef.current == null) return;
            const dy = e.clientY - dragStartYRef.current;
            dragStartYRef.current = null;
            try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
            if (dy > 80) handleClose();
            else setDragY(0);
          }}
          onPointerCancel={() => { dragStartYRef.current = null; setDragY(0); }}
        >
          <div className="w-9 h-1 rounded-full bg-[rgba(46,46,50,0.2)] dark:bg-white/30" />
        </div>

        <div className="overflow-y-auto">
          {/* Karten-Zeile */}
          <div className="flex items-center gap-3 pb-[14px] mb-4 border-b border-[rgba(46,46,50,0.1)] dark:border-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.imgSmallDe || card.imgSmall}
              alt={card.name}
              className="w-10 h-14 rounded-[3px] object-cover shrink-0"
            />
            <div className="min-w-0">
              <div className="text-base font-bold truncate"><CardNameLabel card={card} /></div>
              <div className="text-xs text-muted-foreground truncate">{setMeta?.nameDe ?? card.setName} · {cardNumDisplay}</div>
            </div>
            <CardPrice tcgId={card.id} plain fontSize={15} className="ml-auto text-[#6cb0ff]! font-extrabold shrink-0" />
          </div>

          {/* Zustand + Sprache — je 50% */}
          <div className="grid grid-cols-2 gap-2.5 mb-2.5">
            <ThemedSelect label="Zustand" value={condition} onChange={v => setCondition(v as CardCondition)}>
              {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </ThemedSelect>
            <ThemedSelect label="Sprache" value={language} onChange={v => setLanguage(v as CardLanguage)}>
              {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </ThemedSelect>
          </div>

          {/* Variante — 100% */}
          <div className="mb-4">
            <ThemedSelect label="Variante" value={variant} onChange={v => setVariant(v as CardVariant)} disabled={variantOptions.length <= 1}>
              {variantOptions.map(v => <option key={v} value={v}>{VARIANT_LABELS[v]}</option>)}
            </ThemedSelect>
          </div>

          {/* Bereits vorhanden — eine Zeile pro Exemplar, ohne Anzahl-Badge */}
          {ownedCopies.length > 0 && (
            <div className="flex flex-col gap-1.5 mb-4">
              {ownedCopies.map(copy => {
                const binder = allBinders.find(b => b.cardIds.includes(copy.id));
                const binderName = binder?.name ?? 'Meine Sammlung';
                const binderColor = binder?.color ?? 'var(--muted-foreground)';
                const condColor = CONDITION_COLOR[copy.condition] ?? 'var(--muted-foreground)';
                return (
                  <div
                    key={copy.id}
                    className="glass-inner flex items-center gap-2.5 rounded-xl px-3 py-2"
                    style={{ background: `color-mix(in srgb, ${binderColor} 16%, transparent)` }}
                  >
                    <div
                      className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0"
                      style={{ background: `color-mix(in srgb, ${binderColor} 20%, transparent)` }}
                    >
                      <BinderIcon name={binder?.icon ?? 'folder'} size={18} style={{ color: binderColor }} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold truncate">{binderName}</div>
                      <div className="text-[12px] text-muted-foreground truncate">
                        <span style={{ color: condColor, fontWeight: 600 }}>{CONDITIONS.find(c => c.value === copy.condition)?.label ?? copy.condition}</span>
                        {' · '}{copy.language.toUpperCase()}{' · '}{VARIANT_LABELS[copy.variant]}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Sammlung — Single-Select, Default vorausgewählt */}
          <div className="mb-4">
            <ThemedSelect label="Sammlung" value={selectedBinderId} onChange={setSelectedBinderId}>
              {showDefaultOption && <option value="">Meine Sammlung</option>}
              {binderOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </ThemedSelect>
          </div>
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="w-full rounded-[15px] font-bold text-white disabled:opacity-50 transition-opacity shrink-0"
          style={{ height: 54, fontSize: 17, background: '#22c55e', boxShadow: '0 6px 20px rgba(34,197,94,0.4)' }}
        >
          {saving ? 'Wird gespeichert…' : 'Hinzufügen'}
        </button>
      </div>
    </div>
  ), document.body);
}

/** Themen-bewusster <select> — nutzt `.glass-inner` (folgt Light/Dark automatisch,
 *  im Scanner via erzwungener `.dark`-Klasse immer dunkel). */
function ThemedSelect({ label, value, onChange, disabled, children }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-[7px]">
      <span className="text-[12px] font-semibold text-muted-foreground">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className="glass-inner w-full text-sm text-foreground appearance-none disabled:opacity-50 rounded-xl"
          style={{ height: 48, padding: '0 30px 0 12px' }}
        >
          {children}
        </select>
        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      </div>
    </label>
  );
}
