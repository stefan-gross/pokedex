/** iOS "Liquid Glass"-Hintergrund — bunter Verlauf + 3 weiche Glows, fix
 *  hinter dem scrollenden Inhalt. Eigene Light-/Dark-Variante (Handoff
 *  design_handoff_home_glass). Wiederverwendet auf allen Glas-Screens
 *  (Dashboard, Login, Einstellungen) — siehe .glass in globals.css. */
export function GlassBackground() {
  return (
    <>
      <div className="fixed inset-0 -z-10 overflow-hidden dark:hidden" aria-hidden="true">
        <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg,#ff9d6c 0%,#e53e3e 30%,#8b3bd4 62%,#3b6fe0 100%)' }} />
        <div className="absolute rounded-full" style={{ top: -60, left: -40, width: 280, height: 280, background: 'radial-gradient(circle,#ffd27e,transparent 70%)', opacity: .8 }} />
        <div className="absolute rounded-full" style={{ bottom: 60, right: -60, width: 300, height: 300, background: 'radial-gradient(circle,#54d6ff,transparent 70%)', opacity: .7 }} />
        <div className="absolute rounded-full" style={{ top: 340, left: 120, width: 220, height: 220, background: 'radial-gradient(circle,#ff7ac1,transparent 70%)', opacity: .6 }} />
      </div>
      <div className="fixed inset-0 -z-10 overflow-hidden hidden dark:block" aria-hidden="true">
        <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg,#1c0f26 0%,#2c0f16 34%,#1a1030 64%,#0a1230 100%)' }} />
        <div className="absolute rounded-full" style={{ top: -60, left: -40, width: 280, height: 280, background: 'radial-gradient(circle,#c0392b,transparent 70%)', opacity: .5 }} />
        <div className="absolute rounded-full" style={{ bottom: 60, right: -60, width: 300, height: 300, background: 'radial-gradient(circle,#2f7fd6,transparent 70%)', opacity: .5 }} />
        <div className="absolute rounded-full" style={{ top: 340, left: 120, width: 220, height: 220, background: 'radial-gradient(circle,#a03fb0,transparent 70%)', opacity: .45 }} />
      </div>
    </>
  );
}
