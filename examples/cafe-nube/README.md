# Café Nube Example

Café Nube is the fictional business used to demonstrate the reusable chatbot engine. It provides
realistic structured data and a presentation asset without placing business-specific rules inside
the conversational core.

## Included data

| Content                     | Location                                 | Runtime role                        |
| --------------------------- | ---------------------------------------- | ----------------------------------- |
| Products, promotions, FAQs  | `prisma/seed-data/cafe-nube.ts`          | PostgreSQL source records           |
| Menu document configuration | `examples/cafe-nube/cafe-nube.config.ts` | Channel-neutral document descriptor |
| Menu PDF                    | `examples/cafe-nube/assets/menu.pdf`     | Customer-facing presentation        |
| Vector knowledge            | PostgreSQL `knowledge_chunks`            | Derived RAG index                   |

PostgreSQL remains authoritative for active products, prices, filters, promotions, FAQs, and
orders. The PDF is a presentation artifact and is never used to calculate prices or order totals.

## Load the example

```bash
npm run db:start
npm run db:generate
npm run db:migrate
npm run db:seed
npm run knowledge:ingest
```

The seed uses stable slugs and can be executed repeatedly. Knowledge ingestion updates changed
documents, preserves unchanged vectors, and removes derived chunks whose active source disappeared.

## Replace the example business

To demonstrate another business while keeping the same engine:

1. Provide a new reproducible seed for its structured data.
2. Provide any channel-neutral presentation assets and their configuration.
3. Select that configuration from the application composition boundary.
4. Seed PostgreSQL and run knowledge ingestion.

Do not add a menu, promotion, FAQ, prompt, or order rule directly to `ChatService` or a channel
controller. The current project intentionally supports one configured business and does not yet
implement multi-tenancy.
