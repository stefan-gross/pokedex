'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { X, Plus, Heart, CheckCircle2, ChevronDown, ChevronRight, ChevronLeft, Trash2, Info, Repeat2, LayoutGrid } from 'lucide-react';
import { AddToCollectionModal } from '@/components/scanner/AddToCollectionModal';
import { detectVariants, VARIANT_LABELS, getRarityGroup, SERIES_NAMES_DE, getSubtypeDe } from '@/lib/card-constants';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { markReviewed, deleteCard } from '@/lib/firestore/cards';
import { getBinders, addCardToBinder, removeCardFromBinder, removeCardFromBinderAndCleanup, ensureDefaultBinder } from '@/lib/firestore/binders';
import { getCardsByEvolutionFamily, getCardsByDexNumber } from '@/lib/firestore/catalog';
import { EnergyIcon, type EnergyType } from '@/components/ui/EnergyIcon';
import { CardVariantPrice } from '@/components/card/CardPriceDetail';
import { fetchPokemonSpeciesDE, getEvolutionFamilyDexNumbers, type SpeciesDE } from '@/lib/pokeapi';
import { getSetById } from '@/lib/firestore/sets';
import { CardImage } from '@/components/card/CardImage';
import type { CardDoc, BinderDoc, CardVariant } from '@/types';

/* ── Helpers ─────────────────────────────────────────────────── */

const LANGUAGE_FLAGS: Record<string, string> = {
  de: '🇩🇪', en: '🇬🇧', jp: '🇯🇵', fr: '🇫🇷',
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

/* ── Props / Types ───────────────────────────────────────────── */

interface SetMeta { nameDe: string; logoUrl: string; total: number; }
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
  const [resolvedMeta,    setResolvedMeta]    = useState<SetMeta | undefined>(setMeta);
  const [resolvedBinders, setResolvedBinders] = useState<BinderDoc[]>(binders ?? []);

  /* Reset + load on card change */
  useEffect(() => {
    if (!card) { setVisible(false); return; }
    setSpecies(null); setSpeciesLoaded(false);
    setEvoCards([]); setEvoLoaded(false);
    // DE-Bild direkt aus Firestore, falls vorhanden (|| fängt auch leere Strings ab)
    setImgSrcDe(card.imgLargeDe || undefined);
    requestAnimationFrame(() => setVisible(true));

    // Set-Metadaten laden (DE-Name, Logo) — aus tcg_sets Firestore, kein externer API-Call
    const loadMeta = async () => {
      let meta = setMeta;
      if (!meta) {
        const setDoc = await getSetById(card.setId);
        meta = {
          nameDe:  setDoc?.nameDe ?? setDoc?.name ?? card.setName,
          logoUrl: setDoc?.logoUrl ?? `https://images.pokemontcg.io/${card.setId}/logo.png`,
          total:   setDoc?.total ?? 0,
        };
      }
      setResolvedMeta(meta);
      // Fallback: DE-Bild aus Logo-URL ableiten wenn imgLargeDe nicht in Firestore
      if (!card.imgLargeDe) {
        const deImg = imgFromLogoUrl(meta.logoUrl, card.number);
        if (deImg) setImgSrcDe(deImg);
      }
    };
    loadMeta();
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

            // Eine Karte pro Pokédex-Nummer, sortiert nach Evo-Stufe
            const seen = new Set<number>();
            const deduped = source
              .filter(c => {
                if (!c.nationalDexNumber || seen.has(c.nationalDexNumber)) return false;
                seen.add(c.nationalDexNumber);
                return true;
              })
              .sort((a, b) => (a.nationalDexNumber ?? 0) - (b.nationalDexNumber ?? 0));
            setEvoCards(deduped);
            setEvoLoaded(true);
          });
      } else {
        setEvoLoaded(true);
      }
    } else {
      setSpeciesLoaded(true);
      setEvoLoaded(true);
    }
  }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const numTotal    = resolvedMeta?.total ? String(resolvedMeta.total).padStart(3, '0') : null;
  const numFmt      = numTotal ? `${numBase}/${numTotal}` : numBase;
  const logoUrl     = resolvedMeta?.logoUrl ?? `https://images.pokemontcg.io/${card.setId}/logo.png`;
  const setNameDe   = resolvedMeta?.nameDe ?? card.setName;

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

  return (
    <div className="fixed inset-0 z-[60] flex items-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 transition-opacity duration-[250ms]"
        style={{ opacity: visible ? 1 : 0 }}
        onClick={handleClose}
      />

      {/* Sheet */}
      <div
        className="relative w-full rounded-t-2xl bg-card max-h-[93dvh] flex flex-col"
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
              className="shrink-0 rounded-xl overflow-hidden cursor-zoom-in border"
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
                  <span
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded-md border shrink-0"
                    style={{ color: 'var(--foreground)', borderColor: 'var(--foreground)' }}
                  >
                    {setCode}
                  </span>
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

          {/* ── Akkordion ─────────────────────────────────── */}
          <div className="mx-4 rounded-2xl shadow-card overflow-hidden mb-4">

            {/* 1 · Details */}
            <AccHeader
              icon={<Info size={16} />}
              title="Details"
              open={openSec.has('details')}
              onToggle={() => toggle('details')}
              border={false}
            />
            {openSec.has('details') && (
              <div className="px-4 pb-4 border-t border-border/50">
                {species ? (
                  <>
                    {species.genus && (
                      <p className="text-[13px] text-muted-foreground mb-3 pt-3">{species.genus}</p>
                    )}
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {species.height > 0 && (
                        <div className="bg-secondary rounded-xl px-3 py-2.5">
                          <div className="text-[15px] font-bold">{(species.height / 10).toFixed(1)} m</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">Größe</div>
                        </div>
                      )}
                      {species.weight > 0 && (
                        <div className="bg-secondary rounded-xl px-3 py-2.5">
                          <div className="text-[15px] font-bold">{(species.weight / 10).toFixed(1)} kg</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">Gewicht</div>
                        </div>
                      )}
                      {species.region && (
                        <div className="bg-secondary rounded-xl px-3 py-2.5">
                          <div className="text-[15px] font-bold">{species.region}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">Region</div>
                        </div>
                      )}
                      {card.nationalDexNumber && (
                        <div className="bg-secondary rounded-xl px-3 py-2.5">
                          <div className="text-[15px] font-bold">#{String(card.nationalDexNumber).padStart(3, '0')}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">Pokédex</div>
                        </div>
                      )}
                    </div>
                    {species.flavorText && (
                      <p className="text-[13px] text-muted-foreground leading-relaxed italic">
                        „{species.flavorText}"
                      </p>
                    )}
                  </>
                ) : speciesLoaded ? (
                  <div className="pt-3">
                    {card.nationalDexNumber && (
                      <div className="bg-secondary rounded-xl px-3 py-2.5 w-fit mb-3">
                        <div className="text-[15px] font-bold">#{String(card.nationalDexNumber).padStart(3, '0')}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">Pokédex</div>
                      </div>
                    )}
                    <p className="text-[13px] text-muted-foreground">Keine Details verfügbar</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 pt-3">
                    <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin shrink-0" />
                    <p className="text-[13px] text-muted-foreground">Lade Details…</p>
                  </div>
                )}
              </div>
            )}

            {/* 2 · Evolutionslinie */}
            <AccHeader
              icon={<Repeat2 size={16} />}
              title="Evolutionslinie"
              open={openSec.has('evo')}
              onToggle={() => toggle('evo')}
            />
            {openSec.has('evo') && (
              <div className="px-4 pb-4 border-t border-border/50">
                {evoCards.length > 1 ? (
                  <div className="flex items-center gap-0 overflow-x-auto pt-3 pb-1" style={{ scrollbarWidth: 'none' }}>
                    {evoCards.map((ec, i) => {
                      const isCurrent = ec.id === card.id;
                      return (
                        <div key={ec.id} className="flex items-center shrink-0">
                          {i > 0 && (
                            <span className="text-muted-foreground text-lg px-2 pb-4">›</span>
                          )}
                          <button
                            onClick={() => { if (!isCurrent) setCardStack(s => [...s, ec]); }}
                            disabled={isCurrent}
                            className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform disabled:cursor-default"
                          >
                            <div
                              className="rounded-lg overflow-hidden border-2 w-[62px]"
                              style={{ borderColor: isCurrent ? 'var(--pokedex-red)' : 'var(--border)' }}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={ec.imgSmall}
                                alt={ec.name}
                                className="w-full block"
                                style={{ aspectRatio: '2.5/3.5', objectFit: 'cover' }}
                              />
                            </div>
                            <span
                              className="text-[10px] text-center max-w-[64px] truncate"
                              style={{ color: isCurrent ? 'var(--pokedex-red)' : 'var(--muted-foreground)', fontWeight: isCurrent ? 700 : 400 }}
                            >
                              {ec.name}
                            </span>
                          </button>
                        </div>
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

            {/* 3 · Karten & Preise */}
            <AccHeader
              icon={<LayoutGrid size={16} />}
              title="Karten & Preise"
              open={openSec.has('cards')}
              onToggle={() => toggle('cards')}
            />
            {openSec.has('cards') && (
              <div className="border-t border-border/50">
                {variants.map((variant, vi) => {
                  const copies = ownedCopies.filter(c => c.variant === variant);
                  const isOwned = copies.length > 0;
                  return (
                    <div
                      key={variant}
                      className="px-3 py-2"
                      style={{
                        borderTop: vi > 0 ? '1px solid color-mix(in srgb, var(--border) 50%, transparent)' : 'none',
                        background: isOwned ? 'rgba(72,187,120,.04)' : 'transparent',
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
                          <button
                            onClick={() => setAddVariant(variant)}
                            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                            style={{
                              background: isOwned ? 'var(--secondary)' : 'var(--pokedex-red)',
                              border: isOwned ? '1.5px solid var(--border)' : 'none',
                            }}
                            aria-label="Hinzufügen"
                          >
                            <Plus size={16} color={isOwned ? 'var(--muted-foreground)' : '#fff'} strokeWidth={2.5} />
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
                            return (
                              <div
                                key={copy.id}
                                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5"
                                style={{ background: 'var(--secondary)', minHeight: 36 }}
                              >
                                {/* Chips */}
                                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                  {copy.needsReview && (
                                    <button
                                      onClick={async () => {
                                        await markReviewed(copy.id);
                                        window.dispatchEvent(new Event('review-count-changed'));
                                        onSaved?.();
                                      }}
                                      className="text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0"
                                      style={{ background: 'rgba(229,62,62,.15)', color: 'var(--pokedex-red)' }}
                                    >
                                      <CheckCircle2 size={10} /> Prüfen
                                    </button>
                                  )}
                                  <span className="text-[13px] shrink-0">{LANGUAGE_FLAGS[copy.language] ?? copy.language}</span>
                                  <span
                                    className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                                    style={{ background: 'rgba(255,255,255,.07)', color: 'var(--muted-foreground)' }}
                                  >
                                    {copy.condition}
                                  </span>
                                  {/* Sammlung-Pill — nur bei nicht-Default-Bindern (spart Platz) */}
                                  {!isDefaultBinder && binder && (
                                    <div
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => router.push(`/binders/${binder.id}`)}
                                      onKeyDown={(e) => e.key === 'Enter' && router.push(`/binders/${binder.id}`)}
                                      className="text-[11px] font-semibold pl-2 pr-1.5 py-0.5 rounded-full flex items-center gap-1 cursor-pointer shrink-0 ml-auto truncate"
                                      style={{
                                        background: 'rgba(66,153,225,.12)',
                                        border: '1px solid rgba(66,153,225,.35)',
                                        color: '#4299e1',
                                        maxWidth: 140,
                                      }}
                                    >
                                      {binder.icon && <span>{binder.icon}</span>}
                                      <span className="truncate">{binder.name}</span>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleRemoveFromBinder(copy, binder.id); }}
                                        className="rounded-full p-0.5 transition-colors shrink-0"
                                        style={{ background: 'rgba(229,62,62,.2)', color: '#fc8181' }}
                                        title="Aus Sammlung entfernen"
                                      >
                                        <Trash2 size={10} />
                                      </button>
                                    </div>
                                  )}
                                </div>

                                {/* Löschen */}
                                <button
                                  onClick={() => handleDelete(copy)}
                                  disabled={isDeleting}
                                  className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                                  style={{
                                    background: isConfirm ? 'rgba(229,62,62,.2)' : 'rgba(229,62,62,.08)',
                                    color: 'var(--pokedex-red)',
                                  }}
                                >
                                  {isDeleting
                                    ? <span className="text-[10px]">…</span>
                                    : isConfirm
                                      ? <span className="text-[10px] font-bold">OK?</span>
                                      : <Trash2 size={12} />
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

                {/* Wunschliste */}
                <div className="px-4 pt-2 pb-3 border-t border-border/50">
                  <button
                    className="w-full h-11 rounded-xl bg-secondary flex items-center justify-center gap-2 text-[13px] font-semibold text-muted-foreground"
                  >
                    <Heart size={15} />
                    Auf Wunschliste setzen
                  </button>
                </div>
              </div>
            )}

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
  );
}
