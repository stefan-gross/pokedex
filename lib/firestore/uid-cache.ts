/**
 * Minimaler, pro-Nutzer (uid) gekeyter In-Memory-Cache für Reads, die sonst bei
 * JEDER Navigation die ganze Collection neu lesen (A3/A4: `cards`, `binders`,
 * `wishlists`). Invalidiert wird EXPLIZIT an jedem Schreibpfad (siehe Aufrufe in
 * cards.ts / binders.ts / wishlists.ts) — über-invalidieren ist harmlos
 * (nächster Read lädt neu), eine VERPASSTE Invalidierung wäre der Bug
 * (Staleness nach add/delete). Kein TTL nötig: die App liest ohnehin nur
 * einmalig + explizit neu.
 *
 * Der uid-Key sorgt dafür, dass ein Nutzerwechsel (Logout→anderer Login) nie
 * fremde Daten aus dem Cache liefert — andere uid = Cache-Miss.
 */
export function createUidCache<T>(loader: (uid: string) => Promise<T>) {
  let cache: { uid: string; value: T } | null = null;
  let inflight: { uid: string; p: Promise<T> } | null = null;

  return {
    async get(uid: string): Promise<T> {
      if (cache && cache.uid === uid) return cache.value;
      if (inflight && inflight.uid === uid) return inflight.p;
      const p = loader(uid).then(
        v => { cache = { uid, value: v }; if (inflight?.uid === uid) inflight = null; return v; },
        e => { if (inflight?.uid === uid) inflight = null; throw e; },
      );
      inflight = { uid, p };
      return p;
    },
    invalidate() { cache = null; inflight = null; },
  };
}
