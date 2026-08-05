# Architecture

This document describes the current structure and the boundaries that allow the chatbot engine
to support multiple channels without duplicating conversational logic.

## System design

The current request path is:

```text
HTTP request → DTO validation → ChatController → ChatService → OpenAiService → OpenAI
```

```mermaid
flowchart LR
    client["API consumer"]

    subgraph app["NestJS application"]
        controller["ChatController<br/>HTTP input and output"]
        chat["ChatService<br/>Chatbot behavior"]
        provider["OpenAiService<br/>OpenAI SDK"]

        controller --> chat --> provider
    end

    openai["OpenAI Responses API"]

    client -->|"HTTP / JSON"| controller
    provider -->|"Responses API"| openai
```

Chat requests are still stateless and do not use conversation history yet. PostgreSQL currently
stores the business catalog, but `ChatService` is not connected to that data until retrieval is
implemented.

The demo data path is separate from the chat request path:

```text
Café Nube seed → Prisma Client → PostgreSQL
```

## Multichannel boundary

Channels must remain adapters around the conversational core:

```text
Web adapter ─────┐
                 ├──→ ChatService
WhatsApp adapter ┘
```

A channel may validate its payload, normalize the incoming message, and format the outgoing
response. It must not contain prompts, knowledge retrieval, memory rules, or order logic.

## Component responsibilities

| Component        | Responsibility                                 | Must not                              |
| ---------------- | ---------------------------------------------- | ------------------------------------- |
| `controller`     | Handle transport input and output              | Contain chatbot rules                 |
| `DTO`            | Validate the transport contract                | Contain business logic                |
| `ChatService`    | Define chatbot behavior and coordinate a reply | Depend on HTTP or a messaging channel |
| `OpenAiService`  | Encapsulate the OpenAI SDK and provider errors | Handle channel payloads               |
| `ConfigModule`   | Load and validate environment variables        | Expose secrets in logs or responses   |
| `DatabaseModule` | Provide one shared Prisma database client      | Contain catalog or chatbot rules      |
| Prisma seed      | Load reproducible public demonstration data    | Become a runtime dependency           |

## Decisions and trade-offs

| Decision                    | Reason                                                         | Accepted cost                                      |
| --------------------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| NestJS + strict TypeScript  | Provides modules, dependency injection, and explicit contracts | More framework structure than Express              |
| OpenAI Responses API        | Current API for model responses and future tool use            | Creates an external provider dependency            |
| `gpt-5.6-luna`              | Fits a cost-sensitive conversational workload                  | Harder requests may require a stronger model       |
| HTTP endpoint first         | Validates the core with minimal transport complexity           | WebSocket streaming is not available yet           |
| PostgreSQL + Prisma         | Keeps catalog data structured, queryable, and type-safe        | Requires a local database and migrations           |
| Demo seed in the repository | Makes the project reproducible for reviewers and contributors  | Demo content must stay separate from engine logic  |
| No chat memory yet          | Keeps the current conversation flow simple                     | Requests still have no conversation history        |
| Mocked OpenAI in unit tests | Tests remain fast and do not consume API credits               | Provider integration still needs a real smoke test |

## Project structure

```text
src/
├── chat/
│   ├── dto/
│   │   └── chat-message.dto.ts
│   ├── chat.controller.ts
│   ├── chat.module.ts
│   ├── chat.service.ts
│   ├── chat.service.spec.ts
│   └── openai.service.ts
├── config/
│   ├── environment.ts
│   └── environment.spec.ts
├── database/
│   ├── database.module.ts
│   └── prisma.service.ts
├── health/
├── app.module.ts
└── main.ts

prisma/
├── migrations/
├── seed-data/
│   └── cafe-nube.ts
├── schema.prisma
└── seed.ts
```

New channel, retrieval, memory, and order modules will be added only when their functionality is
implemented. Empty architectural layers are intentionally avoided.
