# Architecture

This document describes the current structure and the boundaries that allow the chatbot engine
to support multiple channels without duplicating conversational logic.

## System design

The current request path is:

```text
HTTP request → DTO validation → ChatController
                                   ├→ ConversationService → PostgreSQL
                                   └→ ChatService
                                       ├→ MemoryService → PostgreSQL
                                       └→ OpenAiService → OpenAI
                                           ├→ CatalogSearchTool
                                           │   └→ CatalogService → PostgreSQL
                                           ├→ MenuDocumentTool
                                           │   └→ CatalogDocumentService → PDF descriptor
                                           ├→ OrderTool
                                           │   ├→ CatalogService → PostgreSQL
                                           │   └→ OrderService → OrderStateMachine → PostgreSQL
                                           └→ KnowledgeSearchTool
                                               └→ RagService
                                                   ├→ EmbeddingService → OpenAI
                                                   └→ PostgreSQL + pgvector
```

```mermaid
flowchart LR
    client["API consumer"]

    subgraph app["NestJS application"]
        controller["ChatController<br/>HTTP input and output"]
        conversation["ConversationService<br/>Session lifecycle and resolution"]
        chat["ChatService<br/>Chatbot behavior"]
        catalogTool["CatalogSearchTool<br/>Exact active products"]
        menuTool["MenuDocumentTool<br/>Menu document descriptor"]
        orderTool["OrderTool<br/>Structured order actions"]
        knowledgeTool["KnowledgeSearchTool<br/>Semantic business knowledge"]
        catalog["CatalogService<br/>Structured catalog queries"]
        rag["RagService<br/>Relevant business context"]
        embedding["EmbeddingService<br/>OpenAI embeddings"]
        memory["MemoryService<br/>Recent conversation history"]
        provider["OpenAiService<br/>OpenAI SDK"]

        controller --> conversation
        controller --> chat --> provider
        provider --> catalogTool --> catalog
        provider --> menuTool --> menuDocument["CatalogDocumentService<br/>Channel-neutral document"]
        provider --> orderTool --> catalog
        orderTool --> orders["OrderService<br/>Prices, totals, and persistence"]
        orders --> stateMachine["OrderStateMachine<br/>Valid transitions"]
        provider --> knowledgeTool --> rag --> embedding
        chat --> memory
    end

    openai["OpenAI APIs"]
    postgres["PostgreSQL"]

    client -->|"HTTP / JSON"| controller
    provider -->|"Responses API"| openai
    embedding -->|"Embeddings API"| openai
    catalog -->|"Prisma"| postgres
    orders -->|"Prisma"| postgres
    conversation -->|"Prisma"| postgres
    rag -->|"pgvector"| postgres
    memory -->|"Prisma"| postgres
```

The web adapter resolves a backend-created public session ID through `ConversationService` before
calling `ChatService` with the internal conversation ID. `MemoryService` loads the latest 10
messages and stores completed user/assistant exchanges using that internal ID. The model may select
one tool per message. `CatalogSearchTool` translates typed product preferences into exact
PostgreSQL queries, while `KnowledgeSearchTool` delegates semantic business questions to
`RagService`. `MenuDocumentTool` returns only a document descriptor for explicit menu-view
requests, so the PDF and full catalog are not added to the model context. `OrderTool` translates
only the model's structured action, product names, and
quantities into application operations:

```text
OpenAI → OrderTool → CatalogService
                  └→ OrderService → OrderStateMachine → PostgreSQL
```

`OrderStateMachine` owns valid transitions without depending on NestJS, Prisma, OpenAI, or a
channel. `OrderTool` resolves names against real products and rejects ambiguous matches before any
write. `OrderService` validates active products, preserves price snapshots, calculates totals with
decimal arithmetic, applies transitions, and persists multi-item actions transactionally. OpenAI
cannot provide prices, totals, order IDs, or state transitions. Tool output contains a
customer-safe order snapshot and state-machine-derived workflow guidance, so the model knows when
`REVIEW` or `CONFIRM` is valid without exposing internal state names in its answer.

`AppModule` is the composition boundary that selects the Café Nube example configuration. Generic
catalog and chatbot modules consume the resulting configuration through NestJS `ConfigService`
without importing the example business.

For semantic knowledge, the model uses recent history to formulate a self-contained query.
`KnowledgeSearchTool` sends only that query to `RagService`; it does not blindly concatenate the
previous customer message, which avoids cross-topic retrieval contamination.

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

| Component                   | Responsibility                                    | Must not                               |
| --------------------------- | ------------------------------------------------- | -------------------------------------- |
| `controller`                | Handle transport input and output                 | Contain chatbot rules                  |
| `DTO`                       | Validate the transport contract                   | Contain business logic                 |
| `ConversationService`       | Create and resolve backend-managed conversations  | Contain prompts or channel payloads    |
| `ChatService`               | Define chatbot behavior and coordinate a reply    | Depend on HTTP or a messaging channel  |
| `OpenAiService`             | Encapsulate the OpenAI SDK and provider errors    | Handle channel payloads                |
| `ConfigModule`              | Load and validate environment variables           | Expose secrets in logs or responses    |
| `DatabaseModule`            | Provide one shared Prisma database client         | Contain catalog or chatbot rules       |
| `CatalogService`            | Read structured business data through Prisma      | Depend on HTTP or a messaging channel  |
| `CatalogSearchTool`         | Adapt typed product preferences to catalog search | Calculate orders or claim live stock   |
| `MenuDocumentTool`          | Return a channel-neutral menu descriptor          | Read or summarize the PDF with the LLM |
| `CatalogDocumentService`    | Locate the example-provided menu presentation     | Become the product source of truth     |
| `OrderTool`                 | Adapt structured actions to order operations      | Set prices, totals, or transitions     |
| `KnowledgeSearchTool`       | Adapt semantic model queries to the RAG service   | Query structured transactional data    |
| `EmbeddingService`          | Generate fixed-size vectors through OpenAI        | Build prompts or handle channels       |
| `RagService`                | Retrieve relevant knowledge through pgvector      | Own structured catalog data            |
| `KnowledgeIngestionService` | Build the derived vector index from active data   | Become the source of truth             |
| `MemoryService`             | Load and save history by internal conversation ID | Resolve public sessions or channels    |
| `OrderStateMachine`         | Validate order states and transitions             | Access databases, models, or channels  |
| `OrderService`              | Apply and persist transactional order actions     | Interpret natural language             |
| Prisma seed                 | Load reproducible public demonstration data       | Become a runtime dependency            |

## Decisions and trade-offs

| Decision                        | Reason                                                          | Accepted cost                                        |
| ------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| NestJS + strict TypeScript      | Provides modules, dependency injection, and explicit contracts  | More framework structure than Express                |
| OpenAI Responses API            | Current API for model responses and future tool use             | Creates an external provider dependency              |
| `gpt-5.6-luna`                  | Fits a cost-sensitive conversational workload                   | Harder requests may require a stronger model         |
| HTTP endpoint first             | Validates the core with minimal transport complexity            | WebSocket streaming is not available yet             |
| PostgreSQL + Prisma             | Keeps catalog data structured, queryable, and type-safe         | Requires a local database and migrations             |
| Normalized product JSONB        | Adds preference filters without premature relation tables       | Database constraints do not enforce metadata values  |
| Demo seed in the repository     | Makes the project reproducible for reviewers and contributors   | Demo content must stay separate from engine logic    |
| Demo assets in `examples/`      | Keeps the sample PDF reproducible without environment variables | A different example needs its own composition config |
| OpenAI `text-embedding-3-small` | Reuses the existing provider and SDK                            | Adds one small embedding request per search          |
| Exact pgvector search           | Is simple and accurate for the current small knowledge base     | Needs a vector index when the dataset becomes large  |
| Five retrieved chunks           | Reduces generation input while keeping useful context           | Exhaustive lists need aggregate catalog chunks       |
| PostgreSQL conversation history | Reuses existing infrastructure and persists sessions            | Adds database reads and writes per chat request      |
| Backend-created web sessions    | Gives the platform control over valid conversations             | Requires a session-creation request before chat      |
| Last 10 messages as context     | Bounds the initial memory implementation                        | Older messages are not sent to the model             |
| Application-managed history     | Keeps memory independent from the model provider                | Does not preserve provider-specific reasoning items  |
| PostgreSQL order drafts         | Persists state independently from LLM conversation context      | Abandoned drafts require expiration handling         |
| Product price snapshots         | Keeps existing orders stable when catalog prices change         | Duplicates selected catalog fields in order items    |
| PDF as presentation only        | Gives rich channels a scalable full-menu artifact               | Must be updated when the demo catalog changes        |
| Mocked OpenAI in unit tests     | Tests remain fast and do not consume API credits                | Provider integration still needs a real smoke test   |

## Project structure

```text
src/
├── catalog/
│   ├── catalog.controller.ts
│   ├── catalog.module.ts
│   └── catalog.service.ts
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
├── conversation/
│   ├── conversation.controller.ts
│   ├── conversation.module.ts
│   ├── conversation.service.ts
│   ├── conversation.service.spec.ts
│   └── conversation.types.ts
├── database/
│   ├── database.module.ts
│   └── prisma.service.ts
├── health/
├── memory/
│   ├── memory.module.ts
│   ├── memory.service.ts
│   ├── memory.service.spec.ts
│   └── memory.types.ts
├── order/
│   ├── order-state-machine.ts
│   ├── order.service.ts
│   ├── order.module.ts
│   └── order.types.ts
├── rag/
│   ├── embedding.service.ts
│   ├── ingest-knowledge.ts
│   ├── knowledge-document.factory.ts
│   ├── knowledge-ingestion.service.ts
│   ├── rag.module.ts
│   ├── rag.service.ts
│   └── rag.types.ts
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

New channel and workflow modules will be added only when their functionality is implemented. Empty
architectural layers are intentionally avoided.
