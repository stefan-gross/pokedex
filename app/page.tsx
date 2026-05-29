import Link from 'next/link';

export default function DashboardPage() {
  return (
    <div className="px-4 pt-6 pb-4 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pokédex</h1>
          <p className="text-sm text-muted-foreground">Deine Sammlung</p>
        </div>
      </div>

      {/* Stat Tiles */}
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Karten gesamt" sub="+12 diese Woche" value="847" accent />
        <StatTile label="Sammlungswert" sub="trendPrice" value="€ 1.240" />
        <StatTile label="Sets" sub="3 vollständig" value="12" />
        <StatTile label="Wunschliste" sub="2 günstig" value="34" />
      </div>

      {/* Set-Vollständigkeit */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Set-Vollständigkeit</h2>
          <Link href="/collection" className="text-xs" style={{ color: 'var(--pokedex-red)' }}>Alle</Link>
        </div>
        <div className="space-y-2">
          <SetProgress name="Scarlet & Violet" owned={74} total={94} />
          <SetProgress name="Paldea Evolved" owned={31} total={93} />
          <SetProgress name="Obsidian Flames" owned={8} total={197} />
        </div>
      </section>

      {/* Zuletzt hinzugefügt */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Zuletzt hinzugefügt</h2>
          <Link href="/collection" className="text-xs" style={{ color: 'var(--pokedex-red)' }}>Alle</Link>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {[
            { name: 'Pikachu', number: '049/198', img: 'https://images.pokemontcg.io/sv1/49.png' },
            { name: 'Charizard ex', number: '125/197', img: 'https://images.pokemontcg.io/sv3/125.png' },
            { name: 'Mewtwo', number: '150/165', img: 'https://images.pokemontcg.io/mew/150.png' },
            { name: 'Gardevoir ex', number: '086/193', img: 'https://images.pokemontcg.io/sv2/86.png' },
          ].map((card) => (
            <RecentCard key={card.name} {...card} />
          ))}
        </div>
      </section>
    </div>
  );
}

function StatTile({ label, sub, value, accent }: { label: string; sub: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 flex items-center justify-between gap-2 min-h-[68px]">
      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div className="text-xs text-muted-foreground font-medium">{label}</div>
        <div className="text-[10px] text-muted-foreground/60 mt-1">{sub}</div>
      </div>
      <div
        className="text-[28px] font-extrabold leading-none shrink-0"
        style={{ color: accent ? 'var(--pokedex-red)' : undefined }}
      >
        {value}
      </div>
    </div>
  );
}

function SetProgress({ name, owned, total }: { name: string; owned: number; total: number }) {
  const pct = Math.round((owned / total) * 100);
  return (
    <div className="bg-card border border-border rounded-xl px-3 py-2.5">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-sm font-medium">{name}</span>
        <span className="text-xs text-muted-foreground">{owned}/{total}</span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: 'var(--pokedex-red)' }}
        />
      </div>
    </div>
  );
}

function RecentCard({ name, number, img }: { name: string; number: string; img: string }) {
  return (
    <Link href="/collection" className="shrink-0 flex flex-col items-center gap-1">
      <div className="w-[72px] h-[100px] rounded-lg overflow-hidden bg-secondary border border-border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img} alt={name} className="w-full h-full object-cover" />
      </div>
      <span className="text-[10px] text-muted-foreground">{number}</span>
    </Link>
  );
}
