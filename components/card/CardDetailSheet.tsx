'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Minus, Heart, ChevronDown, ChevronLeft, Info, Repeat2, LayoutGrid } from 'lucide-react';
import { BinderIcon } from '@/lib/binder-icons';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/modal';
import { CustomSelect } from '@/components/ui/select';
import { AddToCollectionModal } from '@/components/scanner/AddToCollectionModal';
import { detectVariants, VARIANT_LABELS, getRarityGroup, SERIES_NAMES_DE, getSubtypeDe, SYMBOL_ONLY_SERIES } from '@/lib/card-constants';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { markReviewed, deleteCard } from '@/lib/firestore/cards';
import { getBinders, addCardToBinder, removeCardFromBinder, removeCardFromBinderAndCleanup, ensureDefaultBinder } from '@/lib/firestore/binders';
import { matchTemplateBinders } from '@/lib/template-binders/match-hint';
import { syncTemplateBinders } from '@/lib/template-binders/sync';
import { getWishlists, ensureDefaultWishlist, addItemToWishlist, removeItemFromWishlist } from '@/lib/firestore/wishlists';
import { getCardsByEvolutionFamily, getCardsByDexNumber } from '@/lib/firestore/catalog';
import { EnergyIcon, type EnergyType } from '@/components/ui/EnergyIcon';
import { CardVariantPrice } from '@/components/card/CardPriceDetail';
import { fetchPokemonSpeciesDE, getEvolutionFamilyDexNumbers, getEvolutionTree, type SpeciesDE, type PokemonStats, type EvolutionTreeNode } from '@/lib/pokeapi';
import { useSetMeta, type SetMeta } from '@/lib/hooks/use-set-meta';
import { getSetById } from '@/lib/firestore/sets';
import { CardImage } from '@/components/card/CardImage';
import { EvolutionTree } from '@/components/card/EvolutionTree';
import { CardNameLabel } from '@/components/card/CardNameLabel';
import type { CardDoc, BinderDoc, CardVariant } from '@/types';

/* ── Helpers ─────────────────────────────────────────────────── */

/** Schlichte SVG-Flag-Swatches statt Emoji-Flaggen — konsistent über Plattformen. */
function LanguageFlag({ lang, size = 14 }: { lang: string; size?: number }) {
  const w = Math.round(size * 1.4);
  const h = size;
  const wrap = (children: React.ReactNode) => (
    <span
      style={{
        display: 'inline-block', width: w, height: h, borderRadius: 2,
        overflow: 'hidden', flexShrink: 0, lineHeight: 0,
        boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.2)',
      }}
    >
      <svg viewBox="0 0 30 18" width={w} height={h}>{children}</svg>
    </span>
  );
  switch (lang) {
    case 'de': return wrap(<>
      <rect width="30" height="6" fill="#000" />
      <rect y="6" width="30" height="6" fill="#DD0000" />
      <rect y="12" width="30" height="6" fill="#FFCE00" />
    </>);
    case 'en': return wrap(<>
      <rect width="30" height="18" fill="#012169" />
      <path d="M0 0 L30 18 M30 0 L0 18" stroke="#fff" strokeWidth="2.5" />
      <path d="M0 0 L30 18 M30 0 L0 18" stroke="#C8102E" strokeWidth="1" />
      <rect x="13" width="4" height="18" fill="#fff" />
      <rect y="7" width="30" height="4" fill="#fff" />
      <rect x="14" width="2" height="18" fill="#C8102E" />
      <rect y="8" width="30" height="2" fill="#C8102E" />
    </>);
    case 'fr': return wrap(<>
      <rect width="10" height="18" fill="#002654" />
      <rect x="10" width="10" height="18" fill="#fff" />
      <rect x="20" width="10" height="18" fill="#ED2939" />
    </>);
    case 'jp': return wrap(<>
      <rect width="30" height="18" fill="#fff" />
      <circle cx="15" cy="9" r="4.5" fill="#BC002D" />
    </>);
    default: return (
      <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>{lang}</span>
    );
  }
}

const STAT_ROWS: { key: keyof PokemonStats; label: string }[] = [
  { key: 'hp',        label: 'KP' },
  { key: 'attack',    label: 'Angriff' },
  { key: 'defense',   label: 'Verteidigung' },
  { key: 'spAttack',  label: 'Sp. Angriff' },
  { key: 'spDefense', label: 'Sp. Verteidigung' },
  { key: 'speed',     label: 'Initiative' },
];

const CONDITION_LABEL: Record<string, string> = {
  NM: 'Near Mint',
  LP: 'Lightly Played',
  MP: 'Moderately Played',
  HP: 'Heavily Played',
  Poor: 'Poor',
};
const CONDITION_COLOR: Record<string, string> = {
  NM: '#48bb78',
  LP: '#facc15',
  MP: '#fb923c',
  HP: '#f87171',
  Poor: '#9ca3af',
};
// Swipe-nach-links auf einer Karten-Kopie: es gibt bewusst KEINEN
// Zwischenzustand ("Fläche bleibt offen stehen"). Beim Loslassen entweder
// (a) weit genug gezogen → Löschung wird sofort ausgeführt, oder
// (b) nicht weit genug → schnappt zurück auf 0. Nichts dazwischen.
// Kleiner Schwellwert — die Fläche zeigt nur ein einzelnes Icon (kein
// großer Text-Button mehr), braucht also keine große Zugstrecke mehr, um
// zu "aktivieren".
// Sentinel-Wert für "Unsortiert" (Default-Sammlung) in der `CustomSelect`-
// Variante der Sammlung-Auswahl (nur Design-System-Vorschau, siehe
// `sammlungSelectVariant`-Prop) — `CustomSelect.value` ist generisch über
// `string`, `onMoveToBinder` erwartet aber `null` für "Unsortiert".
const UNSORTED_SENTINEL = '__unsorted__';

const SWIPE_DELETE_PX = 80;
// Ab hier (deutlich vor der Lösch-Schwelle, nicht erst kurz davor) setzt der
// Gummiband-Widerstand ein — bis dahin folgt die Zeile 1:1 dem Finger, danach
// bewegt sie sich zunehmend langsamer, bis der harte Anschlag exakt bei
// `SWIPE_DELETE_PX` erreicht ist (siehe `rubberBand` unten). Es soll sich
// nicht weiter ziehen lassen, als bis der Button aktiviert ist — nur das
// "Wie" (linear vs. gedämpft) ändert sich.
const SWIPE_RUBBER_START_PX = SWIPE_DELETE_PX * 0.4;
// Zusätzliche Zieh-Distanz (über `SWIPE_RUBBER_START_PX` hinaus), die nötig
// ist, um den Anschlag zu erreichen — je größer, desto zäher/deutlicher der
// Widerstand. Ein fester Wert (statt einer reinen Rate) garantiert, dass der
// Anschlag bei einer konkreten, endlichen Zug-Distanz sicher erreicht wird.
const SWIPE_RUBBER_TRAVEL_PX = 130;
// Der äußere Wrapper wird um diesen Betrag nach links verbreitert (per
// negativem `marginLeft`, rechte Kante bleibt unverändert) — größer als
// `SWIPE_DELETE_PX` (der Zug wird dort hart gedeckelt, siehe unten), damit
// die Zeile beim Ziehen nie an einem harten Rand abgeschnitten wird. Der
// Wrapper trägt nur `overflow-hidden` (Clip der Überbreite) — die sichtbare
// Rundung kommt von der Zeile selbst (siehe `rounded-xl` unten), nicht vom
// Wrapper-Rand, da dessen eigene Ecken weit links außerhalb des sichtbaren
// Bereichs liegen.
const OVERSCAN_PX = 160;
// Leichtes Überschwingen beim Zurückschnappen — federartig statt linear,
// dadurch fühlt sich das Zurückspringen weniger robotisch an.
const SWIPE_SPRING_EASE = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
// Die Löschen-Fläche reicht um diesen Betrag über ihre eigentliche Breite
// hinaus nach LINKS unter die Zeile — größer als deren Eckenradius (14px).
// Ohne das bleibt exakt in der gerundeten Ecke der Zeile ein winziger
// Bereich frei, den weder die (dort weggeschnittene) Zeile noch die
// bündig anschließende Löschen-Fläche abdecken — dort schimmert der
// Hintergrund dahinter durch. Da die Zeile während des Ziehens blickdicht
// ist (`.glass-swipe-solid`, kein Blur), verdeckt sie den überlappenden
// Teil der Löschen-Fläche in der geraden Mitte vollständig — nur in der
// Ecke, wo die Zeile selbst nichts mehr zeichnet, wird die Überlappung
// sichtbar und schließt die Lücke.
const DELETE_AREA_CORNER_OVERLAP_PX = 18;

/** Bis `SWIPE_RUBBER_START_PX` 1:1, danach eine Ease-Out-Kurve (anfangs noch
 *  spürbar nachgebend, wird zum Anschlag hin zunehmend zäher) — landet exakt
 *  bei `SWIPE_DELETE_PX`, sobald `SWIPE_RUBBER_TRAVEL_PX` zusätzliche
 *  Zug-Distanz erreicht ist. Nie darüber hinaus (harter Anschlag genau an der
 *  Aktivierungsgrenze des Buttons, kein Überschwingen). */
function rubberBand(raw: number): number {
  const dist = -raw;
  if (dist <= SWIPE_RUBBER_START_PX) return raw;
  const remaining = SWIPE_DELETE_PX - SWIPE_RUBBER_START_PX;
  const t = Math.min(1, (dist - SWIPE_RUBBER_START_PX) / SWIPE_RUBBER_TRAVEL_PX);
  const eased = 1 - (1 - t) * (1 - t);
  const damped = SWIPE_RUBBER_START_PX + remaining * eased;
  return -damped;
}

/** Eine Zeile "eigene Kopie" im Kartendetail: Sprache/Zustand/Sammlung als
 *  Pills, gelber Rahmen statt Pill für den Prüfen-Status (Tap auf die Zeile
 *  markiert als geprüft), Swipe nach links legt eine Löschen-Fläche frei und
 *  löscht bei genug Schwung sofort — ersetzt den vorherigen, immer sichtbaren
 *  Lösch-Button. */
export function OwnedCopyRow({
  copy, condColor, binder, isDefaultBinder, assignableBinders,
  onMarkReviewed, onMoveToBinder, onDelete, isDeleting, sammlungSelectVariant,
}: {
  copy: CardDoc;
  condColor: string;
  binder: BinderDoc | undefined;
  isDefaultBinder: boolean;
  /** Sammlungen, die sich direkt aus der Zeile auswählen lassen — normale
   *  Sammlungen ohne Vorlagen-Binder (die sortieren sich selbst automatisch,
   *  siehe `template-binders/sync.ts`) und ohne die Fest-Sammlungen (die sind
   *  ohnehin schon über "Unsortiert" bzw. den aktuellen Eintrag erreichbar). */
  assignableBinders: BinderDoc[];
  onMarkReviewed: () => void;
  /** `null` = "Unsortiert" (Default-Sammlung). */
  onMoveToBinder: (targetBinderId: string | null) => void;
  onDelete: () => void;
  isDeleting: boolean;
  /** Optik der Sammlung-Auswahl — `secondary` (Default, neutral) oder
   *  `primary` (Akzentfarbe). Nur die Design-System-Vorschau nutzt `primary`
   *  zum direkten Vergleich; die echte App bleibt beim neutralen Default. */
  sammlungSelectVariant?: 'primary' | 'secondary';
}) {
  const [dragX, setDragX]         = useState(0);
  const [dragging, setDragging]   = useState(false);
  const [committed, setCommitted] = useState(false);
  const startXRef  = useRef<number | null>(null);
  const movedRef   = useRef(false);
  // War der Gestenstart auf einem eigenständig klickbaren Kind (Sammlung-Pill/
  // Entfernen-Button)? Dann soll ein reiner Tap NUR dessen eigenes onClick
  // auslösen (Navigation/Entfernen), nicht zusätzlich "als geprüft markieren"
  // — Ziehen von dort aus soll aber trotzdem die ganze Zeile swipen können.
  const tapOnChildRef = useRef(false);
  // Aktueller Drag-Wert synchron in einem Ref mitgeführt — `dragX` (State)
  // kann in schnellen Ereignisfolgen kurzzeitig hinter dem tatsächlichen
  // Zeigerstand zurückliegen (Render/Batching), die Schwellwert-Entscheidung
  // in `handlePointerUp` braucht aber den exakt aktuellen Wert.
  const dragXRef   = useRef(0);

  function applyDragX(x: number) {
    dragXRef.current = x;
    setDragX(x);
  }

  function commitDelete() {
    setCommitted(true);
    applyDragX(-500);
    setTimeout(onDelete, 200);
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (isDeleting || committed) return;
    movedRef.current = false;
    tapOnChildRef.current = !!(e.target as HTMLElement).closest('[data-swipe-passthrough]');
    startXRef.current = e.clientX;
    setDragging(true);
    // Pointer-Capture NICHT sofort setzen, wenn die Geste auf einem eigenen
    // klickbaren Kind (Sammlung-Pill) beginnt — Capture retargeted alle
    // folgenden Pointer-Events (inkl. pointerup) auf die Zeile, wodurch der
    // Browser bei einem reinen Tap keinen "click" mehr auf dem Kind-Button
    // synthetisiert (Dropdown öffnete sich dadurch nie bei echtem Antippen,
    // nur bei programmatischem `.click()`). Bei echtem Ziehen wird die
    // Capture stattdessen verzögert in `handlePointerMove` gesetzt, sobald
    // Bewegung erkannt wird — für die Swipe-Verfolgung reicht das.
    if (!tapOnChildRef.current) {
      try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch {}
    }
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (startXRef.current == null) return;
    const dx = e.clientX - startXRef.current;
    if (Math.abs(dx) > 6) {
      if (!movedRef.current && tapOnChildRef.current) {
        try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch {}
      }
      movedRef.current = true;
    }
    applyDragX(rubberBand(Math.min(0, dx)));
  }
  function handlePointerUp() {
    if (startXRef.current == null) return;
    startXRef.current = null;
    setDragging(false);
    if (!movedRef.current) {
      // Reiner Tap ohne Bewegung (falls "Prüfen" aktiv) markiert als geprüft
      // — außer der Tap war auf der Sammlung-Pill/Entfernen-Button, die haben
      // ihr eigenes onClick (Navigation/Entfernen).
      if (!tapOnChildRef.current && copy.needsReview) onMarkReviewed();
      return;
    }
    // Kein Zwischenzustand: entweder weit genug gezogen → sofort löschen,
    // oder zurück auf 0 — nie "offen stehen bleiben".
    if (dragXRef.current <= -SWIPE_DELETE_PX) { commitDelete(); return; }
    applyDragX(0);
  }
  function handlePointerCancel() {
    startXRef.current = null;
    setDragging(false);
    applyDragX(0);
  }

  // Löst ein Loslassen JETZT die Löschung aus? Steuert, ob der Button
  // überhaupt antippbar ist (exakt ab der Schwelle, ab der ein Loslassen
  // wirklich löschen würde).
  const canConfirmDelete = dragX <= -SWIPE_DELETE_PX;
  // 0 (Zug-Beginn) bis 1 (Schwelle erreicht) — treibt die kontinuierliche
  // Farbblendung des Buttons von gedämpft zu voll rot (siehe unten), statt
  // erst exakt an der Schwelle hart umzuschalten.
  const swipeProgress = Math.min(1, -dragX / SWIPE_DELETE_PX);
  // Beim Zurückschnappen (nicht während des aktiven Ziehens) federnd statt
  // linear — beim Wegfliegen (Löschen) dagegen beschleunigend statt federnd,
  // ein Bounce beim Verschwinden sähe unnatürlich aus.
  const settleTransition = committed
    ? 'transform 220ms cubic-bezier(0.4, 0, 1, 1)'
    : `transform 320ms ${SWIPE_SPRING_EASE}`;

  return (
    // Nach links verbreitert (negativer `marginLeft`, siehe `OVERSCAN_PX`) —
    // die rechte Kante bleibt exakt an ihrer ursprünglichen Position, die
    // Zeile bekommt per `marginLeft`/`width`-Ausgleich wieder ihre normale
    // Breite/Position zurück — dadurch kann sie beim Ziehen frei nach links
    // wandern, ohne an einem harten Rand abgeschnitten zu werden. KEIN
    // `overflow-hidden` hier (auch keine eigene `rounded-xl`-Klasse) — das
    // hätte den rechten/unteren Schatten der Zeile abgeschnitten, da der
    // Wrapper-Rand dort exakt an der Zeilen-Box klebt. Unnötig: `html`/`body`
    // haben bereits global `overflow-x: clip` (siehe globals.css) als
    // Sicherheitsnetz gegen horizontales Scrollen durch den negativen Margin
    // — ein eigenes Clipping auf diesem Wrapper bringt nichts außer dem
    // abgeschnittenen Schatten.
    <div className="relative" style={{ minHeight: 48, marginLeft: -OVERSCAN_PX, width: `calc(100% + ${OVERSCAN_PX}px)` }}>
      {/* Löschen-Fläche — flächiges Rot, rechtsbündig, ohne Text-Label. Breite
          wächst mit der Zieh-Distanz (`Math.abs(dragX)`) statt die ganze
          Zeilenbreite zu belegen — sie liegt dadurch NIE unter dem noch
          sichtbaren Teil der transluzenten `.glass`-Zeile (die sonst durch
          die Transparenz hindurchscheinen würde). Bleibt "deaktiviert"
          (gedämpftes Rot, nicht antippbar), solange ein Loslassen JETZT noch
          nicht löschen würde — springt erst ab der Lösch-Schwelle auf voll
          rot/deckend/antippbar. */}
      <div
        className="absolute inset-y-0 right-0 overflow-hidden rounded-r-xl"
        style={{
          width: dragX === 0 ? 0 : Math.abs(dragX) + DELETE_AREA_CORNER_OVERLAP_PX,
          transition: dragging ? 'none' : settleTransition,
        }}
      >
        {/* `inset-0` — der Button deckt IMMER die gesamte freigelegte Fläche
            ab (kein Zusatzweg ins Rote ohne Button, sonst ließe sich über den
            Button hinausziehen). Das Icon selbst wird NICHT mehr per Flexbox
            innerhalb dieser wachsenden Box zentriert (das rechnete bei sehr
            kleiner Zieh-Distanz falsch, weil Icon+Padding nicht hineinpassten
            — sichtbar als leichtes Nachlinks-Rutschen zu Beginn des Swipes),
            sondern eigenständig absolut auf den festen rechten Rand
            positioniert (siehe `span` unten) — dadurch bleibt seine Position
            über die ganze Ziehstrecke konstant, unabhängig von der Breite
            dieser Box. */}
        {/* Deaktiviert/aktiviert wird über eine ANDERE, aber weiterhin
            voll deckende Rotvariante ausgedrückt (`--action-delete-muted`),
            NICHT über `opacity` — `opacity` hätte mit dem durchgeschimmert,
            was hinter dem Button liegt (unterschiedlich je nach Kontext),
            wodurch der Button verwaschen/rosa statt erkennbar rot wirkte.
            Die Blendung von gedämpft zu voll läuft kontinuierlich mit dem
            Zug mit (`color-mix`, `swipeProgress` 0→1), statt erst exakt an
            der Schwelle hart umzuschalten. */}
        <button
          onClick={commitDelete}
          disabled={isDeleting || !canConfirmDelete}
          className="absolute inset-0 text-white rounded-r-xl"
          style={{
            background: `color-mix(in srgb, var(--action-delete-muted), var(--action-delete) ${Math.round(swipeProgress * 100)}%)`,
            transition: dragging ? 'none' : 'background-color 150ms ease-out',
            pointerEvents: dragX === 0 ? 'none' : 'auto',
          }}
          aria-label="Karte löschen"
        >
          <span className="absolute top-1/2 right-4 -translate-y-1/2">
            <Minus size={20} strokeWidth={2.5} />
          </span>
        </button>
      </div>

      {/* Vordergrund — Inhalt der Zeile, per Swipe verschiebbar. Bleibt beim
          Löschen voll deckend (kein Opacity-Fade) — nur die Verschiebung
          nach links macht sie unsichtbar. `.glass` statt `.glass-inner` —
          "Glas auf Glas" (dieselbe Rezeptur wie die umgebende "Karten &
          Preise"-Sektion, gestapelt), analog zum "Details"-Abschnitt weiter
          oben, der seine Fakten-Zeilen ebenso in verschachteltem `.glass`
          statt `.glass-inner` zeigt. `rounded-xl` IMMER auf der Zeile selbst
          (nicht auf dem Wrapper, siehe oben), unverändert auch während des
          Ziehens. Zusätzlich `overflow-hidden` auf der Zeile selbst (NICHT
          auf dem Wrapper — der hätte sonst wieder den Schatten
          abgeschnitten, siehe Kommentar oben): ohne das ragte der Inhalt
          (z.B. die Sammlung-Pille) über die gerundete rechte Ecke hinaus in
          die Löschen-Fläche hinein (sichtbar als eckig wirkende Ecke +
          durchscheinende Pille über Rot) — `overflow-hidden` auf einem
          Element clippt nur seine eigenen Kinder, nie seinen eigenen
          `box-shadow`, daher bleibt der Schatten-Fix unberührt. Während des
          Ziehens zusätzlich `.glass-swipe-solid`: die Blur von `.glass`
          tastet auch leicht über den Elementrand hinaus ab und würde sonst
          die danebenliegende rote Löschen-Fläche durch die Zeile
          durchschimmern lassen — die blickdichte Variante hat dieselbe
          Helligkeit, nur ohne Transparenz/Blur. Zusätzlich `.glass-swipe-
          shadow`: ein zusätzlicher Schatten nach rechts verkauft das
          "Zeile liegt auf der roten Löschen-Fläche"-Layering deutlicher.
          `touchAction: 'pan-y'`: ohne das erkennt der Browser eine leichte
          vertikale Abweichung während des (eigentlich horizontalen) Ziehens
          selbst als Scroll-Versuch und übernimmt die Geste — bei dieser
          niedrigen Zeile (nur ~48px hoch) reicht dafür schon ein winziges
          Verrutschen, was die Geste per `pointercancel` sofort abbrach
          ("Swipe ist vorbei, sobald man das Element verlässt"). `pan-y`
          erlaubt dem Browser weiterhin natives vertikales Scrollen (falls
          die Geste tatsächlich vertikal gemeint ist), beansprucht eine
          überwiegend horizontale Geste aber nicht mehr für sich. */}
      <div
        className={`glass rounded-xl overflow-hidden flex items-center gap-2 px-2.5 py-2 relative ${dragX !== 0 ? 'glass-swipe-solid glass-swipe-shadow' : ''}`}
        style={{
          minHeight: 48,
          marginLeft: OVERSCAN_PX,
          width: `calc(100% - ${OVERSCAN_PX}px)`,
          transform: `translateX(${dragX}px)`,
          transition: dragging ? 'none' : settleTransition,
          touchAction: 'pan-y',
          // Eigener Rahmen überschreibt `.glass`s Standardrahmen nur, wenn
          // "Prüfen" aktiv ist — sonst soll der normale Glas-Rahmen durchscheinen.
          ...(copy.needsReview ? { border: '2px solid var(--pokedex-yellow)' } : undefined),
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="w-7 h-7 rounded-full overflow-hidden shrink-0 flex items-center justify-center">
            <LanguageFlag lang={copy.language} size={28} />
          </span>
          <span
            className="text-role-label px-2 py-1 rounded-full border shrink-0"
            style={{ borderColor: condColor, color: condColor }}
          >
            {CONDITION_LABEL[copy.condition] ?? copy.condition}
          </span>
          {/* Sammlung-Pill — jetzt eine Dropdown-Auswahl statt reiner
              Navigation: direktes Umsortieren spart den Umweg über den
              separaten Sammlungsbereich. Größer für mobile Touch-Targets. */}
          <div className="shrink-0 ml-auto" data-swipe-passthrough style={{ maxWidth: 180 }}>
            <CustomSelect
              variant={sammlungSelectVariant ?? 'secondary'}
              height="sm"
              value={isDefaultBinder ? UNSORTED_SENTINEL : (binder?.id ?? UNSORTED_SENTINEL)}
              onChange={v => onMoveToBinder(v === UNSORTED_SENTINEL ? null : v)}
              options={[
                { value: UNSORTED_SENTINEL, label: 'Unsortiert' },
                ...assignableBinders.map(b => ({
                  value: b.id,
                  label: b.name,
                  icon: b.icon ? <BinderIcon name={b.icon} size={13} className="shrink-0" /> : undefined,
                })),
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const VALID_ENERGY = new Set([
  'Fire','Water','Grass','Lightning','Psychic',
  'Fighting','Darkness','Metal','Dragon','Fairy','Colorless',
]);
function toEnergy(t: string): EnergyType | null {
  return VALID_ENERGY.has(t) ? (t as EnergyType) : null;
}

const STAGE_KEYS = ['Basic','Stage 1','Stage 2','MEGA','BREAK','Level-Up','Restored','GX','EX','V','VMAX','VSTAR','V-UNION','Radiant','Tera','ACE SPEC'];
function getStage(subtypes: string[]): string | null {
  const found = subtypes.find(s => STAGE_KEYS.includes(s));
  return found ? getSubtypeDe(found) : null;
}

/** Sonderform-Mechaniken (Teilmenge von STAGE_KEYS ohne reine Stufen-Wörter) — Karten
 *  wie „Glurak-EX"/„Glurak VMAX" sind keine eigenen Evolutions-Baumknoten (gleiche
 *  Pokédex-Nummer wie die Basisform), werden aber als „Auch verfügbar als"-Zeile
 *  unter dem Baum angezeigt. */
const SPECIAL_MECHANIC_KEYS = ['GX','EX','V','VMAX','VSTAR','V-UNION','MEGA','BREAK','Radiant','Tera','ACE SPEC'];

/** Leitet DE-Kartenbild aus Logo-URL ab: .../sv/sv04.5/logo.png → .../sv/sv04.5/027/high.webp */
function imgFromLogoUrl(logoUrl: string, cardNumber: string): string | null {
  const base = logoUrl.replace(/\/logo\.png$/, '').replace(/\/logo$/, '');
  if (!base.includes('assets.tcgdex.net')) return null;
  const num = cardNumber.split('/')[0].padStart(3, '0');
  return `${base}/${num}/high.webp`;
}

/**
 * Wählt pro Evolutionsstufe (Pokédex-Nummer) genau eine Karte aus — unabhängig
 * für jede Stufe, nicht als eine Entscheidung für die ganze Linie. Priorität:
 * 1. Gleiches Set wie die aktuell angezeigte Karte (stimmige Optik).
 * 2. Eine Karte, die der Nutzer selbst besitzt.
 * 3. Neuestes Erscheinungsdatum (Fallback, braucht ggf. `tcg_sets`-Lookup).
 */
async function pickEvolutionCards(
  candidates: CardInfo[],
  currentCard: CardInfo,
  ownedTcgIds: Set<string>,
): Promise<CardInfo[]> {
  // Sonderform-Drucke (MEGA/EX/VMAX/…) nie als Baum-Knoten wählen — die landen
  // stattdessen in der separaten "Auch verfügbar als"-Zeile der jeweiligen Stufe.
  // Ausnahme: ein Dex-Eintrag hat wirklich nur Sonderform-Drucke (kein normaler
  // Print existiert) — dann bleibt die Sonderform als einzige Option erhalten.
  const byDex = new Map<number, CardInfo[]>();
  for (const c of candidates) {
    if (!c.nationalDexNumber) continue;
    const isSpecialMechanic = c.subtypes?.some(s => SPECIAL_MECHANIC_KEYS.includes(s));
    if (isSpecialMechanic && candidates.some(o =>
      o.nationalDexNumber === c.nationalDexNumber &&
      !o.subtypes?.some(s => SPECIAL_MECHANIC_KEYS.includes(s))
    )) continue;
    const arr = byDex.get(c.nationalDexNumber) ?? [];
    arr.push(c);
    byDex.set(c.nationalDexNumber, arr);
  }

  // Nur für Gruppen ohne Set-/Besitz-Treffer brauchen wir Erscheinungsdaten.
  const groups = [...byDex.values()];
  const dateLookupSetIds = new Set<string>();
  for (const group of groups) {
    const hasSameSet = group.some(c => c.setId === currentCard.setId);
    const hasOwned   = group.some(c => ownedTcgIds.has(c.id));
    if (!hasSameSet && !hasOwned) {
      group.forEach(c => dateLookupSetIds.add(c.setId));
    }
  }
  const setDates = new Map<string, string>();
  await Promise.all([...dateLookupSetIds].map(async id => {
    const set = await getSetById(id);
    if (set?.releaseDate) setDates.set(id, set.releaseDate);
  }));

  const picked: CardInfo[] = [];
  for (const group of groups) {
    const sameSet = group.find(c => c.setId === currentCard.setId);
    const owned   = group.find(c => ownedTcgIds.has(c.id));
    const newest  = [...group].sort((a, b) =>
      (setDates.get(b.setId) ?? '').localeCompare(setDates.get(a.setId) ?? '')
    )[0];
    const best = sameSet ?? owned ?? newest;
    if (best) picked.push(best);
  }
  return picked.sort((a, b) => (a.nationalDexNumber ?? 0) - (b.nationalDexNumber ?? 0));
}

/* ── Props / Types ───────────────────────────────────────────── */

export type { SetMeta };

interface Props {
  card: CardInfo | null;
  ownedCopies: CardDoc[];
  binders?: BinderDoc[];
  setMeta?: SetMeta;
  onClose: () => void;
  onSaved?: () => void;
}

type Section = 'details' | 'evo' | 'cards';

/* ── Accordion Header ────────────────────────────────────────── */
function AccHeader({
  icon, title, open, onToggle, border = true,
}: {
  icon: React.ReactNode; title: string; open: boolean;
  onToggle: () => void; border?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 min-h-[52px] text-left transition-colors"
      style={{ borderTop: border ? '1px solid color-mix(in srgb, var(--border) 50%, transparent)' : 'none' }}
    >
      <div className="flex items-center gap-2.5 text-role-title text-glass">
        <span className="text-glass-muted">{icon}</span>
        {title}
      </div>
      <ChevronDown
        size={18}
        className="text-glass-muted transition-transform duration-200 shrink-0"
        style={{ transform: open ? 'rotate(180deg)' : 'none' }}
      />
    </button>
  );
}

/* ── Component ───────────────────────────────────────────────── */
export function CardDetailSheet({ card: initialCard, ownedCopies, binders, setMeta, onClose, onSaved }: Props) {
  // Slide-Animation + Swipe-Down-Drag übernimmt jetzt `Sheet` (components/ui/modal.tsx)
  // selbst — hier nur noch das einfache offen/zu.
  const [sheetOpen,    setSheetOpen]    = useState(true);
  const [zoomed,       setZoomed]       = useState(false);
  const [openSec,      setOpenSec]      = useState<Set<Section>>(new Set(['cards']));
  const [imgSrcDe,     setImgSrcDe]     = useState<string | undefined>(undefined);
  const [addVariant,   setAddVariant]   = useState<CardVariant | null>(null);
  const [species,      setSpecies]      = useState<SpeciesDE | null>(null);
  // Navigations-Stack für Evolutions-Sprünge — leerer Stack = Initial-Karte sichtbar
  const [cardStack,    setCardStack]    = useState<CardInfo[]>([]);
  // Wenn der Aufrufer eine andere Initial-Karte übergibt (neuer Detail-Aufruf), Stack zurücksetzen
  useEffect(() => { setCardStack([]); }, [initialCard?.id]);
  const card = cardStack.length > 0 ? cardStack[cardStack.length - 1] : initialCard;
  const [speciesLoaded,setSpeciesLoaded]= useState(false);
  const [evoCards,     setEvoCards]     = useState<CardInfo[]>([]);
  const [evoTree,      setEvoTree]      = useState<EvolutionTreeNode | null>(null);
  const [evoLoaded,    setEvoLoaded]    = useState(false);
  const [specialForms, setSpecialForms] = useState<CardInfo[]>([]);
  const [deletingId,   setDeletingId]   = useState<string | null>(null);
  const resolvedMeta = useSetMeta(card?.setId, setMeta, card?.setName);
  const [resolvedBinders, setResolvedBinders] = useState<BinderDoc[]>(binders ?? []);
  const [wishlistItem, setWishlistItem] = useState<{ listId: string; itemId: string } | null>(null);

  /* Reset + load on card change */
  useEffect(() => {
    let cancelled = false;
    if (!card) { setSheetOpen(false); return; }
    setSheetOpen(true);
    setSpecies(null); setSpeciesLoaded(false);
    setEvoCards([]); setEvoLoaded(false); setEvoTree(null); setSpecialForms([]);
    // DE-Bild direkt aus Firestore, falls vorhanden (|| fängt auch leere Strings ab)
    setImgSrcDe(card.imgLargeDe || undefined);
    getBinders().then(setResolvedBinders).catch(() => {});
    setWishlistItem(null);
    getWishlists().then(lists => {
      if (cancelled) return;
      for (const list of lists) {
        const item = list.items.find(i => i.tcgId === card.id);
        if (item) { setWishlistItem({ listId: list.id, itemId: item.id }); return; }
      }
    }).catch(() => {});

    const isPokemon = !card.supertype ||
      card.supertype.toLowerCase().includes('pokémon') ||
      card.supertype.toLowerCase() === 'pokemon';

    if (isPokemon) {
      // Firestore-First: Artdaten direkt aus CardInfo (nach Enrichment)
      if (card.genusDe !== undefined) {
        setSpecies({
          genus:      card.genusDe,
          flavorText: card.flavorTextDe ?? '',
          height:     card.heightDm ?? 0,
          weight:     card.weightHg ?? 0,
          region:     card.region ?? '',
        });
        setSpeciesLoaded(true);
        // Basiswerte/Fähigkeiten/Legendär-Status sind (noch) nicht Teil des
        // persistierten Enrichments — zusätzlich live nachladen und mergen,
        // sobald verfügbar (kein Blocker für die schon vorhandenen Felder).
        fetchPokemonSpeciesDE(card.name, card.supertype).then(extra => {
          if (cancelled || !extra) return;
          setSpecies(prev => prev
            ? { ...prev, stats: extra.stats, abilities: extra.abilities, isLegendary: extra.isLegendary, isMythical: extra.isMythical }
            : prev);
        });
      } else {
        // Fallback: live von PokéAPI (vor Enrichment oder bei Karten ohne DE-Namen)
        fetchPokemonSpeciesDE(card.name, card.supertype)
          .then(s => { setSpecies(s); setSpeciesLoaded(true); });
      }

      if (card.nationalDexNumber) {
        // Baumstruktur unabhängig von den Bilddaten laden — eigener, günstiger
        // PokéAPI-Call, kein Sequenzierungs-Zwang mit dem Karten-Fetch unten.
        getEvolutionTree(card.nationalDexNumber).then(t => { if (!cancelled) setEvoTree(t); });

        getCardsByEvolutionFamily(card.nationalDexNumber, 100)
          .then(async cards => {
            let source = cards.map(catalogCardToInfo);

            // Fallback: evolutionFamily noch nicht befüllt → PokéAPI für Familienstruktur
            if (source.length === 0) {
              const familyNums = await getEvolutionFamilyDexNumbers(card.nationalDexNumber!);
              if (familyNums.length > 0) {
                // Hohes Limit statt 3 — sonst fehlt der zum aktuellen Set passende
                // Print evtl. in der (unsortierten) Firestore-Kappung, und
                // pickEvolutionCards bekommt den richtigen Kandidaten nie zu sehen.
                const batches = await Promise.all(familyNums.map(n => getCardsByDexNumber(n, 60)));
                source = batches.flat().map(catalogCardToInfo);
              }
            }

            // Eine Karte pro Pokédex-Nummer, je Stufe unabhängig gewählt
            // (gleiches Set → eigener Besitz → neuestes Datum, siehe pickEvolutionCards).
            const ownedTcgIds = new Set(ownedCopies.map(o => o.tcgId).filter(Boolean) as string[]);
            const picked = await pickEvolutionCards(source, card, ownedTcgIds);
            if (cancelled) return;
            setEvoCards(picked);
            setEvoLoaded(true);

            // Sonderformen der aktuell angezeigten Stufe (EX/GX/V/VMAX/…) — keine
            // eigenen Baum-Knoten, aber unter dem Baum als kleine Kartenreihe gezeigt.
            const currentPicked = picked.find(p => p.nationalDexNumber === card.nationalDexNumber);
            const seenKeys = new Set<string>();
            const forms: CardInfo[] = [];
            // Einstufige Pokémon (z.B. Miraidon) haben keinen Baum, in dem die normale
            // Form als Knoten auftaucht — dann muss sie zusätzlich in dieser Zeile
            // erscheinen, sonst ist sie von der Sonderform aus gar nicht erreichbar.
            if (picked.length <= 1 && currentPicked && currentPicked.id !== card.id) {
              forms.push(currentPicked);
            }
            for (const c of source) {
              if (c.nationalDexNumber !== card.nationalDexNumber) continue;
              if (c.id === card.id) continue; // aktuell angezeigte Karte nicht nochmal auflisten
              if (currentPicked && c.id === currentPicked.id) continue;
              const key = c.subtypes?.find(s => SPECIAL_MECHANIC_KEYS.includes(s));
              if (!key || seenKeys.has(key)) continue;
              seenKeys.add(key);
              forms.push(c);
            }
            setSpecialForms(forms);
          })
          .catch(() => {
            // Firestore-/PokéAPI-Fehler (z.B. Netzwerk-Hänger) dürfen den Spinner
            // nicht für immer drehen lassen — sauber auf "kein Ergebnis" fallen.
            if (cancelled) return;
            setEvoCards([]);
            setSpecialForms([]);
            setEvoLoaded(true);
          });
      } else {
        setEvoLoaded(true);
      }
    } else {
      setSpeciesLoaded(true);
      setEvoLoaded(true);
    }
    return () => { cancelled = true; };
  }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fallback: DE-Bild aus Logo-URL ableiten, sobald Set-Metadaten geladen sind
  // (nur nötig wenn imgLargeDe nicht direkt in Firestore hinterlegt ist).
  useEffect(() => {
    if (!card || card.imgLargeDe || !resolvedMeta) return;
    const deImg = imgFromLogoUrl(resolvedMeta.logoUrl, card.number);
    if (deImg) setImgSrcDe(deImg);
  }, [card, resolvedMeta]);

  if (!card) return null;

  /* Derived values */
  const rarityInfo  = card.rarity ? getRarityGroup(card.rarity) : null;
  const variants    = (card.variants?.length
    ? card.variants
    : card.rarity ? detectVariants(card.rarity) : ['standard']
  ) as CardVariant[];
  const stage       = getStage(card.subtypes ?? []);
  const energyTypes = (card.types ?? []).map(toEnergy).filter(Boolean) as EnergyType[];
  const setCode     = card.setCode ?? card.setId.toUpperCase();
  // Promo-Karten (egal ob Nummer alphanumerisch wie "SWSH092" oder rein
  // numerisch wie "028") tragen auf dem echten Aufdruck nie eine Gesamtzahl —
  // die Promo-Reihe ist offen/fortlaufend, "215" wäre nur die interne
  // Firestore-Katalogzahl, kein echter Aufdruck. Also nie ein "/Total" anhängen.
  const isPromo     = rarityInfo?.order === 99;
  const numRaw      = card.number.split('/')[0];
  const isPlainNum  = /^\d+$/.test(numRaw);
  const numBase     = isPlainNum ? numRaw.padStart(3, '0') : numRaw;
  const numTotal    = !isPromo && isPlainNum && resolvedMeta?.printedTotal ? String(resolvedMeta.printedTotal).padStart(3, '0') : null;
  const numFmt      = numTotal ? `${numBase}/${numTotal}` : numBase;
  const logoUrl     = resolvedMeta?.logoUrl ?? `https://images.pokemontcg.io/${card.setId}/logo.png`;
  const setNameDe   = resolvedMeta?.nameDe ?? card.setName;
  // Sets vor Scarlet & Violet tragen keinen echten Kürzel-Aufdruck — nur ein
  // grafisches Symbol. setCode ist dort nur ein internes pokemontcg.io-Kürzel.
  const isSymbolOnlySet = !!card.series && SYMBOL_ONLY_SERIES.includes(card.series);

  function bindersOf(copy: CardDoc) { return resolvedBinders.filter(b => b.cardIds.includes(copy.id)); }
  function toggle(s: Section) {
    setOpenSec(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  }
  function handleClose() { setSheetOpen(false); setTimeout(onClose, 250); }

  async function toggleWishlist() {
    if (!card) return;
    if (wishlistItem) {
      await removeItemFromWishlist(wishlistItem.listId, wishlistItem.itemId);
      setWishlistItem(null);
      return;
    }
    const list = await ensureDefaultWishlist();
    const newItem = await addItemToWishlist(list.id, {
      tcgId: card.id,
      name: card.name,
      setName: card.setName,
      setId: card.setId,
      number: card.number,
      tcgImageUrl: imgSrcDe || card.imgLarge || card.imgSmall,
      priority: 2,
      acquired: false,
    });
    if (newItem) setWishlistItem({ listId: list.id, itemId: newItem.id });
  }

  // `targetBinderId` = null → "Unsortiert" (Default-Sammlung). Verallgemeinert
  // das frühere reine "Entfernen" (das immer nach Unsortiert verschob) auf ein
  // direktes Umsortieren in eine beliebige Sammlung — spart den Umweg über
  // den separaten Sammlungsbereich, den ein Tap auf die Pill vorher gebraucht hätte.
  async function handleMoveToBinder(copy: CardDoc, targetBinderId: string | null) {
    const targetId = targetBinderId ?? await ensureDefaultBinder();
    const currentBinderIds = bindersOf(copy).map(b => b.id);
    if (currentBinderIds.includes(targetId)) return;
    await Promise.all(currentBinderIds.map(id => removeCardFromBinder(id, copy.id)));
    await addCardToBinder(targetId, copy.id);
    const fresh = await getBinders();
    setResolvedBinders(fresh);
    onSaved?.();
  }

  // Bestätigung passiert jetzt über die Swipe-Geste selbst (Reveal + Tap bzw.
  // genug Schwung fürs Loslassen, siehe `OwnedCopyRow`) statt über einen
  // zweiten Tap auf einen dauerhaft sichtbaren Button.
  async function handleDelete(copy: CardDoc) {
    setDeletingId(copy.id);
    try {
      await Promise.all(bindersOf(copy).map(b => removeCardFromBinderAndCleanup(b.id, copy.id)));
      await deleteCard(copy.id);
      if (card) {
        const matched = matchTemplateBinders(card, resolvedBinders.filter(b => b.template));
        if (matched.length > 0) await syncTemplateBinders({ binderIds: matched.map(b => b.id) });
      }
      onSaved?.();
    } finally { setDeletingId(null); }
  }

  // ── Karten-Header (wie echte Pokémon-Karte) — als `header`-Slot an `Sheet`
  // übergeben, bleibt dadurch außerhalb des scrollenden Bereichs (shrink-0).
  const header = (
    <div className="flex items-center justify-between px-4 pb-2.5 gap-2 shrink-0">
      {/* Links: Back-Pfeil (wenn auf Evo-Karte navigiert) ODER Evolutionsstufe */}
      {cardStack.length > 0 ? (
        <Button
          variant="secondary" size="sm"
          icon={<ChevronLeft size={16} />}
          onClick={() => setCardStack(s => s.slice(0, -1))}
          className="shrink-0"
        >
          Zurück
        </Button>
      ) : stage ? (
        <span
          className="text-role-label font-bold px-3 py-1 rounded-full shrink-0"
          style={{ background: 'color-mix(in srgb, var(--pokedex-blue) 12%, transparent)', color: 'var(--pokedex-blue)' }}
        >
          {stage}
        </span>
      ) : <span />}

      {/* Mitte: Pokémon-Name */}
      <h2 className="flex-1 text-center text-role-h2 leading-tight tracking-tight truncate">
        <CardNameLabel card={card} />
      </h2>

      {/* Rechts: KP + Typ-Icons */}
      <div className="flex items-center gap-2 shrink-0">
        {card.hp && (
          <span className="text-base font-bold text-muted-foreground">KP {card.hp}</span>
        )}
        {energyTypes.map(t => (
          <EnergyIcon key={t} type={t} size={26} />
        ))}
      </div>
    </div>
  );

  // Portal direkt in document.body: verhindert, dass das Sheet in einem trapped
  // Stacking-Context landet (z.B. Scanner-Root ist selbst `position: fixed`, was
  // IMMER einen eigenen Stacking-Context erzeugt — jedes z-index darin wird nur
  // lokal verglichen und kann nie über Geschwister-Elemente wie die BottomNav
  // hinausragen, egal wie hoch der Wert ist — siehe gleicher Fix in AddToCollectionModal).
  return createPortal((
    <>
      <Sheet open={sheetOpen} onClose={handleClose} header={header} dragToClose bodyClassName="pb-24">

          {/* ── Hero: Kartenbild links · Set-Info rechts ───── */}
          <div className="flex gap-3.5 px-4 pt-1 pb-4">
            {/* Kartenbild mit Zoom — kein Schatten */}
            <div
              className="shrink-0 rounded-[8px] overflow-hidden cursor-zoom-in border"
              style={{ width: 140, borderColor: rarityInfo?.color ?? 'var(--border)' }}
              onClick={() => setZoomed(true)}
            >
              <CardImage
                srcDe={imgSrcDe}
                src={card.imgLarge ?? card.imgSmall}
                alt={card.name}
                width={140}
                height={196}
                className="w-full block"
                style={{ aspectRatio: '2.5/3.5', objectFit: 'cover' }}
              />
            </div>

            {/* Set-Infos */}
            <div className="flex-1 min-w-0 flex flex-col justify-between self-stretch">

              {/* Oben: Logo → Name+Kürzel → Serie (vertikal) */}
              <div className="flex flex-col gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoUrl}
                  alt={setNameDe}
                  className="object-contain object-left"
                  style={{ height: 28, maxWidth: 90 }}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-bold leading-snug truncate">{setNameDe}</span>
                  {isSymbolOnlySet && resolvedMeta?.symbolUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={resolvedMeta.symbolUrl} alt={setCode} className="w-[21px] h-[21px] object-contain shrink-0" />
                  ) : (
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded-md border shrink-0"
                      style={{ color: 'var(--foreground)', borderColor: 'var(--foreground)' }}
                    >
                      {setCode}
                    </span>
                  )}
                </div>
                {card.series && (
                  <div className="text-[11px] text-muted-foreground">
                    {SERIES_NAMES_DE[card.series] ?? card.series}
                  </div>
                )}
              </div>

              {/* Unten: Nummer + Rarity-Pill */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-bold tabular-nums">{numFmt}</span>
                {rarityInfo && (
                  <div
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] font-bold shrink-0"
                    style={{ background: 'var(--secondary)', borderColor: 'var(--border)' }}
                  >
                    <span style={{ color: rarityInfo.color }}>{rarityInfo.symbol}</span>
                    {rarityInfo.label}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── 1 · Details (eigene Glas-Karte) ─────────────── */}
          <div className="glass mx-4 rounded-[18px] overflow-hidden mb-3">
            <AccHeader
              icon={<Info size={16} />}
              title="Details"
              open={openSec.has('details')}
              onToggle={() => toggle('details')}
              border={false}
            />
            {openSec.has('details') && (
              <div className="px-4 pb-4">
                {card.artist && (
                  <p className="text-role-body text-glass-muted pt-3">
                    Illustration: <span className="font-medium text-glass">{card.artist}</span>
                  </p>
                )}
                {species ? (
                  <>
                    {(species.genus || species.isLegendary || species.isMythical) && (
                      <div className={`flex items-center gap-2 mb-3 ${card.artist ? '' : 'pt-3'}`}>
                        {species.genus && (
                          <p className="text-role-body text-glass-muted">{species.genus}</p>
                        )}
                        {(species.isLegendary || species.isMythical) && (
                          <span
                            className="text-role-badge px-2 py-0.5 rounded-full shrink-0"
                            style={{ background: 'rgba(234,179,8,.15)', color: '#ca9a04' }}
                          >
                            {species.isMythical ? 'Mystisch' : 'Legendär'}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {species.height > 0 && (
                        <div className="glass rounded-[14px] px-3 py-2.5">
                          <div className="text-[15px] font-bold">{(species.height / 10).toFixed(1)} m</div>
                          <div className="text-role-label text-glass-muted mt-0.5">Größe</div>
                        </div>
                      )}
                      {species.weight > 0 && (
                        <div className="glass rounded-[14px] px-3 py-2.5">
                          <div className="text-[15px] font-bold">{(species.weight / 10).toFixed(1)} kg</div>
                          <div className="text-role-label text-glass-muted mt-0.5">Gewicht</div>
                        </div>
                      )}
                      {species.region && (
                        <div className="glass rounded-[14px] px-3 py-2.5">
                          <div className="text-[15px] font-bold">{species.region}</div>
                          <div className="text-role-label text-glass-muted mt-0.5">Region</div>
                        </div>
                      )}
                      {card.nationalDexNumber && (
                        <div className="glass rounded-[14px] px-3 py-2.5">
                          <div className="text-[15px] font-bold">#{String(card.nationalDexNumber).padStart(3, '0')}</div>
                          <div className="text-role-label text-glass-muted mt-0.5">Pokédex</div>
                        </div>
                      )}
                    </div>
                    {species.abilities && species.abilities.length > 0 && (
                      <div className="mb-3">
                        <div className="text-role-label text-glass-muted mb-1.5">Fähigkeiten</div>
                        <div className="flex flex-wrap gap-1.5">
                          {species.abilities.map(a => (
                            <span key={a.name} className="glass-inner text-role-label px-2.5 py-1 rounded-full">
                              {a.name}
                              {a.hidden && <span className="text-glass-muted"> (Versteckt)</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {species.stats && (
                      <div className="mb-3">
                        <div className="text-role-label text-glass-muted mb-1.5">Basiswerte</div>
                        <div className="flex flex-col gap-1.5">
                          {STAT_ROWS.map(({ key, label }) => {
                            const value = species.stats![key];
                            return (
                              <div key={key} className="flex items-center gap-2">
                                <span className="text-role-label text-glass-muted w-[92px] shrink-0">{label}</span>
                                <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                                  <div
                                    className="h-full rounded-full"
                                    style={{ width: `${Math.min(100, (value / 255) * 100)}%`, background: 'var(--pokedex-red)' }}
                                  />
                                </div>
                                <span className="text-[12px] font-bold tabular-nums w-[28px] text-right">{value}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {species.flavorText && (
                      <p className="text-role-body text-glass-muted leading-relaxed italic">
                        „{species.flavorText}"
                      </p>
                    )}
                  </>
                ) : speciesLoaded ? (
                  <div className={card.artist ? '' : 'pt-3'}>
                    {card.nationalDexNumber && (
                      <div className="glass rounded-[14px] px-3 py-2.5 w-fit mb-3">
                        <div className="text-[15px] font-bold">#{String(card.nationalDexNumber).padStart(3, '0')}</div>
                        <div className="text-role-label text-glass-muted mt-0.5">Pokédex</div>
                      </div>
                    )}
                    {!card.artist && <p className="text-role-body text-glass-muted">Keine Details verfügbar</p>}
                  </div>
                ) : (
                  <div className={`flex items-center gap-2 ${card.artist ? '' : 'pt-3'}`}>
                    <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin shrink-0" />
                    <p className="text-role-body text-glass-muted">Lade Details…</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── 2 · Evolutionslinie (eigene Glas-Karte) ─────── */}
          <div className="glass mx-4 rounded-[18px] overflow-hidden mb-3">
            <AccHeader
              icon={<Repeat2 size={16} />}
              title="Evolutionslinie"
              open={openSec.has('evo')}
              onToggle={() => toggle('evo')}
              border={false}
            />
            {openSec.has('evo') && (
              <div className="px-4 pb-4">
                {!evoLoaded ? (
                  <div className="flex items-center gap-2 pt-3">
                    <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin shrink-0" />
                    <p className="text-role-body text-glass-muted">Lade Evolutionslinie…</p>
                  </div>
                ) : evoCards.length > 1 || specialForms.length > 0 ? (
                  <>
                    {evoCards.length > 1 && (
                      <EvolutionTree
                        tree={evoTree}
                        cards={evoCards}
                        currentCardId={card.id}
                        onSelect={ec => setCardStack(s => [...s, ec])}
                      />
                    )}
                    {specialForms.length > 0 && (
                      // Ohne Baum darüber (z.B. einstufige Legendäre wie Miraidon)
                      // keinen Trenner/Einzug — die Zeile steht dann für sich allein.
                      <div className={evoCards.length > 1 ? 'mt-2 pt-3 border-t border-[rgba(255,255,255,0.1)]' : 'pt-1'}>
                        <div className="text-role-label text-glass-muted mb-2">Auch verfügbar als</div>
                        <div className="flex gap-2 overflow-x-auto">
                          {specialForms.map(sf => (
                            <button
                              key={sf.id}
                              onClick={() => setCardStack(s => [...s, sf])}
                              className="flex flex-col items-center gap-1 shrink-0 active:scale-95 transition-transform"
                            >
                              <div className="glass-inner rounded-[7px] p-[2px]">
                                <div className="rounded-[4px] overflow-hidden w-10">
                                  <CardImage
                                    srcDe={sf.imgSmallDe}
                                    src={sf.imgSmall}
                                    alt={sf.name}
                                    width={40}
                                    height={56}
                                    className="w-full block"
                                    style={{ aspectRatio: '2.5/3.5', objectFit: 'cover' }}
                                  />
                                </div>
                              </div>
                              <span className="text-[8px] text-center max-w-[52px] truncate text-glass-muted">
                                <CardNameLabel card={sf} secondaryClassName="opacity-80" />
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-role-body text-glass-muted pt-3">Keine Evolutionslinie</p>
                )}
              </div>
            )}
          </div>

          {/* ── 3 · Karten & Preise (eigene Glas-Karte) ─────── */}
          <div className="glass mx-4 rounded-[18px] overflow-hidden mb-3">
            <AccHeader
              icon={<LayoutGrid size={16} />}
              title="Karten & Preise"
              open={openSec.has('cards')}
              onToggle={() => toggle('cards')}
              border={false}
            />
            {openSec.has('cards') && (
              <div>
                {variants.map((variant, vi) => {
                  const copies = ownedCopies.filter(c => c.variant === variant);
                  const isOwned = copies.length > 0;
                  return (
                    <div
                      key={variant}
                      className="px-3 py-2"
                      style={{
                        borderTop: vi > 0 ? '1px solid color-mix(in srgb, var(--border) 50%, transparent)' : 'none',
                      }}
                    >
                      {/* Variant-Zeile: Name + Owned-Badge + Preis + + Button */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-role-title">{VARIANT_LABELS[variant]}</span>
                          {isOwned && (
                            <span
                              className="text-role-badge px-1.5 py-0.5 rounded-full shrink-0"
                              style={{ background: 'color-mix(in srgb, #48bb78 15%, transparent)', color: '#48bb78' }}
                            >
                              ✓
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <CardVariantPrice tcgId={card.id} variant={variant} />
                          <Button
                            variant="primary" accentColor="#2f855a"
                            icon={<Plus strokeWidth={3} />}
                            onClick={() => setAddVariant(variant)}
                            aria-label="Hinzufügen"
                          />
                        </div>
                      </div>

                      {/* Eigene Kopien */}
                      {copies.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          {(() => {
                            // Vorlagen-Binder sortieren automatisch (siehe sync.ts) — kein
                            // sinnvolles manuelles Ziel. Default/Inbox sind bereits als
                            // "Unsortiert" fest im Picker vertreten.
                            const assignableBinders = resolvedBinders.filter(b => !b.template && !b.isDefault && !b.isInbox);
                            return copies.map(copy => {
                            const copyBinders = bindersOf(copy);
                            const isDeleting = deletingId === copy.id;
                            const binder = copyBinders[0];
                            const isDefaultBinder = !binder || !!binder.isDefault;
                            const condColor  = CONDITION_COLOR[copy.condition] ?? 'var(--muted-foreground)';
                            return (
                              <OwnedCopyRow
                                key={copy.id}
                                copy={copy}
                                condColor={condColor}
                                binder={binder}
                                isDefaultBinder={isDefaultBinder}
                                assignableBinders={assignableBinders}
                                isDeleting={isDeleting}
                                onMarkReviewed={async () => {
                                  await markReviewed(copy.id);
                                  window.dispatchEvent(new Event('review-count-changed'));
                                  onSaved?.();
                                }}
                                onMoveToBinder={(targetId) => handleMoveToBinder(copy, targetId)}
                                onDelete={() => handleDelete(copy)}
                              />
                            );
                          });
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Wunschliste — eigenständiger Glas-Button ────── */}
          <div className="mx-4 mb-4">
            <button
              onClick={toggleWishlist}
              className="drawer-panel w-full h-[54px] rounded-[18px] flex items-center justify-center gap-2 text-role-title"
              style={wishlistItem ? { color: '#ef4444' } : undefined}
            >
              <Heart size={19} fill={wishlistItem ? '#ef4444' : 'none'} />
              {wishlistItem ? 'Von Wunschliste entfernen' : 'Auf Wunschliste setzen'}
            </button>
          </div>
      </Sheet>

      {/* ── Zoom-Overlay ──────────────────────────────────────── */}
      {zoomed && (
        <div
          className="fixed inset-0 z-[70] bg-black/95 flex items-center justify-center"
          onClick={() => setZoomed(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgSrcDe || card.imgLarge || card.imgSmall}
            alt={card.name}
            className="rounded-2xl"
            style={{ maxWidth: '90vw', maxHeight: '85dvh', objectFit: 'contain' }}
            onError={e => {
              const target = e.currentTarget;
              const en = card.imgLarge || card.imgSmall;
              if (target.src !== en) target.src = en;
            }}
          />
          <button
            onClick={() => setZoomed(false)}
            className="absolute top-5 right-5 w-11 h-11 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,.15)' }}
          >
            <X size={20} color="#fff" />
          </button>
        </div>
      )}

      {/* ── AddToCollectionModal ──────────────────────────────── */}
      {addVariant !== null && (
        <AddToCollectionModal
          card={card}
          preVariant={addVariant}
          onClose={() => setAddVariant(null)}
          onSaved={() => { setAddVariant(null); onSaved?.(); }}
        />
      )}
    </>
  ), document.body);
}
