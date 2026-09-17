'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { pokemonArtworkUrl } from '@/lib/binder-icons';
import { getCardsByDexNumberRest } from '@/lib/firestore/catalog-rest';
import { fetchSpeciesDetail, type SpeciesDetail, type EvoStep } from '@/lib/pokemon/species-detail';
import SPECIES_JSON from '@/lib/pokemon-species-de.json';

const SPECIES = SPECIES_JSON as { dex: number; name: string }[];
const NAME_BY_DEX = new Map(SPECIES.map(s => [s.dex, s.name]));
const speciesName = (dex: number) => NAME_BY_DEX.get(dex) ?? `#${dex}`;
const padDex = (dex: number) => `#${String(dex).padStart(4, '0')}`;
const fmtM = (dm: number) => `${(dm / 10).toLocaleString('de', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m`;
const fmtKg = (hg: number) => `${(hg / 10).toLocaleString('de', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`;

/** Entwicklungsstufe → TCG-Label (Basis / Phase 1 / Phase 2 …); -1 = unbekannt. */
const stageLabel = (stage: number) => stage < 0 ? null : stage === 0 ? 'Basis' : `Phase ${stage}`;

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

export default function PokemonDetailPage() {
  const params = useParams<{ dex: string }>();
  const dex = useMemo(() => {
    const n = parseInt(params.dex, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [params.dex]);

  const name = speciesName(dex);
  const [detail, setDetail] = useState<SpeciesDetail | null>(null);
  const [cat, setCat] = useState<CatalogFacts | null>(null);
  const [wiki, setWiki] = useState<{ text: string; url: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [artOk, setArtOk] = useState(true);

  useEffect(() => {
    if (!dex) { setLoading(false); return; }
    setLoading(true);
    setArtOk(true);
    setDetail(null);
    setCat(null);
    setWiki(null);
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
      .then(d => { if (alive) { setDetail(d); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });

    // PokéWiki: deutscher Fließtext (Intro) als Hauptbeschreibung (serverseitig).
    fetch(`/api/pokemon/${dex}/wiki`)
      .then(r => r.ok ? r.json() : { intro: null })
      .then(d => { if (alive) setWiki(d.intro ?? null); })
      .catch(() => {});

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
  // Beschreibung: PokéWiki-Fließtext bevorzugt, sonst kurzer PokéAPI-/Katalog-Text.
  const description = wiki?.text || flavor;
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

        {/* Header wie Set-Header: großes Artwork links, Name + Dex-Nr. rechts */}
        <div className="flex items-center gap-4">
          <div className="w-36 shrink-0 flex items-center justify-center aspect-square">
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
          <div className="min-w-0">
            <h1 className="text-role-h1 text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.2)] leading-tight">{name}</h1>
            <p className="text-role-label text-glass-muted tabular-nums mt-1">{padDex(dex)}</p>
          </div>
        </div>

        {/* Beschreibung (PokéWiki-Fließtext) über die volle Breite */}
        {description ? (
          <p className="text-role-body text-glass whitespace-pre-line">{description}</p>
        ) : loading ? (
          <p className="text-role-body text-glass-muted">Wird geladen …</p>
        ) : (
          <p className="text-role-body text-glass-muted">Keine Beschreibung verfügbar.</p>
        )}

        {/* Strukturierte Fakten */}
        {facts.some(([, v]) => !!v) && (
          <dl className="grid grid-cols-1 gap-y-1.5">
            {facts.filter(([, v]) => !!v).map(([k, v]) => (
              <div key={k} className="flex gap-2 text-role-label">
                <dt className="text-glass-muted w-28 shrink-0">{k}</dt>
                <dd className="text-glass min-w-0">{v}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* Entwicklung — Kacheln mit Stufen-Badge, dazwischen ein Pfeil */}
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
                        <span className="absolute top-0 left-0 px-1.5 py-0.5 rounded-br-lg rounded-tl-[8px] text-[10px] italic font-bold leading-none text-glass-muted bg-[rgba(120,130,150,0.18)]">
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
          {wiki && (
            <>
              Beschreibung:{' '}
              {/* eslint-disable-next-line react/jsx-no-target-blank */}
              <a href={wiki.url} target="_blank" rel="noopener" className="underline">PokéWiki</a> (CC BY-SA 3.0).{' '}
            </>
          )}
          Daten:{' '}
          {/* eslint-disable-next-line react/jsx-no-target-blank */}
          <a href="https://pokeapi.co" target="_blank" rel="noopener" className="underline">PokéAPI</a>.
          Artwork & Namen: Pokémon © Nintendo / Game Freak / The Pokémon Company.
        </p>
      </section>
    </div>
  );
}
