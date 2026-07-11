'use client';

import { RotateCcw, Search, Plus } from 'lucide-react';
import type { CardInfo } from '@/lib/card-info';
import type { CardLanguage, CardVariant } from '@/types';
import { AddToCollectionModal } from './AddToCollectionModal';
import { toTcgdexId } from '@/lib/tcgdex';
import { useState } from 'react';

function cardImg(card: CardInfo, language: CardLanguage): string {
  if (language === 'de') {
    const tcgId = toTcgdexId(card.setId);
    return `https://assets.tcgdex.net/de/${tcgId}/${card.number}/high.webp`;
  }
  return card.imgLarge ?? card.imgSmall;
}

interface Props {
  card: CardInfo | null;
  candidates?: CardInfo[] | null;
  language: CardLanguage;
  confidence: string;
  preVariant?: CardVariant;
  ownedCount?: number;
  error?: string;
  onRetry: () => void;
  onManualSearch: () => void;
}

export function CardScanResult({ card, candidates, language, confidence, preVariant, ownedCount = 0, error, onRetry, onManualSearch }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectedCard, setSelectedCard] = useState<CardInfo | null>(card);

  // Wenn per Pokédex-Fallback mehrere Kandidaten kamen, ersten vorausgewählt halten
  const activeCard = selectedCard ?? card;

  if ((error || !card) && !candidates?.length) {
    return (
      <div className="px-4 py-8 text-center space-y-4">
        <p className="text-muted-foreground text-sm">{error ?? 'Keine Karte erkannt.'}</p>
        <button
          onClick={onRetry}
          className="flex items-center gap-2 mx-auto px-4 py-2 rounded-xl bg-secondary text-sm"
        >
          <RotateCcw size={14} /> Nochmal versuchen
        </button>
        <button
          onClick={onManualSearch}
          className="flex items-center gap-2 mx-auto px-4 py-2 rounded-xl text-sm"
          style={{ color: 'var(--pokedex-blue)' }}
        >
          <Search size={14} /> Manuell suchen
        </button>
      </div>
    );
  }

  if (saved) {
    return (
      <div className="px-4 py-10 text-center space-y-4">
        <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center mx-auto text-2xl">✓</div>
        <p className="font-semibold">Karte hinzugefügt!</p>
        <button
          onClick={onRetry}
          className="flex items-center gap-2 mx-auto px-4 py-2 rounded-xl bg-secondary text-sm"
        >
          <RotateCcw size={14} /> Nächste Karte
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="px-4 pt-4 pb-6 space-y-4">
        {/* Karten-Preview */}
        {activeCard && (
          <div className="flex gap-4 items-start">
            <div className="w-20 h-[112px] rounded-xl overflow-hidden bg-secondary border border-border shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cardImg(activeCard, language)} alt={activeCard.name} className="w-full h-full object-cover" />
            </div>
            <div className="flex-1 pt-1">
              <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full"
                  style={{
                    background: candidates ? 'rgba(237,137,54,.15)' : confidence === 'high' ? 'rgba(72,187,120,.15)' : 'rgba(237,137,54,.15)',
                    color: candidates ? '#ed8936' : confidence === 'high' ? '#48bb78' : '#ed8936',
                  }}
                >
                  {candidates ? 'Ähnliche Karte' : confidence === 'high' ? 'Sicher' : confidence === 'medium' ? 'Unsicher' : 'Niedrig'}
                </span>
                {ownedCount > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full"
                    style={{ background: 'rgba(72,187,120,.15)', color: '#48bb78' }}>
                    Bereits ×{ownedCount} vorhanden
                  </span>
                )}
              </div>
              <p className="font-semibold leading-tight">{activeCard.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{activeCard.setName}</p>
              <p className="text-xs text-muted-foreground">#{activeCard.number}{activeCard.rarity ? ` · ${activeCard.rarity}` : ''}</p>
            </div>
          </div>
        )}

        {/* Kandidaten-Auswahl wenn nur Pokédex-Fallback */}
        {candidates && candidates.length > 1 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Welche Karte meinst du?</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {candidates.slice(0, 8).map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCard(c)}
                  className="shrink-0 rounded-lg overflow-hidden border-2 transition-colors"
                  style={{ borderColor: (selectedCard ?? card)?.id === c.id ? 'var(--pokedex-red)' : 'transparent' }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.imgSmall} alt={c.name} className="w-14 h-[78px] object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Zur Sammlung hinzufügen */}
        {activeCard && (
          <button
            onClick={() => setShowModal(true)}
            className="w-full h-11 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2"
            style={{ background: 'var(--action-add)' }}
          >
            <Plus size={16} /> Zur Sammlung hinzufügen
          </button>
        )}

        {/* Andere Karte suchen */}
        <button
          onClick={onManualSearch}
          className="w-full text-xs py-2 flex items-center justify-center gap-1"
          style={{ color: 'var(--muted-foreground)' }}
        >
          <Search size={12} /> Andere Karte suchen
        </button>
      </div>

      {showModal && activeCard && (
        <AddToCollectionModal
          card={activeCard}
          preVariant={preVariant}
          preLanguage={language}
          fromScanner
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); setSaved(true); }}
        />
      )}
    </>
  );
}
