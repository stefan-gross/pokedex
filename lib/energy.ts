/**
 * Energietyp-Namen (deutsch/Varianten) → kanonisch EN, wie sie `EnergyIcon`
 * (ENERGY_META) und `card.types` erwarten. Wird sowohl beim Katalog-Enrich
 * (Server) als auch beim Rendern (Client) genutzt, damit bereits gespeicherte
 * deutsche Werte (z.B. „Unlicht") beim Anzeigen korrekt aufgelöst werden — ohne
 * den ganzen Katalog neu zu prozessieren. EN-Namen fallen unverändert durch.
 */
export const ENERGY_ALIASES: Record<string, string> = {
  // Deutsche TCGdex-Energienamen
  Farblos: 'Colorless', Feuer: 'Fire', Wasser: 'Water', Pflanze: 'Grass',
  Elektro: 'Lightning', Psycho: 'Psychic', Kampf: 'Fighting', Unlicht: 'Darkness',
  Metall: 'Metal', Drache: 'Dragon', Fee: 'Fairy',
  // Fallback-Varianten (Videospiel-/Alt-Namen), falls die Quelle abweicht
  Finsternis: 'Darkness', Stahl: 'Metal', Blitz: 'Lightning', Psychisch: 'Psychic',
};

export function normalizeEnergy(name: string): string {
  return ENERGY_ALIASES[name] ?? name;
}
