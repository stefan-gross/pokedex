'use client';

import { useId } from 'react';
import type { CardInfo } from '@/lib/card-info';
import type { EvolutionTreeNode } from '@/lib/pokeapi';

/** Zeilenhöhe je Blatt-Knoten — gleicher Rhythmus wie der bisherige `h-[93px]`-Pfeil-Abstandshalter. */
const ROW_H = 93;

interface ResolvedNode {
  dexNum: number;
  card: CardInfo;
  children: ResolvedNode[];
}

/**
 * Baut aus der PokéAPI-Baumstruktur + den aufgelösten Karten die render-fertige
 * Struktur. Knoten ohne eigenen Katalog-Print (seltener Edge-Case) werden
 * übersprungen, ihre Kinder rutschen zum Großelternknoten hoch — so verschluckt
 * eine fehlende Zwischenform nicht den ganzen Ast.
 */
function resolveTree(node: EvolutionTreeNode, byDex: Map<number, CardInfo>): ResolvedNode[] {
  const resolvedChildren = node.children.flatMap(child => resolveTree(child, byDex));
  const card = byDex.get(node.dexNum);
  if (!card) return resolvedChildren;
  return [{ dexNum: node.dexNum, card, children: resolvedChildren }];
}

function countLeaves(node: ResolvedNode): number {
  return node.children.length === 0 ? 1 : node.children.reduce((sum, c) => sum + countLeaves(c), 0);
}

function NodeThumb({ card, isCurrent, onSelect }: { card: CardInfo; isCurrent: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={() => { if (!isCurrent) onSelect(); }}
      disabled={isCurrent}
      className="flex flex-col items-center gap-1.5 shrink-0 active:scale-95 transition-transform disabled:cursor-default"
    >
      <div
        className="glass-inner rounded-[9px] p-[3px] w-[68px]"
        style={isCurrent ? { borderColor: 'var(--pokedex-red)', borderWidth: 2 } : undefined}
      >
        <div className="rounded-[6px] overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={card.imgSmall}
            alt={card.name}
            className="w-full block"
            style={{ aspectRatio: '2.5/3.5', objectFit: 'cover' }}
          />
        </div>
      </div>
      <span
        className="text-[10px] text-center max-w-[68px] truncate"
        style={{ color: isCurrent ? 'var(--pokedex-red)' : 'var(--muted-foreground)', fontWeight: isCurrent ? 700 : 400 }}
      >
        {card.name}
      </span>
    </button>
  );
}

function Connector({ totalHeight, childCenters, markerId }: { totalHeight: number; childCenters: number[]; markerId: string }) {
  const marker = (
    <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M2 1L8 5L2 9" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </marker>
  );

  if (childCenters.length === 1) {
    const y = childCenters[0];
    return (
      <svg width="34" height={totalHeight} className="shrink-0">
        <defs>{marker}</defs>
        <line x1="0" y1={y} x2="30" y2={y} stroke="var(--muted-foreground)" strokeOpacity={0.4} strokeWidth="1.5" markerEnd={`url(#${markerId})`} />
      </svg>
    );
  }

  const parentY = totalHeight / 2;
  const first = childCenters[0];
  const last = childCenters[childCenters.length - 1];
  return (
    <svg width="34" height={totalHeight} className="shrink-0">
      <defs>{marker}</defs>
      <path d={`M 0 ${parentY} L 12 ${parentY} M 12 ${first} L 12 ${last}`} fill="none" stroke="var(--muted-foreground)" strokeOpacity={0.3} strokeWidth="1.5" />
      {childCenters.map((y, i) => (
        <line key={i} x1="12" y1={y} x2="30" y2={y} stroke="var(--muted-foreground)" strokeOpacity={0.4} strokeWidth="1.5" markerEnd={`url(#${markerId})`} />
      ))}
    </svg>
  );
}

function Branch({ node, currentCardId, onSelect, markerIdBase }: {
  node: ResolvedNode;
  currentCardId: string;
  onSelect: (card: CardInfo) => void;
  markerIdBase: string;
}) {
  if (node.children.length === 0) {
    return (
      <div style={{ height: ROW_H }} className="flex flex-col justify-center">
        <NodeThumb card={node.card} isCurrent={node.card.id === currentCardId} onSelect={() => onSelect(node.card)} />
      </div>
    );
  }

  const childHeights = node.children.map(c => countLeaves(c) * ROW_H);
  const totalHeight = childHeights.reduce((a, b) => a + b, 0);
  let offset = 0;
  const childCenters = childHeights.map(h => { const c = offset + h / 2; offset += h; return c; });

  return (
    <div className="flex items-stretch">
      <div style={{ height: totalHeight }} className="flex flex-col justify-center shrink-0">
        <NodeThumb card={node.card} isCurrent={node.card.id === currentCardId} onSelect={() => onSelect(node.card)} />
      </div>
      <Connector totalHeight={totalHeight} childCenters={childCenters} markerId={`${markerIdBase}-${node.dexNum}`} />
      <div className="flex flex-col shrink-0">
        {node.children.map((child, i) => (
          <div key={child.dexNum} style={{ height: childHeights[i] }} className="flex items-center">
            <Branch node={child} currentCardId={currentCardId} onSelect={onSelect} markerIdBase={markerIdBase} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function EvolutionTree({ tree, cards, currentCardId, onSelect }: {
  tree: EvolutionTreeNode | null;
  cards: CardInfo[];
  currentCardId: string;
  onSelect: (card: CardInfo) => void;
}) {
  const markerIdBase = useId();
  const byDex = new Map(cards.filter(c => c.nationalDexNumber != null).map(c => [c.nationalDexNumber as number, c]));
  const roots = tree ? resolveTree(tree, byDex) : [];

  if (roots.length === 0) {
    // Baumstruktur (noch) nicht geladen/verfügbar — Fallback: einfache lineare Reihe
    // aus den bereits vorhandenen `evoCards`, exakt wie der bisherige Look.
    return (
      <div className="flex items-start pt-3 pb-1">
        {cards.map((c, i) => (
          <div key={c.id} className="flex items-center">
            {i > 0 && <div style={{ height: ROW_H }} className="flex items-center justify-center min-w-[12px]"><span className="text-muted-foreground text-lg">›</span></div>}
            <NodeThumb card={c} isCurrent={c.id === currentCardId} onSelect={() => onSelect(c)} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 pt-3 pb-1">
      {roots.map(root => (
        <Branch key={root.dexNum} node={root} currentCardId={currentCardId} onSelect={onSelect} markerIdBase={markerIdBase} />
      ))}
    </div>
  );
}
