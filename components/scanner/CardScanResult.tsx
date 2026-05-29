'use client';

import { useState } from 'react';
import { Search, ChevronRight, RotateCcw } from 'lucide-react';
import type { TcgApiCard } from '@/lib/pokemon-tcg';
import { AddToCollectionModal } from './AddToCollectionModal';

interface ScanResult {
  name?: string;
  setName?: string;
  number?: string;
  confidence?: 'high' | 'medium' | 'low';
  isHolo?: boolean;
  isReverse?: boolean;
  error?: string;
}

interface Props {
  result: ScanResult;
  candidates: TcgApiCard[];
  onRetry: () => void;
  onManualSearch: (query: string) => void;
}

export function CardScanResult({ result, candidates, onRetry, onManualSearch }: Props) {
  const [selected, setSelected] = useState<TcgApiCard | null>(null);
  const [saved, setSaved] = useState(false);

  if (result.error) {
    return (
      <div className="px-4 py-6 text-center space-y-4">
        <p className="text-muted-foreground">Keine Karte erkannt.</p>
        <button
          onClick={onRetry}
          className="flex items-center gap-2 mx-auto px-4 py-2 rounded-xl bg-secondary text-sm"
        >
          <RotateCcw size={14} /> Nochmal versuchen
        </button>
        <button
          onClick={() => onManualSearch('')}
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
      <div className="px-4 py-8 text-center space-y-4">
        <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
          <span className="text-2xl">✓</span>
        </div>
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
      <div className="px-4 pt-3 pb-2">
        {/* Gemini result header */}
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground">Erkannte Karte</p>
          <span
            className="text-[10px] px-2 py-0.5 rounded-full"
            style={{
              background: result.confidence === 'high' ? 'rgba(72,187,120,.15)' : 'rgba(237,137,54,.15)',
              color: result.confidence === 'high' ? '#48bb78' : '#ed8936',
            }}
          >
            {result.confidence === 'high' ? 'Sicher' : result.confidence === 'medium' ? 'Unsicher' : 'Niedrig'}
          </span>
        </div>
        <p className="font-semibold">{result.name}</p>
        {result.setName && <p className="text-xs text-muted-foreground">{result.setName}{result.number ? ` · ${result.number}` : ''}</p>}
      </div>

      {/* Candidates from pokemontcg.io */}
      {candidates.length > 0 && (
        <div className="px-4 pb-3">
          <p className="text-xs text-muted-foreground mb-2">Übereinstimmungen</p>
          <div className="space-y-2">
            {candidates.slice(0, 5).map(card => (
              <button
                key={card.id}
                onClick={() => setSelected(card)}
                className="w-full flex items-center gap-3 p-2 rounded-xl bg-secondary border border-border text-left"
              >
                <div className="w-9 h-[50px] rounded-md overflow-hidden bg-card shrink-0 border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={card.images.small} alt={card.name} className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium leading-tight truncate">{card.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{card.set.name} · {card.number}</div>
                  {card.rarity && <div className="text-xs text-muted-foreground">{card.rarity}</div>}
                </div>
                <ChevronRight size={14} className="text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>

          <button
            onClick={() => onManualSearch(result.name ?? '')}
            className="mt-2 w-full text-xs py-2 flex items-center justify-center gap-1"
            style={{ color: 'var(--pokedex-red)' }}
          >
            <Search size={12} /> Andere Karte suchen
          </button>
        </div>
      )}

      {selected && (
        <AddToCollectionModal
          card={selected}
          preVariant={result.isHolo ? 'holo' : result.isReverse ? 'reverse' : undefined}
          onClose={() => setSelected(null)}
          onSaved={() => { setSelected(null); setSaved(true); }}
        />
      )}
    </>
  );
}
