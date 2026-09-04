'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '@/components/ui/input';
import { useSuggestIndex } from '@/lib/search/use-suggest-index';
import { suggest } from '@/lib/search/suggest-index';

/**
 * Gemeinsames Karten-Suchfeld — EIN Ort für Suchfeld + Autosuggest + Enter,
 * damit alle Such-Stellen (Sammlung, Deck-/Scanner-Sheets, Set-/Wunschlisten-/
 * Binder-Suche) dieselbe Suche teilen und Verbesserungen app-weit wirken.
 *
 *  - **Autosuggest**: Vorschläge (Karte/Illustrator/Set, tippfehlertolerant) aus
 *    dem geteilten `useSuggestIndex`; erscheinen bei Fokus + ≥2 Zeichen.
 *  - **Portal**: das Panel wird an `document.body` gerendert (fix positioniert
 *    unter dem Feld), damit das Glas-Blur wirkt — im Glas-Header/Sheet
 *    verschachtelt wäre `backdrop-filter` ein No-op (unlesbar).
 *  - **Enter**: `onSubmit(value)` (Suche sofort ausführen) + Tastatur schließen.
 *
 * `onChange`/`onClear`/`value` sind kontrolliert wie beim rohen `Input`. Ein
 * Vorschlag-Klick setzt nur den Wert (`onChange`) — die eigentliche Suche läuft
 * beim Aufrufer (Debounce/Reactive), exakt wie bisher in der Sammlung.
 */
export function CardSearchField({
  value,
  onChange,
  onClear,
  onSubmit,
  placeholder,
  size = 'md',
  autoFocus,
  suggestLimit = 8,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onClear?: () => void;
  /** Enter im Feld: Suche sofort ausführen (Debounce überspringen). */
  onSubmit?: (v: string) => void;
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
  autoFocus?: boolean;
  suggestLimit?: number;
  className?: string;
}) {
  const suggestIndex = useSuggestIndex();
  const [focused, setFocused] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);

  const suggestions = focused ? suggest(suggestIndex, value, suggestLimit) : [];

  // Panel per Portal an document.body positionieren (wie das App-Menü). Bei
  // Scroll/Resize nachführen, solange Vorschläge sichtbar sind.
  useLayoutEffect(() => {
    if (suggestions.length === 0 || !boxRef.current) { setCoords(null); return; }
    const update = () => {
      const r = boxRef.current!.getBoundingClientRect();
      setCoords({ top: r.bottom + 6, left: r.left, width: r.width });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [suggestions.length, value]);

  return (
    <div ref={boxRef} className={`relative ${className ?? ''}`}>
      <Input
        variant="search"
        size={size}
        value={value}
        onChange={onChange}
        onClear={onClear}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        // Verzögert schließen, damit ein Vorschlag-Klick (onMouseDown) noch greift.
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        // Enter schließt immer Panel + Tastatur (Input blurrt selbst); reaktive
        // In-Memory-Suchen brauchen kein onSubmit, server-Suchen führen es aus.
        onEnter={() => { setFocused(false); onSubmit?.(value); }}
      />

      {/* Autosuggest-Panel — Portal an document.body im Glas-Menü-Stil. */}
      {suggestions.length > 0 && coords && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[400] glass rounded-2xl overflow-hidden py-1 shadow-xl"
          style={{ top: coords.top, left: coords.left, width: coords.width }}
        >
          {suggestions.map(sug => (
            <button
              key={sug.kind + sug.value}
              type="button"
              onMouseDown={e => { e.preventDefault(); onChange(sug.value); setFocused(false); }}
              className="flex items-center justify-between gap-2 w-full px-4 py-2.5 text-left hover:bg-white/10 active:bg-white/10"
            >
              <span className="truncate text-sm text-glass">{sug.value}</span>
              <span className="text-role-label text-glass-muted shrink-0">
                {sug.kind === 'name' ? 'Karte' : sug.kind === 'artist' ? 'Illustrator' : 'Set'}
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
