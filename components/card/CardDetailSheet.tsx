'use client';

import { useEffect, useState } from 'react';
import { X, Plus, Heart, CheckCircle2, ChevronDown, Trash2, Info, Repeat2, LayoutGrid } from 'lucide-react';
import { AddToCollectionModal } from '@/components/scanner/AddToCollectionModal';
import { detectVariants, VARIANT_LABELS, getRarityGroup, SERIES_NAMES_DE } from '@/lib/card-constants';
import { toTcgdexId } from '@/lib/tcgdex';
import { cardInfoToTcgApi, catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { markReviewed, deleteCard } from '@/lib/firestore/cards';
import { removeCardFromBinder } from '@/lib/firestore/binders';
import { getCardsByEvolutionFamily } from '@/lib/firestore/catalog';
import { EnergyIcon, type EnergyType } from '@/components/ui/EnergyIcon';
import { fetchPokemonSpeciesDE, type SpeciesDE } from '@/lib/pokeapi';
import { fetchTcgdexDataMap, resolveSetDe } from '@/lib/tcgdex';
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

const STAGE_LABELS = ['Basic','Stage 1','Stage 2','MEGA','VMAX','VSTAR','V','GX','EX','V-UNION'];
function getStage(subtypes: string[]): string | null {
  return subtypes.find(s => STAGE_LABELS.includes(s)) ?? null;
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
  binders: BinderDoc[];
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
      style={{ borderTop: border ? '1px solid var(--border)' : 'none' }}
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
export function CardDetailSheet({ card, ownedCopies, binders, setMeta, onClose, onSaved }: Props) {
  const [visible,      setVisible]      = useState(false);
  const [zoomed,       setZoomed]       = useState(false);
  const [openSec,      setOpenSec]      = useState<Set<Section>>(new Set(['cards']));
  const [imgSrc,       setImgSrc]       = useState('');
  const [imgFailed,    setImgFailed]    = useState(false);
  const [addVariant,   setAddVariant]   = useState<CardVariant | null>(null);
  const [species,      setSpecies]      = useState<SpeciesDE | null>(null);
  const [evoCards,     setEvoCards]     = useState<CardInfo[]>([]);
  const [deletingId,   setDeletingId]   = useState<string | null>(null);
  const [confirmId,    setConfirmId]    = useState<string | null>(null);
  const [resolvedMeta, setResolvedMeta] = useState<SetMeta | undefined>(setMeta);

  /* Reset + load on card change */
  useEffect(() => {
    if (!card) { setVisible(false); return; }
    setSpecies(null); setEvoCards([]); setImgFailed(false);
    setImgSrc(card.imgSmall ?? ''); // EN-Bild sofort zeigen, DE folgt
    requestAnimationFrame(() => setVisible(true));

    // Set-Metadaten laden (DE-Name, Logo, Bild-URL)
    const loadMeta = async () => {
      let meta = setMeta;
      if (!meta) {
        const dataMap = await fetchTcgdexDataMap();
        const { nameDe, logoDe, total } = resolveSetDe(card.setId, dataMap, card.setName);
        meta = {
          nameDe,
          logoUrl: logoDe ?? `https://images.pokemontcg.io/${card.setId}/logo.png`,
          total:   total ?? 0,
        };
      }
      setResolvedMeta(meta);
      // DE-Kartenbild aus Logo-URL ableiten
      const deImg = imgFromLogoUrl(meta.logoUrl, card.number);
      if (deImg) setImgSrc(deImg);
    };
    loadMeta();

    const isPokemon = !card.supertype ||
      card.supertype.toLowerCase().includes('pokémon') ||
      card.supertype.toLowerCase() === 'pokemon';

    if (isPokemon) {
      fetchPokemonSpeciesDE(card.name, card.supertype).then(s => { if (s) setSpecies(s); });
      if (card.nationalDexNumber) {
        getCardsByEvolutionFamily(card.nationalDexNumber, 6)
          .then(cards => setEvoCards(cards.map(catalogCardToInfo)));
      }
    }
  }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!card) return null;

  /* Derived values */
  const rarityInfo  = card.rarity ? getRarityGroup(card.rarity) : null;
  const variants    = (card.variants?.length
    ? card.variants
    : card.rarity ? detectVariants(card.rarity) : ['standard']
  ) as CardVariant[];
  const tcgApiCard  = cardInfoToTcgApi(card);
  const stage       = getStage(card.subtypes ?? []);
  const energyTypes = (card.types ?? []).map(toEnergy).filter(Boolean) as EnergyType[];
  const setCode     = card.setCode ?? toTcgdexId(card.setId).toUpperCase();
  const numBase     = card.number.split('/')[0].padStart(3, '0');
  const numTotal    = resolvedMeta?.total ? String(resolvedMeta.total).padStart(3, '0') : null;
  const numFmt      = numTotal ? `${numBase}/${numTotal}` : numBase;
  const logoUrl     = resolvedMeta?.logoUrl ?? `https://images.pokemontcg.io/${card.setId}/logo.png`;
  const setNameDe   = resolvedMeta?.nameDe ?? card.setName;

  function bindersOf(copy: CardDoc) { return binders.filter(b => b.cardIds.includes(copy.id)); }
  function toggle(s: Section) {
    setOpenSec(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  }
  function handleClose() { setVisible(false); setTimeout(onClose, 250); }

  async function handleDelete(copy: CardDoc) {
    if (confirmId !== copy.id) {
      setConfirmId(copy.id);
      setTimeout(() => setConfirmId(c => c === copy.id ? null : c), 3000);
      return;
    }
    setConfirmId(null);
    setDeletingId(copy.id);
    try {
      await Promise.all(bindersOf(copy).map(b => removeCardFromBinder(b.id, copy.id)));
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
        className="relative w-full rounded-t-2xl bg-card border-t border-border max-h-[93dvh] flex flex-col transition-transform duration-[250ms] ease-out"
        style={{ transform: visible ? 'translateY(0)' : 'translateY(100%)' }}
      >
        {/* Handle */}
        <div className="flex items-center justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        {/* ── Karten-Header (wie echte Pokémon-Karte) ───────── */}
        <div className="flex items-center justify-between px-4 pb-2.5 gap-2 shrink-0">
          {/* Links: Evolutionsstufe */}
          {stage ? (
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

          {/* Rechts: KP + Typ-Icons + Schließen */}
          <div className="flex items-center gap-2 shrink-0">
            {card.hp && (
              <span className="text-[16px] font-bold text-muted-foreground">KP {card.hp}</span>
            )}
            {energyTypes.map(t => (
              <EnergyIcon key={t} type={t} size={26} />
            ))}
            <button onClick={handleClose} className="p-1 text-muted-foreground ml-1">
              <X size={18} />
            </button>
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imgFailed ? card.imgLarge : imgSrc}
                alt={card.name}
                className="w-full block"
                style={{ aspectRatio: '2.5/3.5', objectFit: 'cover' }}
                onError={() => { if (!imgFailed) setImgFailed(true); }}
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
          <div className="mx-4 rounded-2xl border border-border overflow-hidden mb-4">

            {/* 1 · Details */}
            <AccHeader
              icon={<Info size={16} />}
              title="Details"
              open={openSec.has('details')}
              onToggle={() => toggle('details')}
              border={false}
            />
            {openSec.has('details') && (
              <div className="px-4 pb-4 border-t border-border">
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
                ) : (
                  <p className="text-[13px] text-muted-foreground pt-3">Lade Details…</p>
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
              <div className="px-4 pb-4 border-t border-border">
                {evoCards.length > 1 ? (
                  <div className="flex items-center gap-0 overflow-x-auto pt-3 pb-1" style={{ scrollbarWidth: 'none' }}>
                    {evoCards.map((ec, i) => (
                      <div key={ec.id} className="flex items-center shrink-0">
                        {i > 0 && (
                          <span className="text-muted-foreground text-lg px-2 pb-4">›</span>
                        )}
                        <div className="flex flex-col items-center gap-1.5">
                          <div
                            className="rounded-lg overflow-hidden border-2 w-[62px]"
                            style={{ borderColor: ec.id === card.id ? 'var(--pokedex-red)' : 'var(--border)' }}
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
                            style={{ color: ec.id === card.id ? 'var(--pokedex-red)' : 'var(--muted-foreground)', fontWeight: ec.id === card.id ? 700 : 400 }}
                          >
                            {ec.name}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-muted-foreground pt-3">
                    {evoCards.length === 0 ? 'Lade Evolutionslinie…' : 'Keine Evolutionslinie'}
                  </p>
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
              <div className="border-t border-border">
                {variants.map((variant, vi) => {
                  const copies = ownedCopies.filter(c => c.variant === variant);
                  const isOwned = copies.length > 0;
                  return (
                    <div
                      key={variant}
                      className="px-4 py-3"
                      style={{
                        borderTop: vi > 0 ? '1px solid var(--border)' : 'none',
                        background: isOwned ? 'rgba(72,187,120,.04)' : 'transparent',
                      }}
                    >
                      {/* Variant-Zeile: Name + Owned-Badge + + Button */}
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[15px] font-bold">{VARIANT_LABELS[variant]}</span>
                          {isOwned && (
                            <span
                              className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                              style={{ background: 'rgba(72,187,120,.15)', color: 'var(--green, #48bb78)' }}
                            >
                              ✓ {copies.reduce((s, c) => s + c.quantity, 0)}×
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => setAddVariant(variant)}
                          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                          style={{
                            background: isOwned ? 'var(--secondary)' : 'var(--pokedex-red)',
                            border: isOwned ? '1.5px solid var(--border)' : 'none',
                          }}
                          aria-label="Hinzufügen"
                        >
                          <Plus size={18} color={isOwned ? 'var(--muted-foreground)' : '#fff'} strokeWidth={2.5} />
                        </button>
                      </div>

                      {/* Preis-Placeholder (wird mit Cardmarket befüllt wenn verfügbar) */}
                      <div className="text-[12px] text-muted-foreground mb-2">
                        — Cardmarket-Preis folgt
                      </div>

                      {/* Eigene Kopien */}
                      {copies.length > 0 && (
                        <div className="flex flex-col gap-2 mt-2">
                          {copies.map(copy => {
                            const copyBinders = bindersOf(copy);
                            const isConfirm = confirmId === copy.id;
                            const isDeleting = deletingId === copy.id;
                            return (
                              <div
                                key={copy.id}
                                className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                                style={{ background: 'var(--secondary)', minHeight: 44 }}
                              >
                                {/* Chips */}
                                <div className="flex gap-1.5 flex-wrap flex-1 min-w-0">
                                  {copy.needsReview && (
                                    <button
                                      onClick={async () => {
                                        await markReviewed(copy.id);
                                        window.dispatchEvent(new Event('review-count-changed'));
                                        onSaved?.();
                                      }}
                                      className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1"
                                      style={{ background: 'rgba(229,62,62,.15)', color: 'var(--pokedex-red)' }}
                                    >
                                      <CheckCircle2 size={10} /> Prüfen
                                    </button>
                                  )}
                                  <span
                                    className="text-[12px] font-semibold px-2 py-0.5 rounded-full"
                                    style={{ background: 'rgba(255,255,255,.07)', color: 'var(--muted-foreground)' }}
                                  >
                                    {copy.condition}
                                  </span>
                                  <span className="text-[14px]">{LANGUAGE_FLAGS[copy.language] ?? copy.language}</span>
                                  {copyBinders.map(b => (
                                    <span key={b.id} className="text-[11px] text-muted-foreground flex items-center gap-0.5">
                                      {b.icon ?? '📁'} {b.name}
                                    </span>
                                  ))}
                                </div>

                                {/* Anzahl */}
                                <span
                                  className="text-[14px] font-extrabold shrink-0"
                                  style={{ color: 'var(--green, #48bb78)' }}
                                >
                                  ×{copy.quantity}
                                </span>

                                {/* Löschen */}
                                <button
                                  onClick={() => handleDelete(copy)}
                                  disabled={isDeleting}
                                  className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
                                  style={{
                                    background: isConfirm ? 'rgba(229,62,62,.2)' : 'rgba(229,62,62,.08)',
                                    color: 'var(--pokedex-red)',
                                  }}
                                >
                                  {isDeleting
                                    ? <span className="text-[10px]">…</span>
                                    : isConfirm
                                      ? <span className="text-[10px] font-bold">OK?</span>
                                      : <Trash2 size={14} />
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
                <div className="px-4 pt-2 pb-3 border-t border-border">
                  <button
                    className="w-full h-11 rounded-xl border border-border flex items-center justify-center gap-2 text-[13px] font-semibold text-muted-foreground"
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
            src={imgFailed ? card.imgLarge : imgSrc}
            alt={card.name}
            className="rounded-2xl"
            style={{ maxWidth: '90vw', maxHeight: '85dvh', objectFit: 'contain' }}
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
          card={tcgApiCard}
          preVariant={addVariant}
          onClose={() => setAddVariant(null)}
          onSaved={() => { setAddVariant(null); onSaved?.(); }}
        />
      )}
    </div>
  );
}
