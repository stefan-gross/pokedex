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
// Auf einen ECHTEN (nicht-null) User warten: `onAuthStateChanged` feuert beim
// App-Start oft zuerst mit `null` (Session-Restore aus IndexedDB läuft noch)
// und danach mit dem User. Früher wurde dieses erste `null` dauerhaft gecacht
// → alle privaten Reads blieben für die ganze Seiten-Session token-los (Firestore
// verweigert → „alles leer", obwohl eingeloggt). Jetzt: `null`-Events ignorieren
// und bis zu `AUTH_WAIT_MS` auf den User warten; danach (wirklich ausgeloggt)
// mit `null` auflösen. Ein `null`-Ergebnis wird NICHT gecacht, damit ein späterer
// Read einen inzwischen wiederhergestellten Login noch aufgreift.
const AUTH_WAIT_MS = 5000;
let authReadyPromise: Promise<User | null> | null = null;
function waitForAuthUser(): Promise<User | null> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  if (!authReadyPromise) {
    authReadyPromise = new Promise<User | null>(resolve => {
      let settled = false;
      const finish = (u: User | null) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        resolve(u);
      };
      const unsubscribe = onAuthStateChanged(auth, user => { if (user) finish(user); });
      setTimeout(() => finish(auth.currentUser), AUTH_WAIT_MS);
    });
    // Nur einen erfolgreichen (User-)Restore dauerhaft behalten; ein `null`
    // (Timeout ohne Login) verwerfen, damit ein späterer Aufruf neu wartet.
    authReadyPromise.then(u => { if (!u) authReadyPromise = null; });
  }
  return authReadyPromise;
}

/** uid des eingeloggten Nutzers für owner-scoped REST-Queries (IDOR-Härtung).
 *  Wartet wie `getAuthHeader` auf den Auth-Restore, damit der erste
 *  Dashboard-Read nicht token-/uid-los ins Leere läuft. */
export async function restOwnerUid(): Promise<string | null> {
  const u = auth.currentUser ?? await waitForAuthUser();
  return u?.uid ?? null;
}

/** Firebase-ID-Token holen, falls eingeloggt — sonst leerer Header (Rule
 *  entscheidet dann serverseitig, ob der Request trotzdem durchgeht). */
export async function getAuthHeader(): Promise<Record<string, string>> {
  try {
    // WICHTIG: erst den LIVE-User prüfen. `waitForAuthUser` merkt sich das erste
    // onAuthStateChanged-Ergebnis dauerhaft — feuert das direkt nach Login/Install
    // noch mit `null` (Session-Restore läuft), bliebe es sonst für die ganze
    // Seiten-Session `null` → alle authentifizierten Reads leer (0 Karten), obwohl
    // man eingeloggt ist. `auth.currentUser` spiegelt den aktuellen Stand.
    const u = auth.currentUser ?? await waitForAuthUser();
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

/** Führt eine strukturierte Firestore-Query per REST aus.
 *  Ein 401/403 (fehlendes/abgelaufenes Token, oft die Auth-Restore-Race beim
 *  App-Start) wird EINMAL wiederholt — dann steht das Token i.d.R. bereit
 *  (`getAuthHeader` wartet über `waitForAuthUser` auf den User). So bleibt die
 *  private Sammlung nicht wegen eines token-losen ersten Reads leer. */
export async function runFirestoreQuery<T>(structuredQuery: Record<string, unknown>): Promise<T[]> {
  // Timeout pro fetch: ein hängender Request (z.B. Netz-/Verbindungsklemme nach
  // frischem Login) darf NICHT den ganzen Read blockieren — sonst bleibt das
  // Dashboard (`loading = cards === null`) im Endlos-Spinner. Nach `FETCH_TIMEOUT`
  // wird abgebrochen → Fehler → oben einmal Retry, sonst greift der `.catch` des
  // Aufrufers (zeigt „leer" statt Spinner).
  const FETCH_TIMEOUT = 12000;
  const attempt = async (): Promise<Response> => {
    const authHeader = await getAuthHeader();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    try {
      return await fetch(`${FIRESTORE_REST_BASE}:runQuery?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ structuredQuery }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
  // Erster Versuch; bei Netz-/Timeout-Fehler (throw) genau einmal wiederholen,
  // bevor der Fehler nach oben durchschlägt.
  let res: Response;
  try {
    res = await attempt();
  } catch {
    res = await attempt();
  }
  if ((res.status === 401 || res.status === 403) && auth.currentUser) {
    // Frisches Token erzwingen und genau einmal erneut versuchen.
    try { await auth.currentUser.getIdToken(true); } catch { /* fällt in den Fehler unten */ }
    res = await attempt();
  }
  if (!res.ok) {
    throw new Error(`Firestore REST ${res.status}: ${await res.text()}`);
  }
  const data: RunQueryResponseEntry[] = await res.json();
  return data
    .filter((e): e is { document: NonNullable<RunQueryResponseEntry['document']> } => !!e.document)
    .map(e => decodeDocument<T>(e.document));
}
