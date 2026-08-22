'use client';

import {
  collection, addDoc, getDocs, deleteDoc, query, where,
} from 'firebase/firestore';
import { db, currentUid, waitForUid } from '../firebase/client';

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

/** Kompakte Debug-Ausgabe je Scan (für die Fehleranalyse im Testmodus) —
 *  bewusst schlank (das base64-Bild dominiert die Dokumentgröße). */
export interface ScanDebug {
  geminiParsed?: Record<string, unknown>; // von Gemini gelesene Felder (name/number/…)
  via?: string;                           // Lookup-Herkunft ("printedTotal+number(swap)" …)
  model?: string;                         // genutztes Gemini-Modell
  ms?: number;                            // Gemini-Latenz
}

export interface ScanHistoryEntry {
  id: string;          // Firestore-Doc-ID
  ownerUid?: string;   // Firebase-uid des Besitzers (IDOR-Härtung)
  imageBase64: string; // exakt das an Gemini gesendete Bild (ohne data:-Präfix)
  mimeType: string;
  label: string;       // Kartenname, „Kein Treffer", „Fehler" …
  ok: boolean;         // true = Karte erkannt
  cardId?: string;
  debug?: ScanDebug;   // optionale Debug-Ausgabe (v.a. bei Fehlversuchen)
  ts: number;          // Zeitstempel (ms)
}

const COL = 'scan_history';
const MAX_ENTRIES = 20;

/** Neuen Scan speichern und auf die letzten MAX_ENTRIES kürzen. Fehler werden
 *  geschluckt (Historie ist reiner Test-Komfort, nie geschäftskritisch). */
export async function saveScan(entry: Omit<ScanHistoryEntry, 'id' | 'ts'> & { ts?: number }): Promise<void> {
  try {
    const uid = currentUid();
    const ts = entry.ts ?? Date.now();
    // Kein `undefined` an Firestore geben (wirft je nach SDK-Config). Optionale
    // Felder nur setzen, wenn vorhanden.
    const doc: Record<string, unknown> = {
      ownerUid: uid,
      imageBase64: entry.imageBase64,
      mimeType: entry.mimeType,
      label: entry.label,
      ok: entry.ok,
      ts,
    };
    if (entry.cardId) doc.cardId = entry.cardId;
    if (entry.debug) doc.debug = entry.debug;
    await addDoc(collection(db, COL), doc);
    // Kürzen: nur eigene Scans (ownerUid), älteste Überzählige löschen.
    // In-Memory sortiert → kein Composite-Index (ownerUid+ts) nötig.
    if (uid) {
      const own = await getDocs(query(collection(db, COL), where('ownerUid', '==', uid)));
      const docs = own.docs
        .map(d => ({ ref: d.ref, ts: (d.get('ts') as number) ?? 0 }))
        .sort((a, b) => a.ts - b.ts);
      const excess = docs.length - MAX_ENTRIES;
      if (excess > 0) await Promise.all(docs.slice(0, excess).map(d => deleteDoc(d.ref)));
    }
  } catch { /* Historie ist optional */ }
}

/** Letzte MAX_ENTRIES, neueste zuerst. */
export async function listScans(): Promise<ScanHistoryEntry[]> {
  try {
    const uid = await waitForUid();
    if (!uid) return [];
    const snap = await getDocs(query(collection(db, COL), where('ownerUid', '==', uid)));
    return snap.docs
      .map(d => ({ id: d.id, ...(d.data() as Omit<ScanHistoryEntry, 'id'>) }))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export async function clearScans(): Promise<void> {
  try {
    const uid = currentUid();
    if (!uid) return;
    const snap = await getDocs(query(collection(db, COL), where('ownerUid', '==', uid)));
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
  } catch { /* egal */ }
}
