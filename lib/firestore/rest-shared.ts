/**
 * Gemeinsame Bausteine für Firestore-REST-Zugriffe — umgeht den Firestore-
 * Web-SDK WebSocket-Handshake (10-20s Cold-Start auf iOS-PWA, besonders nach
 * "App aktualisieren" in den Einstellungen, das den Service-Worker zurücksetzt
 * und damit auch die bestehende Firestore-Verbindung kappt). Pro Query ein
 * einfacher HTTPS-Call (~200–400 ms cold + warm), unabhängig vom SDK-State.
 *
 * Öffentliche Collections (z.B. tcg_catalog) brauchen kein Auth-Token.
 * Private Collections (cards/binders/wishlists, Rule `if request.auth != null`)
 * funktionieren genauso über REST — man muss nur das Firebase-ID-Token als
 * `Authorization: Bearer <token>` mitschicken. Das Token selbst zu holen
 * (`auth.currentUser.getIdToken()`) läuft über die separate, leichte Firebase-
 * Auth-Route, NICHT über die langsame Firestore-WebSocket-Verbindung — ist
 * beim App-Start i.d.R. schon gecacht.
 */

import { Timestamp } from 'firebase/firestore';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!;
const API_KEY    = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;
export const FIRESTORE_REST_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// `auth.currentUser` ist direkt nach dem Seitenladen oft noch `null` — Firebase
// Auth stellt die gespeicherte Session erst asynchron wieder her (Login läuft
// über `signInWithEmailAndPassword`, persistiert in IndexedDB). Ein Read direkt
// auf `auth.currentUser` beim allerersten Dashboard-Mount lief deshalb ins
// Leere (leerer Auth-Header → 403 trotz gültiger Session). Der erste
// `onAuthStateChanged`-Callback markiert zuverlässig, sobald die Wiederher-
// stellung abgeschlossen ist (Wert dann `User` oder wirklich `null`).
let authReadyPromise: Promise<User | null> | null = null;
function waitForAuthUser(): Promise<User | null> {
  if (!authReadyPromise) {
    authReadyPromise = new Promise(resolve => {
      const unsubscribe = onAuthStateChanged(auth, user => { unsubscribe(); resolve(user); });
    });
  }
  return authReadyPromise;
}

/** Firebase-ID-Token holen, falls eingeloggt — sonst leerer Header (Rule
 *  entscheidet dann serverseitig, ob der Request trotzdem durchgeht). */
export async function getAuthHeader(): Promise<Record<string, string>> {
  try {
    const u = await waitForAuthUser();
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
  | { timestampValue: string }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields?: Record<string, FsValue> } };

export function decodeValue(v: FsValue): unknown {
  if ('stringValue'    in v) return v.stringValue;
  if ('integerValue'   in v) return parseInt(v.integerValue, 10);
  if ('doubleValue'    in v) return v.doubleValue;
  if ('booleanValue'   in v) return v.booleanValue;
  if ('nullValue'      in v) return null;
  if ('timestampValue' in v) return Timestamp.fromDate(new Date(v.timestampValue));
  if ('arrayValue'     in v) return (v.arrayValue.values ?? []).map(decodeValue);
  if ('mapValue'       in v) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v.mapValue.fields ?? {})) out[k] = decodeValue(val);
    return out;
  }
  return undefined;
}

export function decodeDocument<T>(doc: { name: string; fields?: Record<string, FsValue> }): T {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(doc.fields ?? {})) out[k] = decodeValue(val);
  // doc.name = "projects/X/databases/(default)/documents/{collection}/{id}"
  if (!out.id) out.id = doc.name.split('/').pop();
  return out as unknown as T;
}

interface RunQueryResponseEntry {
  document?: { name: string; fields?: Record<string, FsValue> };
  readTime?: string;
}

/** Führt eine strukturierte Firestore-Query per REST aus. */
export async function runFirestoreQuery<T>(structuredQuery: Record<string, unknown>): Promise<T[]> {
  const authHeader = await getAuthHeader();
  const res = await fetch(`${FIRESTORE_REST_BASE}:runQuery?key=${API_KEY}`, {
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
    .map(e => decodeDocument<T>(e.document));
}
