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
  /** 'glass' = weiße Typografie auf durchscheinendem Untergrund (Home-Dashboard
   *  im iOS-"Liquid Glass"-Look) statt der normalen Theme-Farben. */
  variant?: 'default' | 'glass';
}

/**
 * Wiederverwendbares Set-Listenelement mit Logo, Name, Fortschrittsbalken.
 * Genutzt auf Dashboard und in der Sets-Übersicht.
 */
export function SetListItem({
  setId, name, nameDe, logoDe, owned, total, ptcgoCode, symbolUrl, series, href, separator = false,
  variant = 'default',
}: SetListItemProps) {
  const displayName = nameDe ?? name;
  const logoSrc     = logoDe ?? `https://images.pokemontcg.io/${setId}/logo.png`;
  const pct         = total ? Math.round((owned / total) * 100) : null;
  const isSymbolOnlySet = !!series && SYMBOL_ONLY_SERIES.includes(series);
  const isGlass = variant === 'glass';

  return (
    <Link
      href={href}
      className={
        isGlass
          ? `flex items-center gap-3 px-4 py-[13px] transition-colors${separator ? ' border-b border-[rgba(46,46,50,0.1)] dark:border-white/[.14]' : ''}`
          : `flex items-center gap-3 px-4 py-[13px] active:bg-secondary transition-colors${separator ? ' border-b border-border/30' : ''}`
      }
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
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`text-sm font-medium truncate ${isGlass ? 'text-glass' : ''}`}>{displayName}</span>
            {isSymbolOnlySet && symbolUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={symbolUrl} alt={ptcgoCode ?? ''} className="w-[16px] h-[16px] object-contain shrink-0" />
            ) : ptcgoCode && (
              <span
                className={`text-[10px] font-bold rounded-[5px] shrink-0 ${
                  isGlass ? 'text-glass bg-[rgba(30,40,80,0.10)] dark:bg-white/24' : ''
                }`}
                style={isGlass
                  ? { padding: '1px 5px', letterSpacing: '.03em' }
                  : { color: '#9A9DA6', background: '#F2F2F2', padding: '1px 5px', letterSpacing: '.03em' }
                }
              >
                {ptcgoCode}
              </span>
            )}
          </div>
          {pct != null && (
            <span
              className={`text-[13px] font-bold shrink-0 tabular-nums ${isGlass ? 'text-glass' : ''}`}
              style={!isGlass ? { color: 'var(--action-add)' } : undefined}
            >
              {pct}%
            </span>
          )}
        </div>
        <div
          className={`h-2 rounded-full overflow-hidden ${isGlass ? 'bg-[rgba(30,40,80,0.10)] dark:bg-white/25' : 'bg-secondary'}`}
        >
          <div
            className={`h-full rounded-full transition-all ${isGlass ? 'bg-[#e53e3e] dark:bg-white dark:shadow-[0_0_8px_rgba(255,255,255,0.6)]' : ''}`}
            style={{ width: `${pct ?? 0}%`, ...(isGlass ? {} : { background: 'var(--pokedex-red)' }) }}
          />
        </div>
        <div className={`text-[11px] tabular-nums ${isGlass ? 'text-glass-muted' : 'text-muted-foreground'}`}>
          {owned} / {total ?? '?'} Karten
        </div>
      </div>
    </Link>
  );
}
