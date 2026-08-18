/* global document, HTMLElement, window */

(function registerChatbotWidget() {
  const SESSION_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const MAX_TRANSCRIPT_ENTRIES = 50;

  class ChatbotHttpError extends Error {
    constructor(status, message) {
      super(message);
      this.name = 'ChatbotHttpError';
      this.status = status;
    }
  }

  class ChatbotWidget extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.initialized = false;
      this.sessionId = null;
      this.sessionPromise = null;
      this.waitingForReply = false;
    }

    connectedCallback() {
      if (this.initialized) return;

      this.initialized = true;
      this.apiUrl = this.getApiUrl();
      this.storagePrefix =
        this.getAttribute('storage-key') || `chatbot-widget:${encodeURIComponent(this.apiUrl)}`;
      this.sessionId = this.readStoredSession();
      if (!this.sessionId) this.clearStoredTranscript();
      this.render();
      this.bindEvents();
      this.restoreTranscript();
    }

    getApiUrl() {
      const configuredUrl = this.getAttribute('api-url')?.trim();
      return (configuredUrl || `${window.location.origin}/api`).replace(/\/+$/, '');
    }

    getTextAttribute(name, fallback) {
      return this.getAttribute(name)?.trim() || fallback;
    }

    get sessionStorageKey() {
      return `${this.storagePrefix}:session`;
    }

    get transcriptStorageKey() {
      return `${this.storagePrefix}:transcript`;
    }

    readStoredSession() {
      try {
        const storedSession = window.sessionStorage.getItem(this.sessionStorageKey);
        return storedSession && SESSION_ID_PATTERN.test(storedSession) ? storedSession : null;
      } catch {
        return null;
      }
    }

    storeSession(sessionId) {
      try {
        window.sessionStorage.setItem(this.sessionStorageKey, sessionId);
      } catch {
        // The widget remains usable when browser storage is unavailable.
      }
    }

    readTranscript() {
      try {
        const storedTranscript = window.sessionStorage.getItem(this.transcriptStorageKey);
        const parsedTranscript = storedTranscript ? JSON.parse(storedTranscript) : [];
        return Array.isArray(parsedTranscript) ? parsedTranscript : [];
      } catch {
        return [];
      }
    }

    storeTranscript(transcript) {
      try {
        window.sessionStorage.setItem(
          this.transcriptStorageKey,
          JSON.stringify(transcript.slice(-MAX_TRANSCRIPT_ENTRIES)),
        );
      } catch {
        // The server still owns conversation memory when browser storage is unavailable.
      }
    }

    appendTranscript(entry) {
      const transcript = this.readTranscript();
      transcript.push(entry);
      this.storeTranscript(transcript);
    }

    render() {
      const title = this.getTextAttribute('title', 'Asistente virtual');
      const subtitle = this.getTextAttribute('subtitle', 'Chat en línea');
      const accentColor = this.getTextAttribute('accent-color', '#405943');
      this.style.setProperty('--chatbot-accent', accentColor);

      this.shadowRoot.innerHTML = `
        <style>
          :host {
            --chatbot-accent: #405943;
            --chatbot-surface: #fffdf9;
            --chatbot-text: #34231d;
            --chatbot-muted: #746a63;
            --chatbot-line: #e8ded0;
            --chatbot-user: #5d765f;
            position: fixed;
            right: 1.5rem;
            bottom: 1.5rem;
            z-index: 2147483000;
            color: var(--chatbot-text);
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
              "Segoe UI", sans-serif;
          }

          *, *::before, *::after { box-sizing: border-box; }
          [hidden] { display: none !important; }
          button, textarea { font: inherit; }
          button { cursor: pointer; }
          button:focus-visible, textarea:focus-visible, a:focus-visible {
            outline: 3px solid color-mix(in srgb, var(--chatbot-accent) 30%, transparent);
            outline-offset: 3px;
          }

          .launcher {
            display: flex;
            align-items: center;
            gap: .65rem;
            min-height: 3.5rem;
            padding: .75rem 1rem;
            border: 0;
            border-radius: 999px;
            color: white;
            background: var(--chatbot-accent);
            box-shadow: 0 12px 30px rgb(52 35 29 / 25%);
            font-weight: 750;
          }

          .panel {
            display: grid;
            width: min(24rem, calc(100vw - 2rem));
            height: min(38rem, calc(100vh - 2rem));
            grid-template-rows: auto 1fr auto;
            overflow: hidden;
            border: 1px solid rgb(80 56 46 / 12%);
            border-radius: 1.4rem;
            background: var(--chatbot-surface);
            box-shadow: 0 20px 55px rgb(52 35 29 / 18%);
          }

          .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 1rem 1.1rem;
            color: white;
            background: var(--chatbot-accent);
          }

          .identity { display: flex; align-items: center; gap: .7rem; }
          .avatar {
            display: grid;
            width: 2.5rem;
            height: 2.5rem;
            place-items: center;
            border-radius: 50%;
            color: var(--chatbot-text);
            background: #f7f0e3;
          }
          .identity strong, .identity small { display: block; }
          .identity small { margin-top: .15rem; color: rgb(255 255 255 / 75%); }
          .close {
            width: 2.3rem;
            height: 2.3rem;
            border: 0;
            border-radius: 50%;
            color: white;
            background: transparent;
            font-size: 1.35rem;
          }
          .close:hover { background: rgb(255 255 255 / 12%); }

          .messages {
            display: flex;
            flex-direction: column;
            gap: .8rem;
            overflow-y: auto;
            padding: 1.1rem;
            background: #faf7f1;
            scroll-behavior: smooth;
          }

          .message {
            max-width: 84%;
            padding: .75rem .9rem;
            border-radius: 1rem;
            font-size: .92rem;
            line-height: 1.45;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
          }
          .assistant {
            align-self: flex-start;
            border: 1px solid var(--chatbot-line);
            border-bottom-left-radius: .3rem;
            background: white;
          }
          .user {
            align-self: flex-end;
            border-bottom-right-radius: .3rem;
            color: white;
            background: var(--chatbot-user);
          }
          .status { align-self: center; color: var(--chatbot-muted); text-align: center; }
          .message a { color: var(--chatbot-accent); font-weight: 700; }

          .document {
            display: grid;
            gap: .35rem;
            width: min(84%, 19rem);
            align-self: flex-start;
            padding: .85rem;
            border: 1px solid var(--chatbot-line);
            border-radius: 1rem;
            background: white;
          }
          .document small { color: var(--chatbot-muted); }
          .document a {
            width: fit-content;
            margin-top: .25rem;
            padding: .55rem .75rem;
            border-radius: .65rem;
            color: white;
            background: var(--chatbot-accent);
            font-weight: 700;
            text-decoration: none;
          }

          .typing { display: inline-flex; gap: .25rem; }
          .typing span {
            width: .36rem;
            height: .36rem;
            border-radius: 50%;
            background: #998c83;
            animation: bounce 1s infinite ease-in-out;
          }
          .typing span:nth-child(2) { animation-delay: 120ms; }
          .typing span:nth-child(3) { animation-delay: 240ms; }
          @keyframes bounce {
            0%, 80%, 100% { transform: scale(.7); }
            40% { transform: scale(1); }
          }

          .form {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: .65rem;
            padding: .85rem;
            border-top: 1px solid var(--chatbot-line);
            background: var(--chatbot-surface);
          }
          textarea {
            min-height: 2.8rem;
            max-height: 7rem;
            resize: none;
            padding: .72rem .8rem;
            border: 1px solid var(--chatbot-line);
            border-radius: .8rem;
            color: var(--chatbot-text);
            background: white;
          }
          .send {
            width: 2.8rem;
            height: 2.8rem;
            border: 0;
            border-radius: .8rem;
            color: white;
            background: var(--chatbot-accent);
            font-size: 1.15rem;
          }
          button:disabled, textarea:disabled { cursor: not-allowed; opacity: .55; }

          @media (max-width: 32rem) {
            :host { right: 1rem; bottom: 1rem; }
          }
        </style>

        <button class="launcher" type="button" aria-label="Abrir chat">
          <span aria-hidden="true">☕</span>
          <span class="launcher-label">Conversemos</span>
        </button>

        <section class="panel" role="dialog" aria-label="${this.escapeAttribute(title)}" hidden>
          <header class="header">
            <div class="identity">
              <span class="avatar" aria-hidden="true">☕</span>
              <div><strong class="title"></strong><small class="subtitle"></small></div>
            </div>
            <button class="close" type="button" aria-label="Minimizar chat">−</button>
          </header>
          <div class="messages" role="log" aria-live="polite" aria-label="Mensajes"></div>
          <form class="form">
            <textarea rows="1" maxlength="2000" aria-label="Escribe tu mensaje" placeholder="Escribe tu mensaje…" disabled required></textarea>
            <button class="send" type="submit" aria-label="Enviar mensaje" disabled>➜</button>
          </form>
        </section>
      `;

      this.elements = {
        launcher: this.shadowRoot.querySelector('.launcher'),
        launcherLabel: this.shadowRoot.querySelector('.launcher-label'),
        panel: this.shadowRoot.querySelector('.panel'),
        close: this.shadowRoot.querySelector('.close'),
        title: this.shadowRoot.querySelector('.title'),
        subtitle: this.shadowRoot.querySelector('.subtitle'),
        messages: this.shadowRoot.querySelector('.messages'),
        form: this.shadowRoot.querySelector('.form'),
        input: this.shadowRoot.querySelector('textarea'),
        send: this.shadowRoot.querySelector('.send'),
      };
      this.elements.title.textContent = title;
      this.elements.subtitle.textContent = subtitle;
    }

    escapeAttribute(value) {
      return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
    }

    bindEvents() {
      this.elements.launcher.addEventListener('click', () => void this.open());
      this.elements.close.addEventListener('click', () => this.close());
      this.elements.form.addEventListener('submit', (event) => void this.submit(event));
      this.elements.input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          this.elements.form.requestSubmit();
        }
      });
      this.elements.input.addEventListener('input', () => {
        this.elements.input.style.height = 'auto';
        this.elements.input.style.height = `${Math.min(this.elements.input.scrollHeight, 112)}px`;
      });
    }

    restoreTranscript() {
      const transcript = this.readTranscript();
      for (const entry of transcript) {
        if (entry?.type === 'message' && typeof entry.text === 'string') {
          this.addMessage(entry.text, entry.role === 'user' ? 'user' : 'assistant', false);
        } else if (entry?.type === 'document') {
          this.addDocument(entry, false);
        }
      }
    }

    async open() {
      this.elements.panel.hidden = false;
      this.elements.launcher.hidden = true;

      try {
        await this.startSession();
        this.elements.input.focus();
      } catch (error) {
        this.addStatus(this.getErrorMessage(error));
      }
    }

    close() {
      this.elements.panel.hidden = true;
      this.elements.launcher.hidden = false;
      this.elements.launcher.focus();
    }

    async startSession() {
      if (this.sessionId) {
        this.ensureGreeting();
        this.setEnabled(true);
        return this.sessionId;
      }
      if (this.sessionPromise) return this.sessionPromise;

      this.elements.launcherLabel.textContent = 'Conectando…';
      this.setEnabled(false);
      this.sessionPromise = this.request('/conversations', { method: 'POST' })
        .then((data) => {
          if (!SESSION_ID_PATTERN.test(data.sessionId || '')) {
            throw new Error('El servidor no devolvió una sesión válida.');
          }
          this.sessionId = data.sessionId;
          this.storeSession(this.sessionId);
          this.ensureGreeting();
          this.setEnabled(true);
          this.elements.launcherLabel.textContent = 'Conversemos';
          return this.sessionId;
        })
        .catch((error) => {
          this.elements.launcherLabel.textContent = 'Reintentar chat';
          throw error;
        })
        .finally(() => {
          this.sessionPromise = null;
        });

      return this.sessionPromise;
    }

    ensureGreeting() {
      if (this.readTranscript().length > 0) return;
      const greeting = this.getTextAttribute(
        'greeting',
        '¡Hola! Soy tu asistente virtual. ¿En qué puedo ayudarte?',
      );
      this.addMessage(greeting, 'assistant');
    }

    async submit(event) {
      event.preventDefault();
      const message = this.elements.input.value.trim();
      if (!message || this.waitingForReply || !this.sessionId) return;

      this.elements.input.value = '';
      this.elements.input.style.height = 'auto';
      await this.sendMessage(message);
    }

    async sendMessage(message) {
      this.waitingForReply = true;
      this.setEnabled(false);
      this.addMessage(message, 'user');
      const typingIndicator = this.showTypingIndicator();
      const messageId = window.crypto.randomUUID();

      try {
        const payload = { sessionId: this.sessionId, messageId, message };
        const data = await this.requestWithNetworkRetry('/chat', payload);
        typingIndicator.remove();
        this.addMessage(data.reply || 'No recibí una respuesta. Intenta nuevamente.', 'assistant');
        this.addResponseContent(data.content);
      } catch (error) {
        typingIndicator.remove();
        if (error instanceof ChatbotHttpError && error.status === 404) {
          this.clearStoredConversation();
        }
        this.addStatus(this.getErrorMessage(error));
      } finally {
        this.waitingForReply = false;
        this.setEnabled(Boolean(this.sessionId));
        this.elements.input.focus();
      }
    }

    async requestWithNetworkRetry(path, payload) {
      const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      };

      try {
        return await this.request(path, options);
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        return this.request(path, options);
      }
    }

    async request(path, options) {
      const response = await window.fetch(`${this.apiUrl}${path}`, options);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const responseMessage = Array.isArray(data.message) ? data.message.join(' ') : data.message;
        throw new ChatbotHttpError(
          response.status,
          responseMessage || 'La solicitud no pudo completarse.',
        );
      }
      return data;
    }

    clearStoredTranscript() {
      try {
        window.sessionStorage.removeItem(this.transcriptStorageKey);
      } catch {
        // No cleanup is needed when browser storage is unavailable.
      }
    }

    clearStoredConversation() {
      this.sessionId = null;
      try {
        window.sessionStorage.removeItem(this.sessionStorageKey);
        window.sessionStorage.removeItem(this.transcriptStorageKey);
      } catch {
        // No cleanup is needed when browser storage is unavailable.
      }
      this.elements.messages.replaceChildren();
    }

    addMessage(text, role, persist = true) {
      const message = document.createElement('div');
      message.className = `message ${role}`;
      this.appendLinkedText(message, text);
      this.elements.messages.append(message);
      this.scrollToLatest();
      if (persist) this.appendTranscript({ type: 'message', role, text });
      return message;
    }

    addStatus(text) {
      const status = document.createElement('div');
      status.className = 'message status';
      status.textContent = text;
      this.elements.messages.append(status);
      this.scrollToLatest();
    }

    appendLinkedText(container, text) {
      const urlPattern = /https?:\/\/[^\s]+/g;
      let currentIndex = 0;
      for (const match of text.matchAll(urlPattern)) {
        const matchIndex = match.index ?? currentIndex;
        const rawUrl = match[0];
        const url = rawUrl.replace(/[.,;:!?]+$/, '');
        container.append(document.createTextNode(text.slice(currentIndex, matchIndex)));
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = this.getLinkLabel(url);
        container.append(link);
        container.append(document.createTextNode(rawUrl.slice(url.length)));
        currentIndex = matchIndex + rawUrl.length;
      }
      container.append(document.createTextNode(text.slice(currentIndex)));
    }

    getLinkLabel(url) {
      try {
        const parsedUrl = new URL(url);
        return parsedUrl.hostname.endsWith('google.com') && parsedUrl.pathname.startsWith('/maps')
          ? 'Abrir en Google Maps'
          : `Abrir ${parsedUrl.hostname.replace(/^www\./, '')}`;
      } catch {
        return 'Abrir enlace';
      }
    }

    addResponseContent(content) {
      if (!Array.isArray(content)) return;
      for (const item of content) {
        if (item?.type === 'document' && item.mimeType === 'application/pdf') {
          this.addDocument(item);
        }
      }
    }

    addDocument(content, persist = true) {
      if (typeof content.title !== 'string' || typeof content.url !== 'string') return;
      const card = document.createElement('div');
      card.className = 'document';
      const title = document.createElement('strong');
      title.textContent = content.title;
      const format = document.createElement('small');
      format.textContent = 'Documento PDF';
      const link = document.createElement('a');
      link.href = new URL(content.url, `${this.apiUrl}/`).href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Ver documento';
      card.append(title, format, link);
      this.elements.messages.append(card);
      this.scrollToLatest();
      if (persist) {
        this.appendTranscript({
          type: 'document',
          title: content.title,
          url: content.url,
          mimeType: content.mimeType,
        });
      }
    }

    showTypingIndicator() {
      const indicator = document.createElement('div');
      indicator.className = 'message assistant';
      indicator.setAttribute('aria-label', 'El asistente está escribiendo');
      const typing = document.createElement('span');
      typing.className = 'typing';
      typing.setAttribute('aria-hidden', 'true');
      typing.append(
        document.createElement('span'),
        document.createElement('span'),
        document.createElement('span'),
      );
      indicator.append(typing);
      this.elements.messages.append(indicator);
      this.scrollToLatest();
      return indicator;
    }

    setEnabled(enabled) {
      this.elements.input.disabled = !enabled;
      this.elements.send.disabled = !enabled;
    }

    scrollToLatest() {
      this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
    }

    getErrorMessage(error) {
      if (error instanceof TypeError) {
        return 'No pudimos conectar con el chatbot. Verifica que la API esté disponible.';
      }
      if (error instanceof ChatbotHttpError && error.status === 404) {
        return 'La conversación ya no está disponible. Cierra y vuelve a abrir el chat para iniciar otra.';
      }
      return error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
    }
  }

  if (!window.customElements.get('chatbot-widget')) {
    window.customElements.define('chatbot-widget', ChatbotWidget);
  }
})();
