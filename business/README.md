# business/

Everything specific to the business this deployment serves. The conversational
engine in `src/` never imports from here except through one seam,
`src/config/business.config.ts`.

This is **not** multi-tenancy: one deployment serves one business, with its own
database. To run a different (gastronomic) business, edit the files below — never
`src/` or `prisma/seed.ts`.

## What you edit

| File              | Format     | What it is                                                                                                                                                                                                                                                                                  |
| ----------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profile.json`    | JSON       | Business identity: `name`, `timeZone` (IANA), and an optional `menuTitle` (defaults to `Carta de <name>`). Validated on startup — a bad time zone or missing field stops the app. The menu file is always `assets/menu.pdf`, served at `/api/menu`; those are engine constants, not config. |
| `seed.ts`         | TypeScript | The reproducible bootstrap catalog: `products`, `promotions`, `faqs`, `obsoleteFaqSlugs`. Typed against Prisma's input types so a wrong category or a missing field fails the build, not the seed run. PostgreSQL is the runtime source of truth; this is only the initial load.            |
| `assets/menu.pdf` | file       | The presentation menu. Never a price source.                                                                                                                                                                                                                                                |

`contract.ts` (the `BusinessProfile` / `BusinessSeed` types), `product-metadata.ts`
(the shared metadata helper) and `seed-runner.ts` (the idempotent upsert-by-slug
loader) are infrastructure — you normally don't touch them.

## Apply it

```bash
npm run db:seed          # upserts seed.ts into PostgreSQL (idempotent, keyed by slug)
npm run knowledge:ingest # rebuilds the pgvector index from what was seeded
```

## Boundary

The engine targets the **gastronomic catalog-with-ordering vertical**.
`ProductCategory` (`HOT_DRINK` / `COLD_DRINK` / `FOOD`), declared allergens,
dietary tags and caffeine flags are deliberate constraints of that vertical and
are defined in `src/` — they are not generalized to other industries. A new
business varies the data within this vertical, not the domain model. The reuse
guarantee is exercised in `business/business.spec.ts` against an alternate
business fixture.
