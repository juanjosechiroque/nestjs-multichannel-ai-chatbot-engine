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
- Business-aware chat responses using the active catalog as controlled model context.
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
      ▼
ChatService           Defines chatbot behavior
      │
      ├──► KnowledgeContextService ──► CatalogService ──► PostgreSQL
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
OPENAI_MAX_OUTPUT_TOKENS=500
```

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
```

The seed is explicit and safe to run again. It uses stable slugs to update the 10 products, 3
promotions, and 8 FAQs without creating duplicates.

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

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"¿Qué bebidas calientes tienen y cuánto cuestan?"}'
```

Response:

```json
{ "reply": "..." }
```

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
├── database/
├── health/
├── knowledge/
│   ├── knowledge-context.service.ts
│   └── knowledge.module.ts
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
