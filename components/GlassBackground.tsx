/** iOS "Liquid Glass"-Hintergrund — "Holo-Schimmer" (Handoff
 *  design_handoff_home_glass, Variante 7c): Grundfläche + diagonaler
 *  Regenbogen-Sheen (wie TCG-Holo-Folie) + weicher Radial-Glow unten links.
 *  Fix hinter dem scrollenden Inhalt. Der Sheen ist in Light/Dark identisch
 *  aufgebaut, nur Grundfläche und Glow-Deckkraft wechseln — siehe .glass in
 *  globals.css für die dazugehörigen Panel-Werte. Wiederverwendet auf allen
 *  Screens außer /scanner (eigenes dunkles Kamera-Chrome). */
export function GlassBackground() {
  return (
    <>
      <div className="fixed inset-0 -z-10 overflow-hidden dark:hidden" aria-hidden="true">
        <div className="absolute inset-0" style={{ background: '#eef0f7' }} />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(115deg, transparent 20%, rgba(120,200,255,0.28) 38%, rgba(180,130,255,0.28) 50%, rgba(255,140,200,0.28) 62%, transparent 80%)' }}
        />
        <div
          className="absolute rounded-full"
          style={{ bottom: -120, left: -120, width: 420, height: 420, background: 'radial-gradient(circle, rgba(150,190,255,0.40), transparent 70%)' }}
        />
      </div>
      <div className="fixed inset-0 -z-10 overflow-hidden hidden dark:block" aria-hidden="true">
        <div className="absolute inset-0" style={{ background: '#14121c' }} />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(115deg, transparent 20%, rgba(120,200,255,0.24) 38%, rgba(180,130,255,0.24) 50%, rgba(255,140,200,0.24) 62%, transparent 80%)' }}
        />
        <div
          className="absolute rounded-full"
          style={{ bottom: -120, left: -120, width: 420, height: 420, background: 'radial-gradient(circle, rgba(90,180,255,0.35), transparent 70%)' }}
        />
      </div>
    </>
  );
}
