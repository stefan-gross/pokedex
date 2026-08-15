'use client';

import { PokemonWall } from '@/components/PokemonWall';
import { PokedexWordmark } from '@/components/PokedexWordmark';

/**
 * Cold-Start-Splash: dieselbe Pokémon-Wand + „Pokédex"-Schriftzug wie die
 * Login-Seite, aber ohne Felder. Wird beim App-Öffnen kurz eingeblendet,
 * während Auth/erster Dashboard-Load läuft, und blendet aus (`visible=false`),
 * sobald es weitergeht. `visible` steuert das sanfte Aus-/Einblenden; die
 * Komponente selbst bleibt gemountet, bis der Aufrufer sie entfernt.
 * Theme-abhängig (hell/dunkel) — erbt den `.dark`-Zustand vom Layout.
 */
export function SplashScreen({ visible = true }: { visible?: boolean }) {
  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-[#f4f6fb] dark:bg-[#0f1117]"
      style={{
        opacity: visible ? 1 : 0,
        transition: 'opacity 450ms ease-out',
        pointerEvents: visible ? 'auto' : 'none',
      }}
      aria-hidden={!visible}
    >
      <PokemonWall />
      <div className="relative flex flex-col items-center">
        <PokedexWordmark className="text-6xl" />
        <p className="text-black/60 dark:text-white/70 text-role-body mt-2">Deine Sammlung. Immer dabei.</p>
        <span className="mt-8 w-6 h-6 border-2 border-black/20 border-t-black/70 dark:border-white/30 dark:border-t-white/90 rounded-full animate-spin" />
      </div>
    </div>
  );
}
