# NestJS Multichannel AI Chatbot Engine

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
- Reproducible Café Nube demo seed with products, promotions, and FAQs.
- Read-only catalog endpoints backed by PostgreSQL.
- Semantic business knowledge retrieval with OpenAI embeddings and PostgreSQL/pgvector.
- Backend-managed web sessions with persistent PostgreSQL conversation history.
- Structured OpenAI latency and token usage logging.
- Controlled handling of provider errors.
- Unit tests that do not make real OpenAI API calls.

## Current request flow

```text
POST /api/chat
      │
      ▼
ChatController        Receives and validates HTTP input
      │
      ├──► ConversationService ─────────────────────────► PostgreSQL
      │
      ▼
ChatService           Defines chatbot behavior
      │
      ├──► RagService ──► EmbeddingService ─────────────► OpenAI Embeddings API
      │         └───────────────────────────────────────► PostgreSQL + pgvector
      ├──► MemoryService ───────────────────────────────► PostgreSQL
      │
      ▼
OpenAiService         Encapsulates the OpenAI SDK
      │
      ▼
OpenAI Responses API
```

`ChatService` does not depend on HTTP. WebSocket and WhatsApp adapters will eventually call the
same service.

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
OPENAI_MAX_OUTPUT_TOKENS=500
RAG_MIN_SIMILARITY=0.5
```

`RAG_MIN_SIMILARITY` accepts a value from `0` to `1`. Retrieved knowledge below this threshold is
discarded, and the accepted source IDs and similarity scores are written to structured application
logs without being exposed in the HTTP response.

### RAG retrieval evaluation

After seeding and ingesting the knowledge base, run the retrieval evaluation:

```bash
npm run rag:evaluate
```

The command executes 26 representative queries against the real embeddings and pgvector search. It
does not generate chatbot responses. It reports the expected-source hit rate for business questions
and the no-result accuracy for unrelated questions, then exits with an error when any case fails.
Use these results to calibrate `RAG_MIN_SIMILARITY` instead of choosing the threshold by intuition.
To diagnose one case without running the complete suite, set its exact name with
`RAG_EVALUATION_CASE`, for example:

```bash
RAG_EVALUATION_CASE="food catalog paraphrase" npm run rag:evaluate
```

### PostgreSQL integration test

With Docker Desktop running, execute the deterministic RAG integration test:

```bash
npm run test:integration
```

Testcontainers starts a disposable PostgreSQL 17 container with pgvector, verifies that the vector
extension is available, and checks similarity ordering and threshold filtering with fixed vectors.
It stops and removes the container after the test. The test does not call OpenAI and is intentionally
kept separate from `npm run validate`, so the unit-test workflow remains fast and does not require
Docker.

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

The seed is explicit and safe to run again. It uses stable slugs to update the 10 products, 3
promotions, and 9 active FAQs without creating duplicates. Run `knowledge:ingest` after changing this
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

Reuse the same `sessionId` in later requests to preserve conversational context. The backend
creates valid sessions; an unknown UUID is rejected instead of creating a conversation implicitly.

### Catalog

```bash
curl http://localhost:3000/api/products
curl http://localhost:3000/api/promotions
curl http://localhost:3000/api/faqs
```

## Verification

```bash
npm run build
npm test
```

## Current project structure

```text
src/
├── catalog/
│   ├── catalog.controller.ts
│   ├── catalog.module.ts
│   └── catalog.service.ts
├── chat/
│   ├── dto/
│   ├── chat.controller.ts
│   ├── chat.module.ts
│   ├── chat.service.ts
│   └── openai.service.ts
├── config/
├── conversation/
│   ├── conversation.controller.ts
│   ├── conversation.module.ts
│   └── conversation.service.ts
├── database/
├── health/
├── memory/
│   ├── memory.service.ts
│   ├── memory.types.ts
│   └── memory.module.ts
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
```

Initial implementations will remain simple while validating functionality. Refactors and
optimizations will be proposed after the MVP can be tested end to end.
