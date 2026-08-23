'use client';

import {
  collection, addDoc, doc, updateDoc, getDocs, deleteDoc, query, where, runTransaction,
} from 'firebase/firestore';
import { db, currentUid, waitForUid } from '../firebase/client';

/**
 * Scan-Telemetrie in Firestore — die Datenbasis, um die Karten-Erkennung über
 * Zeit datenbasiert zu optimieren (Analyse passiert außerhalb der App).
 *
 * Drei Collections (Client-SDK, weil Vercel keine Admin-Env-Vars hat; Bilder
 * inline als base64, da kein Firebase-Storage eingerichtet ist):
 *  - `scan_events`  — EIN kompaktes Doc pro Scan, OHNE Bild, ungedeckelt.
 *                     Qualitäts-/Gemini-/Lookup-/pHash-Werte für JEDEN Scan
 *                     (auch Erfolg) → Statistik + Korrelation Qualität↔Ergebnis.
 *  - `scan_cases`   — voller Fall MIT beiden Bildern, nur bei Fehlern (auto) +
 *                     gemeldeten Fällen. Enthält die Grundwahrheit.
 *  - `scan_stats/{uid}` — Live-Aggregat (Zähler + Summen) je Nutzer, pro Scan
 *                     per Transaction aktualisiert → Erkennungsrate/Mittelwerte.
 */

export type ScanOutcome = 'recognized' | 'not_recognized' | 'pending' | 'error';

/** Bild-Qualitätswerte des ausgelösten Frames (aus CameraCapture `CaptureMeta`). */
export interface ScanQuality {
  trigger?: string;      // 'auto' | 'manual'
  captureMode?: string;  // 'auto' | 'manual'
  level?: string;        // Ampel: neutral|red|yellow|green
  sharpness?: number;    // Laplace-Varianz
  contrast?: number;
  glare?: number;        // % ausgebrannt
  softGlare?: number;    // % weich-hell (Schleier)
  nameGlare?: number;    // Reflexion Namenszone
  codeGlare?: number;    // Reflexion Set-Code-Zone
  meanLum?: number;
  fill?: number;         // % Kartenfläche
  cornersN?: number;     // erkannte Ecken (4 = Warp möglich)
  angleDeg?: number;
}

export interface ScanGemini {
  name?: string | null; setCode?: string | null; number?: string | null;
  printedTotal?: number | null; nationalDexNumber?: number | null; hp?: number | null;
  language?: string | null; confidence?: string | null; error?: string | null;
  model?: string; ms?: number; attempts?: number;
}

export interface ScanLookup {
  via?: string; matchedBy?: string; stepsCount?: number; recognizedCardId?: string;
}

export interface ScanEventInput {
  outcome: ScanOutcome;
  quality?: ScanQuality;
  gemini?: ScanGemini;
  lookup?: ScanLookup;
  pHashDistance?: number;
  pHashClass?: string;
  uploadMs?: number; lookupMs?: number; totalMs?: number;
}

export type ScanReportType = 'auto_fail' | 'wrong' | 'not_in_catalog';

export interface ScanCaseInput extends ScanEventInput {
  reportType: ScanReportType;
  warpedCropBase64?: string;    // was Gemini sah
  originalFrameBase64?: string; // Vor-Entzerrung (herunterskaliert)
  mimeType?: string;
  lookupSteps?: string[];       // volle Lookup-Spur
  geminiRaw?: string;
  catalogMatch?: unknown;
  correctedCardId?: string;     // Grundwahrheit (vom Nutzer gewählt)
  note?: string;
  eventId?: string;             // Verknüpfung zum scan_events-Doc
}

const EVENTS = 'scan_events';
const CASES = 'scan_cases';
const STATS = 'scan_stats';
// Firestore-Doc-Limit ist 1 MB; base64 dominiert. Ab dieser Zeichenzahl das
// Originalfoto weglassen (der gewarpte Zuschnitt = das Wichtigere bleibt).
const MAX_BASE64_CHARS = 900_000;

/** Entfernt `undefined` rekursiv (Firestore wirft sonst je nach SDK-Config). */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

/** Kompaktes Event (ohne Bild) für JEDEN Scan. Gibt die Doc-ID zurück, damit
 *  ein späteres „Melden" dieses Event als `reportedWrong` markieren kann. */
export async function recordScanEvent(input: ScanEventInput): Promise<string | null> {
  try {
    const uid = currentUid();
    const payload = stripUndefined({ ...input, ownerUid: uid, ts: Date.now() });
    const ref = await addDoc(collection(db, EVENTS), payload as Record<string, unknown>);
    return ref.id;
  } catch {
    return null;
  }
}

/** Markiert ein Event als „falsch erkannt" + Grundwahrheit (aus dem Melden-Flow). */
export async function markEventReported(eventId: string, correctedCardId?: string): Promise<void> {
  try {
    await updateDoc(doc(db, EVENTS, eventId), stripUndefined({ reportedWrong: true, correctedCardId }));
  } catch { /* optional */ }
}

/** Hängt die (asynchron berechnete) pHash-Distanz an ein bestehendes Event. */
export async function updateScanEventPHash(eventId: string, pHashDistance: number): Promise<void> {
  try {
    await updateDoc(doc(db, EVENTS, eventId), { pHashDistance });
  } catch { /* optional */ }
}

/** Voller Fall MIT Bildern (Fehler/gemeldet). 1-MB-Guard: Originalframe zuerst
 *  opfern, danach zur Not den Zuschnitt. */
export async function recordScanCase(input: ScanCaseInput): Promise<string | null> {
  try {
    const uid = currentUid();
    const data: ScanCaseInput & { ownerUid?: string | null; ts: number } = { ...input, ownerUid: uid, ts: Date.now() };
    let size = (data.warpedCropBase64?.length ?? 0) + (data.originalFrameBase64?.length ?? 0);
    if (size > MAX_BASE64_CHARS && data.originalFrameBase64) {
      delete data.originalFrameBase64;
      size = data.warpedCropBase64?.length ?? 0;
    }
    if (size > MAX_BASE64_CHARS) delete data.warpedCropBase64;
    const ref = await addDoc(collection(db, CASES), stripUndefined(data as unknown as Record<string, unknown>));
    return ref.id;
  } catch {
    return null;
  }
}

/** Live-Aggregat je Nutzer aktualisieren: Zähler + laufende Summen (für Rate +
 *  Mittelwerte je Outcome). Read-modify-write in einer Transaktion. */
export async function bumpScanStats(
  outcome: ScanOutcome,
  quality?: ScanQuality,
  pHashDistance?: number,
  geminiMs?: number,
  reportedWrong = false,
): Promise<void> {
  try {
    const uid = currentUid();
    if (!uid) return;
    const ref = doc(db, STATS, uid);
    await runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      const s = (snap.exists() ? snap.data() : {}) as Record<string, unknown>;
      const num = (v: unknown) => (typeof v === 'number' ? v : 0);
      const by = (s.byOutcome ?? {}) as Record<string, Record<string, number>>;
      const o = by[outcome] ?? {};
      const add = (obj: Record<string, number>, key: string, v?: number) => {
        if (typeof v === 'number' && !Number.isNaN(v)) { obj[key] = (obj[key] ?? 0) + v; obj[`${key}_n`] = (obj[`${key}_n`] ?? 0) + 1; }
      };

      s.ownerUid = uid;                              // String-Feld für Rules/Query
      s.total = num(s.total) + 1;
      if (reportedWrong) s.reportedWrong = num(s.reportedWrong) + 1;
      o.count = (o.count ?? 0) + 1;
      add(o, 'sharpness', quality?.sharpness);
      add(o, 'glare', quality?.glare);
      add(o, 'softGlare', quality?.softGlare);
      add(o, 'pHash', pHashDistance);
      add(o, 'geminiMs', geminiMs);
      by[outcome] = o;
      s.byOutcome = by;
      s.updatedAt = Date.now();
      tx.set(ref, stripUndefined(s), { merge: true });
    });
  } catch { /* Statistik ist optional */ }
}

/** Eigene Fälle lesen (für spätere In-App-Nutzung; die Analyse läuft i.d.R.
 *  über die Admin-Route). Neueste zuerst. */
export async function listScanCases(max = 200): Promise<Array<Record<string, unknown> & { id: string }>> {
  try {
    const uid = await waitForUid();
    if (!uid) return [];
    const snap = await getDocs(query(collection(db, CASES), where('ownerUid', '==', uid)));
    return snap.docs
      .map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
      .sort((a, b) => (((b as Record<string, unknown>).ts as number) ?? 0) - (((a as Record<string, unknown>).ts as number) ?? 0))
      .slice(0, max);
  } catch {
    return [];
  }
}

export async function clearScanCases(): Promise<void> {
  try {
    const uid = currentUid();
    if (!uid) return;
    const snap = await getDocs(query(collection(db, CASES), where('ownerUid', '==', uid)));
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
  } catch { /* egal */ }
}
