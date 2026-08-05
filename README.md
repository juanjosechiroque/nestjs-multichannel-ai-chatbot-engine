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
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-5.6-luna
OPENAI_MAX_OUTPUT_TOKENS=500
```

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
  -d '{"message":"Hello, who are you?"}'
```

Response:

```json
{ "reply": "..." }
```

## Verification

```bash
npm run build
npm test
```

## Current project structure

```text
src/
├── chat/
│   ├── dto/
│   ├── chat.controller.ts
│   ├── chat.module.ts
│   ├── chat.service.ts
│   └── openai.service.ts
├── config/
├── health/
├── app.module.ts
└── main.ts
```

Initial implementations will remain simple while validating functionality. Refactors and
optimizations will be proposed after the MVP can be tested end to end.
