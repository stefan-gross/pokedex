'use client';

import {
  collection, addDoc, getDocs, deleteDoc, query, orderBy, limit,
  getCountFromServer,
} from 'firebase/firestore';
import { db, currentUid } from '../firebase/client';

/**
 * Scan-Historie in FIRESTORE (Collection `scan_history`): die zuletzt an Gemini
 * gesendeten Bilder samt Ergebnis. Bewusst geteilter Backend-Speicher statt
 * lokaler IndexedDB — so sind auf dem iPhone (Live-App) gescannte Bilder auch
 * am Entwicklungs-`localhost:3000` verfügbar (dieselbe Firestore-Instanz).
 *
 * Auf Vercel fehlen die Admin-Env-Vars → nur das Client-SDK funktioniert dort;
 * deshalb Firestore-Client (nicht Admin/Storage). Das Bild liegt inline als
 * base64 im Dokument (zugeschnittenes Sendebild ~150–350 KB < 1 MB Doc-Limit).
 * Gedeckelt auf die letzten MAX_ENTRIES.
 */

export interface ScanHistoryEntry {
  id: string;          // Firestore-Doc-ID
  ownerUid?: string;   // Firebase-uid des Besitzers (IDOR-Härtung)
  imageBase64: string; // exakt das an Gemini gesendete Bild (ohne data:-Präfix)
  mimeType: string;
  label: string;       // Kartenname, „Kein Treffer", „Fehler" …
  ok: boolean;         // true = Karte erkannt
  cardId?: string;
  ts: number;          // Zeitstempel (ms)
}

const COL = 'scan_history';
const MAX_ENTRIES = 20;

/** Neuen Scan speichern und auf die letzten MAX_ENTRIES kürzen. Fehler werden
 *  geschluckt (Historie ist reiner Test-Komfort, nie geschäftskritisch). */
export async function saveScan(entry: Omit<ScanHistoryEntry, 'id' | 'ts'> & { ts?: number }): Promise<void> {
  try {
    const ts = entry.ts ?? Date.now();
    await addDoc(collection(db, COL), {
      ownerUid: currentUid(),
      imageBase64: entry.imageBase64,
      mimeType: entry.mimeType,
      label: entry.label,
      ok: entry.ok,
      cardId: entry.cardId,
      ts,
    });
    // Kürzen: Anzahl serverseitig zählen (billig, ohne Bilder zu laden), dann die
    // ältesten Überzähligen löschen.
    const cntSnap = await getCountFromServer(collection(db, COL));
    const excess = cntSnap.data().count - MAX_ENTRIES;
    if (excess > 0) {
      const oldest = await getDocs(query(collection(db, COL), orderBy('ts', 'asc'), limit(excess)));
      await Promise.all(oldest.docs.map(d => deleteDoc(d.ref)));
    }
  } catch { /* Historie ist optional */ }
}

/** Letzte MAX_ENTRIES, neueste zuerst. */
export async function listScans(): Promise<ScanHistoryEntry[]> {
  try {
    const snap = await getDocs(query(collection(db, COL), orderBy('ts', 'desc'), limit(MAX_ENTRIES)));
    return snap.docs.map(d => {
      const data = d.data() as Omit<ScanHistoryEntry, 'id'>;
      return { id: d.id, ...data };
    });
  } catch {
    return [];
  }
}

export async function clearScans(): Promise<void> {
  try {
    const snap = await getDocs(collection(db, COL));
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
  } catch { /* egal */ }
}
