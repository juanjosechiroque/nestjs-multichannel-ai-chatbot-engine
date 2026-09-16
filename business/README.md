# business/

Everything specific to the business this deployment serves. The conversational
engine in `src/` never imports from here except through one seam,
`src/config/business.config.ts`.

This is **not** multi-tenancy: one deployment serves one business, with its own
database. To run a different catalog and ordering business, edit the files below — never
`src/` or `prisma/seed.ts`.

## What you edit

| File              | Format     | What it is                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `profile.json`    | JSON       | Business identity: `name`, `timeZone` (IANA), and an optional `menuTitle` (defaults to `Carta de <name>`). Validated on startup — a bad time zone or missing field stops the app. The menu file is always `assets/menu.pdf`, served at `/api/menu`; those are engine constants, not config.                                    |
| `seed.ts`         | TypeScript | The reproducible bootstrap catalog: `categories`, `attributes`, `products`, `promotions`, `faqs`, `obsoleteFaqSlugs`. Categories carry labels and search terms; attributes declare keys, types, allowed values and filterability. The seed validates product values before writing. PostgreSQL is the runtime source of truth. |
| `assets/menu.pdf` | file       | The presentation menu. Never a price source.                                                                                                                                                                                                                                                                                   |

`contract.ts` (the `BusinessProfile` / `BusinessSeed` types), `product-metadata.ts`
(the shared metadata helper) and `seed-runner.ts` (the idempotent upsert-by-slug
loader) are infrastructure — you normally don't touch them.

## Apply it

```bash
npm run db:seed          # upserts seed.ts into PostgreSQL (idempotent, keyed by slug)
npm run knowledge:ingest # rebuilds the pgvector index from what was seeded
```

## Boundary

The engine serves one configurable catalog-and-ordering business per deployment.
Categories and attributes are data, not engine enums: define only the categories
and filterable product facts that the deployment needs. This is intentionally not
a claim of support for every industry. The reuse guarantee is exercised against a
non-gastronomic fixture in `business/business.spec.ts`.

Only active categories and products are published by catalog search; a product can
be added to or confirmed in an order only while both records are active.
