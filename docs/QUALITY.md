# Quality and evaluations

The project separates deterministic software checks from live model evaluations. Catalog facts,
prices, totals, persistence and order transitions must remain deterministic even when model output
varies.

## Deterministic checks

```bash
npm run validate
```

This runs ESLint, Prettier verification, strict TypeScript, unit tests with coverage and a production
NestJS build. Unit tests mock OpenAI and require neither Docker nor API credentials.

Coverage thresholds:

| Metric     | Minimum |
| ---------- | ------: |
| Statements |     85% |
| Branches   |     75% |
| Functions  |     80% |
| Lines      |     85% |

## Database and HTTP suites

| Command                    | Verifies                                                                                                   | Requirements                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `npm run test:integration` | Prisma migrations, configurable catalog persistence, pgvector queries and transactional order persistence. | Docker/Testcontainers; no OpenAI.                            |
| `npm run test:e2e`         | HTTP contract, validation, Web chat, catalog, RAG, orders, rate limits and WhatsApp webhooks.              | Docker/Testcontainers; OpenAI is replaced with test doubles. |

Both suites use disposable PostgreSQL databases whose names include `test` or `e2e`. They never clear
or reseed the local development database.

## Live evaluations

These commands use configured OpenAI models and are intentionally outside CI. Prepare the seed and
knowledge index first unless noted otherwise.

| Command                          | Measures                                                        |
| -------------------------------- | --------------------------------------------------------------- |
| `npm run rag:evaluate`           | Expected-source retrieval and unrelated-query rejection.        |
| `npm run chat:evaluate:catalog`  | Tool choice, typed filters and product attribution.             |
| `npm run chat:evaluate:security` | Injection resistance, secret disclosure and unsupported claims. |
| `npm run chat:evaluate:orders`   | Multi-turn interpretation and persisted order state.            |

Set the corresponding `*_EVALUATION_CASE` variable to run one named case. RAG, catalog and security
evaluations use the configured development database; the order evaluator creates its own disposable
database. Order reports are written under `output/evaluations/orders/` and include token and estimated
cost data. They are run artifacts, not invoices.

## When to run what

| Change                                             | Run                                                 |
| -------------------------------------------------- | --------------------------------------------------- |
| Normal application change                          | `npm run validate`                                  |
| Prisma, SQL, RAG query or order persistence        | `npm run test:integration`                          |
| Controller, DTO, HTTP contract or channel behavior | `npm run test:e2e`                                  |
| Prompt, tool schema or model change                | Relevant live evaluation case                       |
| Release candidate                                  | Deterministic checks plus affected live evaluations |

When a live case fails, rerun that exact case before changing implementation. Use its result to
improve the prompt or tool contract while preserving deterministic business rules.
