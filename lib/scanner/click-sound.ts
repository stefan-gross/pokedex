'use client';

/**
 * Kurzer Klick-Ton via Web Audio — psychoakustischer Ersatz für haptisches
 * Feedback (auf iOS im Web nicht verfügbar). Ein sehr kurzer, leiser Sinus-Burst
 * (~20 ms, schneller Attack/Decay gegen „Plopp") fühlt sich wie ein mechanischer
 * Klick an. Wird beim Auslösen (Auto-Trigger + manuelles Foto) gespielt.
 *
 * WICHTIG: iOS erlaubt Audio erst nach einer Nutzer-Geste → `unlockClickSound()`
 * einmal bei der ersten Interaktion aufrufen (Scanner tut das). Danach klickt
 * auch der automatische Trigger. Hinweis: Der iOS-Stummschalter (Klingel aus)
 * kann Web-Audio unterdrücken — dann bleibt der Klick lautlos.
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
  }
  return ctx;
}

/** Einmal bei der ersten Nutzer-Geste aufrufen (entsperrt Audio auf iOS). */
export function unlockClickSound(): void {
  const c = getCtx();
  if (c && c.state === 'suspended') c.resume().catch(() => { /* egal */ });
}

/** Sehr kurzer, leiser Klick. Best-effort — Fehler werden geschluckt. */
export function playClickSound(): void {
  const c = getCtx();
  if (!c) return;
  try {
    if (c.state === 'suspended') c.resume().catch(() => { /* egal */ });
    const t = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880; // knackig, aber unaufdringlich
    // Schneller Attack (~2 ms), kurzer Ausklang (~28 ms) → „Klick" statt „Piep".
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.06, t + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.04);
  } catch { /* egal */ }
}
