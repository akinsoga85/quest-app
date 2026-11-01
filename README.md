# Quest (working name)

Daily creative quests for teens 13–19, with an AI coach and family-only sharing.
This repo is **Lean V1**: Studio for everyone, on iPhone and Android, no walls yet.
The plan, PRD and design review live in the product doc; screens are in Figma
(file `DJ7C4eGOmgahBCPVsbHhnc`).

## What's here

| Path | What it is |
|---|---|
| `apps/mobile` | Expo (React Native) app: one codebase for iPhone and Android |
| `packages/tokens` | Colours, type, spacing and tap sizes from Figma, with contrast tests |
| `packages/contract` | The shared contract: data shapes, rules and server-function signatures, plus generated database types |
| `supabase/migrations` | Database schema with row-level security on every table |
| `supabase/seed.sql` | Zones, skills and a first day of quests |
| `scripts/` | Local Postgres, access-rule tests, database type generator |
| `docs/agents.md` | Rules and briefs for the AI agents building packages A1–A12 |

## Run it

Needs Node 22.13+ and, for the database tests, a local PostgreSQL 16 (no Docker needed).

```sh
npm install
npm run check          # types, lint, unit tests
npm run db:up          # start a throwaway Postgres and load the schema
npm run db:test        # access-rule and integrity tests
npm run gen:types      # regenerate database types after a migration
npm run start -w @quest/mobile   # Expo dev server (scan with Expo Go or a dev build)
```

To connect the app to Supabase, copy `apps/mobile/.env.example` to `.env` and fill
in the project URL and anon key. Deploy the schema with `supabase db push`.

## Before the first store build

- Replace the working name, `com.example.quest` bundle IDs and the `quest` URL scheme in `apps/mobile/app.json` once the name is cleared.
- The skills for Fashion, Art and crafts, Music and Words are drafts for the mentor sprint to confirm (`packages/contract/src/zones.ts` and `supabase/seed.sql` must match; `npm run db:test` checks this).
- Level thresholds in `packages/contract/src/levels.ts` are a first guess to tune in the pilot.
