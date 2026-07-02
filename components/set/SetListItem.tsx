'use client';

import Link from 'next/link';
import { SYMBOL_ONLY_SERIES } from '@/lib/card-constants';

interface SetListItemProps {
  setId: string;
  /** Englischer Name als Fallback */
  name: string;
  /** Deutscher Name (bevorzugt) */
  nameDe?: string;
  /** Deutsches Logo-URL (TCGdex), Fallback: pokemontcg.io */
  logoDe?: string;
  owned: number;
  total: number | null;
  /** Optionaler Set-Code (z.B. "PAF") — wird als Badge angezeigt, außer bei
   *  Sets ohne echten Kürzel-Aufdruck (siehe symbolUrl/series) */
  ptcgoCode?: string;
  /** Grafisches Set-Symbol (Kartenaufdruck) — ersetzt den Kürzel-Badge bei Sets
   *  ohne echten Textcode (pre-Scarlet&Violet) */
  symbolUrl?: string;
  /** pokemontcg.io-Serie, entscheidet ob Symbol statt Kürzel gezeigt wird */
  series?: string;
  href: string;
  /** Trennlinie unten (für gruppierte Listen) */
  separator?: boolean;
}

/**
 * Wiederverwendbares Set-Listenelement mit Logo, Name, Fortschrittsbalken.
 * Genutzt auf Dashboard und in der Sets-Übersicht.
 */
export function SetListItem({
  setId, name, nameDe, logoDe, owned, total, ptcgoCode, symbolUrl, series, href, separator = false,
}: SetListItemProps) {
  const displayName = nameDe ?? name;
  const logoSrc     = logoDe ?? `https://images.pokemontcg.io/${setId}/logo.png`;
  const pct         = total ? Math.round((owned / total) * 100) : null;
  const isSymbolOnlySet = !!series && SYMBOL_ONLY_SERIES.includes(series);

  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-4 py-3 active:bg-secondary transition-colors${separator ? ' border-b border-border/40' : ''}`}
    >
      {/* Logo */}
      <div className="w-14 shrink-0 flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoSrc}
          alt={displayName}
          className="max-h-8 max-w-[56px] object-contain"
          onError={e => {
            const img = e.currentTarget as HTMLImageElement;
            const enSrc = `https://images.pokemontcg.io/${setId}/logo.png`;
            if (img.src !== enSrc) {
              img.src = enSrc;
            } else {
              img.style.display = 'none';
            }
          }}
        />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium truncate">{displayName}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {isSymbolOnlySet && symbolUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={symbolUrl} alt={ptcgoCode ?? ''} className="w-4 h-4 object-contain" />
            ) : ptcgoCode && (
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded-md border"
                style={{ color: 'var(--foreground)', borderColor: 'var(--foreground)' }}
              >
                {ptcgoCode}
              </span>
            )}
            <span className="text-xs text-muted-foreground tabular-nums">
              {owned}{total != null ? `/${total}` : ' Karten'}
            </span>
          </div>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct ?? 0}%`, background: 'var(--pokedex-red)' }}
          />
        </div>
      </div>
    </Link>
  );
}
