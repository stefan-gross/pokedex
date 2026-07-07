import {
  collection, doc, getDocs, setDoc, getDoc, documentId,
  query, where, limit, startAfter, writeBatch, getCountFromServer,
  type QueryDocumentSnapshot, type QueryConstraint,
} from 'firebase/firestore';
import { db } from '../firebase/client';
import { RARITY_GROUPS } from '../card-constants';
import type { CardVariant } from '@/types';

export interface CatalogCard {
  id: string;
  name: string;               // englischer Name (pokemontcg.io)
  nameLower: string;          // name.toLowerCase() — für case-insensitive Prefix-Suche
  nameDe?: string;            // deutscher Name (TCGdex) — optional, wird via Enrichment befüllt
  nameDeLower?: string;       // nameDe.toLowerCase()
  number: string;
  setId: string;
  setName: string;
  series: string;
  setCode?: string;            // ptcgoCode z.B. "PAF", "SVI" — von pokemontcg.io
  rarity: string;
  supertype: string;
  types: string[];
  subtypes?: string[];        // z.B. ['Basic'] | ['Stage 1'] | ['Item'] — für Stufen-Filter (ab nächstem Sync)
  hp?: number;                 // Trefferpunkte (nur Pokémon-Karten)
  nationalDexNumber?: number;  // Nationaler Pokédex-Eintrag (erster, falls mehrere)
  evolutionFamily?: number[];  // Alle Pokédex-Nummern der Evolutionslinie, z.B. [4,5,6] für Glumanda-Linie
  imgSmall: string;
  imgLarge: string;
  imgSmallDe?: string;         // DE-Kartenbild klein von TCGdex (einmalig via enrichDeImages gespeichert)
  imgLargeDe?: string;         // DE-Kartenbild groß von TCGdex
  // Pokémon-Artdaten (nur Pokémon-Karten, via PokéAPI-Enrichment)
  genusDe?: string;            // z.B. "Maus-Pokémon"
  flavorTextDe?: string;       // Beschreibungstext auf Deutsch
  heightDm?: number;           // Größe in Dezimeter (4 = 0,4 m)
  weightHg?: number;           // Gewicht in Hektogramm (60 = 6,0 kg)
  region?: string;             // z.B. "Kanto", "Johto"
  variants?: CardVariant[];    // mögliche Varianten, abgeleitet aus rarity
  artist?: string;             // Illustrator, direkt von pokemontcg.io (kein separates Enrichment nötig)
  artistTokens?: string[];     // artist.toLowerCase().split(/\s+/) — für Nachnamen-Suche (z.B. "Morii" → "Yuka Morii")
}

export interface SyncMeta {
  lastPage: number;
  totalPages: number;
  syncedTotal: number;   // wie viele Karten wir in Firestore haben
  currentTotal: number;  // wie viele Karten pokemontcg.io hat
  lastSynced: string;
}

export type FilterCounts = {
  types:      Record<string, number>; // pro TcgType
  supertypes: Record<string, number>; // 'Pokémon' | 'Trainer' | 'Energy'
  rarities:   Record<string, number>; // pro RARITY_GROUP label (global, kein Filter-Kontext)
};

const COL = 'tcg_catalog';

// Prefix-Suche nach Name — sucht parallel auf englischem (nameLower) und deutschem (nameDeLower) Feld
export async function searchCatalog(q: string, setId = '', maxResults = 80): Promise<CatalogCard[]> {
  const lower = q.toLowerCase();
  const end   = lower + ''; // Unicode-Sentinel für Prefix-Range

  const makeConstraints = (field: 'nameLower' | 'nameDeLower') =>
    setId
      ? [where('setId', '==', setId), where(field, '>=', lower), where(field, '<=', end), limit(maxResults)]
      : [where(field, '>=', lower), where(field, '<=', end), limit(maxResults)];

  // Erst Deutsch — nur wenn kein Treffer, Englisch als Fallback
  const deSnap = await getDocs(query(collection(db, COL), ...makeConstraints('nameDeLower')));
  if (!deSnap.empty) {
    return deSnap.docs.map(d => d.data() as CatalogCard);
  }
  const enSnap = await getDocs(query(collection(db, COL), ...makeConstraints('nameLower')));
  return enSnap.docs.map(d => d.data() as CatalogCard);
}

// Wortweise Suche auf dem Illustrator-Feld über `artistTokens` (klein geschriebene
// Wörter des vollen Namens, z.B. "Yuka Morii" → ["yuka","morii"]). Ein reiner
// Präfix-Vergleich auf dem vollen `artist`-String (frühere Implementierung) matcht
// nur, wenn die Eingabe mit dem VORNAMEN beginnt — Nachnamen wie "Morii" (der in
// der Praxis übliche Suchbegriff) fanden dadurch nie etwas. `array-contains-any`
// findet Karten, bei denen mindestens ein Eingabe-Wort exakt vorkommt; bei
// mehrteiliger Eingabe (z.B. "Yuka Morii") wird client-seitig auf Treffer
// eingeschränkt, die ALLE Wörter enthalten (sonst zu lockere Ergebnisse).
export async function searchCatalogByArtist(q: string, maxResults = 80): Promise<CatalogCard[]> {
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const snap = await getDocs(
    query(collection(db, COL), where('artistTokens', 'array-contains-any', tokens.slice(0, 30)), limit(maxResults)),
  );
  const docs = snap.docs.map(d => d.data() as CatalogCard);
  if (tokens.length === 1) return docs;
  return docs.filter(c => tokens.every(t => c.artistTokens?.includes(t)));
}

// Lookup mehrerer Karten per ID (für Deutsch-Suche via TCGdex)
export async function getCatalogCardsByIds(ids: string[]): Promise<CatalogCard[]> {
  if (ids.length === 0) return [];
  const results: CatalogCard[] = [];
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const snap = await getDocs(query(collection(db, COL), where(documentId(), 'in', chunk)));
    results.push(...snap.docs.map(d => d.data() as CatalogCard));
  }
  return results;
}

// Alle Karten einer Pokédex-Nummer (Fallback für Evolutionslinie)
export async function getCardsByDexNumber(dexNum: number, maxResults = 100): Promise<CatalogCard[]> {
  const snap = await getDocs(
    query(collection(db, COL), where('nationalDexNumber', '==', dexNum), limit(maxResults))
  );
  return snap.docs.map(d => d.data() as CatalogCard);
}

// Alle Karten einer Evolutionslinie via array-contains (benötigt Enrichment-Schritt)
export async function getCardsByEvolutionFamily(dexNum: number, maxResults = 200): Promise<CatalogCard[]> {
  const snap = await getDocs(
    query(collection(db, COL), where('evolutionFamily', 'array-contains', dexNum), limit(maxResults))
  );
  return snap.docs.map(d => d.data() as CatalogCard);
}

// Einzelne Karte per Set + Nummer (für Scanner-Lookup)
export async function getCardBySetAndNumber(setId: string, number: string): Promise<CatalogCard | null> {
  const snap = await getDocs(
    query(collection(db, COL), where('setId', '==', setId), where('number', '==', number), limit(1))
  );
  return snap.docs[0]?.data() as CatalogCard ?? null;
}

/** Suche per gedrucktem Set-Kürzel (ptcgoCode) + Kartennummer.
 *  Zuverlässiger als setId-Lookup für moderne Karten (ASC, SSP, TEF ...).
 *  Das setCode-Feld enthält den auf der Karte aufgedruckten Buchstaben-Code. */
export async function getCardBySetCodeAndNumber(setCode: string, number: string): Promise<CatalogCard | null> {
  const snap = await getDocs(
    query(collection(db, COL), where('setCode', '==', setCode), where('number', '==', number), limit(1))
  );
  return snap.docs[0]?.data() as CatalogCard ?? null;
}

// Batch-Upsert (Firestore max 500 pro Batch)
export async function upsertCatalogBatch(cards: CatalogCard[]): Promise<void> {
  const chunks = [];
  for (let i = 0; i < cards.length; i += 500) chunks.push(cards.slice(i, i + 500));
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    chunk.forEach(card => batch.set(doc(db, COL, card.id), card, { merge: true }));
    await batch.commit();
  }
}

// Sync-Metadaten
export async function getSyncMeta(): Promise<SyncMeta | null> {
  const snap = await getDoc(doc(db, 'tcg_catalog_meta', 'sync'));
  return snap.exists() ? (snap.data() as SyncMeta) : null;
}

export async function setSyncMeta(data: Partial<SyncMeta>): Promise<void> {
  await setDoc(doc(db, 'tcg_catalog_meta', 'sync'), data, { merge: true });
}

// Alle Karten eines Sets aus dem Catalog (nach Nummer sortiert)
export async function getCardsBySetId(setId: string): Promise<CatalogCard[]> {
  const snap = await getDocs(
    query(collection(db, COL), where('setId', '==', setId))
  );
  const cards = snap.docs.map(d => d.data() as CatalogCard);
  cards.sort((a, b) => {
    const na = parseInt(a.number) || 0;
    const nb = parseInt(b.number) || 0;
    return na !== nb ? na - nb : a.number.localeCompare(b.number);
  });
  return cards;
}

// Wie viele Karten sind bereits gecacht?
export async function getCatalogCount(): Promise<number> {
  const meta = await getSyncMeta();
  return meta?.syncedTotal ?? 0;
}

/**
 * Counts pro Typ und Supertype — dynamisch basierend auf aktivem Filter.
 * Wenn z.B. supertype='Pokémon' aktiv → Typ-Counts zeigen nur Pokémon-Karten.
 * Hinweis: Kombination type+supertype braucht Firestore Composite-Index.
 * Bei fehlendem Index fällt safeCount auf 0 zurück (Link zum Anlegen im Firebase-Console).
 */
export async function getCatalogFilterCounts(activeFilter: BrowseFilter = {}): Promise<FilterCounts> {
  const TYPES = [
    'Fire', 'Water', 'Grass', 'Lightning', 'Psychic',
    'Fighting', 'Darkness', 'Metal', 'Dragon', 'Fairy', 'Colorless',
  ];
  const SUPERTYPES = ['Pokémon', 'Trainer', 'Energy'];

  const safeCount = async (constraints: QueryConstraint[]): Promise<number> => {
    try {
      const snap = await getCountFromServer(query(collection(db, COL), ...constraints));
      return snap.data().count;
    } catch (err) {
      // Firestore gibt hier einen Link zum Anlegen des fehlenden Composite-Index aus
      console.error('[getCatalogFilterCounts] Firestore-Fehler (ggf. Composite-Index fehlt):', err);
      return 0;
    }
  };

  const [typeCounts, supertypeCounts, rarityCounts] = await Promise.all([
    // Typ-Counts: optional nach aktivem Supertype gefiltert
    Promise.all(TYPES.map(async t => {
      const c: QueryConstraint[] = [where('types', 'array-contains', t)];
      if (activeFilter.supertype) c.push(where('supertype', '==', activeFilter.supertype));
      return [t, await safeCount(c)] as [string, number];
    })),
    // Supertype-Counts: optional nach aktivem Typ gefiltert
    Promise.all(SUPERTYPES.map(async s => {
      const c: QueryConstraint[] = [where('supertype', '==', s)];
      if (activeFilter.type) c.push(where('types', 'array-contains', activeFilter.type));
      return [s, await safeCount(c)] as [string, number];
    })),
    // Rarity-Counts: global (kein Filter-Kontext, vermeidet Composite-Indexes)
    Promise.all(RARITY_GROUPS.map(async g => {
      if (!g.keys.length) return [g.label, 0] as [string, number];
      return [g.label, await safeCount([where('rarity', 'in', g.keys)])] as [string, number];
    })),
  ]);

  return {
    types:      Object.fromEntries(typeCounts),
    supertypes: Object.fromEntries(supertypeCounts),
    rarities:   Object.fromEntries(rarityCounts),
  };
}

/* ── Browse (paginiert, server-seitig gefiltert) ────────────────
 * Priorität server-seitig: type > evolutionStage > supertype
 * (Kombination mehrerer would brauchen Composite-Indexes)
 * Restliche Filter (rarity, owned, client-supertype) laufen im Hook
 */
export type BrowseSortKey = 'name' | 'hp' | 'pokedex';

export interface BrowseFilter {
  /** Pokémon-Typ (englisch), z.B. 'Darkness' — array-contains */
  type?: string;
  /** Supertype: 'Pokémon' | 'Trainer' | 'Energy' — equality */
  supertype?: string;
  /** Entwicklungsstufe: 'Basic' | 'Stage 1' | 'Stage 2' — array-contains auf subtypes */
  evolutionStage?: string;
}

export interface BrowsePage {
  cards: CatalogCard[];
  cursor: QueryDocumentSnapshot | null;
  hasMore: boolean;
}

/** Exakte Gesamtzahl für einen BrowseFilter — kein Dokument wird übertragen */
export async function getBrowseCount(filter: BrowseFilter = {}): Promise<number> {
  const constraints: QueryConstraint[] = [];
  if (filter.type) {
    constraints.push(where('types', 'array-contains', filter.type));
  } else if (filter.evolutionStage) {
    constraints.push(where('subtypes', 'array-contains', filter.evolutionStage));
  } else if (filter.supertype) {
    constraints.push(where('supertype', '==', filter.supertype));
  }
  try {
    const snap = await getCountFromServer(query(collection(db, COL), ...constraints));
    return snap.data().count;
  } catch {
    return -1; // Fehler → caller zeigt "-" statt Zahl
  }
}

export async function browseCatalog(
  filter: BrowseFilter = {},
  cursor: QueryDocumentSnapshot | null = null,
  pageSize = 50,
): Promise<BrowsePage> {
  const constraints: QueryConstraint[] = [];

  // Priorität: type > evolutionStage > supertype (je nur einer server-seitig)
  if (filter.type) {
    constraints.push(where('types', 'array-contains', filter.type));
  } else if (filter.evolutionStage) {
    constraints.push(where('subtypes', 'array-contains', filter.evolutionStage));
  } else if (filter.supertype) {
    constraints.push(where('supertype', '==', filter.supertype));
  }

  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(pageSize));

  const snap = await getDocs(query(collection(db, COL), ...constraints));
  return {
    cards:   snap.docs.map(d => d.data() as CatalogCard),
    cursor:  snap.docs[snap.docs.length - 1] ?? null,
    hasMore: snap.docs.length === pageSize,
  };
}
