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
- 🔲 Phase 4 Rest: Drag & Drop
- 🔲 Phase 5: Wunschlisten
- 🔲 Phase 6: Marktpreise (Cardmarket)
- 🔲 Phase 7: PDF-Export

## Offene Vercel Env Vars (noch nicht eingetragen)
- `FIREBASE_ADMIN_PROJECT_ID`
- `FIREBASE_ADMIN_CLIENT_EMAIL`
- `FIREBASE_ADMIN_PRIVATE_KEY`
- `CRON_SECRET=sfz-cron-2026-pokedex`

## Bekannte Eigenheiten
- Node.js: System hat v15 — immer v22 nutzen: `/Users/sgr/.nvm/versions/node/v22.3.0/bin/node`
- Turbopack funktioniert nicht (Node v15 im Subprocess) → `--webpack` Flag nötig
- `.claude/launch.json` startet den Dev-Server mit v22 direkt
