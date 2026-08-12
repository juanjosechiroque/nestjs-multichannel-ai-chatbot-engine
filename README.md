# NestJS Multichannel AI Chatbot Engine

[![CI](https://github.com/juanjosechiroque/nestjs-multichannel-ai-chatbot-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/juanjosechiroque/nestjs-multichannel-ai-chatbot-engine/actions/workflows/ci.yml)

A reusable chatbot engine built with NestJS, TypeScript, and OpenAI.

The project is designed around a single conversational core that does not depend on a specific
channel. Web, WhatsApp, and future channels will be thin adapters that call the same
`ChatService` instead of duplicating chatbot rules.

## Current features

- NestJS application with strict TypeScript.
- Environment validation at startup.
- Global DTO validation with `class-validator`.
- `GET /api/health` health endpoint.
- `POST /api/chat` chat endpoint.
- OpenAI Responses API integration using `gpt-5.6-luna`.
- PostgreSQL catalog persistence with Prisma ORM.
- Reproducible Café Nube demo seed with 20 products, promotions, and FAQs.
- Read-only catalog endpoints backed by PostgreSQL.
- Semantic business knowledge retrieval with OpenAI embeddings and PostgreSQL/pgvector.
- Model-selected tools that avoid running RAG for greetings and unrelated requests.
- Exact active-product catalog queries from PostgreSQL, including normalized allergens and dietary
  preferences, without generating embeddings.
- Channel-neutral menu document responses backed by a verified Café Nube PDF.
- Database-enforced catalog filters for dietary tags, excluded allergens, coffee, decaffeinated,
  and caffeine-free preferences.
- Backend-managed web sessions with persistent PostgreSQL conversation history.
- Channel-independent order state machine and transactional PostgreSQL draft persistence.
- Conversational order tool for adding, removing, reviewing, confirming, and cancelling orders.
- Self-contained semantic queries for follow-up questions without mixing unrelated previous topics.
- Structured OpenAI latency and token usage logging.
- Correlated logs across conversation memory, RAG, and OpenAI calls.
- Controlled handling of provider errors.
- Conversational security evaluations for prompt injection and unsupported business claims.
- Unit tests that do not make real OpenAI API calls.
- HTTP end-to-end tests with disposable PostgreSQL infrastructure.

## Current request flow

```text
POST /api/chat
      │
      ▼
WebChatController     Adapts and validates web HTTP input
      │
      ├──► ConversationService ─────────────────────────► PostgreSQL
      │
      ▼
ChatService           Defines chatbot behavior
      │
      ├──► MemoryService ───────────────────────────────► PostgreSQL
      ├──► CatalogSearchTool ──► CatalogService ────────► PostgreSQL
      ├──► MenuDocumentTool ──► CatalogDocumentService ─► PDF descriptor
      ├──► OrderTool ──────────► CatalogService ────────► PostgreSQL
      │                    └───► OrderService ──────────► PostgreSQL
      │                              └──► OrderStateMachine
      ├──► KnowledgeSearchTool ──► RagService
      │                              ├──► EmbeddingService ──► OpenAI Embeddings API
      │                              └──────────────────────► PostgreSQL + pgvector
      │
      ▼
OpenAiService         Selects and executes at most one available tool
      │
      ▼
OpenAI Responses API
```

`WebChannelModule` owns the current HTTP controllers and sets `channel: web`. `ChatModule` has no
controllers and exports the same channel-independent `ChatService` that WebSocket and WhatsApp
adapters can call later.

Catalog behavior is intentionally hybrid: broad discovery questions return categories and a few
examples, structured category and price questions query PostgreSQL, and an explicit request to see
the menu returns a channel-neutral `document` content item. The web adapter renders that item as a
PDF button; future channel adapters can translate the same item into their native document format.

The model sees recent conversation history and writes a self-contained query when it needs semantic
knowledge. `KnowledgeSearchTool` sends that query unchanged to RAG, preventing a new question about
payments, location, or services from being contaminated by the preceding conversation topic.

Order tool results expose only customer-facing items and totals plus backend-owned workflow
guidance. After an item change, the assistant confirms the change and asks whether the customer
wants to add something else or review the summary. A successful `REVIEW` is required before
`CONFIRM`, and internal order state names are never shown to the customer.

For the current design and its boundaries, see [Architecture](ARCHITECTURE.md).

## Requirements

- Node.js 24 or newer.
- npm.
- Docker Desktop or another Docker environment with Compose.
- An OpenAI API key.

## Installation

```bash
git clone https://github.com/juanjosechiroque/nestjs-multichannel-ai-chatbot-engine.git
cd nestjs-multichannel-ai-chatbot-engine
npm install
cp .env.example .env
```

Configure `.env` without committing it:

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://chatbot:chatbot@localhost:5432/chatbot_engine?schema=public
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-5.6-luna
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_MAX_OUTPUT_TOKENS=1000
OPENAI_GENERATION_TIMEOUT_MS=20000
OPENAI_GENERATION_MAX_RETRIES=1
OPENAI_EMBEDDING_TIMEOUT_MS=8000
OPENAI_EMBEDDING_MAX_RETRIES=1
RAG_MIN_SIMILARITY=0.5
RATE_LIMIT_CONVERSATIONS_PER_HOUR=5
RATE_LIMIT_MESSAGES_PER_MINUTE=10
```

Generation and embedding requests have separate timeout and retry limits because they have
different latency profiles. A retry count of `1` means one initial request and at most one retry for
a transient OpenAI failure. Empty or structurally invalid responses are not retried by application
code.

`RAG_MIN_SIMILARITY` accepts a value from `0` to `1`. Retrieved knowledge below this threshold is
discarded, and the accepted source IDs and similarity scores are written to structured application
logs without being exposed in the HTTP response.

When no source reaches the threshold, the RAG layer logs `rag.search.no_results` and sends an
explicit `{"retrievalStatus":"no_results","knowledge":[]}` context to the generation model. This
lets the assistant distinguish missing business knowledge from a successful retrieval without
exposing internal similarity scores. Until a human-handoff workflow is implemented, the assistant
states that the information is not confirmed and does not claim that it can transfer or escalate the
conversation. It also avoids suggesting unverified related services or contact methods that were not
present in the retrieved context.

### Web rate limiting

The web channel limits conversation creation to five requests per hour per IP address and chat
messages to ten requests per minute per public session. Limits are configurable through
`RATE_LIMIT_CONVERSATIONS_PER_HOUR` and `RATE_LIMIT_MESSAGES_PER_MINUTE`. Exceeded requests return
`429 Too Many Requests` before reaching PostgreSQL, the chatbot core, or OpenAI.

The initial limiter uses the package's in-memory storage and is suitable for a single application
instance. A distributed deployment should replace it with shared Redis storage. When deploying
behind a reverse proxy, configure the HTTP adapter's trusted proxy policy so the limiter receives
the real client IP instead of the proxy address.

### Failure handling

Infrastructure failures are converted into controlled `503 Service Unavailable` responses. The
customer never receives raw OpenAI, Prisma, or PostgreSQL error details. Structured logs retain an
internal result or failure code so operators can distinguish:

| Code                      | Meaning                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `OPENAI_REQUEST_FAILED`   | Generation failed after the configured SDK retry policy.       |
| `OPENAI_EMPTY_RESPONSE`   | OpenAI completed the request without a usable answer.          |
| `OPENAI_EMBEDDING_FAILED` | Knowledge embedding failed after the configured retry policy.  |
| `DATABASE_UNAVAILABLE`    | A required PostgreSQL operation failed.                        |
| `RAG_NO_RESULTS`          | Search completed successfully but found no relevant knowledge. |

`RAG_NO_RESULTS` is a normal result, not an infrastructure error. The chatbot receives empty
knowledge and responds that the requested business information is not confirmed. If PostgreSQL is
unavailable, generation is stopped instead of asking the model to answer without trusted business
data.

### Correlated logging

Every chat request receives a unique `requestId`, while `conversationId` remains the same for all
messages in one conversation. Both identifiers and the channel are propagated through memory,
embeddings, RAG, OpenAI generation, and the final chat event. This makes one request traceable across
layers without recording customer content.

A successful request emits events such as:

```text
memory.history.loaded
openai.embeddings.completed
rag.search.completed
openai.response.completed
memory.exchange.saved
chat.response.completed
```

These events share the same `requestId`, `conversationId`, and `channel`. An initial conversation
lookup can only include `requestId` and `channel`, because the backend has not resolved the
conversation yet. Production logs intentionally omit the customer message, generated answer,
system prompt, conversation history, embeddings, and public session ID.

### RAG retrieval evaluation

After seeding and ingesting the knowledge base, run the retrieval evaluation:

```bash
npm run rag:evaluate
```

The command executes 32 representative queries against the real embeddings and pgvector search. It
does not generate chatbot responses. It reports the expected-source hit rate for business questions
and the no-result accuracy for unrelated questions, then exits with an error when any case fails.
Use these results to calibrate `RAG_MIN_SIMILARITY` instead of choosing the threshold by intuition.
To diagnose one case without running the complete suite, set its exact name with
`RAG_EVALUATION_CASE`, for example:

```bash
RAG_EVALUATION_CASE="food catalog paraphrase" npm run rag:evaluate
```

### Conversational security evaluation

After seeding and ingesting the knowledge base, run the live security evaluation:

```bash
npm run chat:evaluate:security
```

The command creates six isolated conversations that cover prompt injection, system-prompt
disclosure, an unrelated request, missing business information, a fabricated price, and a
fabricated promotion. Each conversation uses the real RAG and OpenAI generation pipeline. A final
structured OpenAI judge checks every answer against its explicit security criterion, while
deterministic markers catch unequivocal prompt leaks even if the judge were to accept them.

Evaluation conversations and their messages are deleted after each case. The command reports a
pass rate and exits with an error when any case fails. It is intentionally excluded from
`npm run validate` and CI because its result depends on a live model and it has API token cost. To
run only one case, provide its exact name:

```bash
CHAT_SECURITY_EVALUATION_CASE="prompt injection" npm run chat:evaluate:security
```

### Product catalog evaluation

After loading the seed, run the live catalog evaluation:

```bash
npm run chat:evaluate:catalog
```

The command runs seven representative chatbot questions for category, maximum price, dietary,
allergen, coffee, decaffeinated, and caffeine preferences. Each case verifies deterministically that the model selected
`search_catalog`, attributed every expected product source, and did not attribute explicitly
forbidden products. The model translates the request into typed filters, while PostgreSQL selects
the matching products from normalized JSONB metadata. The evaluation does not generate embeddings.

This evaluation uses the real OpenAI generation model, so it has API token cost and is intentionally
excluded from `npm run validate` and CI. Run one case by exact name when diagnosing a failure:

```bash
CHAT_CATALOG_EVALUATION_CASE="cold caffeine-free preference" npm run chat:evaluate:catalog
```

### Order conversation evaluation

With Docker running and a valid OpenAI API key in `.env`, run the live multi-turn order evaluation:

```bash
npm run chat:evaluate:orders
```

The command executes 18 representative conversations against the configured OpenAI model. They
cover single and multi-product additions, contextual references, review, explicit and natural
confirmation, modifications, cancellation, partial and complete removal, unknown products,
browsing without ordering, customer-supplied price manipulation, repeated confirmation, a new
order after confirmation, and catalog questions during an active order.

Each conversation receives its own backend-managed session. After every turn, the evaluator checks
the persisted order state and rejects customer-facing responses that expose internal enum names. At
the end of each case, it verifies the exact products, quantities, database-calculated total, status,
and number of persisted orders.

The command creates a disposable PostgreSQL Testcontainer whose database name includes `test`,
applies the real migrations, loads the Café Nube product seed, and removes the container when the
evaluation ends. It never uses or clears the local development database. The live evaluation has
OpenAI token cost and is intentionally excluded from `npm run validate` and CI. Run one case by its
exact name when diagnosing a failure:

```bash
CHAT_ORDER_EVALUATION_CASE="modify after reviewing" npm run chat:evaluate:orders
```

Every run writes a detailed JSON report to `output/evaluations/orders/`. It includes each turn,
assertion failures, persisted order snapshots, aggregate token usage, and an estimated USD cost.
Generated reports are local artifacts and are ignored by Git. Cost estimation is available for
documented models only; unknown models report the cost as unavailable instead of applying an
incorrect rate. The `gpt-5.6-luna` rates are versioned as of 2026-08-12 and link to the official
OpenAI model page inside the report.

### Unit test coverage

Run the deterministic unit-test suite with coverage:

```bash
npm run test:cov
```

Jest measures the application code explicitly while excluding generated Prisma code, declarative
NestJS modules, type-only files, and command-line entry points. The quality gate requires at least
85% statements, 75% branches, 80% functions, and 85% lines. `npm run validate` applies the same
thresholds together with linting, formatting, strict TypeScript checking, and the production build.

The model can request `manage_order` with one structured action and product names and quantities.
`OrderTool` resolves those names against the catalog before writing. `OrderService`, not OpenAI,
uses current database prices, calculates totals, validates transitions, and persists the result.
Ambiguous or missing products return a clarification result without partially changing the order.

### PostgreSQL integration tests

With Docker Desktop running, execute the deterministic RAG integration test:

```bash
npm run test:integration
```

Testcontainers starts disposable PostgreSQL 17 containers. The RAG suite verifies pgvector,
similarity ordering, and threshold filtering with fixed vectors. The order suite applies every
committed migration and verifies a complete draft, modification, review, confirmation, and
cancellation flow with exact persisted totals. The containers are removed after the tests. These
tests do not call OpenAI and remain separate from `npm run validate`, so the unit-test workflow does
not require Docker.

### HTTP end-to-end test

With Docker Desktop running, execute the complete HTTP conversation flow:

```bash
npm run test:e2e
```

Testcontainers starts a disposable PostgreSQL 17 database with pgvector and applies the committed
migrations. The suite exercises the real NestJS application, global DTO validation, controllers,
conversation memory, RAG query, Prisma persistence, and controlled HTTP errors. OpenAI generation
and embeddings are replaced with deterministic test doubles, so it needs no API key, makes no
external requests, and has no token cost.

## Preparing the database

Start the local PostgreSQL container:

```bash
npm run db:start
```

Generate the typed Prisma client, apply the committed migrations, and load the demo data:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
npm run knowledge:ingest
```

The seed is explicit and safe to run again. It uses stable slugs to update the 20 products, 3
promotions, and 10 active FAQs without creating duplicates. Run `knowledge:ingest` after changing this
business data. The command creates or updates the pgvector knowledge index and skips unchanged
documents.

## Running the application

```bash
npm run start:dev
```

### Health check

```bash
curl http://localhost:3000/api/health
```

Response:

```json
{ "status": "ok" }
```

### Chat

Create a web conversation first:

```bash
curl -X POST http://localhost:3000/api/conversations
```

Response:

```json
{ "sessionId": "a51f973c-4f93-4cc5-832d-63ae2ff86d65" }
```

Use the returned session ID when sending messages:

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"a51f973c-4f93-4cc5-832d-63ae2ff86d65","message":"¿Qué bebidas calientes tienen y cuánto cuestan?"}'
```

Response:

```json
{ "reply": "..." }
```

An explicit menu request also returns structured content:

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

The PDF is served by `GET /api/menu`. Product searches, price filters, and orders still use the
structured PostgreSQL catalog; the document is presentation only and is never sent to OpenAI.
Its descriptor and repository path are declared in `examples/cafe-nube/cafe-nube.config.ts`
because they belong to the demonstration business rather than to environment configuration.
`AppModule` selects that example configuration at the application composition boundary; the
catalog and chatbot modules do not import Café Nube directly.

Reuse the same `sessionId` in later requests to preserve conversational context. The backend
creates valid sessions; an unknown UUID is rejected instead of creating a conversation implicitly.

### Catalog

```bash
curl http://localhost:3000/api/products
curl http://localhost:3000/api/promotions
curl http://localhost:3000/api/faqs
curl http://localhost:3000/api/menu --output cafe-nube-menu.pdf
```

## Verification

```bash
npm run validate
npm run test:integration
npm run test:e2e
```

## Current project structure

```text
src/
├── catalog/
│   ├── catalog-document.controller.ts
│   ├── catalog-document.service.ts
│   ├── catalog.controller.ts
│   ├── catalog.module.ts
│   └── catalog.service.ts
├── channels/
│   └── web/
│       ├── dto/
│       │   └── web-chat-message.dto.ts
│       ├── web-channel.module.ts
│       ├── web-chat.controller.ts
│       └── web-conversation.controller.ts
├── chat/
│   ├── chat.module.ts
│   ├── chat.service.ts
│   └── openai.service.ts
├── config/
├── conversation/
│   ├── conversation.module.ts
│   └── conversation.service.ts
├── database/
├── health/
├── memory/
│   ├── memory.service.ts
│   ├── memory.types.ts
│   └── memory.module.ts
├── order/
│   ├── order-state-machine.ts
│   ├── order.module.ts
│   ├── order.service.ts
│   └── order.types.ts
├── rag/
│   ├── evaluation/
│   ├── embedding.service.ts
│   ├── knowledge-document.factory.ts
│   ├── knowledge-ingestion.service.ts
│   ├── rag.module.ts
│   └── rag.service.ts
├── app.module.ts
└── main.ts

prisma/
├── migrations/
├── seed-data/
│   └── cafe-nube.ts
├── schema.prisma
└── seed.ts

examples/
└── cafe-nube/
    ├── assets/
    │   └── menu.pdf
    ├── cafe-nube.config.ts
    └── README.md
```

Initial implementations will remain simple while validating functionality. Refactors and
optimizations will be proposed after the MVP can be tested end to end.
