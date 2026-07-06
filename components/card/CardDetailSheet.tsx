'use client';

import { Fragment, useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { X, Plus, Heart, CheckCircle2, ChevronDown, ChevronRight, ChevronLeft, Trash2, Info, Repeat2, LayoutGrid } from 'lucide-react';
import { AddToCollectionModal } from '@/components/scanner/AddToCollectionModal';
import { detectVariants, VARIANT_LABELS, getRarityGroup, SERIES_NAMES_DE, getSubtypeDe, SYMBOL_ONLY_SERIES } from '@/lib/card-constants';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { markReviewed, deleteCard } from '@/lib/firestore/cards';
import { getBinders, addCardToBinder, removeCardFromBinder, removeCardFromBinderAndCleanup, ensureDefaultBinder } from '@/lib/firestore/binders';
import { getCardsByEvolutionFamily, getCardsByDexNumber } from '@/lib/firestore/catalog';
import { EnergyIcon, type EnergyType } from '@/components/ui/EnergyIcon';
import { CardVariantPrice } from '@/components/card/CardPriceDetail';
import { fetchPokemonSpeciesDE, getEvolutionFamilyDexNumbers, type SpeciesDE, type PokemonStats } from '@/lib/pokeapi';
import { useSetMeta, type SetMeta } from '@/lib/hooks/use-set-meta';
import { getSetById } from '@/lib/firestore/sets';
import { CardImage } from '@/components/card/CardImage';
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
  const byDex = new Map<number, CardInfo[]>();
  for (const c of candidates) {
    if (!c.nationalDexNumber) continue;
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
      <div className="flex items-center gap-2.5 font-semibold text-[15px]">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      <ChevronDown
        size={18}
        className="text-muted-foreground transition-transform duration-200 shrink-0"
        style={{ transform: open ? 'rotate(180deg)' : 'none' }}
      />
    </button>
  );
}

/* ── Component ───────────────────────────────────────────────── */
export function CardDetailSheet({ card: initialCard, ownedCopies, binders, setMeta, onClose, onSaved }: Props) {
  const router = useRouter();
  const [visible,      setVisible]      = useState(false);
  const [zoomed,       setZoomed]       = useState(false);
  // Swipe-Down-State: Y-Offset während des Drags (px, nur positiv)
  const [dragY,        setDragY]        = useState(0);
  const dragStartYRef                   = useRef<number | null>(null);
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
  const [evoLoaded,    setEvoLoaded]    = useState(false);
  const [deletingId,   setDeletingId]   = useState<string | null>(null);
  const [confirmId,    setConfirmId]    = useState<string | null>(null);
  const resolvedMeta = useSetMeta(card?.setId, setMeta, card?.setName);
  const [resolvedBinders, setResolvedBinders] = useState<BinderDoc[]>(binders ?? []);

  /* Reset + load on card change */
  useEffect(() => {
    let cancelled = false;
    if (!card) { setVisible(false); return; }
    setSpecies(null); setSpeciesLoaded(false);
    setEvoCards([]); setEvoLoaded(false);
    // DE-Bild direkt aus Firestore, falls vorhanden (|| fängt auch leere Strings ab)
    setImgSrcDe(card.imgLargeDe || undefined);
    requestAnimationFrame(() => setVisible(true));
    getBinders().then(setResolvedBinders).catch(() => {});

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
        getCardsByEvolutionFamily(card.nationalDexNumber, 100)
          .then(async cards => {
            let source = cards.map(catalogCardToInfo);

            // Fallback: evolutionFamily noch nicht befüllt → PokéAPI für Familienstruktur
            if (source.length === 0) {
              const familyNums = await getEvolutionFamilyDexNumbers(card.nationalDexNumber!);
              if (familyNums.length > 0) {
                const batches = await Promise.all(familyNums.map(n => getCardsByDexNumber(n, 3)));
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
  const numBase     = card.number.split('/')[0].padStart(3, '0');
  const numTotal    = resolvedMeta?.printedTotal ? String(resolvedMeta.printedTotal).padStart(3, '0') : null;
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
  function handleClose() { setVisible(false); setTimeout(onClose, 250); }

  async function handleRemoveFromBinder(copy: CardDoc, binderId: string) {
    await removeCardFromBinder(binderId, copy.id);
    const defaultId = await ensureDefaultBinder();
    await addCardToBinder(defaultId, copy.id);
    const fresh = await getBinders();
    setResolvedBinders(fresh);
    onSaved?.();
  }

  async function handleDelete(copy: CardDoc) {
    if (confirmId !== copy.id) {
      setConfirmId(copy.id);
      setTimeout(() => setConfirmId(c => c === copy.id ? null : c), 3000);
      return;
    }
    setConfirmId(null);
    setDeletingId(copy.id);
    try {
      await Promise.all(bindersOf(copy).map(b => removeCardFromBinderAndCleanup(b.id, copy.id)));
      await deleteCard(copy.id);
      onSaved?.();
    } finally { setDeletingId(null); }
  }

  // Portal direkt in document.body: verhindert, dass das Sheet in einem trapped
  // Stacking-Context landet (z.B. Scanner-Root ist selbst `position: fixed`, was
  // IMMER einen eigenen Stacking-Context erzeugt — jedes z-index darin wird nur
  // lokal verglichen und kann nie über Geschwister-Elemente wie die BottomNav
  // hinausragen, egal wie hoch der Wert ist — siehe gleicher Fix in AddToCollectionModal).
  return createPortal((
    <div className="fixed inset-0 z-[60] flex items-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 transition-opacity duration-[250ms]"
        style={{ opacity: visible ? 1 : 0 }}
        onClick={handleClose}
      />

      {/* Sheet */}
      <div
        className="relative w-full rounded-t-2xl bg-card/50 backdrop-blur-xl max-h-[93dvh] flex flex-col"
        style={{
          transform: visible
            ? `translateY(${dragY}px)`
            : 'translateY(100%)',
          transition: dragStartYRef.current != null
            ? 'none'
            : 'transform 250ms ease-out',
          boxShadow: '0 -8px 32px rgba(30,40,80,0.14), 0 -2px 8px rgba(30,40,80,0.07)',
        }}
      >
        {/* Handle — swipe-down zum Schließen + größeres Touch-Target */}
        <div
          className="flex items-center justify-center pt-3 pb-2 shrink-0 cursor-grab touch-none"
          style={{ touchAction: 'none' }}
          onPointerDown={e => {
            dragStartYRef.current = e.clientY;
            setDragY(0);
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={e => {
            if (dragStartYRef.current == null) return;
            const dy = e.clientY - dragStartYRef.current;
            setDragY(Math.max(0, dy)); // nur nach unten
          }}
          onPointerUp={e => {
            if (dragStartYRef.current == null) return;
            const dy = e.clientY - dragStartYRef.current;
            dragStartYRef.current = null;
            try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
            if (dy > 80) {
              handleClose();
            } else {
              setDragY(0);
            }
          }}
          onPointerCancel={() => {
            dragStartYRef.current = null;
            setDragY(0);
          }}
        >
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        {/* ── Karten-Header (wie echte Pokémon-Karte) ───────── */}
        <div className="flex items-center justify-between px-4 pb-2.5 gap-2 shrink-0">
          {/* Links: Back-Pfeil (wenn auf Evo-Karte navigiert) ODER Evolutionsstufe */}
          {cardStack.length > 0 ? (
            <button
              onClick={() => setCardStack(s => s.slice(0, -1))}
              className="flex items-center gap-1 h-8 pl-2 pr-3 rounded-full shrink-0"
              style={{ background: 'var(--secondary)' }}
              aria-label="Zurück"
            >
              <ChevronLeft size={16} />
              <span className="text-[12px] font-semibold">Zurück</span>
            </button>
          ) : stage ? (
            <span
              className="text-[13px] font-bold px-3 py-1 rounded-full border shrink-0"
              style={{ background: 'rgba(66,153,225,.12)', color: 'var(--blue, #4299e1)', borderColor: 'rgba(66,153,225,.3)' }}
            >
              {stage}
            </span>
          ) : <span />}

          {/* Mitte: Pokémon-Name */}
          <h2 className="flex-1 text-center text-[19px] font-extrabold leading-tight tracking-tight truncate">
            {card.name}
          </h2>

          {/* Rechts: KP + Typ-Icons */}
          <div className="flex items-center gap-2 shrink-0">
            {card.hp && (
              <span className="text-[16px] font-bold text-muted-foreground">KP {card.hp}</span>
            )}
            {energyTypes.map(t => (
              <EnergyIcon key={t} type={t} size={26} />
            ))}
          </div>
        </div>

        {/* ── Scrollbarer Inhalt ────────────────────────────── */}
        <div className="overflow-y-auto pb-24 flex-1">

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
          <div className="glass-solid mx-4 rounded-[20px] overflow-hidden mb-3">
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
                  <p className="text-[13px] text-muted-foreground pt-3">
                    Illustration: <span className="font-medium text-foreground">{card.artist}</span>
                  </p>
                )}
                {species ? (
                  <>
                    {(species.genus || species.isLegendary || species.isMythical) && (
                      <div className={`flex items-center gap-2 mb-3 ${card.artist ? '' : 'pt-3'}`}>
                        {species.genus && (
                          <p className="text-[13px] text-muted-foreground">{species.genus}</p>
                        )}
                        {(species.isLegendary || species.isMythical) && (
                          <span
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                            style={{ background: 'rgba(234,179,8,.15)', color: '#ca9a04' }}
                          >
                            {species.isMythical ? 'Mystisch' : 'Legendär'}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {species.height > 0 && (
                        <div className="glass-inner rounded-[14px] px-3 py-2.5">
                          <div className="text-[15px] font-bold">{(species.height / 10).toFixed(1)} m</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">Größe</div>
                        </div>
                      )}
                      {species.weight > 0 && (
                        <div className="glass-inner rounded-[14px] px-3 py-2.5">
                          <div className="text-[15px] font-bold">{(species.weight / 10).toFixed(1)} kg</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">Gewicht</div>
                        </div>
                      )}
                      {species.region && (
                        <div className="glass-inner rounded-[14px] px-3 py-2.5">
                          <div className="text-[15px] font-bold">{species.region}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">Region</div>
                        </div>
                      )}
                      {card.nationalDexNumber && (
                        <div className="glass-inner rounded-[14px] px-3 py-2.5">
                          <div className="text-[15px] font-bold">#{String(card.nationalDexNumber).padStart(3, '0')}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">Pokédex</div>
                        </div>
                      )}
                    </div>
                    {species.abilities && species.abilities.length > 0 && (
                      <div className="mb-3">
                        <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">Fähigkeiten</div>
                        <div className="flex flex-wrap gap-1.5">
                          {species.abilities.map(a => (
                            <span key={a.name} className="glass-inner text-[12px] font-medium px-2.5 py-1 rounded-full">
                              {a.name}
                              {a.hidden && <span className="text-muted-foreground"> (Versteckt)</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {species.stats && (
                      <div className="mb-3">
                        <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">Basiswerte</div>
                        <div className="flex flex-col gap-1.5">
                          {STAT_ROWS.map(({ key, label }) => {
                            const value = species.stats![key];
                            return (
                              <div key={key} className="flex items-center gap-2">
                                <span className="text-[11px] text-muted-foreground w-[92px] shrink-0">{label}</span>
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
                      <p className="text-[13px] text-muted-foreground leading-relaxed italic">
                        „{species.flavorText}"
                      </p>
                    )}
                  </>
                ) : speciesLoaded ? (
                  <div className={card.artist ? '' : 'pt-3'}>
                    {card.nationalDexNumber && (
                      <div className="glass-inner rounded-[14px] px-3 py-2.5 w-fit mb-3">
                        <div className="text-[15px] font-bold">#{String(card.nationalDexNumber).padStart(3, '0')}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">Pokédex</div>
                      </div>
                    )}
                    {!card.artist && <p className="text-[13px] text-muted-foreground">Keine Details verfügbar</p>}
                  </div>
                ) : (
                  <div className={`flex items-center gap-2 ${card.artist ? '' : 'pt-3'}`}>
                    <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin shrink-0" />
                    <p className="text-[13px] text-muted-foreground">Lade Details…</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── 2 · Evolutionslinie (eigene Glas-Karte) ─────── */}
          <div className="glass-solid mx-4 rounded-[20px] overflow-hidden mb-3">
            <AccHeader
              icon={<Repeat2 size={16} />}
              title="Evolutionslinie"
              open={openSec.has('evo')}
              onToggle={() => toggle('evo')}
              border={false}
            />
            {openSec.has('evo') && (
              <div className="px-4 pb-4">
                {evoCards.length > 1 ? (
                  <div className="flex items-start pt-3 pb-1">
                    {evoCards.map((ec, i) => {
                      const isCurrent = ec.id === card.id;
                      return (
                        <Fragment key={ec.id}>
                          {i > 0 && (
                            <div key={`arrow-${ec.id}`} className="flex-1 flex items-center justify-center min-w-[12px] h-[93px]">
                              <span className="text-muted-foreground text-lg">›</span>
                            </div>
                          )}
                          <button
                            onClick={() => { if (!isCurrent) setCardStack(s => [...s, ec]); }}
                            disabled={isCurrent}
                            className="flex flex-col items-center gap-1.5 shrink-0 active:scale-95 transition-transform disabled:cursor-default"
                          >
                            <div
                              className="glass-inner rounded-[9px] p-[3px] w-[68px]"
                              style={isCurrent ? { borderColor: 'var(--pokedex-red)', borderWidth: 2 } : undefined}
                            >
                              <div className="rounded-[6px] overflow-hidden">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={ec.imgSmall}
                                  alt={ec.name}
                                  className="w-full block"
                                  style={{ aspectRatio: '2.5/3.5', objectFit: 'cover' }}
                                />
                              </div>
                            </div>
                            <span
                              className="text-[10px] text-center max-w-[68px] truncate"
                              style={{ color: isCurrent ? 'var(--pokedex-red)' : 'var(--muted-foreground)', fontWeight: isCurrent ? 700 : 400 }}
                            >
                              {ec.name}
                            </span>
                          </button>
                        </Fragment>
                      );
                    })}
                  </div>
                ) : evoLoaded ? (
                  <p className="text-[13px] text-muted-foreground pt-3">Keine Evolutionslinie</p>
                ) : (
                  <div className="flex items-center gap-2 pt-3">
                    <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin shrink-0" />
                    <p className="text-[13px] text-muted-foreground">Lade Evolutionslinie…</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── 3 · Karten & Preise (eigene Glas-Karte) ─────── */}
          <div className="glass-solid mx-4 rounded-[20px] overflow-hidden mb-3">
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
                          <span className="text-[14px] font-semibold">{VARIANT_LABELS[variant]}</span>
                          {isOwned && (
                            <span
                              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                              style={{ background: 'rgba(72,187,120,.15)', color: 'var(--green, #48bb78)' }}
                            >
                              ✓
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <CardVariantPrice tcgId={card.id} variant={variant} />
                          {/* Hinzufügen — getöntes grünes Glas (Handoff design_handoff_card_detail) */}
                          <button
                            onClick={() => setAddVariant(variant)}
                            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                            style={{
                              background: 'rgba(34,197,94,0.9)',
                              backdropFilter: 'blur(8px) saturate(1.4)',
                              WebkitBackdropFilter: 'blur(8px) saturate(1.4)',
                              border: '1.5px solid rgba(255,255,255,0.55)',
                              boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.6), 0 3px 12px rgba(34,197,94,0.4)',
                            }}
                            aria-label="Hinzufügen"
                          >
                            <Plus size={18} color="#fff" strokeWidth={3} />
                          </button>
                        </div>
                      </div>

                      {/* Eigene Kopien */}
                      {copies.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          {copies.map(copy => {
                            const copyBinders = bindersOf(copy);
                            const isConfirm = confirmId === copy.id;
                            const isDeleting = deletingId === copy.id;
                            const binder = copyBinders[0];
                            const isDefaultBinder = !binder || !!binder.isDefault;
                            const binderName = binder?.name ?? 'Meine Sammlung';
                            const condColor  = CONDITION_COLOR[copy.condition] ?? 'var(--muted-foreground)';
                            return (
                              <div
                                key={copy.id}
                                className="glass-inner flex items-center gap-2 rounded-xl px-2.5 py-2"
                                style={{ minHeight: 48 }}
                              >
                                {/* Chips */}
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  {copy.needsReview && (
                                    <button
                                      onClick={async () => {
                                        await markReviewed(copy.id);
                                        window.dispatchEvent(new Event('review-count-changed'));
                                        onSaved?.();
                                      }}
                                      className="text-[11px] px-2 py-1 rounded flex items-center gap-1 shrink-0 text-white"
                                      style={{ background: 'var(--action-delete)' }}
                                    >
                                      <CheckCircle2 size={11} /> Prüfen
                                    </button>
                                  )}
                                  <LanguageFlag lang={copy.language} size={16} />
                                  <span
                                    className="text-[12px] font-semibold px-2 py-1 rounded border shrink-0"
                                    style={{
                                      borderColor: condColor,
                                      color: condColor,
                                      background: 'transparent',
                                    }}
                                  >
                                    {CONDITION_LABEL[copy.condition] ?? copy.condition}
                                  </span>
                                  {/* Sammlung-Pill — größer für mobile Touch-Targets */}
                                  <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => router.push(binder ? `/binders/${binder.id}` : '/binders')}
                                    onKeyDown={(e) => e.key === 'Enter' && router.push(binder ? `/binders/${binder.id}` : '/binders')}
                                    className="text-[13px] font-semibold pl-3 pr-2 py-1.5 rounded-full flex items-center gap-1.5 cursor-pointer shrink-0 ml-auto truncate"
                                    style={{
                                      background: isDefaultBinder ? 'var(--secondary)' : 'rgba(66,153,225,.12)',
                                      border: isDefaultBinder
                                        ? '1px dashed var(--border)'
                                        : '1px solid rgba(66,153,225,.35)',
                                      color: isDefaultBinder ? 'var(--muted-foreground)' : '#4299e1',
                                      maxWidth: 180,
                                      minHeight: 32,
                                    }}
                                  >
                                    {binder?.icon && <span>{binder.icon}</span>}
                                    <span className="truncate">{binderName}</span>
                                    {!isDefaultBinder && binder ? (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleRemoveFromBinder(copy, binder.id); }}
                                        className="rounded-full p-1 transition-colors shrink-0 text-white"
                                        style={{ background: 'var(--action-delete)' }}
                                        title="Aus Sammlung entfernen"
                                        aria-label="Aus Sammlung entfernen"
                                      >
                                        <X size={12} strokeWidth={3} />
                                      </button>
                                    ) : (
                                      <ChevronRight size={13} style={{ opacity: 0.7 }} />
                                    )}
                                  </div>
                                </div>

                                {/* Löschen — "Ghost-Trash": dezent im Ruhezustand, erst bei
                                    Bestätigung rot (Handoff design_handoff_card_detail). */}
                                <button
                                  onClick={() => handleDelete(copy)}
                                  disabled={isDeleting}
                                  className={`shrink-0 w-10 h-10 rounded-[11px] flex items-center justify-center transition-colors ${
                                    isConfirm
                                      ? 'text-white'
                                      : 'bg-[rgba(46,46,50,0.06)] dark:bg-white/8 border border-[rgba(46,46,50,0.12)] dark:border-white/15 text-[#9aa0ac] dark:text-white/50'
                                  }`}
                                  style={isConfirm ? { background: 'var(--action-delete)' } : undefined}
                                  aria-label="Karte löschen"
                                >
                                  {isDeleting
                                    ? <span className="text-[10px]">…</span>
                                    : isConfirm
                                      ? <span className="text-[11px] font-bold">OK?</span>
                                      : <Trash2 size={16} />
                                  }
                                </button>
                              </div>
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
            <button className="glass-solid w-full h-[54px] rounded-2xl flex items-center justify-center gap-2 text-[15px] font-semibold">
              <Heart size={19} />
              Auf Wunschliste setzen
            </button>
          </div>
        </div>
      </div>

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
    </div>
  ), document.body);
}
