'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { X, Plus, Minus, Heart, ChevronDown, ChevronRight, ChevronLeft, Info, Repeat2, LayoutGrid } from 'lucide-react';
import { BinderIcon } from '@/lib/binder-icons';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/modal';
import { AddToCollectionModal } from '@/components/scanner/AddToCollectionModal';
import { detectVariants, VARIANT_LABELS, getRarityGroup, SERIES_NAMES_DE, getSubtypeDe, SYMBOL_ONLY_SERIES } from '@/lib/card-constants';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { markReviewed, deleteCard } from '@/lib/firestore/cards';
import { getBinders, addCardToBinder, removeCardFromBinder, removeCardFromBinderAndCleanup, ensureDefaultBinder } from '@/lib/firestore/binders';
import { matchTemplateBinders } from '@/lib/template-binders/match-hint';
import { syncTemplateBinders } from '@/lib/template-binders/sync';
import { getWishlists, ensureDefaultWishlist, addItemToWishlist, removeItemFromWishlist } from '@/lib/firestore/wishlists';
import { getCardsByEvolutionFamily, getCardsByDexNumber } from '@/lib/firestore/catalog';
import { EnergyIcon, type EnergyType } from '@/components/ui/EnergyIcon';
import { CardVariantPrice } from '@/components/card/CardPriceDetail';
import { fetchPokemonSpeciesDE, getEvolutionFamilyDexNumbers, getEvolutionTree, type SpeciesDE, type PokemonStats, type EvolutionTreeNode } from '@/lib/pokeapi';
import { useSetMeta, type SetMeta } from '@/lib/hooks/use-set-meta';
import { getSetById } from '@/lib/firestore/sets';
import { CardImage } from '@/components/card/CardImage';
import { EvolutionTree } from '@/components/card/EvolutionTree';
import { CardNameLabel } from '@/components/card/CardNameLabel';
import type { CardDoc, BinderDoc, CardVariant } from '@/types';

/* ── Helpers ─────────────────────────────────────────────────── */

/** Schlichte SVG-Flag-Swatches statt Emoji-Flaggen — konsistent über Plattformen. */
function LanguageFlag({ lang, size = 14 }: { lang: string; size?: number }) {
  const w = Math.round(size * 1.4);
  const h = size;
  const wrap = (children: React.ReactNode) => (
    <span
      style={{
        display: 'inline-block', width: w, height: h, borderRadius: 2,
        overflow: 'hidden', flexShrink: 0, lineHeight: 0,
        boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.2)',
      }}
    >
      <svg viewBox="0 0 30 18" width={w} height={h}>{children}</svg>
    </span>
  );
  switch (lang) {
    case 'de': return wrap(<>
      <rect width="30" height="6" fill="#000" />
      <rect y="6" width="30" height="6" fill="#DD0000" />
      <rect y="12" width="30" height="6" fill="#FFCE00" />
    </>);
    case 'en': return wrap(<>
      <rect width="30" height="18" fill="#012169" />
      <path d="M0 0 L30 18 M30 0 L0 18" stroke="#fff" strokeWidth="2.5" />
      <path d="M0 0 L30 18 M30 0 L0 18" stroke="#C8102E" strokeWidth="1" />
      <rect x="13" width="4" height="18" fill="#fff" />
      <rect y="7" width="30" height="4" fill="#fff" />
      <rect x="14" width="2" height="18" fill="#C8102E" />
      <rect y="8" width="30" height="2" fill="#C8102E" />
    </>);
    case 'fr': return wrap(<>
      <rect width="10" height="18" fill="#002654" />
      <rect x="10" width="10" height="18" fill="#fff" />
      <rect x="20" width="10" height="18" fill="#ED2939" />
    </>);
    case 'jp': return wrap(<>
      <rect width="30" height="18" fill="#fff" />
      <circle cx="15" cy="9" r="4.5" fill="#BC002D" />
    </>);
    default: return (
      <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>{lang}</span>
    );
  }
}

const STAT_ROWS: { key: keyof PokemonStats; label: string }[] = [
  { key: 'hp',        label: 'KP' },
  { key: 'attack',    label: 'Angriff' },
  { key: 'defense',   label: 'Verteidigung' },
  { key: 'spAttack',  label: 'Sp. Angriff' },
  { key: 'spDefense', label: 'Sp. Verteidigung' },
  { key: 'speed',     label: 'Initiative' },
];

const CONDITION_LABEL: Record<string, string> = {
  NM: 'Near Mint',
  LP: 'Lightly Played',
  MP: 'Moderately Played',
  HP: 'Heavily Played',
  Poor: 'Poor',
};
const CONDITION_COLOR: Record<string, string> = {
  NM: '#48bb78',
  LP: '#facc15',
  MP: '#fb923c',
  HP: '#f87171',
  Poor: '#9ca3af',
};
const LANGUAGE_SHORT: Record<string, string> = { de: 'DE', en: 'EN', fr: 'FR', jp: 'JP' };

// Swipe-nach-links auf einer Karten-Kopie: schon ab CATCH (kleine Strecke)
// "fängt" die Geste — beim Loslassen bleibt die Löschen-Fläche bei REVEAL
// offen stehen, statt bei jeder kleinen Bewegung zurückzuspringen. Der
// Nutzer tippt dann den freigelegten Button. Ab COMMIT (viel weiter gezogen)
// löst ein Loslassen die Löschung direkt aus, ohne zusätzlichen Tap.
const SWIPE_CATCH_PX  = 28;
const SWIPE_REVEAL_PX = 88;
const SWIPE_COMMIT_PX = 160;

/** Eine Zeile "eigene Kopie" im Kartendetail: Sprache/Zustand/Sammlung als
 *  Pills, gelber Rahmen statt Pill für den Prüfen-Status (Tap auf die Zeile
 *  markiert als geprüft), Swipe nach links legt eine Löschen-Fläche frei und
 *  löscht bei genug Schwung sofort — ersetzt den vorherigen, immer sichtbaren
 *  Lösch-Button. */
function OwnedCopyRow({
  copy, condColor, binder, isDefaultBinder, binderName,
  onMarkReviewed, onNavigateToBinder, onRemoveFromBinder, onDelete, isDeleting,
}: {
  copy: CardDoc;
  condColor: string;
  binder: BinderDoc | undefined;
  isDefaultBinder: boolean;
  binderName: string;
  onMarkReviewed: () => void;
  onNavigateToBinder: () => void;
  onRemoveFromBinder: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const [dragX, setDragX]         = useState(0);
  const [dragging, setDragging]   = useState(false);
  const [committed, setCommitted] = useState(false);
  const startXRef  = useRef<number | null>(null);
  const movedRef   = useRef(false);
  const openRef    = useRef(false); // Reveal-Zustand bleibt zwischen Gesten erhalten
  // Aktueller Drag-Wert synchron in einem Ref mitgeführt — `dragX` (State)
  // kann in schnellen Ereignisfolgen kurzzeitig hinter dem tatsächlichen
  // Zeigerstand zurückliegen (Render/Batching), die Schwellwert-Entscheidung
  // in `handlePointerUp` braucht aber den exakt aktuellen Wert.
  const dragXRef   = useRef(0);

  function applyDragX(x: number) {
    dragXRef.current = x;
    setDragX(x);
  }

  function commitDelete() {
    setCommitted(true);
    applyDragX(-500);
    setTimeout(onDelete, 200);
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (isDeleting || committed) return;
    movedRef.current = false;
    startXRef.current = e.clientX;
    setDragging(true);
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch {}
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (startXRef.current == null) return;
    const dx = e.clientX - startXRef.current;
    if (Math.abs(dx) > 6) movedRef.current = true;
    const base = openRef.current ? -SWIPE_REVEAL_PX : 0;
    applyDragX(Math.min(0, Math.max(-(SWIPE_COMMIT_PX + 20), base + dx)));
  }
  function handlePointerUp() {
    if (startXRef.current == null) return;
    startXRef.current = null;
    setDragging(false);
    if (!movedRef.current) {
      // Reiner Tap ohne Bewegung: bei aufgeklappter Löschen-Fläche schließen,
      // sonst (falls "Prüfen" aktiv) als geprüft markieren.
      if (openRef.current) { openRef.current = false; applyDragX(0); }
      else if (copy.needsReview) onMarkReviewed();
      return;
    }
    if (dragXRef.current <= -SWIPE_COMMIT_PX) { commitDelete(); return; }
    if (dragXRef.current <= -SWIPE_CATCH_PX) { openRef.current = true; applyDragX(-SWIPE_REVEAL_PX); }
    else { openRef.current = false; applyDragX(0); }
  }
  function handlePointerCancel() {
    startXRef.current = null;
    setDragging(false);
    applyDragX(openRef.current ? -SWIPE_REVEAL_PX : 0);
  }

  return (
    <div className="relative rounded-xl overflow-hidden" style={{ minHeight: 48 }}>
      {/* Löschen-Fläche — liegt hinter der Zeile, wird durch den Swipe freigelegt.
          Sobald überhaupt gezogen wird, voll deckendes Rot (kein Auf-/Abblenden
          über die Zugstrecke) — sonst wirkt die Fläche blass/wie ein kleiner
          Button statt einer klar roten Zeile. Nur im Ruhezustand (dragX===0)
          komplett ausgeblendet, da `glass-inner` sonst transluzent durchscheint. */}
      <button
        onClick={commitDelete}
        disabled={isDeleting}
        className="absolute inset-0 flex items-center justify-end gap-1.5 pr-4 text-white text-role-title"
        style={{
          background: 'var(--action-delete)',
          opacity: dragX === 0 ? 0 : 1,
          transition: dragging ? 'none' : 'opacity 150ms ease-out',
          pointerEvents: dragX === 0 ? 'none' : 'auto',
        }}
        aria-label="Karte löschen"
      >
        <Minus size={16} strokeWidth={2.5} /> Löschen
      </button>

      {/* Vordergrund — Inhalt der Zeile, per Swipe verschiebbar */}
      <div
        className="glass-inner flex items-center gap-2 rounded-xl px-2.5 py-2 relative"
        style={{
          minHeight: 48,
          transform: `translateX(${dragX}px)`,
          transition: dragging ? 'none' : 'transform 200ms ease-out, opacity 200ms ease-out',
          opacity: committed ? 0 : 1,
          border: copy.needsReview ? '2px solid var(--pokedex-yellow)' : '2px solid transparent',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className="text-role-label px-2 py-1 rounded-full border shrink-0 flex items-center gap-1"
            style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
          >
            <LanguageFlag lang={copy.language} size={13} />
            {LANGUAGE_SHORT[copy.language] ?? copy.language.toUpperCase()}
          </span>
          <span
            className="text-role-label px-2 py-1 rounded-full border shrink-0"
            style={{ borderColor: condColor, color: condColor }}
          >
            {CONDITION_LABEL[copy.condition] ?? copy.condition}
          </span>
          {/* Sammlung-Pill — größer für mobile Touch-Targets */}
          <div
            role="button"
            tabIndex={0}
            onPointerDown={e => e.stopPropagation()}
            onClick={onNavigateToBinder}
            onKeyDown={(e) => e.key === 'Enter' && onNavigateToBinder()}
            className="text-role-title pl-3 pr-2 py-1.5 rounded-full flex items-center gap-1.5 cursor-pointer shrink-0 ml-auto truncate"
            style={{
              background: isDefaultBinder ? 'var(--secondary)' : 'color-mix(in srgb, var(--pokedex-blue) 12%, transparent)',
              border: isDefaultBinder
                ? '1px dashed var(--border)'
                : '1px solid color-mix(in srgb, var(--pokedex-blue) 35%, transparent)',
              color: isDefaultBinder ? 'var(--muted-foreground)' : 'var(--pokedex-blue)',
              maxWidth: 180,
              minHeight: 32,
            }}
          >
            {binder?.icon && <BinderIcon name={binder.icon} size={13} className="shrink-0" />}
            <span className="truncate">{binderName}</span>
            {!isDefaultBinder && binder ? (
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onRemoveFromBinder(); }}
                className="rounded-full p-1 transition-colors shrink-0 text-white"
                style={{ background: 'var(--action-delete)' }}
                title="Aus Sammlung entfernen"
                aria-label="Aus Sammlung entfernen"
              >
                <Minus size={12} strokeWidth={3} />
              </button>
            ) : (
              <ChevronRight size={13} style={{ opacity: 0.7 }} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const VALID_ENERGY = new Set([
  'Fire','Water','Grass','Lightning','Psychic',
  'Fighting','Darkness','Metal','Dragon','Fairy','Colorless',
]);
function toEnergy(t: string): EnergyType | null {
  return VALID_ENERGY.has(t) ? (t as EnergyType) : null;
}

const STAGE_KEYS = ['Basic','Stage 1','Stage 2','MEGA','BREAK','Level-Up','Restored','GX','EX','V','VMAX','VSTAR','V-UNION','Radiant','Tera','ACE SPEC'];
function getStage(subtypes: string[]): string | null {
  const found = subtypes.find(s => STAGE_KEYS.includes(s));
  return found ? getSubtypeDe(found) : null;
}

/** Sonderform-Mechaniken (Teilmenge von STAGE_KEYS ohne reine Stufen-Wörter) — Karten
 *  wie „Glurak-EX"/„Glurak VMAX" sind keine eigenen Evolutions-Baumknoten (gleiche
 *  Pokédex-Nummer wie die Basisform), werden aber als „Auch verfügbar als"-Zeile
 *  unter dem Baum angezeigt. */
const SPECIAL_MECHANIC_KEYS = ['GX','EX','V','VMAX','VSTAR','V-UNION','MEGA','BREAK','Radiant','Tera','ACE SPEC'];

/** Leitet DE-Kartenbild aus Logo-URL ab: .../sv/sv04.5/logo.png → .../sv/sv04.5/027/high.webp */
function imgFromLogoUrl(logoUrl: string, cardNumber: string): string | null {
  const base = logoUrl.replace(/\/logo\.png$/, '').replace(/\/logo$/, '');
  if (!base.includes('assets.tcgdex.net')) return null;
  const num = cardNumber.split('/')[0].padStart(3, '0');
  return `${base}/${num}/high.webp`;
}

/**
 * Wählt pro Evolutionsstufe (Pokédex-Nummer) genau eine Karte aus — unabhängig
 * für jede Stufe, nicht als eine Entscheidung für die ganze Linie. Priorität:
 * 1. Gleiches Set wie die aktuell angezeigte Karte (stimmige Optik).
 * 2. Eine Karte, die der Nutzer selbst besitzt.
 * 3. Neuestes Erscheinungsdatum (Fallback, braucht ggf. `tcg_sets`-Lookup).
 */
async function pickEvolutionCards(
  candidates: CardInfo[],
  currentCard: CardInfo,
  ownedTcgIds: Set<string>,
): Promise<CardInfo[]> {
  // Sonderform-Drucke (MEGA/EX/VMAX/…) nie als Baum-Knoten wählen — die landen
  // stattdessen in der separaten "Auch verfügbar als"-Zeile der jeweiligen Stufe.
  // Ausnahme: ein Dex-Eintrag hat wirklich nur Sonderform-Drucke (kein normaler
  // Print existiert) — dann bleibt die Sonderform als einzige Option erhalten.
  const byDex = new Map<number, CardInfo[]>();
  for (const c of candidates) {
    if (!c.nationalDexNumber) continue;
    const isSpecialMechanic = c.subtypes?.some(s => SPECIAL_MECHANIC_KEYS.includes(s));
    if (isSpecialMechanic && candidates.some(o =>
      o.nationalDexNumber === c.nationalDexNumber &&
      !o.subtypes?.some(s => SPECIAL_MECHANIC_KEYS.includes(s))
    )) continue;
    const arr = byDex.get(c.nationalDexNumber) ?? [];
    arr.push(c);
    byDex.set(c.nationalDexNumber, arr);
  }

  // Nur für Gruppen ohne Set-/Besitz-Treffer brauchen wir Erscheinungsdaten.
  const groups = [...byDex.values()];
  const dateLookupSetIds = new Set<string>();
  for (const group of groups) {
    const hasSameSet = group.some(c => c.setId === currentCard.setId);
    const hasOwned   = group.some(c => ownedTcgIds.has(c.id));
    if (!hasSameSet && !hasOwned) {
      group.forEach(c => dateLookupSetIds.add(c.setId));
    }
  }
  const setDates = new Map<string, string>();
  await Promise.all([...dateLookupSetIds].map(async id => {
    const set = await getSetById(id);
    if (set?.releaseDate) setDates.set(id, set.releaseDate);
  }));

  const picked: CardInfo[] = [];
  for (const group of groups) {
    const sameSet = group.find(c => c.setId === currentCard.setId);
    const owned   = group.find(c => ownedTcgIds.has(c.id));
    const newest  = [...group].sort((a, b) =>
      (setDates.get(b.setId) ?? '').localeCompare(setDates.get(a.setId) ?? '')
    )[0];
    const best = sameSet ?? owned ?? newest;
    if (best) picked.push(best);
  }
  return picked.sort((a, b) => (a.nationalDexNumber ?? 0) - (b.nationalDexNumber ?? 0));
}

/* ── Props / Types ───────────────────────────────────────────── */

export type { SetMeta };

interface Props {
  card: CardInfo | null;
  ownedCopies: CardDoc[];
  binders?: BinderDoc[];
  setMeta?: SetMeta;
  onClose: () => void;
  onSaved?: () => void;
}

type Section = 'details' | 'evo' | 'cards';

/* ── Accordion Header ────────────────────────────────────────── */
function AccHeader({
  icon, title, open, onToggle, border = true,
}: {
  icon: React.ReactNode; title: string; open: boolean;
  onToggle: () => void; border?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 min-h-[52px] text-left transition-colors"
      style={{ borderTop: border ? '1px solid color-mix(in srgb, var(--border) 50%, transparent)' : 'none' }}
    >
      <div className="flex items-center gap-2.5 text-role-title text-glass">
        <span className="text-glass-muted">{icon}</span>
        {title}
      </div>
      <ChevronDown
        size={18}
        className="text-glass-muted transition-transform duration-200 shrink-0"
        style={{ transform: open ? 'rotate(180deg)' : 'none' }}
      />
    </button>
  );
}

/* ── Component ───────────────────────────────────────────────── */
export function CardDetailSheet({ card: initialCard, ownedCopies, binders, setMeta, onClose, onSaved }: Props) {
  const router = useRouter();
  // Slide-Animation + Swipe-Down-Drag übernimmt jetzt `Sheet` (components/ui/modal.tsx)
  // selbst — hier nur noch das einfache offen/zu.
  const [sheetOpen,    setSheetOpen]    = useState(true);
  const [zoomed,       setZoomed]       = useState(false);
  const [openSec,      setOpenSec]      = useState<Set<Section>>(new Set(['cards']));
  const [imgSrcDe,     setImgSrcDe]     = useState<string | undefined>(undefined);
  const [addVariant,   setAddVariant]   = useState<CardVariant | null>(null);
  const [species,      setSpecies]      = useState<SpeciesDE | null>(null);
  // Navigations-Stack für Evolutions-Sprünge — leerer Stack = Initial-Karte sichtbar
  const [cardStack,    setCardStack]    = useState<CardInfo[]>([]);
  // Wenn der Aufrufer eine andere Initial-Karte übergibt (neuer Detail-Aufruf), Stack zurücksetzen
  useEffect(() => { setCardStack([]); }, [initialCard?.id]);
  const card = cardStack.length > 0 ? cardStack[cardStack.length - 1] : initialCard;
  const [speciesLoaded,setSpeciesLoaded]= useState(false);
  const [evoCards,     setEvoCards]     = useState<CardInfo[]>([]);
  const [evoTree,      setEvoTree]      = useState<EvolutionTreeNode | null>(null);
  const [evoLoaded,    setEvoLoaded]    = useState(false);
  const [specialForms, setSpecialForms] = useState<CardInfo[]>([]);
  const [deletingId,   setDeletingId]   = useState<string | null>(null);
  const resolvedMeta = useSetMeta(card?.setId, setMeta, card?.setName);
  const [resolvedBinders, setResolvedBinders] = useState<BinderDoc[]>(binders ?? []);
  const [wishlistItem, setWishlistItem] = useState<{ listId: string; itemId: string } | null>(null);

  /* Reset + load on card change */
  useEffect(() => {
    let cancelled = false;
    if (!card) { setSheetOpen(false); return; }
    setSheetOpen(true);
    setSpecies(null); setSpeciesLoaded(false);
    setEvoCards([]); setEvoLoaded(false); setEvoTree(null); setSpecialForms([]);
    // DE-Bild direkt aus Firestore, falls vorhanden (|| fängt auch leere Strings ab)
    setImgSrcDe(card.imgLargeDe || undefined);
    getBinders().then(setResolvedBinders).catch(() => {});
    setWishlistItem(null);
    getWishlists().then(lists => {
      if (cancelled) return;
      for (const list of lists) {
        const item = list.items.find(i => i.tcgId === card.id);
        if (item) { setWishlistItem({ listId: list.id, itemId: item.id }); return; }
      }
    }).catch(() => {});

    const isPokemon = !card.supertype ||
      card.supertype.toLowerCase().includes('pokémon') ||
      card.supertype.toLowerCase() === 'pokemon';

    if (isPokemon) {
      // Firestore-First: Artdaten direkt aus CardInfo (nach Enrichment)
      if (card.genusDe !== undefined) {
        setSpecies({
          genus:      card.genusDe,
          flavorText: card.flavorTextDe ?? '',
          height:     card.heightDm ?? 0,
          weight:     card.weightHg ?? 0,
          region:     card.region ?? '',
        });
        setSpeciesLoaded(true);
        // Basiswerte/Fähigkeiten/Legendär-Status sind (noch) nicht Teil des
        // persistierten Enrichments — zusätzlich live nachladen und mergen,
        // sobald verfügbar (kein Blocker für die schon vorhandenen Felder).
        fetchPokemonSpeciesDE(card.name, card.supertype).then(extra => {
          if (cancelled || !extra) return;
          setSpecies(prev => prev
            ? { ...prev, stats: extra.stats, abilities: extra.abilities, isLegendary: extra.isLegendary, isMythical: extra.isMythical }
            : prev);
        });
      } else {
        // Fallback: live von PokéAPI (vor Enrichment oder bei Karten ohne DE-Namen)
        fetchPokemonSpeciesDE(card.name, card.supertype)
          .then(s => { setSpecies(s); setSpeciesLoaded(true); });
      }

      if (card.nationalDexNumber) {
        // Baumstruktur unabhängig von den Bilddaten laden — eigener, günstiger
        // PokéAPI-Call, kein Sequenzierungs-Zwang mit dem Karten-Fetch unten.
        getEvolutionTree(card.nationalDexNumber).then(t => { if (!cancelled) setEvoTree(t); });

        getCardsByEvolutionFamily(card.nationalDexNumber, 100)
          .then(async cards => {
            let source = cards.map(catalogCardToInfo);

            // Fallback: evolutionFamily noch nicht befüllt → PokéAPI für Familienstruktur
            if (source.length === 0) {
              const familyNums = await getEvolutionFamilyDexNumbers(card.nationalDexNumber!);
              if (familyNums.length > 0) {
                // Hohes Limit statt 3 — sonst fehlt der zum aktuellen Set passende
                // Print evtl. in der (unsortierten) Firestore-Kappung, und
                // pickEvolutionCards bekommt den richtigen Kandidaten nie zu sehen.
                const batches = await Promise.all(familyNums.map(n => getCardsByDexNumber(n, 60)));
                source = batches.flat().map(catalogCardToInfo);
              }
            }

            // Eine Karte pro Pokédex-Nummer, je Stufe unabhängig gewählt
            // (gleiches Set → eigener Besitz → neuestes Datum, siehe pickEvolutionCards).
            const ownedTcgIds = new Set(ownedCopies.map(o => o.tcgId).filter(Boolean) as string[]);
            const picked = await pickEvolutionCards(source, card, ownedTcgIds);
            if (cancelled) return;
            setEvoCards(picked);
            setEvoLoaded(true);

            // Sonderformen der aktuell angezeigten Stufe (EX/GX/V/VMAX/…) — keine
            // eigenen Baum-Knoten, aber unter dem Baum als kleine Kartenreihe gezeigt.
            const currentPicked = picked.find(p => p.nationalDexNumber === card.nationalDexNumber);
            const seenKeys = new Set<string>();
            const forms: CardInfo[] = [];
            // Einstufige Pokémon (z.B. Miraidon) haben keinen Baum, in dem die normale
            // Form als Knoten auftaucht — dann muss sie zusätzlich in dieser Zeile
            // erscheinen, sonst ist sie von der Sonderform aus gar nicht erreichbar.
            if (picked.length <= 1 && currentPicked && currentPicked.id !== card.id) {
              forms.push(currentPicked);
            }
            for (const c of source) {
              if (c.nationalDexNumber !== card.nationalDexNumber) continue;
              if (c.id === card.id) continue; // aktuell angezeigte Karte nicht nochmal auflisten
              if (currentPicked && c.id === currentPicked.id) continue;
              const key = c.subtypes?.find(s => SPECIAL_MECHANIC_KEYS.includes(s));
              if (!key || seenKeys.has(key)) continue;
              seenKeys.add(key);
              forms.push(c);
            }
            setSpecialForms(forms);
          })
          .catch(() => {
            // Firestore-/PokéAPI-Fehler (z.B. Netzwerk-Hänger) dürfen den Spinner
            // nicht für immer drehen lassen — sauber auf "kein Ergebnis" fallen.
            if (cancelled) return;
            setEvoCards([]);
            setSpecialForms([]);
            setEvoLoaded(true);
          });
      } else {
        setEvoLoaded(true);
      }
    } else {
      setSpeciesLoaded(true);
      setEvoLoaded(true);
    }
    return () => { cancelled = true; };
  }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fallback: DE-Bild aus Logo-URL ableiten, sobald Set-Metadaten geladen sind
  // (nur nötig wenn imgLargeDe nicht direkt in Firestore hinterlegt ist).
  useEffect(() => {
    if (!card || card.imgLargeDe || !resolvedMeta) return;
    const deImg = imgFromLogoUrl(resolvedMeta.logoUrl, card.number);
    if (deImg) setImgSrcDe(deImg);
  }, [card, resolvedMeta]);

  if (!card) return null;

  /* Derived values */
  const rarityInfo  = card.rarity ? getRarityGroup(card.rarity) : null;
  const variants    = (card.variants?.length
    ? card.variants
    : card.rarity ? detectVariants(card.rarity) : ['standard']
  ) as CardVariant[];
  const stage       = getStage(card.subtypes ?? []);
  const energyTypes = (card.types ?? []).map(toEnergy).filter(Boolean) as EnergyType[];
  const setCode     = card.setCode ?? card.setId.toUpperCase();
  // Promo-Karten (egal ob Nummer alphanumerisch wie "SWSH092" oder rein
  // numerisch wie "028") tragen auf dem echten Aufdruck nie eine Gesamtzahl —
  // die Promo-Reihe ist offen/fortlaufend, "215" wäre nur die interne
  // Firestore-Katalogzahl, kein echter Aufdruck. Also nie ein "/Total" anhängen.
  const isPromo     = rarityInfo?.order === 99;
  const numRaw      = card.number.split('/')[0];
  const isPlainNum  = /^\d+$/.test(numRaw);
  const numBase     = isPlainNum ? numRaw.padStart(3, '0') : numRaw;
  const numTotal    = !isPromo && isPlainNum && resolvedMeta?.printedTotal ? String(resolvedMeta.printedTotal).padStart(3, '0') : null;
  const numFmt      = numTotal ? `${numBase}/${numTotal}` : numBase;
  const logoUrl     = resolvedMeta?.logoUrl ?? `https://images.pokemontcg.io/${card.setId}/logo.png`;
  const setNameDe   = resolvedMeta?.nameDe ?? card.setName;
  // Sets vor Scarlet & Violet tragen keinen echten Kürzel-Aufdruck — nur ein
  // grafisches Symbol. setCode ist dort nur ein internes pokemontcg.io-Kürzel.
  const isSymbolOnlySet = !!card.series && SYMBOL_ONLY_SERIES.includes(card.series);

  function bindersOf(copy: CardDoc) { return resolvedBinders.filter(b => b.cardIds.includes(copy.id)); }
  function toggle(s: Section) {
    setOpenSec(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  }
  function handleClose() { setSheetOpen(false); setTimeout(onClose, 250); }

  async function toggleWishlist() {
    if (!card) return;
    if (wishlistItem) {
      await removeItemFromWishlist(wishlistItem.listId, wishlistItem.itemId);
      setWishlistItem(null);
      return;
    }
    const list = await ensureDefaultWishlist();
    const newItem = await addItemToWishlist(list.id, {
      tcgId: card.id,
      name: card.name,
      setName: card.setName,
      setId: card.setId,
      number: card.number,
      tcgImageUrl: imgSrcDe || card.imgLarge || card.imgSmall,
      priority: 2,
      acquired: false,
    });
    if (newItem) setWishlistItem({ listId: list.id, itemId: newItem.id });
  }

  async function handleRemoveFromBinder(copy: CardDoc, binderId: string) {
    await removeCardFromBinder(binderId, copy.id);
    const defaultId = await ensureDefaultBinder();
    await addCardToBinder(defaultId, copy.id);
    const fresh = await getBinders();
    setResolvedBinders(fresh);
    onSaved?.();
  }

  // Bestätigung passiert jetzt über die Swipe-Geste selbst (Reveal + Tap bzw.
  // genug Schwung fürs Loslassen, siehe `OwnedCopyRow`) statt über einen
  // zweiten Tap auf einen dauerhaft sichtbaren Button.
  async function handleDelete(copy: CardDoc) {
    setDeletingId(copy.id);
    try {
      await Promise.all(bindersOf(copy).map(b => removeCardFromBinderAndCleanup(b.id, copy.id)));
      await deleteCard(copy.id);
      if (card) {
        const matched = matchTemplateBinders(card, resolvedBinders.filter(b => b.template));
        if (matched.length > 0) await syncTemplateBinders({ binderIds: matched.map(b => b.id) });
      }
      onSaved?.();
    } finally { setDeletingId(null); }
  }

  // ── Karten-Header (wie echte Pokémon-Karte) — als `header`-Slot an `Sheet`
  // übergeben, bleibt dadurch außerhalb des scrollenden Bereichs (shrink-0).
  const header = (
    <div className="flex items-center justify-between px-4 pb-2.5 gap-2 shrink-0">
      {/* Links: Back-Pfeil (wenn auf Evo-Karte navigiert) ODER Evolutionsstufe */}
      {cardStack.length > 0 ? (
        <Button
          variant="secondary" size="sm"
          icon={<ChevronLeft size={16} />}
          onClick={() => setCardStack(s => s.slice(0, -1))}
          className="shrink-0"
        >
          Zurück
        </Button>
      ) : stage ? (
        <span
          className="text-role-label font-bold px-3 py-1 rounded-full shrink-0"
          style={{ background: 'color-mix(in srgb, var(--pokedex-blue) 12%, transparent)', color: 'var(--pokedex-blue)' }}
        >
          {stage}
        </span>
      ) : <span />}

      {/* Mitte: Pokémon-Name */}
      <h2 className="flex-1 text-center text-role-h2 leading-tight tracking-tight truncate">
        <CardNameLabel card={card} />
      </h2>

      {/* Rechts: KP + Typ-Icons */}
      <div className="flex items-center gap-2 shrink-0">
        {card.hp && (
          <span className="text-base font-bold text-muted-foreground">KP {card.hp}</span>
        )}
        {energyTypes.map(t => (
          <EnergyIcon key={t} type={t} size={26} />
        ))}
      </div>
    </div>
  );

  // Portal direkt in document.body: verhindert, dass das Sheet in einem trapped
  // Stacking-Context landet (z.B. Scanner-Root ist selbst `position: fixed`, was
  // IMMER einen eigenen Stacking-Context erzeugt — jedes z-index darin wird nur
  // lokal verglichen und kann nie über Geschwister-Elemente wie die BottomNav
  // hinausragen, egal wie hoch der Wert ist — siehe gleicher Fix in AddToCollectionModal).
  return createPortal((
    <>
      <Sheet open={sheetOpen} onClose={handleClose} header={header} dragToClose bodyClassName="pb-24">

          {/* ── Hero: Kartenbild links · Set-Info rechts ───── */}
          <div className="flex gap-3.5 px-4 pt-1 pb-4">
            {/* Kartenbild mit Zoom — kein Schatten */}
            <div
              className="shrink-0 rounded-[8px] overflow-hidden cursor-zoom-in border"
              style={{ width: 140, borderColor: rarityInfo?.color ?? 'var(--border)' }}
              onClick={() => setZoomed(true)}
            >
              <CardImage
                srcDe={imgSrcDe}
                src={card.imgLarge ?? card.imgSmall}
                alt={card.name}
                width={140}
                height={196}
                className="w-full block"
                style={{ aspectRatio: '2.5/3.5', objectFit: 'cover' }}
              />
            </div>

            {/* Set-Infos */}
            <div className="flex-1 min-w-0 flex flex-col justify-between self-stretch">

              {/* Oben: Logo → Name+Kürzel → Serie (vertikal) */}
              <div className="flex flex-col gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoUrl}
                  alt={setNameDe}
                  className="object-contain object-left"
                  style={{ height: 28, maxWidth: 90 }}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-bold leading-snug truncate">{setNameDe}</span>
                  {isSymbolOnlySet && resolvedMeta?.symbolUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={resolvedMeta.symbolUrl} alt={setCode} className="w-[21px] h-[21px] object-contain shrink-0" />
                  ) : (
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded-md border shrink-0"
                      style={{ color: 'var(--foreground)', borderColor: 'var(--foreground)' }}
                    >
                      {setCode}
                    </span>
                  )}
                </div>
                {card.series && (
                  <div className="text-[11px] text-muted-foreground">
                    {SERIES_NAMES_DE[card.series] ?? card.series}
                  </div>
                )}
              </div>

              {/* Unten: Nummer + Rarity-Pill */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-bold tabular-nums">{numFmt}</span>
                {rarityInfo && (
                  <div
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] font-bold shrink-0"
                    style={{ background: 'var(--secondary)', borderColor: 'var(--border)' }}
                  >
                    <span style={{ color: rarityInfo.color }}>{rarityInfo.symbol}</span>
                    {rarityInfo.label}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── 1 · Details (eigene Glas-Karte) ─────────────── */}
          <div className="glass mx-4 rounded-[18px] overflow-hidden mb-3">
            <AccHeader
              icon={<Info size={16} />}
              title="Details"
              open={openSec.has('details')}
              onToggle={() => toggle('details')}
              border={false}
            />
            {openSec.has('details') && (
              <div className="px-4 pb-4">
                {card.artist && (
                  <p className="text-role-body text-glass-muted pt-3">
                    Illustration: <span className="font-medium text-glass">{card.artist}</span>
                  </p>
                )}
                {species ? (
                  <>
                    {(species.genus || species.isLegendary || species.isMythical) && (
                      <div className={`flex items-center gap-2 mb-3 ${card.artist ? '' : 'pt-3'}`}>
                        {species.genus && (
                          <p className="text-role-body text-glass-muted">{species.genus}</p>
                        )}
                        {(species.isLegendary || species.isMythical) && (
                          <span
                            className="text-role-badge px-2 py-0.5 rounded-full shrink-0"
                            style={{ background: 'rgba(234,179,8,.15)', color: '#ca9a04' }}
                          >
                            {species.isMythical ? 'Mystisch' : 'Legendär'}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {species.height > 0 && (
                        <div className="glass rounded-[14px] px-3 py-2.5">
                          <div className="text-[15px] font-bold">{(species.height / 10).toFixed(1)} m</div>
                          <div className="text-role-label text-glass-muted mt-0.5">Größe</div>
                        </div>
                      )}
                      {species.weight > 0 && (
                        <div className="glass rounded-[14px] px-3 py-2.5">
                          <div className="text-[15px] font-bold">{(species.weight / 10).toFixed(1)} kg</div>
                          <div className="text-role-label text-glass-muted mt-0.5">Gewicht</div>
                        </div>
                      )}
                      {species.region && (
                        <div className="glass rounded-[14px] px-3 py-2.5">
                          <div className="text-[15px] font-bold">{species.region}</div>
                          <div className="text-role-label text-glass-muted mt-0.5">Region</div>
                        </div>
                      )}
                      {card.nationalDexNumber && (
                        <div className="glass rounded-[14px] px-3 py-2.5">
                          <div className="text-[15px] font-bold">#{String(card.nationalDexNumber).padStart(3, '0')}</div>
                          <div className="text-role-label text-glass-muted mt-0.5">Pokédex</div>
                        </div>
                      )}
                    </div>
                    {species.abilities && species.abilities.length > 0 && (
                      <div className="mb-3">
                        <div className="text-role-label text-glass-muted mb-1.5">Fähigkeiten</div>
                        <div className="flex flex-wrap gap-1.5">
                          {species.abilities.map(a => (
                            <span key={a.name} className="glass-inner text-role-label px-2.5 py-1 rounded-full">
                              {a.name}
                              {a.hidden && <span className="text-glass-muted"> (Versteckt)</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {species.stats && (
                      <div className="mb-3">
                        <div className="text-role-label text-glass-muted mb-1.5">Basiswerte</div>
                        <div className="flex flex-col gap-1.5">
                          {STAT_ROWS.map(({ key, label }) => {
                            const value = species.stats![key];
                            return (
                              <div key={key} className="flex items-center gap-2">
                                <span className="text-role-label text-glass-muted w-[92px] shrink-0">{label}</span>
                                <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                                  <div
                                    className="h-full rounded-full"
                                    style={{ width: `${Math.min(100, (value / 255) * 100)}%`, background: 'var(--pokedex-red)' }}
                                  />
                                </div>
                                <span className="text-[12px] font-bold tabular-nums w-[28px] text-right">{value}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {species.flavorText && (
                      <p className="text-role-body text-glass-muted leading-relaxed italic">
                        „{species.flavorText}"
                      </p>
                    )}
                  </>
                ) : speciesLoaded ? (
                  <div className={card.artist ? '' : 'pt-3'}>
                    {card.nationalDexNumber && (
                      <div className="glass rounded-[14px] px-3 py-2.5 w-fit mb-3">
                        <div className="text-[15px] font-bold">#{String(card.nationalDexNumber).padStart(3, '0')}</div>
                        <div className="text-role-label text-glass-muted mt-0.5">Pokédex</div>
                      </div>
                    )}
                    {!card.artist && <p className="text-role-body text-glass-muted">Keine Details verfügbar</p>}
                  </div>
                ) : (
                  <div className={`flex items-center gap-2 ${card.artist ? '' : 'pt-3'}`}>
                    <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin shrink-0" />
                    <p className="text-role-body text-glass-muted">Lade Details…</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── 2 · Evolutionslinie (eigene Glas-Karte) ─────── */}
          <div className="glass mx-4 rounded-[18px] overflow-hidden mb-3">
            <AccHeader
              icon={<Repeat2 size={16} />}
              title="Evolutionslinie"
              open={openSec.has('evo')}
              onToggle={() => toggle('evo')}
              border={false}
            />
            {openSec.has('evo') && (
              <div className="px-4 pb-4">
                {!evoLoaded ? (
                  <div className="flex items-center gap-2 pt-3">
                    <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin shrink-0" />
                    <p className="text-role-body text-glass-muted">Lade Evolutionslinie…</p>
                  </div>
                ) : evoCards.length > 1 || specialForms.length > 0 ? (
                  <>
                    {evoCards.length > 1 && (
                      <EvolutionTree
                        tree={evoTree}
                        cards={evoCards}
                        currentCardId={card.id}
                        onSelect={ec => setCardStack(s => [...s, ec])}
                      />
                    )}
                    {specialForms.length > 0 && (
                      // Ohne Baum darüber (z.B. einstufige Legendäre wie Miraidon)
                      // keinen Trenner/Einzug — die Zeile steht dann für sich allein.
                      <div className={evoCards.length > 1 ? 'mt-2 pt-3 border-t border-[rgba(255,255,255,0.1)]' : 'pt-1'}>
                        <div className="text-role-label text-glass-muted mb-2">Auch verfügbar als</div>
                        <div className="flex gap-2 overflow-x-auto">
                          {specialForms.map(sf => (
                            <button
                              key={sf.id}
                              onClick={() => setCardStack(s => [...s, sf])}
                              className="flex flex-col items-center gap-1 shrink-0 active:scale-95 transition-transform"
                            >
                              <div className="glass-inner rounded-[7px] p-[2px]">
                                <div className="rounded-[4px] overflow-hidden w-10">
                                  <CardImage
                                    srcDe={sf.imgSmallDe}
                                    src={sf.imgSmall}
                                    alt={sf.name}
                                    width={40}
                                    height={56}
                                    className="w-full block"
                                    style={{ aspectRatio: '2.5/3.5', objectFit: 'cover' }}
                                  />
                                </div>
                              </div>
                              <span className="text-[8px] text-center max-w-[52px] truncate text-glass-muted">
                                <CardNameLabel card={sf} secondaryClassName="opacity-80" />
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-role-body text-glass-muted pt-3">Keine Evolutionslinie</p>
                )}
              </div>
            )}
          </div>

          {/* ── 3 · Karten & Preise (eigene Glas-Karte) ─────── */}
          <div className="glass mx-4 rounded-[18px] overflow-hidden mb-3">
            <AccHeader
              icon={<LayoutGrid size={16} />}
              title="Karten & Preise"
              open={openSec.has('cards')}
              onToggle={() => toggle('cards')}
              border={false}
            />
            {openSec.has('cards') && (
              <div>
                {variants.map((variant, vi) => {
                  const copies = ownedCopies.filter(c => c.variant === variant);
                  const isOwned = copies.length > 0;
                  return (
                    <div
                      key={variant}
                      className="px-3 py-2"
                      style={{
                        borderTop: vi > 0 ? '1px solid color-mix(in srgb, var(--border) 50%, transparent)' : 'none',
                      }}
                    >
                      {/* Variant-Zeile: Name + Owned-Badge + Preis + + Button */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-role-title">{VARIANT_LABELS[variant]}</span>
                          {isOwned && (
                            <span
                              className="text-role-badge px-1.5 py-0.5 rounded-full shrink-0"
                              style={{ background: 'color-mix(in srgb, #48bb78 15%, transparent)', color: '#48bb78' }}
                            >
                              ✓
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <CardVariantPrice tcgId={card.id} variant={variant} />
                          <Button
                            variant="primary" accentColor="#2f855a"
                            icon={<Plus strokeWidth={3} />}
                            onClick={() => setAddVariant(variant)}
                            aria-label="Hinzufügen"
                          />
                        </div>
                      </div>

                      {/* Eigene Kopien */}
                      {copies.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          {copies.map(copy => {
                            const copyBinders = bindersOf(copy);
                            const isDeleting = deletingId === copy.id;
                            const binder = copyBinders[0];
                            const isDefaultBinder = !binder || !!binder.isDefault;
                            const binderName = binder?.name ?? 'Unsortiert';
                            const condColor  = CONDITION_COLOR[copy.condition] ?? 'var(--muted-foreground)';
                            return (
                              <OwnedCopyRow
                                key={copy.id}
                                copy={copy}
                                condColor={condColor}
                                binder={binder}
                                isDefaultBinder={isDefaultBinder}
                                binderName={binderName}
                                isDeleting={isDeleting}
                                onMarkReviewed={async () => {
                                  await markReviewed(copy.id);
                                  window.dispatchEvent(new Event('review-count-changed'));
                                  onSaved?.();
                                }}
                                onNavigateToBinder={() => router.push(binder ? `/binders/${binder.id}` : '/binders')}
                                onRemoveFromBinder={() => binder && handleRemoveFromBinder(copy, binder.id)}
                                onDelete={() => handleDelete(copy)}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Wunschliste — eigenständiger Glas-Button ────── */}
          <div className="mx-4 mb-4">
            <button
              onClick={toggleWishlist}
              className="drawer-panel w-full h-[54px] rounded-[18px] flex items-center justify-center gap-2 text-role-title"
              style={wishlistItem ? { color: '#ef4444' } : undefined}
            >
              <Heart size={19} fill={wishlistItem ? '#ef4444' : 'none'} />
              {wishlistItem ? 'Von Wunschliste entfernen' : 'Auf Wunschliste setzen'}
            </button>
          </div>
      </Sheet>

      {/* ── Zoom-Overlay ──────────────────────────────────────── */}
      {zoomed && (
        <div
          className="fixed inset-0 z-[70] bg-black/95 flex items-center justify-center"
          onClick={() => setZoomed(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgSrcDe || card.imgLarge || card.imgSmall}
            alt={card.name}
            className="rounded-2xl"
            style={{ maxWidth: '90vw', maxHeight: '85dvh', objectFit: 'contain' }}
            onError={e => {
              const target = e.currentTarget;
              const en = card.imgLarge || card.imgSmall;
              if (target.src !== en) target.src = en;
            }}
          />
          <button
            onClick={() => setZoomed(false)}
            className="absolute top-5 right-5 w-11 h-11 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,.15)' }}
          >
            <X size={20} color="#fff" />
          </button>
        </div>
      )}

      {/* ── AddToCollectionModal ──────────────────────────────── */}
      {addVariant !== null && (
        <AddToCollectionModal
          card={card}
          preVariant={addVariant}
          onClose={() => setAddVariant(null)}
          onSaved={() => { setAddVariant(null); onSaved?.(); }}
        />
      )}
    </>
  ), document.body);
}
