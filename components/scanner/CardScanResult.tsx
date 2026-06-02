'use client';

import { RotateCcw, Search, Plus } from 'lucide-react';
import type { CardInfo } from '@/lib/card-info';
import type { CardLanguage } from '@/types';
import { AddToCollectionModal } from './AddToCollectionModal';
import { cardInfoToTcgApi } from '@/lib/card-info';
import { useState } from 'react';

interface Props {
  card: CardInfo | null;
  language: CardLanguage;
  confidence: string;
  error?: string;
  onRetry: () => void;
  onManualSearch: () => void;
}

export function CardScanResult({ card, language, confidence, error, onRetry, onManualSearch }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [saved, setSaved] = useState(false);

  if (error || !card) {
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
          style={{ color: 'var(--pokedex-red)' }}
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
        <div className="flex gap-4 items-start">
          <div className="w-20 h-[112px] rounded-xl overflow-hidden bg-secondary border border-border shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={card.imgSmall} alt={card.name} className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 pt-1">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-[10px] px-2 py-0.5 rounded-full"
                style={{
                  background: confidence === 'high' ? 'rgba(72,187,120,.15)' : 'rgba(237,137,54,.15)',
                  color: confidence === 'high' ? '#48bb78' : '#ed8936',
                }}
              >
                {confidence === 'high' ? 'Sicher' : confidence === 'medium' ? 'Unsicher' : 'Niedrig'}
              </span>
            </div>
            <p className="font-semibold leading-tight">{card.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{card.setName}</p>
            <p className="text-xs text-muted-foreground">#{card.number}{card.rarity ? ` · ${card.rarity}` : ''}</p>
          </div>
        </div>

        {/* Zur Sammlung hinzufügen */}
        <button
          onClick={() => setShowModal(true)}
          className="w-full h-11 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2"
          style={{ background: 'var(--pokedex-red)' }}
        >
          <Plus size={16} /> Zur Sammlung hinzufügen
        </button>

        {/* Andere Karte suchen */}
        <button
          onClick={onManualSearch}
          className="w-full text-xs py-2 flex items-center justify-center gap-1"
          style={{ color: 'var(--muted-foreground)' }}
        >
          <Search size={12} /> Andere Karte suchen
        </button>
      </div>

      {showModal && (
        <AddToCollectionModal
          card={cardInfoToTcgApi(card)}
          preLanguage={language}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); setSaved(true); }}
        />
      )}
    </>
  );
}
