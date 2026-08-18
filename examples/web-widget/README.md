# Portable Web Widget Example

This framework-free Web Component demonstrates how an external website can consume the chatbot's
Web HTTP adapter. It is an example client, not part of the channel-independent chatbot core.

## Run locally

Start the API from the repository root:

```bash
npm run start:dev
```

Serve this directory with any static file server. For example, with VS Code Live Server or:

```bash
npx serve examples/web-widget --listen 4173
```

Then open the URL printed by the static server. The example expects the API at
`http://localhost:3000/api`.

## Embed in an HTML page

Copy `chatbot-widget.js` to the website and add:

```html
<chatbot-widget
  api-url="https://api.example.com/api"
  title="My business"
  subtitle="Virtual assistant"
  greeting="Hello! How can I help you?"
  accent-color="#405943"
></chatbot-widget>

<script src="/assets/chatbot-widget.js"></script>
```

If the API and page share an origin, `api-url` may be omitted and defaults to `/api` on the current
origin. `storage-key` is optional and can isolate multiple widgets that use the same API.

## Client responsibilities

- Requests a backend-managed session from `POST /api/conversations`.
- Keeps the session and visible transcript in tab-scoped `sessionStorage`.
- Generates one UUID `messageId` for every new customer message.
- Reuses the same `messageId` for one uncertain network retry.
- Renders reply text, safe links, and channel-neutral PDF document descriptors.
- Uses Shadow DOM so its styles do not leak into the host page.

The widget does not contain prompts, retrieval rules, prices, order transitions, or other chatbot
business behavior. Add every website that hosts it to the API's comma-separated
`CORS_ALLOWED_ORIGINS` configuration.
