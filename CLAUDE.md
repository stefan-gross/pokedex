@AGENTS.md

# Pokédex — Projektkontext

Vollständiger Implementierungsplan: `.claude/plans/plan.md`

> **Wichtig für Claude:** Nach jeder Änderung (Feature, Bugfix, Refactor) den Abschnitt **„Aktueller Implementierungsstand"** in `.claude/plans/plan.md` aktualisieren — ✅ für Fertiges, 🔲 für Offenes. So kann jede neue Session nahtlos weitermachen.

## Projekt
Pokémon-Kartensammlung PWA für Stefan Gross.
- **URL**: https://pokedex.smartfamilyzone.de
- **Repo**: GitHub → stefan-gross/pokedex (main → Vercel Auto-Deploy)
- **Firebase Projekt**: smartfamilyzone-d9657 (geteilt mit contracts-app)

## Tech Stack
- Next.js 16 (App Router, TypeScript) — `middleware.ts` heißt hier `proxy.ts`
- Tailwind CSS v4 + shadcn/ui
- Firebase Client SDK (Browser) + Firebase Admin SDK (Server)
- Dev-Server starten: `/Users/sgr/.nvm/versions/node/v22.3.0/bin/node node_modules/.bin/next dev --webpack --port 3000`

## Auth
- Firebase Email/Password, Session-Cookie `__session` auf `.smartfamilyzone.de`
- JWT-Verifikation via `jose` in `lib/auth.ts`
- `proxy.ts` schützt alle Routen außer `/login` und `/api/auth`
- SSO mit contracts-app und family-hub (gleiche Cookie-Domain)

## Wichtige Dateien
| Datei | Zweck |
|-------|-------|
| `proxy.ts` | Route-Schutz (Next.js 16: nicht middleware.ts!) |
| `lib/auth.ts` | JWT-Verifikation |
| `lib/firebase/client.ts` | Firebase Client SDK (Browser + Client-Components) |
| `lib/firebase/admin.ts` | Firebase Admin SDK (Server/API-Routes) |
| `lib/sync-catalog.ts` | Catalog-Sync Logik (nutzt Admin SDK) |
| `lib/firestore/catalog.ts` | Firestore Catalog (Client SDK, nur Reads) |
| `lib/firestore/cards.ts` | Nutzer-Sammlung CRUD |
| `lib/firestore/binders.ts` | Mappen CRUD |
| `app/admin/page.tsx` | Admin-Seite: Catalog-Sync manuell anstoßen |

## Aktueller Stand
- ✅ Phase 0: Mockup (`public/mockup.html`)
- ✅ Phase 1: Gerüst, Firebase, Auth, Navigation, Dashboard
- ✅ Phase 2: Scanner (Kamera + Gemini Vision)
- ✅ Phase 3: Suche (pokemontcg.io, Live-Wildcard, Karten-Grid)
- ✅ Phase 4 (teilw.): Mappen Übersicht + Detail
- ✅ Catalog-Sync: Firestore `tcg_catalog`, Admin SDK, wöch. Cron
- ✅ Scanner-Polish (Stufe 1–8): Pause/Resume-FAB, Erkennen-Modus mit Owned-Banner, Quick-Add `+` auf Tiles, Bulk-Actions, REST-Catalog-Lookup, Detection-Speedups (WebGPU + Mask-Lazy), Auto-Pause nach Recognize, Slider-Reihenfolge-Polish
- ✅ **TCGdex-Migration (komplett, live seit Go-Live 2026-07-29):** einzige Datenquelle jetzt TCGdex (native IDs `me04-100`/`me03`), DE-Namen/-Bilder nativ, Preise via `tcgdexProvider` (Cardmarket bevorzugt). pokemontcg.io vollständig raus (`lib/tcgdex.ts`/`lib/pokemon-tcg.ts`/`app/api/tcg` gelöscht). Reset-Route `app/api/admin/reset-catalog`. Katalog nach Voll-Sync: **218 Sets · 23.444 Karten** + PokéAPI-Evolution/Artdaten. PokéAPI bleibt.
- ✅ **Scanner-Erkennung/Trigger/KI-Debug (Stufe 52, 2026-08-04):** Perspektiv-Deskew (echte 4 Ecken → Homographie-Warp + Unsharp), Full-HD-Kamera, grün-gegateter Auto-Auslöser (mse 2000 / Δbox 22 / Ecken-„im-Rahmen"), zonengenaue Reflexionsmessung (Name/Set-Code). Mehrstufiges Debug-Framework (`lib/scanner/debug-flags.ts`, 3 Settings-Switches): **Scannen** misst „Erkennung→Trigger"-Zeit + Blocker & stoppt statt auszulösen; **KI** zeigt Sendebild-Vorschau → „An Gemini senden" → Debug-Modal (Antwort/Latenz/Lookup) — je mit Kopieren-Button. Server-`tryDirectCatalogLookup` erweitert: printedTotal+number(+dex, +Namensfilter) → Symbolabgleich nur noch letzter Ausweg (er halluziniert). pHash-Match-Decke 22→24 (dunkle Holos). **Bekannt/offen:** Gemini-`setCode` fast immer null (Lite-Modell liest den winzigen Stempel nicht) — via Zahlen-Lookup unkritisch; pHash nur mit wenigen Datenpunkten kalibriert.
- 🔲 Phase 4 Rest: Drag & Drop
- 🔲 Phase 5: Wunschlisten
- 🔲 Phase 6: Marktpreise (Cardmarket)
- 🔲 Phase 7: PDF-Export

## Vercel Env Vars (Secrets NICHT hier hinterlegen!)
- `FIREBASE_ADMIN_PROJECT_ID`
- `FIREBASE_ADMIN_CLIENT_EMAIL`
- `FIREBASE_ADMIN_PRIVATE_KEY`
- `CRON_SECRET` — nur in Vercel/`.env.local`, **niemals im Repo**. (Der alte Wert war hier im Klartext eingecheckt → muss rotiert + aus der Git-Historie entfernt werden.)
- `ADMIN_UIDS` — kommagetrennte Firebase-uids, die Admin-/Sync-Routen auslösen dürfen (siehe `lib/admin-auth.ts`). Ohne diese Var ist der Session-Weg zu den Admin-Routen gesperrt.

## UI-Regeln
- Icons werden ausschließlich als SVG-Dateien eingebunden — kein Icon-Font, keine Emoji
- Stil: einfarbig (monochrome), flach (outline oder solid, kein Duotone/multicolor)
- Farbe wird per Tailwind-Klasse (`text-*`, `fill-current`) oder CSS-Variable gesteuert, nicht inline im SVG hardcodiert

## Bekannte Eigenheiten
- Node.js: System hat v15 — immer v22 nutzen: `/Users/sgr/.nvm/versions/node/v22.3.0/bin/node`
- Turbopack funktioniert nicht (Node v15 im Subprocess) → `--webpack` Flag nötig
- `.claude/launch.json` startet den Dev-Server mit v22 direkt
