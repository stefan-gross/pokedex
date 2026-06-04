'use client';

import { useEffect, useState, useCallback } from 'react';
import { X, Plus, Heart, CheckCircle2 } from 'lucide-react';
import { AddToCollectionModal } from '@/components/scanner/AddToCollectionModal';
import { detectVariants, VARIANT_LABELS, getRarityGroup } from '@/lib/card-constants';
import { toTcgdexId } from '@/lib/tcgdex';
import { cardInfoToTcgApi, type CardInfo } from '@/lib/card-info';
import { markReviewed } from '@/lib/firestore/cards';
import type { CardDoc, BinderDoc } from '@/types';

const LANGUAGE_FLAGS: Record<string, string> = {
  de: '🇩🇪', en: '🇬🇧', jp: '🇯🇵', fr: '🇫🇷',
};

/* ── TCGdex Karten-Bild URL (Sprachversion) ──────────────────── */
function tcgdexImageUrl(setId: string, cardNumber: string, lang = 'de'): string {
  const tcgId = toTcgdexId(setId);
  const num   = parseInt(cardNumber.split('/')[0]) || cardNumber.split('/')[0];
  return `https://assets.tcgdex.net/${lang}/${tcgId}/${num}/high.webp`;
}

/* ── Deutschen Pokémon-Namen von PokéAPI laden ───────────────── */
function extractSpeciesName(cardName: string): string {
  return cardName
    .replace(/\s+(ex|EX|V|VMAX|VSTAR|GX|TAG TEAM|LEGEND|BREAK|Prime|Radiant|◇|★|Tera|Iron|Ancient|Future)(\s|$).*/i, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')         // "Tapu Koko" → "tapu-koko"
    .replace(/[^a-z0-9-]/g, ''); // Sonderzeichen entfernen
}

async function fetchGermanName(cardName: string, supertype?: string): Promise<string | null> {
  if (supertype && supertype.toLowerCase() !== 'pokémon' && supertype.toLowerCase() !== 'pokemon') {
    return null; // Trainer/Energy → kein PokéAPI-Lookup
  }
  try {
    const species = extractSpeciesName(cardName);
    if (!species) return null;
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${species}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.names?.find((n: { language: { name: string }; name: string }) =>
      n.language.name === 'de'
    )?.name ?? null;
  } catch {
    return null;
  }
}


/* ── Props ───────────────────────────────────────────────────── */
interface SetMeta {
  nameDe: string;
  logoUrl: string;
  total: number;
}

export type { SetMeta };

interface Props {
  card: CardInfo | null;
  ownedCopies: CardDoc[];
  binders: BinderDoc[];
  setMeta?: SetMeta;
  onClose: () => void;
  onSaved?: () => void;
}

/* ── Component ───────────────────────────────────────────────── */
export function CardDetailSheet({ card, ownedCopies, binders, setMeta, onClose, onSaved }: Props) {
  const [visible, setVisible]         = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [germanName, setGermanName]   = useState<string | null>(null);
  const [imgSrc, setImgSrc]           = useState<string>('');
  const [imgFailed, setImgFailed]     = useState(false);

  /* Slide-in + Reset bei neuer Karte */
  useEffect(() => {
    if (card) {
      setGermanName(null);
      setImgFailed(false);
      setImgSrc(tcgdexImageUrl(card.setId, card.number, 'de'));
      requestAnimationFrame(() => setVisible(true));

      // Deutschen Pokémon-Namen laden
      fetchGermanName(card.name, card.supertype).then(name => {
        if (name) setGermanName(name);
      });
    } else {
      setVisible(false);
    }
  }, [card]);

  if (!card) return null;

  const rarityInfo = card.rarity ? getRarityGroup(card.rarity) : null;
  const variants   = (card.variants?.length ? card.variants : (card.rarity ? detectVariants(card.rarity) : ['standard' as const])) as import('@/types').CardVariant[];
  const tcgApiCard = cardInfoToTcgApi(card);
  const displayName = germanName ?? card.name;

  /* Kartennummer formatieren: "1" → "001/258" */
  const numFormatted = (() => {
    const base = card.number.split('/')[0];
    const padded = base.padStart(3, '0');
    return setMeta?.total ? `${padded}/${setMeta.total}` : padded;
  })();

  function bindersForCopy(copy: CardDoc): BinderDoc[] {
    return binders.filter(b => b.cardIds.includes(copy.id));
  }

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 250);
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
        className="relative w-full rounded-t-2xl bg-card border-t border-border transition-transform duration-[250ms] ease-out max-h-[90dvh] flex flex-col"
        style={{ transform: visible ? 'translateY(0)' : 'translateY(100%)' }}
      >
        {/* Handle + Schließen */}
        <div className="flex items-center justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>
        <button onClick={handleClose} className="absolute right-4 top-3 text-muted-foreground p-1">
          <X size={18} />
        </button>

        {/* Scrollbarer Inhalt */}
        <div className="overflow-y-auto px-4 pb-28">

          {/* ── Karte + Meta ─────────────────────────────────── */}
          <div className="flex gap-4 py-4">
            {/* Karten-Bild (deutsch via TCGdex, Fallback pokemontcg.io) */}
            <div className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imgFailed ? card.imgLarge : imgSrc}
                alt={displayName}
                className="w-28 rounded-xl border-2 shadow-lg"
                style={{ borderColor: rarityInfo?.color ?? 'var(--border)' }}
                onError={() => {
                  if (!imgFailed) setImgFailed(true);
                }}
              />
            </div>

            {/* Meta */}
            <div className="flex-1 min-w-0 pt-1 space-y-2">
              {/* Pokémon-Name (deutsch) */}
              <h2 className="text-base font-bold leading-tight">{displayName}</h2>

              {/* Set: Logo + Name */}
              <div className="flex items-center gap-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={setMeta?.logoUrl ?? `https://images.pokemontcg.io/${card.setId}/logo.png`}
                  alt={setMeta?.nameDe ?? card.setName}
                  className="h-4 max-w-[48px] object-contain"
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
                <span className="text-xs text-muted-foreground truncate">
                  {setMeta?.nameDe ?? card.setName}
                </span>
              </div>

              {/* Nummer */}
              <p className="text-xs text-muted-foreground font-mono">{numFormatted}</p>

              {/* Rarity als Icon */}
              {rarityInfo && (
                <div className="flex items-center gap-1.5">
                  <span className="text-base" style={{ color: rarityInfo.color }}>
                    {rarityInfo.symbol}
                  </span>
                  <span className="text-xs text-muted-foreground">{rarityInfo.label}</span>
                </div>
              )}

              {/* Varianten-Chips */}
              {variants.length > 1 && (
                <div className="flex flex-wrap gap-1">
                  {variants.map(v => (
                    <span
                      key={v}
                      className="px-2 py-0.5 rounded-full text-[10px] font-medium border border-border text-muted-foreground bg-secondary"
                    >
                      {VARIANT_LABELS[v]}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* ── In deiner Sammlung ───────────────────────────── */}
          <div className="py-4 space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              In deiner Sammlung
            </h3>

            {ownedCopies.length === 0 ? (
              <p className="text-sm text-muted-foreground">Noch nicht in deiner Sammlung</p>
            ) : (
              <div className="space-y-2">
                {ownedCopies.map(copy => {
                  const copyBinders = bindersForCopy(copy);
                  return (
                    <div
                      key={copy.id}
                      className="rounded-xl border bg-background px-3 py-2.5 space-y-1.5"
                      style={{ borderColor: copy.needsReview ? 'var(--pokedex-red)' : 'var(--border)' }}
                    >
                      {copy.needsReview && (
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-medium" style={{ color: 'var(--pokedex-red)' }}>
                            Noch nicht geprüft
                          </span>
                          <button
                            onClick={async () => {
                              await markReviewed(copy.id);
                              window.dispatchEvent(new Event('review-count-changed'));
                              onSaved?.();
                            }}
                            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
                            style={{ background: 'rgba(72,187,120,.15)', color: '#48bb78' }}
                          >
                            <CheckCircle2 size={10} /> Geprüft
                          </button>
                        </div>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium">{VARIANT_LABELS[copy.variant]}</span>
                        <span className="text-xs">{LANGUAGE_FLAGS[copy.language] ?? copy.language}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                          {copy.condition}
                        </span>
                        {copy.isFoil && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border border-yellow-500/50 text-yellow-400">Foil</span>
                        )}
                        {copy.isFirstEd && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">1st Ed.</span>
                        )}
                        <span className="ml-auto text-xs font-semibold">×{copy.quantity}</span>
                      </div>

                      {copyBinders.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {copyBinders.map(b => (
                            <div key={b.id} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <span>{b.icon ?? '📁'}</span>
                              <span>{b.name}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {copy.notes && (
                        <p className="text-[10px] text-muted-foreground italic">{copy.notes}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="h-px bg-border" />

          {/* ── Aktionen ─────────────────────────────────────── */}
          <div className="pt-4 flex gap-2">
            <button
              onClick={() => setShowAddModal(true)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium text-white"
              style={{ background: 'var(--pokedex-red)' }}
            >
              <Plus size={16} />
              Zur Sammlung
            </button>
            <button
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-border text-muted-foreground"
            >
              <Heart size={16} />
              Merkliste
            </button>
          </div>
        </div>
      </div>

      {showAddModal && (
        <AddToCollectionModal
          card={tcgApiCard}
          onClose={() => setShowAddModal(false)}
          onSaved={() => { setShowAddModal(false); onSaved?.(); }}
        />
      )}
    </div>
  );
}
