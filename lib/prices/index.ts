export type { PriceResult, PriceVariant, PriceProvider, PriceCurrency, IPriceProvider } from './types';

// Swap this import to switch providers globally:
// import { cardmarketProvider as activeProvider } from './cardmarket';
// import { pokepriceProvider as activeProvider } from './pokeprice';
import { tcgPlayerProvider as activeProvider } from './tcgplayer';

export { activeProvider };
