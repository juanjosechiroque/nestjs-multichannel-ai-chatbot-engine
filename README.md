# Chatbot Engine

Motor de chatbot reutilizable construido con NestJS y TypeScript.

## Paso 1: aplicación mínima

En este punto solo tenemos:

- una aplicación NestJS;
- variables de entorno validadas;
- validación global para los futuros DTOs;
- el endpoint `GET /api/health`;
- un test unitario básico.

Todavía no agregamos PostgreSQL, Redis, RAG, OpenAI ni WebSockets. Cada pieza se incorporará
por separado y se probará antes de continuar.

## Ejecutar

```bash
cp .env.example .env
npm install
npm run start:dev
```

Visita `http://localhost:3000/api/health`. La respuesta debe ser:

```json
{ "status": "ok" }
```

## Verificar

```bash
npm run build
npm test
```

## Decisiones que ya están fijadas

- El núcleo no dependerá de WebSocket, WhatsApp ni otro canal.
- Usaremos OpenAI Responses API con `gpt-5.6-luna`.
- Usaremos `text-embedding-3-small` para embeddings.
- Empezaremos con implementaciones simples; propondremos refactors después de validar el MVP.
