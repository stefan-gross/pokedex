'use client';

import Link from 'next/link';

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
  /** Optionaler Set-Code (z.B. "PAF") — wird als Badge angezeigt */
  ptcgoCode?: string;
  href: string;
  /** Trennlinie unten (für gruppierte Listen) */
  separator?: boolean;
}

/**
 * Wiederverwendbares Set-Listenelement mit Logo, Name, Fortschrittsbalken.
 * Genutzt auf Dashboard und in der Sets-Übersicht.
 */
export function SetListItem({
  setId, name, nameDe, logoDe, owned, total, ptcgoCode, href, separator = false,
}: SetListItemProps) {
  const displayName = nameDe ?? name;
  const logoSrc     = logoDe ?? `https://images.pokemontcg.io/${setId}/logo.png`;
  const pct         = total ? Math.round((owned / total) * 100) : null;

  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-4 py-3 active:bg-secondary transition-colors${separator ? ' border-b border-border' : ''}`}
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
            {ptcgoCode && (
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
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct ?? 0}%`, background: 'var(--pokedex-red)' }}
          />
        </div>
      </div>
    </Link>
  );
}
