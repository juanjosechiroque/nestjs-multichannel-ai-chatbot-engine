# NestJS Multichannel AI Chatbot Engine

[![CI](https://github.com/juanjosechiroque/nestjs-multichannel-ai-chatbot-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/juanjosechiroque/nestjs-multichannel-ai-chatbot-engine/actions/workflows/ci.yml)

A reusable AI chatbot engine built with NestJS, strict TypeScript, OpenAI, PostgreSQL, and pgvector.

The engine has one channel-independent conversational core. Web is the current adapter; additional
channels can translate their transport payloads and call the same `ChatService` without duplicating
prompts, retrieval, memory, catalog, or order rules.

## Design principles

- Channel adapters own transport validation and response formatting, not chatbot behavior.
- PostgreSQL is the source of truth for products, prices, promotions, FAQs, conversations, and orders.
- RAG is used for semantic business knowledge; exact catalog and order operations use structured queries.
- OpenAI interprets language and selects tools, but application code owns prices, totals, and state transitions.
- Provider and database failures produce controlled responses instead of exposing internal errors.
- The included Café Nube business is reproducible demo data, not hardcoded chatbot logic.

## Implemented capabilities

### Conversational core

- OpenAI Responses API with structured output and model-selected tools.
- Persistent PostgreSQL conversation history with a bounded recent-message window.
- Direct catalog search by category, price, allergens, dietary tags, and caffeine preferences.
- Semantic FAQ, promotion, location, policy, and service retrieval with pgvector.
- Channel-neutral PDF menu responses.
- Prompt-injection and unsupported-claim protections.

### Orders

- Channel-independent order state machine.
- Add, remove, review, confirm, cancel, and internally expire orders.
- Transactional PostgreSQL draft persistence and product price snapshots.
- Database-calculated totals and validated state transitions.
- Clarification for unknown or ambiguous product names without partial writes.

### Web channel and operations

- Backend-created public sessions through `POST /api/conversations`.
- Chat through `POST /api/chat`.
- Five conversation creations per hour per IP.
- Ten chat messages per minute per public session.
- Structured correlated logs for memory, RAG, tools, OpenAI, and completed chat requests.
- Token and latency telemetry without exposing it in the public response.

### Quality

- Strict environment and DTO validation.
- Unit, PostgreSQL integration, and HTTP end-to-end tests.
- Disposable Testcontainers databases whose names explicitly include `test` or `e2e`.
- Live evaluations for RAG, catalog routing, conversational security, and multi-turn orders.
- Local JSON order-evaluation reports with token totals and estimated OpenAI cost.
- GitHub Actions quality workflow.

See [Architecture](ARCHITECTURE.md) for the C4 diagrams and component boundaries, and
[Quality and evaluations](docs/QUALITY.md) for the complete verification strategy.

## Requirements

- Node.js 24 or newer.
- npm.
- Docker Desktop or another Docker environment with Compose.
- An OpenAI API key.

## Quick start

```bash
git clone https://github.com/juanjosechiroque/nestjs-multichannel-ai-chatbot-engine.git
cd nestjs-multichannel-ai-chatbot-engine
npm install
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`, then start PostgreSQL and prepare the demo knowledge base:

```bash
npm run db:start
npm run db:generate
npm run db:migrate
npm run db:seed
npm run knowledge:ingest
npm run start:dev
```

The API starts at `http://localhost:3000/api` by default. The seed is safe to run again: stable
slugs update the Café Nube records without creating duplicates. Run `knowledge:ingest` whenever
products, promotions, or FAQs change.

## API usage

### Health

```bash
curl http://localhost:3000/api/health
```

```json
{ "status": "ok" }
```

### Create a web conversation

```bash
curl -X POST http://localhost:3000/api/conversations
```

```json
{ "sessionId": "a51f973c-4f93-4cc5-832d-63ae2ff86d65" }
```

The client should persist this backend-generated `sessionId` and reuse it for later messages.
Unknown session IDs are rejected instead of implicitly creating conversations.

### Send a chat message

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"a51f973c-4f93-4cc5-832d-63ae2ff86d65","message":"¿Qué bebidas calientes tienen y cuánto cuestan?"}'
```

```json
{ "reply": "..." }
```

An explicit request to see the menu returns channel-neutral structured content:

```json
{
  "reply": "Aquí tienes nuestra carta.",
  "content": [
    {
      "type": "document",
      "title": "Carta de Café Nube",
      "url": "/api/menu",
      "mimeType": "application/pdf"
    }
  ]
}
```

The web client decides how to render this descriptor. The PDF is presentation-only: exact product
facts, price filters, and orders continue to use PostgreSQL.

The public HTTP contract uses controlled status codes:

| Status | Meaning                                             |
| -----: | --------------------------------------------------- |
|  `400` | Invalid DTO or unsupported property                 |
|  `404` | Validly shaped but unknown public session           |
|  `429` | Web conversation or message rate limit exceeded     |
|  `503` | Required OpenAI or PostgreSQL operation unavailable |

### Catalog and menu

```bash
curl http://localhost:3000/api/products
curl http://localhost:3000/api/promotions
curl http://localhost:3000/api/faqs
curl http://localhost:3000/api/menu --output cafe-nube-menu.pdf
```

## Information routing

| Customer request                         | Application path                                  |
| ---------------------------------------- | ------------------------------------------------- |
| “What do you sell?”                      | Catalog categories and representative examples    |
| “Show me the menu”                       | Channel-neutral PDF document descriptor           |
| “What cold drinks cost less than S/ 15?” | Typed PostgreSQL catalog query                    |
| “Explain your allergen policy”           | Semantic knowledge search through RAG             |
| “Add two cappuccinos”                    | Order tool, catalog resolution, and state machine |
| Greeting or thanks                       | Direct model response without retrieval           |

The model may select at most one tool per customer message. A tool call uses one model response to
choose the operation and a second response to present the application-controlled result.

## Configuration

All supported variables and development defaults are documented in [.env.example](.env.example).
Important controls include:

| Variable                            | Default                  |
| ----------------------------------- | ------------------------ |
| `OPENAI_MODEL`                      | `gpt-5.6-luna`           |
| `OPENAI_EMBEDDING_MODEL`            | `text-embedding-3-small` |
| `RAG_MIN_SIMILARITY`                | `0.5`                    |
| `RATE_LIMIT_CONVERSATIONS_PER_HOUR` | `5`                      |
| `RATE_LIMIT_MESSAGES_PER_MINUTE`    | `10`                     |

The current rate-limit store is in memory and intentionally targets one application instance. A
distributed deployment requires shared Redis storage. A reverse proxy must also be trusted
explicitly so the web adapter receives the real client IP.

## Commands

| Command                          | Purpose                                                    |
| -------------------------------- | ---------------------------------------------------------- |
| `npm run start:dev`              | Start the API in watch mode                                |
| `npm run db:start`               | Start local PostgreSQL with pgvector                       |
| `npm run db:migrate`             | Apply development migrations                               |
| `npm run db:seed`                | Load the Café Nube demo data                               |
| `npm run knowledge:ingest`       | Build or update the derived vector knowledge index         |
| `npm run format`                 | Apply ESLint and Prettier fixes                            |
| `npm run validate`               | Lint, format check, type-check, unit coverage, and build   |
| `npm run test:integration`       | Run deterministic PostgreSQL and pgvector tests            |
| `npm run test:e2e`               | Run deterministic HTTP flows with disposable PostgreSQL    |
| `npm run rag:evaluate`           | Run live RAG retrieval evaluation                          |
| `npm run chat:evaluate:catalog`  | Run live catalog-routing evaluation                        |
| `npm run chat:evaluate:security` | Run live conversational security evaluation                |
| `npm run chat:evaluate:orders`   | Run live multi-turn order evaluation and write JSON report |

The deterministic test commands do not call OpenAI. Live evaluation commands require an API key,
can vary with model behavior, and have token cost.

## Project documentation

- [Architecture](ARCHITECTURE.md): C4 views, runtime boundaries, tools, data ownership, and order states.
- [Quality and evaluations](docs/QUALITY.md): testing layers, safe test databases, live evals, and cost reports.
- [Café Nube example](examples/cafe-nube/README.md): demo data, assets, loading, and replacement boundaries.
