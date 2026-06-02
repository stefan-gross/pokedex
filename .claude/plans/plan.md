# Pokémon-Kartensammlung App — Implementierungsplan

## Context

Aufbau einer vollständigen Sammlungsverwaltungs-App für Pokémon-Karten im leeren Verzeichnis `/Users/sgr/Entwicklung/AI/pokedex`. Die App soll Karten via Kamera erfassen, in Mappen/Boxen verwalten, Marktpreise anzeigen, eine Pokémon-Wiki bieten und Wunschlisten als PDF exportieren können.

---

## Tech Stack

| Bereich | Technologie |
|---------|-------------|
| Framework | **Next.js 15** (App Router, TypeScript) |
| UI | **Tailwind CSS + shadcn/ui** |
| Datenbank | **Firebase Firestore** (Cloud NoSQL, Echtzeit-Sync) |
| Bilder | **pokemontcg.io API** (offizielle Kartenbilder, via Next.js Image-Optimierung gecacht) |
| Karten-API | **pokemontcg.io** (kostenfrei, API-Key) |
| Pokémon-Wiki | **PokéAPI** (pokeapi.co, kein Auth) |
| Preise | **TCGPlayer/Cardmarket** via PokéWallet API |
| KI-Erkennung | **Google Gemini Vision** (AI Studio API-Key) |
| PDF | **@react-pdf/renderer** |
| Scanner | Browser `MediaDevices` API (Kamera) |

---

## Vorgeschlagene Zusatz-Features

- **Kartenzustand** (Mint, Near Mint, Lightly Played, etc.)
- **Duplikat-Zähler** (Anzahl je Karte)
- **Set-Vollständigkeit** (X/Y Karten je Set)
- **Sammlungsstatistiken** (Gesamtwert, Wertentwicklung)
- **Tausch-Liste** (separate Liste für Karten die getauscht werden sollen)
- **Preisalerts** (Email/Browser-Notification wenn Wunschlistenkarte unter Preis fällt)
- **Sprach-Filter** (DE/EN/JP Karten unterscheiden)

---

## Projektstruktur

```
pokedex/
├── app/
│   ├── layout.tsx                    # Root Layout + Navigation
│   ├── page.tsx                      # Dashboard (Statistiken, Schnellzugriff)
│   ├── scanner/page.tsx              # Kamera-Scanner + KI-Erkennung
│   ├── collection/
│   │   ├── page.tsx                  # Sammlung (Grid/Liste, Filter)
│   │   └── [id]/page.tsx             # Kartendetail
│   ├── binders/
│   │   ├── page.tsx                  # Mappen/Boxen Übersicht
│   │   └── [id]/page.tsx             # Einzelne Mappe (drag & drop)
│   ├── wishlist/
│   │   ├── page.tsx                  # Wunschlisten Übersicht
│   │   └── [id]/page.tsx             # Einzelne Wunschliste
│   ├── pokedex/
│   │   ├── page.tsx                  # Pokémon-Wiki (Suche, Filter)
│   │   └── [nameOrId]/page.tsx       # Pokémon-Detail (Stats, Typen, Evolution)
│   ├── prices/page.tsx               # Marktpreise & Trends
│   └── api/
│       ├── cards/route.ts            # CRUD eigene Karten
│       ├── binders/route.ts          # CRUD Mappen
│       ├── wishlist/route.ts         # CRUD Wunschlisten
│       ├── scan/route.ts             # Claude Vision → Kartenerkennung
│       ├── tcg/route.ts              # pokemontcg.io Proxy (caching)
│       ├── pokemon/route.ts          # PokéAPI Proxy (caching)
│       ├── prices/route.ts           # Preisabfrage + History
│       └── pdf/route.ts             # PDF-Generierung
├── components/
│   ├── ui/                           # shadcn/ui Komponenten
│   ├── scanner/CameraCapture.tsx     # Kamera-Komponente
│   ├── scanner/CardScanResult.tsx    # Erkennungsergebnis + Bestätigung
│   ├── card/CardGrid.tsx             # Sammlungs-Grid
│   ├── card/CardDetail.tsx           # Kartendetail-Modal
│   ├── card/CardFilters.tsx          # Filter (Set, Typ, Seltenheit, etc.)
│   ├── binder/BinderView.tsx         # Mappenansicht mit Slots
│   ├── wishlist/WishlistCard.tsx
│   └── pdf/CollectionDocument.tsx    # react-pdf Dokument
├── lib/
│   ├── firebase.ts                   # Firebase Client + Admin SDK Init
│   ├── firestore/
│   │   ├── cards.ts                  # Cards Collection CRUD
│   │   ├── binders.ts                # Binders Collection CRUD
│   │   ├── wishlist.ts               # Wishlist Collection CRUD
│   │   └── prices.ts                 # PriceHistory Collection
│   ├── pokemon-tcg.ts                # pokemontcg.io API-Wrapper
│   ├── pokeapi.ts                    # PokéAPI-Wrapper mit Cache
│   ├── gemini-vision.ts              # Google AI Studio Bildanalyse (nur für Scanner)
│   └── pdf.ts                        # PDF-Generierung Hilfsfunktionen
├── public/
├── .env.local                        # API Keys (Firebase, Gemini, pokemontcg)
└── package.json
```

---

## Firestore Collections & Datenstruktur

Kein starres Schema — Firestore ist NoSQL. Struktur als TypeScript-Typen:

```typescript
// Collection: "cards"
interface CardDoc {
  id: string;                  // Firestore auto-ID
  tcgId?: string;              // pokemontcg.io ID
  name: string;
  setId: string;
  setName: string;
  series?: string;
  number: string;
  rarity?: string;
  pokemonType?: string;        // Fire, Water, etc.
  supertype?: string;          // Pokémon, Trainer, Energy
  condition: "NM"|"LP"|"MP"|"HP"|"Poor";
  language: "de"|"en"|"jp";
  isFoil: boolean;
  isFirstEd: boolean;
  quantity: number;
  tcgImageUrl?: string;        // Offizielle Karten-URL von pokemontcg.io
  notes?: string;
  addedAt: Timestamp;
  updatedAt: Timestamp;
}

// Collection: "binders"
interface BinderDoc {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  sortOrder: number;
  cardIds: string[];           // geordnete Karten-IDs
  createdAt: Timestamp;
}

// Collection: "wishlists"
interface WishlistDoc {
  id: string;
  name: string;
  description?: string;
  createdAt: Timestamp;
  items: WishlistItem[];       // embedded subcollection
}

interface WishlistItem {
  tcgId?: string;
  name: string;
  setName?: string;
  maxPrice?: number;
  priority: 1|2|3;
  notes?: string;
  acquired: boolean;
}

// Subcollection: "cards/{cardId}/priceHistory"
interface PriceHistoryDoc {
  price: number;
  currency: "EUR"|"USD";
  source: "cardmarket"|"tcgplayer";
  trend?: "average"|"trend"|"low"|"high";
  recordedAt: Timestamp;
}
```

---

## Auth-Integration (vor Phase 1 abzuschließen)

### Ausgangslage
Die contracts-app (`/Users/sgr/Entwicklung/AI/contracts-app`) hat bereits die fertige Auth-Infrastruktur:
- Firebase Email/Password Auth
- Session-Cookie `__session` auf **`.smartfamilyzone.de`** (alle Subdomains)
- JWT-Verifikation via `jose` (kein Service Account nötig)
- `AuthRefresh`-Komponente für automatische Token-Erneuerung alle ~55 Min

**SSO-Effekt**: Login in einer App → automatisch eingeloggt in allen `*.smartfamilyzone.de`-Apps.

### Zu entfernen (falsch hinzugefügt)
- `components/AuthProvider.tsx` — löschen
- `lib/firebase.ts` — `ensureAuth()`, `signInAnonymously`, `onAuthStateChanged` entfernen
- `app/layout.tsx` — `<AuthProvider>` entfernen

### Dateien 1:1 aus contracts-app kopieren
| Ziel | Quelle |
|------|--------|
| `lib/auth.ts` | `contracts-app/lib/auth.ts` |
| `lib/firebase/client.ts` | `contracts-app/lib/firebase/client.ts` |
| `middleware.ts` | `contracts-app/middleware.ts` |
| `app/api/auth/login/route.ts` | `contracts-app/app/api/auth/login/route.ts` |
| `app/api/auth/logout/route.ts` | `contracts-app/app/api/auth/logout/route.ts` |
| `components/AuthRefresh.tsx` | `family-hub/components/AuthRefresh.tsx` (Import-Pfad anpassen) |

### Angepasste Dateien
- `lib/firebase.ts` → **löschen**, stattdessen `lib/firebase/client.ts` verwenden; alle Imports in `lib/firestore/*.ts` aktualisieren
- `app/login/page.tsx` — Gleiche Logik wie contracts-app, aber Pokédex-Branding (dark, mobile-first)
- `app/layout.tsx` — `<AuthRefresh />` direkt einbinden (kein Provider-Wrapper)

### .env.local ergänzen
```
NEXT_PUBLIC_DOMAIN=smartfamilyzone.de
```

### Abhängigkeit
```bash
npm install jose
```

### Firestore Rules
Keine Änderung nötig — `request.auth != null` wird durch echten Firebase-User erfüllt.

### Verifikation
1. Dev-Server → `localhost:3000` leitet zu `/login` weiter
2. Login mit Firebase-Credentials → Dashboard erscheint
3. Cookie `__session` in DevTools sichtbar
4. Production: Login in contracts-app → pokedex automatisch eingeloggt (SSO)

---

## Implementierungsphasen

### Phase 0 — UI-Mockups (vor der Umsetzung)
Interaktive HTML-Mockups für alle Hauptansichten, bevor echte Komponenten gebaut werden:
- Dashboard (Statistiken, Schnellzugriff)
- Sammlung / Kartenraster mit Filterleiste
- Scanner-Ansicht (Kamera + Erkennungsergebnis)
- Mappe/Binder-Ansicht
- Wunschliste
- Pokémon-Wiki-Detailseite
- Marktpreise-Übersicht

### Phase 1 — Projektgerüst & Firebase
1. `npx create-next-app@latest` mit TypeScript, Tailwind, App Router
2. Firebase-Projekt erstellen + Firestore + Storage aktivieren
3. `firebase` + `firebase-admin` SDK installieren und initialisieren
4. shadcn/ui initialisieren
5. Navigation + Layout-Komponente
6. `.env.local` mit API Keys (Firebase, Gemini AI Studio, pokemontcg.io)

### Phase 2 — Scanner & Karteneingabe
1. `CameraCapture.tsx` — Browser MediaDevices API, Foto schießen
2. API Route `/api/scan` — Foto (base64) an **Gemini Vision** (Google AI Studio) → Kartenname + Set extrahieren; Foto wird danach **verworfen**, nicht gespeichert
3. Abgleich gegen pokemontcg.io API → Kartenvorschlag mit offiziellem Bild + Metadaten
4. Bestätigungsformular (Zustand, Sprache, Anzahl, Mappe zuordnen)
5. Karte mit `tcgImageUrl` (API-Bild) in **Firestore** speichern

### Phase 3 — Sammlung & Filterung
1. `CardGrid.tsx` — Raster-Ansicht mit Lazy Loading
2. `CardFilters.tsx` — Filter nach Set, Typ, Seltenheit, Zustand, Sprache
3. Volltextsuche über Name
4. Kartendetail-Seite (Foto, alle Metadaten, Preishistorie)
5. Inline-Bearbeitung (Zustand, Anzahl, Notizen)

### Phase 4 — Mappen & Boxen
1. Binder CRUD (erstellen, umbenennen, löschen)
2. `BinderView.tsx` — visuelle Mappenansicht (9/12/16 Karten pro Seite)
3. Karten per Drag & Drop in Mappen verschieben
4. Mappe als PDF exportieren

### Phase 5 — Pokémon-Wiki
1. PokéAPI-Integration (species, types, abilities, evolution chain)
2. Pokémon-Suchseite mit Typ-Filter
3. Pokémon-Detailseite (Stats, Moves, Evolutions, eigene Karten zu diesem Pokémon)

### Phase 6 — Marktpreise
1. PokéWallet API für Cardmarket-Preise einbinden
2. Preishistorie in DB speichern (täglicher Cron/manuell)
3. Preistabelle auf Kartendetailseite
4. Gesamtwert der Sammlung im Dashboard

### Phase 7 — Wunschlisten & PDF
1. Wunschlisten CRUD
2. Karten aus pokemontcg.io zur Wunschliste hinzufügen
3. `CollectionDocument.tsx` — react-pdf Layout für Sammlung/Wunschliste
4. PDF-Download + Browser-Druck-Dialog

---

## Externe APIs

| API | Zweck | Auth | Kosten |
|-----|-------|------|--------|
| pokemontcg.io | Kartendatenbank, Bilder | API Key (Header) | Kostenlos |
| pokeapi.co | Pokémon-Wiki-Daten | Keine | Kostenlos |
| Google AI Studio (Gemini) | Bildanalyse für Scanner | API Key | Großzügiges Free Tier |
| Firebase Firestore | Datenbank | Firebase Config | Spark Plan kostenlos |
| PokéWallet | Cardmarket-Preise | API Key | 10K req/Mo kostenlos |

---

## Verifikation

Nach Implementierung testen:
1. **Scanner**: Pokémon-Karte vor Kamera halten → Erkennung → Karte in DB gespeichert
2. **Sammlung**: Filter nach Set/Typ funktioniert, Bilder laden korrekt
3. **Mappe**: Karte per Drag & Drop hinzufügen, Position wird gespeichert
4. **Wiki**: Pokémon suchen, Evolutionskette + Stats anzeigen
5. **Preise**: Karte aufrufen → Marktpreis geladen, in History gespeichert
6. **PDF**: Wunschliste generieren → PDF herunterladbar mit Karten-Thumbnails

---

## Aktueller Implementierungsstand (Stand: 2026-06-02)

> **Hinweis für Wiederaufnahme:** Alle Seiten liegen unter `app/(app)/` (Route Group). Root-Layout ist minimal. Login unter `app/login/page.tsx` ohne App-Chrome.

### ✅ Fertig

| Bereich | Was | Wichtige Dateien |
|---------|-----|-----------------|
| Phase 0 | Mockup | `public/mockup.html` |
| Phase 1 | Next.js 16 + Tailwind v4 + shadcn/ui + Firebase + Layout | `app/layout.tsx`, `app/(app)/layout.tsx`, `components/BottomNav.tsx` |
| Phase 2 | Scanner (Kamera + Gemini Vision + Add-Modal) | `app/(app)/scanner/page.tsx`, `components/scanner/*` |
| Phase 3 | Suche: Such-Modus + Browse-Modus (paginiert), alle Filter | `app/(app)/collection/page.tsx` |
| Phase 4 (teilw.) | Mappen: Übersicht + Detailseite + Create/Edit Modal | `app/(app)/binders/*`, `components/binder/*` |
| Phase 6 (teilw.) | Preissystem: TCGPlayer via pokemontcg.io, Provider-Interface | `lib/prices/`, `app/api/prices/route.ts`, `components/card/CardPrices.tsx` |
| Auth | Firebase Email/Password, Session-Cookie `.smartfamilyzone.de`, Middleware | `middleware.ts`, `app/login/page.tsx`, `lib/auth.ts`, `components/AuthRefresh.tsx` |
| Catalog-Sync | Firestore `tcg_catalog`, Admin SDK, wöch. Cron; `variants`, `hp`, `nationalDexNumber`, `subtypes`, `evolutionFamily` (nach Enrichment) | `lib/sync-catalog.ts`, `lib/firebase/admin.ts` |
| Settings | Theme, App-Reload, Abmelden, Catalog-Sync, Evolutionsdaten-Anreicherung | `app/(app)/settings/page.tsx`, `components/ThemeProvider.tsx` |
| Set-Detailseite | Header (Logo+Name+Jahr+Code), Fortschritt, RarityFilterBar, ButtonGroup, Sort, CardGrid | `app/(app)/sets/[setId]/page.tsx` |
| Sets-Übersicht | Alle Sets gruppiert nach Serie, Dashboard-Style Zeilen | `app/(app)/sets/page.tsx` |
| Karten-Detailansicht | Bottom-Sheet: dt. Bild (TCGdex), dt. Name (PokéAPI), Set-Logo, Nummer, Rarity-Icon, Varianten, Binder | `components/card/CardDetailSheet.tsx` |
| Rarity-System | Vollständiges RARITY_GROUPS (alle offiziellen Typen inkl. Amazing/Radiant/Shiny), getRarityGroup(), korrekte Symbole + Farben | `lib/card-constants.ts` |
| Karten-Architektur | `CardInfo`-Typ (normalisiert, inkl. `subtypes`, `nationalDexNumber`, `evolutionFamily`), `CardGrid`, `RarityFilterBar`, `CardTile` | `lib/card-info.ts`, `components/card/*` |
| Energie-Icons | 11 TCG-Typen als inline SVG mit offiziellen Farben + Symbolen, dt. Namen | `components/ui/EnergyIcon.tsx` |
| Browse-Modus | Ohne Suchbegriff: paginiert, Sort (A-Z/KP/Pokédex), Filter (Supertype/Typ/Rarity/Owned/Phase) | `lib/hooks/useCardBrowser.ts` |
| Dashboard | Echte Firestore-Daten: Kartenanzahl, Sets, Wunschliste, zuletzt hinzugefügt, Set-Fortschrittsbalken | `app/(app)/page.tsx` |
| PWA | Pokeball-Favicon (PNG + SVG + Apple-Icon), Manifest-Icons | `app/icon.png`, `app/icon.svg` |
| UI | Plus Jakarta Sans, Login-Split-Panel, ButtonGroup, EnergyIcon | `components/ui/` |
| Mehrsprachigkeit | Deutsche Set-/Seriennamen live von TCGdex API, deutsche Logos | `lib/tcgdex.ts`, `lib/set-names-de.ts` |
| Suche — Suchseite | Deutsch/EN/Prefix-Suche, TCGdex-Fallback für deutsche Namen, Phase-Filter mit Disabled-States, Evo-Linie-Toggle, Rarity aus Ergebnissen | `app/(app)/collection/page.tsx` |
| Suche — Evolutionslinie | Firestore-Query via `evolutionFamily array-contains`, PokéAPI-Fallback wenn noch nicht angereichert | `lib/firestore/catalog.ts`, `lib/pokeapi.ts` |
| Suche — Evolutionsdaten-Enrichment | Admin-Route + Settings-Button; schreibt `evolutionFamily[]` in alle Pokémon-Karten via PokéAPI (einmalig) | `app/api/admin/enrich-evolution/route.ts`, `lib/sync-catalog.ts` |
| Karten-Darstellung | Owned: Vollfarbe + ×N Badge; Unowned: dunkles Overlay + Schloss-Icon mittig | `components/card/CardTile.tsx` |
| Filter-Collapse | Scroll-Collapse mit 200ms Lockout nach State-Change (verhindert Reflow-Flicker), aktive Filter als Chips | `app/(app)/collection/page.tsx` |
| next.config.ts | `images.scrydex.com` + `assets.tcgdex.net` als erlaubte Bild-Hosts eingetragen | `next.config.ts` |

### 🔲 Noch offen

- **Evolutionsdaten-Enrichment ausführen** — Settings → „Evolutionsdaten anreichern" einmal klicken; danach kein PokéAPI-Call mehr zur Laufzeit
- **Karten-Detailansicht** — Wunschlisten-Aktion, Preisanzeige im Sheet
- **Phase 4 (Rest)** — Karten per Drag & Drop in Mappen verschieben, Mappe als PDF
- **Phase 5** — Wunschlisten: CRUD, Karten zuordnen, PDF-Export (`app/(app)/wishlist/` existiert noch nicht)
- **Phase 6 (Rest)** — Preishistorie in Firestore, Gesamtwert im Dashboard
- **Phase 7** — PDF-Export für Sammlung/Wunschliste (`@react-pdf/renderer`)
- **Pokédex/Wiki** — PokéAPI Integration (noch nicht begonnen, geplant: `app/(app)/pokedex/`)
- **Suche — Mehrsprachiger Catalog** — `nameDe`, `nameFr` in `tcg_catalog` via TCGdex-Sync (geplant, nicht gebaut); aktuell nur TCGdex-Fallback bei 0 EN-Treffern
- **Set-Favoriten** — in Firestore speichern (Dashboard-Favoriten-Tab zeigt aktuell meiste Karten)
- **Energie-Icons** — SVG-Symbole noch nicht 1:1 mit offiziellen Icons (gut erkennbar, aber verbesserungsfähig)

### Entwicklungs-Prinzipien

- **Wiederverwendbarkeit first**: Vor jeder Implementierung prüfen ob Logik/Komponente bereits existiert oder künftig woanders gebraucht wird → dann sofort als gemeinsames Modul anlegen
- **Single Source of Truth**: Logik (Filter, Sortierung, Typ-Konvertierung, Konstanten) gehört in ein Modul, nie in mehrere Pages kopieren
- **Gemeinsame Komponenten**: Filter-UI, Grids, Sheets → immer als Komponente, nie inline duplizieren
- **Wiederverwendbare Hooks**: Zustandslogik die in mehreren Pages vorkommt → eigener `use*`-Hook

### Wichtige Architektur-Entscheidungen

- `middleware.ts` (nicht `proxy.ts`) schützt alle Routen außer `/login` und `/api/auth`
- `app/(app)/` — Route Group für alle App-Seiten (hat BottomNav + AuthRefresh im Layout)
- `app/login/` — Login-Seite ohne App-Chrome (nur Root-Layout)
- `next build --webpack` — Turbopack für Production-Build deaktiviert (Inkompatibilität)
- Preise: Provider-Interface in `lib/prices/types.ts`, aktuell TCGPlayer, austauschbar zu Cardmarket/pokeprice.io
- Dark Mode: class-based via next-themes (`attribute="class"`), `.dark`-Klasse auf `<html>`
- Font: Plus Jakarta Sans via `next/font/google`, Variable auf `<html>` (nicht `<body>`)
- Set-Detailseite: lädt Karten aus Firestore Catalog (`tcg_catalog`), Fallback auf pokemontcg.io API
- Deutsche Namen + Logos: TCGdex API (`api.tcgdex.net/v2/de`), 6h Server-Cache, ID-Normalisierung in `lib/tcgdex.ts`
- Karten-Konstanten zentral in `lib/card-constants.ts`: LANGUAGES, CONDITIONS, VARIANT_LABELS, RARITY_GROUPS, getRarityGroup(), detectVariants()
- `lib/card-info.ts`: gemeinsamer `CardInfo`-Typ + Converter (catalogCardToInfo, tcgApiCardToInfo, cardInfoToTcgApi)
- `components/card/CardGrid.tsx`: wiederverwendbares Grid + Detail-Sheet-Management (Suche, Set-Detail, Binder)
- `components/card/RarityFilterBar.tsx`: wiederverwendbare Rarity-Chips inkl. buildRarityBreakdown()
- CatalogCard hat `variants?: CardVariant[]` — beim Catalog-Sync befüllt, Fallback auf lokale Erkennung
- ButtonGroup-Komponente in `components/ui/button-group.tsx` — app-weit nutzbar
- Navigations-Kontext: `?from=dashboard` / `?from=sets` → Back-Button zeigt korrektes Ziel
- Karten-Bilder: pokemontcg.io (EN), für DE-Bilder → TCGdex `assets.tcgdex.net/de/{tcgdexSetId}/{num}/high.webp`
- Deutsche Pokémon-Namen: PokéAPI `pokeapi.co/api/v2/pokemon-species/{name}` → `names[de]`

### Externe APIs

| API | Zweck | Auth |
|-----|-------|------|
| `pokemontcg.io` | Kartendatenbank, Bilder, Set-Metadaten | API Key |
| `api.tcgdex.net/v2/de` | Deutsche Set-Namen + Logos + Karten-Bilder (kein Auth, 6h gecacht) | — |
| `pokeapi.co` | Deutsche Pokémon-Namen (kein Auth) | — |
| Firebase Firestore | Sammlung, Mappen, Catalog | Firebase Config |
| Google Gemini Vision | Scanner-Bilderkennung | API Key |

### Deployment

- **Repo**: GitHub → `stefan-gross/pokedex` (main → Vercel Auto-Deploy)
- **Hosting**: Vercel, Region `fra1`
- **URL**: `https://pokedex.smartfamilyzone.de`
- **Build-Befehl**: `next build --webpack` (in `package.json`)
- **Vercel Timeout**: Serverless Functions max ~10s → Catalog-Sync macht max 2 Seiten (500 Karten) pro Request, Client loopt

### Env Vars (alle eingetragen — lokal `.env.local` + Vercel)

| Variable | Wert | Wo |
|----------|------|----|
| `FIREBASE_ADMIN_PROJECT_ID` | `smartfamilyzone-d9657` | Vercel ✅ |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | `firebase-adminsdk-fbsvc@...` | Vercel ✅ |
| `FIREBASE_ADMIN_PRIVATE_KEY` | `-----BEGIN PRIVATE KEY...` | Vercel ✅ |
| `CRON_SECRET` | `sfz-cron-2026-pokedex` | Vercel ✅ |
| `POKEMON_TCG_API_KEY` | `a82a4efa-7b6a-405e-a23e-c6df8aea0e7c` | lokal + Vercel ✅ |
| `GEMINI_API_KEY` | in `.env.local` | lokal ✅ |
| `CARDMARKET_*` | — | gesperrt, kein Zugang |

### Firebase

- **Projekt**: `smartfamilyzone-d9657` (geteilt mit contracts-app + family-hub)
- **Firestore Collections**: `cards`, `binders`, `wishlists`, `tcg_catalog`, `tcg_catalog_meta`
- **Rules**: `/{document=**} if request.auth != null`
- **Auth**: Email/Password aktiviert, SSO über `.smartfamilyzone.de` Cookie

### Bekannte Eigenheiten

- Node.js: System hat v15 — immer v22 nutzen: `/Users/sgr/.nvm/versions/node/v22.3.0/bin/node`
- Dev-Server starten: `/Users/sgr/.nvm/versions/node/v22.3.0/bin/node node_modules/.bin/next dev --webpack --port 3000`
- Turbopack nicht nutzen (weder `--turbo` noch ohne `--webpack`)
- `.claude/launch.json` startet Dev-Server korrekt
- TCGdex IDs unterscheiden sich von pokemontcg.io (sv1 vs sv01, pt5 vs .5) → `toTcgdexId()` in `lib/tcgdex.ts`
