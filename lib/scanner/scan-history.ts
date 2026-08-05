'use client';

/**
 * Lokale Scan-Historie (IndexedDB): speichert die zuletzt an Gemini gesendeten
 * Bilder samt Ergebnis. Zweck: eine falsch/gar nicht erkannte Karte lässt sich
 * im Testmodus mit EXAKT demselben Bild erneut durch die Pipeline schicken —
 * auch am iPhone (pokedex.smartfamilyzone.de), ohne die Karte erneut vor die
 * Kamera halten zu müssen.
 *
 * Bewusst IndexedDB statt localStorage: Base64-JPEGs sind zu groß für die
 * ~5 MB-Grenze von localStorage; IDB liegt auf Disk (kein RAM-Druck → kein
 * iOS-PWA-Crash-Risiko wie bei In-Memory-Bildern).
 */

export interface ScanHistoryEntry {
  id: number;          // Zeitstempel (ms) = Schlüssel, monoton
  imageBase64: string; // exakt das an Gemini gesendete Bild (ohne data:-Präfix)
  mimeType: string;
  label: string;       // Kartenname, „Kein Treffer", „Fehler" …
  ok: boolean;         // true = Karte erkannt
  cardId?: string;
  ts: number;
}

const DB_NAME = 'pokedex-scanner';
const STORE = 'scan-history';
const MAX_ENTRIES = 20;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB nicht verfügbar')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Neuen Scan speichern und auf die letzten MAX_ENTRIES kürzen. Fehler werden
 *  geschluckt (Historie ist rein optionaler Komfort, nie geschäftskritisch). */
export async function saveScan(entry: Omit<ScanHistoryEntry, 'id' | 'ts'> & { ts?: number }): Promise<void> {
  try {
    const db = await openDb();
    const ts = entry.ts ?? Date.now();
    const record: ScanHistoryEntry = { ...entry, id: ts, ts };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    // Kürzen: alle IDs holen, älteste über der Grenze löschen.
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const keysReq = store.getAllKeys();
      keysReq.onsuccess = () => {
        const keys = (keysReq.result as number[]).sort((a, b) => a - b); // aufsteigend = älteste zuerst
        const excess = keys.length - MAX_ENTRIES;
        for (let i = 0; i < excess; i++) store.delete(keys[i]);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch { /* Historie ist optional */ }
}

/** Alle Einträge, neueste zuerst. */
export async function listScans(): Promise<ScanHistoryEntry[]> {
  try {
    const db = await openDb();
    const all = await new Promise<ScanHistoryEntry[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as ScanHistoryEntry[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return all.sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

export async function clearScans(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch { /* egal */ }
}
