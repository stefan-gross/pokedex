/**
 * Kurze Ton-Rückmeldung nach einem Scan (Mehrfach- wie Einzelscan):
 *  - Erfolg  → freundliches, aufsteigendes „Ding" (zwei Noten).
 *  - Fehler  → tiefer, absteigender „Buzz".
 *
 * Bewusst per Web Audio SYNTHETISIERT statt MP3-Dateien: keine Assets/Netz,
 * offline-tauglich, minimal, und auf iOS zuverlässig — der AudioContext muss
 * dort nur EINMAL innerhalb einer User-Geste „entsperrt" werden (siehe
 * `unlockScanSound`, das der Scanner beim ersten Tap aufruft).
 *
 * Stummschalten per localStorage-Flag `pokedex.scan.sound` = 'off'.
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    return ctx;
  } catch {
    return null;
  }
}

/** Innerhalb einer User-Geste aufrufen (erster Tap) — entsperrt den AudioContext
 *  auf iOS, damit spätere (auch geste-lose Auto-Scan-)Töne abspielen dürfen. */
export function unlockScanSound(): void {
  const c = getCtx();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

export function scanSoundEnabled(): boolean {
  try { return localStorage.getItem('pokedex.scan.sound') !== 'off'; } catch { return true; }
}

export function setScanSoundEnabled(on: boolean): void {
  try { localStorage.setItem('pokedex.scan.sound', on ? 'on' : 'off'); } catch { /* ignore */ }
}

/** Ein Ton mit Frequenz-Glide + weicher Hüllkurve (kein Klick). */
function tone(
  c: AudioContext,
  { start, freqFrom, freqTo, dur, type = 'sine', gain = 0.14 }:
  { start: number; freqFrom: number; freqTo: number; dur: number; type?: OscillatorType; gain?: number },
): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqFrom, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), start + dur);
  // Weiche Attack/Release, damit es nicht knackt.
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** Spielt den Erfolg-/Fehler-Ton. Idempotent gegen fehlende/entsperrte Contexts. */
export function playScanSound(success: boolean): void {
  if (!scanSoundEnabled()) return;
  const c = getCtx();
  if (!c) return;
  // Falls (noch) suspended: bestmöglich resumen — nach dem ersten Unlock läuft er.
  if (c.state === 'suspended') { c.resume().catch(() => {}); }
  try {
    const now = c.currentTime + 0.01;
    if (success) {
      // Aufsteigendes Ding: zwei kurze, klare Noten (A5 → E6).
      tone(c, { start: now,        freqFrom: 880,  freqTo: 900,  dur: 0.09, type: 'sine',     gain: 0.16 });
      tone(c, { start: now + 0.10, freqFrom: 1318, freqTo: 1330, dur: 0.13, type: 'sine',     gain: 0.16 });
    } else {
      // Absteigender Buzz: tief + leicht rau (triangle), etwas länger.
      tone(c, { start: now,        freqFrom: 300,  freqTo: 150,  dur: 0.26, type: 'triangle', gain: 0.18 });
    }
  } catch { /* ignore */ }
}
