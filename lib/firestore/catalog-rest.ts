/**
 * REST-API-Variante der Catalog-Lookups — umgeht den Firestore-Web-SDK
 * WebSocket-Handshake (~30 s Cold-Start auf iOS-PWA). Pro Query ein
 * einfacher HTTPS-Call (~200–400 ms cold + warm), unabhängig vom SDK-State.
 *
 * Nur für PUBLIC-READ-Collections geeignet (hier: tcg_catalog mit
 * `allow read: if true`). Authentifizierung erfolgt über die NEXT_PUBLIC
 * Firebase-API-Key, identisch wie das Web-SDK initialisiert.
 *
 * User-Sammlung (cards) braucht weiterhin das SDK wegen Auth-Tokens.
 */

import type { CatalogCard } from './catalog';
import { auth } from '@/lib/firebase/client';

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!;
const API_KEY    = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;
const BASE       = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

/** Versucht das Firebase-ID-Token zu holen — wenn User eingeloggt ist, geht's mit
 *  der Rule `if request.auth != null` durch (egal was deployed ist). */
async function getAuthHeader(): Promise<Record<string, string>> {
  try {
    const u = auth.currentUser;
    if (!u) return {};
    const token = await u.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

// Firestore-encoded Value → JS-Value
type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields?: Record<string, FsValue> } };

function decodeValue(v: FsValue): unknown {
  if ('stringValue'    in v) return v.stringValue;
  if ('integerValue'   in v) return parseInt(v.integerValue, 10);
  if ('doubleValue'    in v) return v.doubleValue;
  if ('booleanValue'   in v) return v.booleanValue;
  if ('nullValue'      in v) return null;
  if ('arrayValue'     in v) return (v.arrayValue.values ?? []).map(decodeValue);
  if ('mapValue'       in v) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v.mapValue.fields ?? {})) out[k] = decodeValue(val);
    return out;
  }
  return undefined;
}

function decodeDocument(doc: { name: string; fields?: Record<string, FsValue> }): CatalogCard {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(doc.fields ?? {})) out[k] = decodeValue(val);
  // doc.name = "projects/X/databases/(default)/documents/tcg_catalog/{id}" → letzten Pfad-Teil als id
  // (Catalog-Dokumente speichern id zwar auch als Feld, aber wir gehen safe vor.)
  if (!out.id) out.id = doc.name.split('/').pop();
  return out as unknown as CatalogCard;
}

interface RunQueryResponseEntry {
  document?: { name: string; fields?: Record<string, FsValue> };
  readTime?: string;
}

async function runQuery(structuredQuery: Record<string, unknown>): Promise<CatalogCard[]> {
  const authHeader = await getAuthHeader();
  const res = await fetch(`${BASE}:runQuery?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) {
    throw new Error(`Firestore REST ${res.status}: ${await res.text()}`);
  }
  const data: RunQueryResponseEntry[] = await res.json();
  return data
    .filter((e): e is { document: NonNullable<RunQueryResponseEntry['document']> } => !!e.document)
    .map(e => decodeDocument(e.document));
}

/** REST-Variante von getCardBySetCodeAndNumber (catalog.ts). */
export async function getCardBySetCodeAndNumberRest(
  setCode: string,
  number: string,
): Promise<CatalogCard | null> {
  const results = await runQuery({
    from: [{ collectionId: 'tcg_catalog' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: 'setCode' }, op: 'EQUAL', value: { stringValue: setCode } } },
          { fieldFilter: { field: { fieldPath: 'number'  }, op: 'EQUAL', value: { stringValue: number  } } },
        ],
      },
    },
    limit: 1,
  });
  return results[0] ?? null;
}

/** REST-Variante von getCardsByDexNumber (catalog.ts). */
export async function getCardsByDexNumberRest(
  dexNum: number,
  maxResults = 100,
): Promise<CatalogCard[]> {
  return runQuery({
    from: [{ collectionId: 'tcg_catalog' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'nationalDexNumber' },
        op: 'EQUAL',
        value: { integerValue: String(dexNum) },
      },
    },
    limit: maxResults,
  });
}
