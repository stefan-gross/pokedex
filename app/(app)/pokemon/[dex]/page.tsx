'use client';

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronDown, ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { pokemonArtworkUrl } from '@/lib/binder-icons';
import { getCardsByDexNumberRest } from '@/lib/firestore/catalog-rest';
import { fetchSpeciesDetail, type SpeciesDetail, type EvoStep } from '@/lib/pokemon/species-detail';
import type { PokemonProfile } from '@/lib/firestore/pokemon';
import SPECIES_JSON from '@/lib/pokemon-species-de.json';

const SPECIES = SPECIES_JSON as { dex: number; name: string }[];
const NAME_BY_DEX = new Map(SPECIES.map(s => [s.dex, s.name]));
const speciesName = (dex: number) => NAME_BY_DEX.get(dex) ?? `#${dex}`;
const padDex = (dex: number) => `#${String(dex).padStart(4, '0')}`;
const fmtM = (dm: number) => `${(dm / 10).toLocaleString('de', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m`;
const fmtKg = (hg: number) => `${(hg / 10).toLocaleString('de', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`;

/** Entwicklungsstufe → TCG-Label (Basis / Phase 1 / Phase 2 …); -1 = unbekannt. */
const stageLabel = (stage: number) => stage < 0 ? null : stage === 0 ? 'Basis' : `Phase ${stage}`;

/** Typ-Farben (deutsche Typnamen) für farbige Typ-Chips. */
const TYPE_COLOR: Record<string, string> = {
  Normal: '#9FA19F', Feuer: '#E62829', Wasser: '#2980EF', Elektro: '#FAC000', Pflanze: '#3FA129',
  Eis: '#3DCEF3', Kampf: '#FF8000', Gift: '#9141CB', Boden: '#915121', Flug: '#81B9EF',
  Psycho: '#EF4179', Käfer: '#91A119', Gestein: '#AFA981', Geist: '#704170', Drache: '#5060E1',
  Unlicht: '#624D4E', Stahl: '#60A1B8', Fee: '#EF70EF',
};

/** Gewichtung der Spezies-Unterthemen (allgemein für alle Pokémon): bekannte
 *  Themen zuerst in dieser Reihenfolge, alles andere danach (Original-Reihenfolge). */
const SPEZIES_PRIORITY: RegExp[] = [/aussehen|körperbau/i, /verhalten|lebensraum/i, /herkunft|namens/i, /zucht|entwicklung/i];
const speziesRank = (heading: string) => {
  const i = SPEZIES_PRIORITY.findIndex(re => re.test(heading));
  return i === -1 ? SPEZIES_PRIORITY.length : i;
};
function orderSpezies<T extends { heading: string }>(list: T[]): T[] {
  return list
    .map((s, i) => ({ s, i }))
    .sort((a, b) => speziesRank(a.s.heading) - speziesRank(b.s.heading) || a.i - b.i)
    .map(x => x.s);
}

/** gender_rate (-1..8, Weibchen-Achtel) → deutsches Label. */
function genderLabel(rate: number | null): string | null {
  if (rate == null) return null;
  if (rate < 0) return 'Geschlechtslos';
  const female = Math.round((rate / 8) * 100);
  if (female === 0) return '100 % ♂';
  if (female === 100) return '100 % ♀';
  return `${100 - female} % ♂ · ${female} % ♀`;
}


/** Aus dem Katalog übernommene (deutsche) Textfakten — bevorzugt vor PokéAPI. */
interface CatalogFacts {
  genusDe?: string; flavorTextDe?: string; heightDm?: number; weightHg?: number; region?: string;
  evolutionFamily?: number[];
}

/** Ein Glas-Panel als Akkordeon: initial nur die Überschriften; Klick klappt eine
 *  Sektion auf — es ist immer nur EINE gleichzeitig offen (Single-Open). */
function Accordion({ items }: { items: { key: string; title: string; content: ReactNode }[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (!items.length) return null;
  return (
    <div className="glass rounded-[18px] overflow-hidden">
      {items.map((it, i) => {
        const open = openKey === it.key;
        return (
          <div key={it.key} className={i > 0 ? 'border-t border-[rgba(46,46,50,0.08)] dark:border-white/[.08]' : ''}>
            <button
              onClick={() => setOpenKey(k => (k === it.key ? null : it.key))}
              aria-expanded={open}
              className="w-full flex items-center justify-between gap-2 px-4 min-h-[52px] text-left"
            >
              <span className="text-role-title text-glass">{it.title}</span>
              <ChevronDown
                size={18}
                className="text-glass-muted transition-transform duration-200 shrink-0"
                style={{ transform: open ? 'rotate(180deg)' : 'none' }}
              />
            </button>
            {open && <div className="px-4 pb-4">{it.content}</div>}
          </div>
        );
      })}
    </div>
  );
}

export default function PokemonDetailPage() {
  const params = useParams<{ dex: string }>();
  const dex = useMemo(() => {
    const n = parseInt(params.dex, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [params.dex]);

  const name = speciesName(dex);
  const [detail, setDetail] = useState<SpeciesDetail | null>(null);
  const [cat, setCat] = useState<CatalogFacts | null>(null);
  const [profile, setProfile] = useState<PokemonProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [artOk, setArtOk] = useState(true);

  useEffect(() => {
    if (!dex) { setProfileLoading(false); return; }
    setProfileLoading(true);
    setArtOk(true);
    setDetail(null);
    setCat(null);
    setProfile(null);
    let alive = true;

    // Firestore-First: deutsche Textfakten + Evolutionslinie aus dem Katalog.
    getCardsByDexNumberRest(dex, 60)
      .then(cards => {
        if (!alive) return;
        const withFacts = cards.find(c => c.genusDe || c.flavorTextDe);
        const withFam = cards.find(c => c.evolutionFamily?.length);
        setCat({
          genusDe: withFacts?.genusDe,
          flavorTextDe: withFacts?.flavorTextDe,
          heightDm: withFacts?.heightDm,
          weightHg: withFacts?.weightHg,
          region: withFacts?.region,
          evolutionFamily: withFam?.evolutionFamily,
        });
      })
      .catch(() => { if (alive) setCat({}); });

    // PokéAPI: Typen/Fähigkeiten/Evolution + Fallback für die Textfakten.
    fetchSpeciesDetail(dex)
      .then(d => { if (alive) setDetail(d); })
      .catch(() => {});

    // Angereichertes Profil (allgemeiner Text + TCG-Zusammenfassung) — serverseitig
    // aus PokéWiki via Gemini zusammengesetzt und gecacht (erste Ansicht kann dauern).
    fetch(`/api/pokemon/${dex}`)
      .then(r => r.ok ? r.json() : { profile: null })
      .then(d => { if (alive) setProfile(d.profile ?? null); })
      .catch(() => {})
      .finally(() => { if (alive) setProfileLoading(false); });

    return () => { alive = false; };
  }, [dex]);

  // Effektive Fakten: Katalog (deutsch) bevorzugt, PokéAPI als Quelle/Fallback.
  const genus = cat?.genusDe || detail?.genus || '';
  const flavor = cat?.flavorTextDe || detail?.flavorText || '';
  const height = cat?.heightDm ?? detail?.height ?? 0;
  const weight = cat?.weightHg ?? detail?.weight ?? 0;
  const region = cat?.region || detail?.region || '';
  const types = detail?.typesDe ?? [];
  const abilities = detail?.abilities ?? [];
  // Allgemeiner Text: bevorzugt die Gemini-Zusammenfassung. Solange das Profil noch
  // lädt, NICHT den kurzen PokéAPI-Text zeigen (sonst sichtbarer Text-Tausch) — erst
  // als Fallback, wenn das Profil fertig geladen ist und keinen general-Text hat.
  const general = profile?.general ?? '';
  // Evolutionslinie: PokéAPI (mit Stufe) bevorzugt; Katalog-Familie nur als
  // Fallback (ohne bekannte Stufe → stage -1, kein Badge).
  const evolution: EvoStep[] = detail?.evolution?.length
    ? detail.evolution
    : (cat?.evolutionFamily ?? []).map(d => ({ dex: d, stage: -1 }));

  const badge = detail?.isMythical ? 'Mysteriöses Pokémon' : detail?.isLegendary ? 'Legendäres Pokémon' : null;
  const facts: [string, string | null][] = [
    ['Kategorie', genus || null],
    ['Typ', types.length ? types.join(' · ') : null],
    ['Größe', height ? fmtM(height) : null],
    ['Gewicht', weight ? fmtKg(weight) : null],
    ['Region', region || null],
    ['Fähigkeiten', abilities.length ? abilities.map(a => a.name + (a.hidden ? ' (versteckt)' : '')).join(', ') : null],
    ['Geschlecht', genderLabel(detail?.genderRate ?? null)],
    ['Fangrate', detail?.catchRate != null ? String(detail.catchRate) : null],
    ['Status', badge],
  ];

  return (
    <div className="min-h-screen px-3 pt-3 pb-4 md:max-w-3xl md:mx-auto">
      {/* Alles in EINEM Panel */}
      <section className="glass rounded-[20px] px-4 pt-2 pb-4 space-y-4">
        <Button variant="ghost" href="/collection" className="px-0 -ml-1" icon={<ChevronLeft size={18} strokeWidth={2} />}>
          Zurück
        </Button>

        {/* Kopf: Name + Pokédex-Nr. gleichwertig in einer Zeile */}
        <div className="flex items-baseline gap-2 flex-wrap">
          <h1 className="text-role-h1 text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.2)] leading-tight">{name}</h1>
          <span className="text-role-h1 text-glass-muted tabular-nums leading-tight">{padDex(dex)}</span>
        </div>

        {/* Allgemeiner Text (mehrere Absätze) über die volle Breite */}
        {general ? (
          <div className="space-y-2">
            {general.split(/\n{2,}/).map((para, i) => (
              <p key={i} className="text-role-body text-glass whitespace-pre-line">{para}</p>
            ))}
          </div>
        ) : profileLoading ? (
          <p className="text-role-body text-glass-muted">Wird geladen …</p>
        ) : flavor ? (
          <p className="text-role-body text-glass whitespace-pre-line">{flavor}</p>
        ) : (
          <p className="text-role-body text-glass-muted">Keine Beschreibung verfügbar.</p>
        )}

        {/* Bild links + Fakten rechts (Typ als Chips, Status als Badge) */}
        {(types.length > 0 || facts.some(([, v]) => !!v)) && (
          <div className="flex gap-4">
            <div className="w-32 shrink-0 flex items-start justify-center aspect-square">
              {artOk ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={pokemonArtworkUrl(dex)}
                  alt={name}
                  className="w-full h-full object-contain"
                  onError={() => setArtOk(false)}
                />
              ) : null}
            </div>
            <div className="flex-1 min-w-0 self-center space-y-2">
              {/* Typ-Chips + optionaler Status-Badge */}
              {(types.length > 0 || badge) && (
                <div className="flex flex-wrap gap-1.5">
                  {types.map(t => (
                    <span
                      key={t}
                      className="px-2 py-0.5 rounded-full text-[11px] font-semibold text-white leading-none"
                      style={{ background: TYPE_COLOR[t] ?? 'var(--text-muted)' }}
                    >
                      {t}
                    </span>
                  ))}
                  {badge && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold leading-none text-glass border border-[rgba(120,130,150,0.35)]">
                      {badge}
                    </span>
                  )}
                </div>
              )}
              {/* Übrige Fakten als Zeilen mit dezenten Trennlinien */}
              <dl className="grid grid-cols-1">
                {facts.filter(([k, v]) => v && k !== 'Typ' && k !== 'Status').map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 text-role-label py-1 border-b border-[rgba(46,46,50,0.08)] dark:border-white/[.08] last:border-0">
                    <dt className="text-glass-muted shrink-0">{k}</dt>
                    <dd className="text-glass text-right min-w-0">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}

        {/* Entwicklung — wichtig, daher weit oben und immer sichtbar (kein Panel) */}
        {evolution.length > 1 && (
          <div>
            <h2 className="text-role-h2 text-glass mb-2">Entwicklung</h2>
            <div className="flex items-start gap-1 overflow-x-auto -mx-1 px-1 pb-1">
              {evolution.map((step, i) => {
                const active = step.dex === dex;
                const label = stageLabel(step.stage);
                return (
                  <div key={`${step.dex}-${i}`} className="flex items-center gap-1 shrink-0">
                    {i > 0 && <ChevronRight size={18} className="text-glass-muted shrink-0" />}
                    <Link
                      href={`/pokemon/${step.dex}`}
                      className={`relative flex flex-col items-center gap-1 rounded-[8px] p-2 w-24 shrink-0 ${active ? 'glass' : 'glass-inner'} active:scale-[.97] transition-transform`}
                      aria-current={active ? 'page' : undefined}
                    >
                      {label && (
                        <span className="absolute top-0 left-0 px-1.5 py-0.5 rounded-tl-[8px] rounded-br-[8px] text-[10px] italic font-bold leading-none text-glass-muted bg-[rgba(120,130,150,0.18)]">
                          {label}
                        </span>
                      )}
                      <span className="w-full aspect-square flex items-center justify-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={pokemonArtworkUrl(step.dex)}
                          alt={speciesName(step.dex)}
                          loading="lazy"
                          className="w-full h-full object-contain"
                          onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                        />
                      </span>
                      <span className="text-role-label text-glass truncate max-w-full text-center leading-tight">{speciesName(step.dex)}</span>
                      <span className="text-role-badge text-glass-muted tabular-nums">{padDex(step.dex)}</span>
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Ein Panel als Akkordeon: Spezies-Unterthemen (gewichtet) + Sammelkartenspiel */}
        <Accordion
          items={[
            ...orderSpezies(profile?.spezies ?? []).map(s => ({
              key: s.heading,
              title: s.heading,
              content: <p className="text-role-body text-glass leading-relaxed whitespace-pre-line">{s.text}</p>,
            })),
            ...(profile?.tcg ? [{
              key: '__tcg',
              title: 'Im Sammelkartenspiel',
              content: <p className="text-role-body text-glass leading-relaxed whitespace-pre-line">{profile.tcg}</p>,
            }] : []),
          ]}
        />

        {/* Karten dieses Pokémon → gefilterter Karten-Tab */}
        <Button
          variant="primary"
          className="w-full"
          href={`/collection?q=${encodeURIComponent(`#${dex}`)}`}
          icon={<LayoutGrid size={18} />}
        >
          Karten anzeigen
        </Button>

        {/* Quellen / Lizenz */}
        <p className="pt-3 border-t border-[rgba(46,46,50,0.1)] dark:border-white/[.12] text-[11px] leading-relaxed text-glass-muted">
          {profile?.sources?.length ? (
            <>
              Texte (zusammengefasst):{' '}
              {profile.sources.map((s, i) => (
                <span key={s.url}>
                  {i > 0 && ', '}
                  {/* eslint-disable-next-line react/jsx-no-target-blank */}
                  <a href={s.url} target="_blank" rel="noopener" className="underline">{s.name}</a>
                </span>
              ))}
              {' '}(CC BY-SA 3.0).{' '}
            </>
          ) : null}
          Daten:{' '}
          {/* eslint-disable-next-line react/jsx-no-target-blank */}
          <a href="https://pokeapi.co" target="_blank" rel="noopener" className="underline">PokéAPI</a>.
          Artwork & Namen: Pokémon © Nintendo / Game Freak / The Pokémon Company.
        </p>
      </section>
    </div>
  );
}
