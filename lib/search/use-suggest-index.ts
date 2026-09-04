'use client';

import { useEffect, useState } from 'react';
import { loadSuggestIndex } from '@/lib/search/suggest-index';
import type { SuggestIndex } from '@/lib/build-search-index';

/**
 * Lädt den Autosuggest-/Fuzzy-Index EINMAL (Memory/localStorage/Netz — die
 * Dedupe liegt in `loadSuggestIndex`) und gibt ihn zurück. Bewusst als Hook,
 * damit jede Such-Stelle (Hauptsuche, Deck-/Scanner-Sheets, Set-/Wunschlisten-
 * Suche …) denselben Index teilt, statt ihn pro Screen neu zu verdrahten.
 */
export function useSuggestIndex(): SuggestIndex | null {
  const [index, setIndex] = useState<SuggestIndex | null>(null);
  useEffect(() => {
    let alive = true;
    loadSuggestIndex().then(i => { if (alive) setIndex(i); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return index;
}
