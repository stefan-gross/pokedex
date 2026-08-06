'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

/**
 * Geteilte Grabber-/Scroll-Kollaps-Mechanik für sticky Filter-Panels
 * (Set-Detailseite + Suche-Seite). Verallgemeinert die zuvor inline in
 * `app/(app)/sets/[setId]/page.tsx` liegende Logik auf eine **geordnete Liste
 * von N Kollaps-Regionen** (Index 0 klappt zuerst):
 *
 *  - misst die natürlichen Höhen der Regionen (über `registerRegion(i)`),
 *  - `stage` 0..N (Stufe k = Regionen 0..k-1 eingeklappt),
 *  - **Griff**: Pointer-Drag folgt dem Finger (`dragCollapse` px, kumulativ über
 *    die Regionen), Snap auf die nächste Stufe beim Loslassen; Tippen = ganz
 *    auf/zu,
 *  - **Scroll**: Kartenposition-Trigger (erste Kartenreihe zur Hälfte hinter dem
 *    ausgeklappten Panel) mit richtungsabhängiger **Hysterese** gegen Flackern,
 *  - `overflow-anchor: none` am Root, solange aktiv (verhindert die
 *    Scroll-Anchoring-Rückkopplung beim Höhenwechsel des sticky Panels).
 *
 * Der Consumer rendert pro Region:
 *   <div style={regionStyle(i)} className="overflow-hidden">
 *     <div ref={registerRegion(i)}>…Inhalt…</div>
 *   </div>
 * und einen Griff mit `{...grabberProps}` (z.B. über `<Grabber>`).
 */
export interface GrabberCollapseOptions {
  /** Anzahl Kollaps-Regionen (Reihenfolge = Kollaps-Reihenfolge, Index 0 zuerst). */
  regionCount: number;
  /** Das sticky Glas-Panel (für Oberkante + ausgeklappte Höhe als Referenzlinie).
   *  Nur für den Scroll-Trigger nötig — bei `scrollTrigger: false` weglassbar. */
  panelRef?: React.RefObject<HTMLElement | null>;
  /** Der Karten-Grid-Wrapper (für den Kartenposition-Scroll-Trigger).
   *  Nur für den Scroll-Trigger nötig — bei `scrollTrigger: false` weglassbar. */
  gridWrapRef?: React.RefObject<HTMLElement | null>;
  /** Erst messen/aktiv, wenn true (z.B. `!loading`). */
  ready?: boolean;
  /** Neu messen, wenn sich ein Wert ändert (z.B. Datenlänge). */
  measureDeps?: unknown[];
  /** Scroll-basiertes Ein-/Ausklappen (Kartenposition-Trigger). Default `true`
   *  für scrollende Filterseiten; auf `false` für fixe Overlays/Drawer (z.B.
   *  Scanner-Panel), die nur per Griff geklappt werden — dann sind
   *  `panelRef`/`gridWrapRef` unnötig. */
  scrollTrigger?: boolean;
  /** Zieh-Richtung umkehren: Default (unten sitzender Griff, Filterseiten) =
   *  hoch ziehen klappt ein. `true` (oben sitzender Griff eines Bottom-Panels,
   *  z.B. Scanner) = runter ziehen klappt ein — der Griff folgt dann dem Finger. */
  invertDrag?: boolean;
}

export interface GrabberCollapseResult {
  stage: number;
  dragging: boolean;
  /** Callback-Ref für den Inhalt einer Region (Höhenmessung). */
  registerRegion: (i: number) => (el: HTMLDivElement | null) => void;
  /** Style (maxHeight + Transition) für die Kollaps-Hülle einer Region. */
  regionStyle: (i: number) => React.CSSProperties;
  grabberProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onClick: () => void;
  };
}

/** Hysterese-Puffer (px): Wieder-Ausklappen erst, wenn die Karte deutlich unter
 *  die Linie zurückkommt — sonst Flackern genau auf der Schwelle. */
const HYST = 56;

export function useGrabberCollapse(opts: GrabberCollapseOptions): GrabberCollapseResult {
  const { regionCount: n, panelRef, gridWrapRef, ready = true, measureDeps = [], scrollTrigger = true, invertDrag = false } = opts;

  const [stage, setStage] = useState(0);
  const [dragCollapse, setDragCollapse] = useState<number | null>(null);
  const [heights, setHeights] = useState<number[]>(() => Array(n).fill(0));

  const regionEls = useRef<(HTMLDivElement | null)[]>([]);
  const grabRef = useRef<{ y: number; start: number; moved: boolean } | null>(null);
  const movedRef = useRef(false);
  const stageRef = useRef(0);
  const panelTopRef = useRef(0);
  const panelExpandedHRef = useRef(0);

  const registerRegion = useCallback(
    (i: number) => (el: HTMLDivElement | null) => { regionEls.current[i] = el; },
    [],
  );

  // Kumulative Höhe vor Region i (Summe der Höhen 0..i-1).
  const cumulative = useCallback((i: number) => {
    let s = 0;
    for (let k = 0; k < i; k++) s += heights[k] ?? 0;
    return s;
  }, [heights]);
  const totalH = useMemo(() => heights.reduce((a, b) => a + (b || 0), 0), [heights]);
  const stageCollapse = useCallback((s: number) => cumulative(s), [cumulative]);

  const dragging = dragCollapse !== null;
  const collapse = dragCollapse ?? stageCollapse(stage);

  const regionStyle = useCallback((i: number): React.CSSProperties => {
    const hidden = Math.max(0, collapse - cumulative(i));
    const visible = Math.max(0, (heights[i] ?? 0) - hidden);
    return { maxHeight: visible, transition: dragging ? 'none' : 'max-height 300ms ease' };
  }, [collapse, cumulative, heights, dragging]);

  // Höhen messen (natürlich, unabhängig von der aktuellen maxHeight-Hülle) +
  // Panel-Referenzlinie im voll ausgeklappten Zustand.
  useLayoutEffect(() => {
    if (!ready) return;
    const measure = () => {
      const next: number[] = [];
      for (let i = 0; i < n; i++) next[i] = regionEls.current[i]?.scrollHeight ?? 0;
      // Funktionales Update + Vergleich → kein `heights` in der Closure (die
      // Messung läuft auch aus einem ResizeObserver, wo eine Stale-Closure sonst
      // veraltete Höhen zurückschriebe und den Inhalt wieder abschneiden würde).
      setHeights(prev => {
        let changed = prev.length !== n;
        for (let i = 0; i < n && !changed; i++) if (next[i] !== (prev[i] ?? 0)) changed = true;
        return changed ? next : prev;
      });
      // Panel-Referenzlinie nur im voll ausgeklappten Zustand aktualisieren
      // (grabRef ist nur während eines aktiven Ziehens gesetzt). Nur relevant
      // mit Scroll-Trigger — sonst kein panelRef nötig.
      if (scrollTrigger && panelRef?.current && stageRef.current === 0 && !grabRef.current) {
        panelExpandedHRef.current = panelRef.current.offsetHeight;
        panelTopRef.current = panelRef.current.getBoundingClientRect().top;
      }
    };
    measure();
    // ResizeObserver auf den (stabilen) Inhalts-Divs jeder Region: asynchron
    // nachladende Zähler/Pills/Rarity-Zeilen vergrößern den Inhalt nach der
    // ersten Messung — ohne Nachmessen bliebe die `maxHeight`-Hülle zu klein und
    // der untere Teil des Filters wäre abgeschnitten.
    const ro = new ResizeObserver(measure);
    for (let i = 0; i < n; i++) { const el = regionEls.current[i]; if (el) ro.observe(el); }
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
    // Nur bei Inhaltsänderungen neu aufsetzen — nicht bei jedem Drag-Frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, n, ...measureDeps]);

  // `stageRef` spiegeln (der Scroll-Handler wird nur einmal registriert).
  useEffect(() => { stageRef.current = stage; }, [stage]);

  // Scroll-Trigger (Kartenposition + Hysterese). Referenzlinie = Panel-Oberkante
  // + AUSGEKLAPPTE Panel-Höhe → selbst-stabilisierend. Beim Ziehen ignoriert.
  useEffect(() => {
    if (!ready || !scrollTrigger) return;
    const onScroll = () => {
      if (grabRef.current) return;
      if (window.scrollY <= 8) { setStage(0); return; }
      const gw = gridWrapRef?.current;
      const line = panelTopRef.current + panelExpandedHRef.current;
      if (!gw || line <= 0) return;
      const cols = gw.clientWidth >= 640 ? 3 : 2;
      const rowH = ((gw.clientWidth - 12 * (cols - 1)) / cols) * (88 / 63);
      const cardMid = gw.getBoundingClientRect().top + rowH * 0.5;
      // t_k = Schwelle, ab der Stufe k erreicht wird (jede weitere Region eine
      // Kartenreihe später).
      const t = (k: number) => line - (k - 1) * rowH;
      const cur = stageRef.current;
      let target = cur;
      if (cur < n && cardMid < t(cur + 1)) {
        target = cur + 1;                         // runter: nächste Region einklappen
      } else if (cur > 0 && cardMid > t(cur) + HYST) {
        target = cur - 1;                         // hoch: eine Region wieder auf
      }
      if (target !== cur) setStage(target);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [ready, n, gridWrapRef]);

  // Scroll-Anchoring am Root abschalten, solange aktiv.
  useEffect(() => {
    if (!ready) return;
    const el = document.documentElement;
    const prev = el.style.overflowAnchor;
    el.style.overflowAnchor = 'none';
    return () => { el.style.overflowAnchor = prev; };
  }, [ready]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* egal */ }
    grabRef.current = { y: e.clientY, start: stageCollapse(stageRef.current), moved: false };
    movedRef.current = false;
  }, [stageCollapse]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const g = grabRef.current;
    if (!g) return;
    const dy = e.clientY - g.y;              // hoch = negativ
    if (Math.abs(dy) > 4) { g.moved = true; movedRef.current = true; }
    // Default: hoch ziehen = mehr Einklappen (Griff unten). invertDrag: runter
    // ziehen = mehr Einklappen (Griff oben an einem Bottom-Panel) — so folgt der
    // Griff dem Finger.
    const delta = invertDrag ? dy : -dy;
    setDragCollapse(Math.max(0, Math.min(totalH, g.start + delta)));
  }, [totalH, invertDrag]);

  const onPointerUp = useCallback(() => {
    const g = grabRef.current;
    grabRef.current = null;
    setDragCollapse(c => {
      if (g && g.moved && c !== null) {
        // Snap: Stufe = Anzahl Regionen, deren Halbhöhen-Grenze überschritten ist.
        let snapped = 0;
        for (let k = 0; k < n; k++) {
          if (c >= cumulative(k) + (heights[k] ?? 0) / 2) snapped = k + 1;
        }
        setStage(snapped);
      }
      return null; // Transition wieder an → Snap-Animation
    });
  }, [n, cumulative, heights]);

  const onClick = useCallback(() => {
    if (movedRef.current) return;
    setStage(s => (s === 0 ? n : 0));
  }, [n]);

  const grabberProps = useMemo(() => ({
    onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onClick,
  }), [onPointerDown, onPointerMove, onPointerUp, onClick]);

  return { stage, dragging, registerRegion, regionStyle, grabberProps };
}
