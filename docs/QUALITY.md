# Quality and Evaluations

This document explains how the reusable AI chatbot backend is verified. It separates deterministic
software verification from live model evaluation because the two groups answer different questions
and intentionally run through different commands.

The quality strategy treats the LLM as one component inside a larger system: model output may vary,
but catalog facts, prices, totals, order transitions, persistence, and safety boundaries must remain
under application control.

## Deterministic quality gate

```bash
npm run validate
```

The command runs:

1. ESLint without warnings.
2. Prettier verification.
3. Strict TypeScript checking.
4. Unit tests with coverage thresholds.
5. A production NestJS build.

The current global coverage thresholds are:

| Metric     | Minimum |
| ---------- | ------: |
| Statements |     85% |
| Branches   |     75% |
| Functions  |     80% |
| Lines      |     85% |

Unit tests mock OpenAI and do not require Docker, a database, network access, or API credits.

## PostgreSQL integration tests

```bash
npm run test:integration
```

Testcontainers starts disposable PostgreSQL 17 instances with pgvector. The suites verify:

- The pgvector extension and real similarity queries.
- Similarity ordering and minimum-threshold filtering.
- Applied Prisma migrations.
- Order draft creation, modification, review, customer identity collection, numbered confirmation,
  and cancellation.
- Product ordering availability when adding items and immediately before confirmation.
- Exact persisted products, quantities, price snapshots, and totals.

Integration tests do not call OpenAI.

## HTTP end-to-end tests

```bash
npm run test:e2e
```

The HTTP suites start the real NestJS application with disposable PostgreSQL infrastructure. OpenAI
generation and embeddings are replaced by deterministic test doubles. They cover:

- Global DTO validation and controlled errors.
- Swagger/OpenAPI route coverage, schemas, operations, and documented HTTP responses.
- Global security headers and removal of the Express signature.
- Allowed and disallowed browser origins, including CORS preflight behavior.
- WhatsApp callback verification success, invalid credentials, and missing query parameters.
- Backend-managed conversations and persistent history.
- Completed-message replay, conflicting IDs, failed retries, and concurrent duplicate rejection.
- Catalog endpoints, typed catalog search, and menu documents.
- RAG context propagation with real pgvector queries.
- Multi-turn order changes and confirmation.
- Web rate limiting by IP and public session.
- `429` rejection before persistence or the chatbot core.
- Controlled `503` responses for provider and database failures.

These tests do not call external APIs and have no token cost.

## Disposable database safety

Integration, HTTP E2E, and live order evaluation databases are created by Testcontainers. Their
database names must include `test` or `e2e`, and safety assertions reject any non-disposable target.
Containers are removed after each suite. Tests never clear or reseed the local development database.

## Live evaluations

Live evaluations use the configured OpenAI models and are intentionally excluded from
`npm run validate` and CI.

| Evaluation | Command                          | What it measures                                        |
| ---------- | -------------------------------- | ------------------------------------------------------- |
| RAG        | `npm run rag:evaluate`           | Expected-source retrieval and unrelated-query rejection |
| Catalog    | `npm run chat:evaluate:catalog`  | Tool selection, filters, and product attribution        |
| Security   | `npm run chat:evaluate:security` | Prompt injection, disclosure, and unsupported claims    |
| Orders     | `npm run chat:evaluate:orders`   | Multi-turn language interpretation and persisted state  |

RAG, catalog, and security evaluations use the `DATABASE_URL` configured in `.env`, so prepare the
local seed and knowledge index first. The security evaluator creates isolated conversations and
deletes them after each case. The order evaluator is different: it always starts its own disposable
Testcontainers database and never reads, clears, or seeds the local development database.

### RAG retrieval

The RAG evaluator runs representative business questions and unrelated queries against real
embeddings and pgvector. It should be used to calibrate `RAG_MIN_SIMILARITY` from evidence rather
than intuition.

```bash
npm run rag:evaluate
RAG_EVALUATION_CASE="food catalog paraphrase" npm run rag:evaluate
```

### Catalog routing

The catalog evaluator verifies that the model selects `search_catalog`, supplies typed filters, and
attributes expected products without including forbidden results.

```bash
npm run chat:evaluate:catalog
CHAT_CATALOG_EVALUATION_CASE="cold caffeine-free preference" npm run chat:evaluate:catalog
```

### Conversational security

Security cases cover prompt injection, system-prompt disclosure, unrelated requests, missing
business information, fabricated prices, and fabricated promotions. Deterministic leak markers are
combined with a structured model judge.

```bash
npm run chat:evaluate:security
CHAT_SECURITY_EVALUATION_CASE="prompt injection" npm run chat:evaluate:security
```

### Multi-turn orders

The order evaluator runs representative conversations for additions, contextual references,
review, confirmation, modification, cancellation, unknown products, price manipulation, repeated
products, excessive removal, required customer identity, public order-number assignment, idempotent
confirmation, and new orders after a terminal state.

Each case receives a new backend-managed conversation in a disposable database. The evaluator
checks state after every turn and verifies final products, quantities, totals, status, and persisted
order count.

```bash
npm run chat:evaluate:orders
CHAT_ORDER_EVALUATION_CASE="modify after reviewing" npm run chat:evaluate:orders
```

## Order evaluation reports and cost

Every order-evaluation run writes a local JSON artifact to:

```text
output/evaluations/orders/<timestamp>.json
```

The report contains:

- Model and generation timestamp.
- Overall pass rate, turns, and duration.
- Customer message, model answer, expected state, and actual state for every turn.
- Expected and persisted final order snapshots, including checkout identity and order-number checks.
- Input, cached-input, cache-write, output, reasoning, and total tokens.
- Estimated USD cost with the pricing date, source, billable tokens, and breakdown.

Reports are ignored by Git because they are run artifacts. The estimate is not an invoice. Pricing
is available only for models explicitly documented by the project; an unknown model produces
`status: unavailable` instead of applying an incorrect rate. Reasoning tokens are a subset of output
tokens and are not charged a second time by the estimator.

## Recommended workflow

| Situation                             | Run                                                |
| ------------------------------------- | -------------------------------------------------- |
| Normal code change                    | `npm run validate`                                 |
| Prisma, RAG SQL, or order persistence | `npm run test:integration`                         |
| Controller, DTO, error, or full flow  | `npm run test:e2e`                                 |
| Prompt or tool-schema adjustment      | Relevant single live evaluation case               |
| Significant chatbot behavior change   | Complete affected live evaluation                  |
| Before a release candidate            | Deterministic suites, then all relevant live evals |

When a live case fails, rerun that exact case before changing code. Model output can vary, while
database invariants, prices, totals, and state transitions must remain deterministic.
