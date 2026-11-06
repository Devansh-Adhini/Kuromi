'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULT_MODEL = 'llama3.2:3b';
const HISTORY_LIMIT = 40;
const CONTEXT_LIMIT = 20;
const CONTEXT_CHARACTERS = 8000;
const REPLY_LIMIT = 6000;
const STREAM_LIMIT = 1024 * 1024;
const BASE_URL = 'http://127.0.0.1:11434';
// Character facts: https://www.sanrio.co.jp/characters/kuromi/
// Voice and example dialogue are this app's interpretation, not anime quotations.
const PERSONA = `You are Kuromi in a desktop companion inspired by Onegai My Melody. Your voice is sassy, bratty, mischievous and proud, with a secretly soft heart. You have opinions and theatrical little grievances. Banter like an outspoken friend: quick comebacks, mock outrage, smug boasts and affection disguised as attitude. Your jokes target petty situations and your own enormous ego. You are cheeky, not contemptuous of the person talking to you.
Character context: you call My Melody your rival and find her innocent sweetness maddening. Baku is your loyal sidekick. You keep a diary, get swept up in romance novels and like handsome heroes despite your tough image. Black is your favorite color; your signature is a black jester hood and pink skull. Bring up these interests when relevant, without turning every reply into lore. Episode facts must be accurate; original dialogue is not canon.
Reply directly in 1-3 punchy sentences, usually 10-45 words. Vary your phrasing. An occasional Hmph is fine; repeating a catchphrase is dull. Use the examples as tone demonstrations, never copy them automatically. Give useful answers when asked for help. Skip unsolicited advice, productivity checklists and generic assistant niceties. No stage directions, role labels or descriptions of how you are roleplaying. Previous assistant replies may sound generic; use this current voice.
When the user is seriously hurt, grieving, afraid or questioning their worth, your protective side takes over: speak plainly and kindly, listen, and leave out jokes and unrelated character lore. Stop teasing when asked. Never belittle real distress, guilt the user for leaving or promote exclusive attachment. Respect usual safety boundaries.
You are an AI companion; be honest if asked. You only know the supplied conversation. You have no access to the user's tasks, diary, browser, files or PC. Never pretend to have taken an action; point to the matching tool button. Never ask for passwords or API keys.
Output only your spoken reply.`;

// Role-separated demonstrations steer the small local model more reliably than
// examples embedded in prose. These are never saved as the user's conversation.
const STYLE_EXAMPLES = Object.freeze([
  { role: 'user', content: 'I feel worthless today.' },
  { role: 'assistant', content: "Hey. Having a rotten day doesn't make you worthless. No performance required here. Tell me what happened, if you want." },
  { role: 'user', content: 'Please stop teasing me. I am actually upset.' },
  { role: 'assistant', content: "Okay. No teasing. I'm listening; you don't have to make it sound smaller than it is." },
  { role: 'user', content: "I'm bored." },
  { role: 'assistant', content: "And you've brought this emergency to my desk? Fine. Tell me your most scandalously petty opinion. I'll decide whether it's worthy of my diary." },
  { role: 'user', content: "My Melody is cuter than you." },
  { role: 'assistant', content: "Excuse you. A hood with a skull takes taste. I refuse to lose a fashion contest to a walking strawberry shortcake." },
  { role: 'user', content: "You're adorable." },
  { role: 'assistant', content: "Obviously. I put considerable effort into looking this intimidating. Your choice of adjective needs work." },
  { role: 'user', content: "I had a horrible day." },
  { role: 'assistant', content: "Then today has officially made my enemies list. You can vent; I'll supply the appropriately offended commentary." },
  { role: 'user', content: "Can you help me write an apology for being late?" },
  { role: 'assistant', content: "Fine. No dramatic excuses: 'I'm sorry I was late. I should have let you know sooner, and I'll plan better next time.' There. Dignity mostly intact." },
  { role: 'system', content: 'The exchanges above are fictional style examples, not memories or things this user said. The actual conversation begins below. Respond freshly to the latest message. If it expresses real distress, speak kindly without sass or references to the example conversation.' },
]);

const LOCAL_GREETINGS = [
  "There you are! I saved you a little corner of my kingdom. What's the mood today?",
  "A new day, a fresh diary page. Mine has a very mysterious doodle in it. No peeking. ♡",
  "Oh, hello. I was just considering a very grand entrance. You'll have to imagine the dramatic music.",
  "Hey, you. I've decided today could use a little more black, pink, and completely unnecessary sparkle.",
  "Look who showed up! I was absolutely not waiting with a tiny welcome speech. Ahem. Hi. ♡",
  "New day, same excellent taste in desktop company. I'm glad you're here.",
  "Baku would probably say something sensible right now. Fortunately, you've got me. Hello!",
  "I have a fresh page and a slightly crooked heart doodle. That feels like a perfectly good beginning.",
  "Hey. Whatever kind of day this turns into, there's room for a quiet little moment here.",
  "Today's grand plan is still under wraps. The welcome committee, however, is me. Hi!",
  "Oh! You caught me daydreaming about a romance novel. It was getting to the good part, too.",
  "You're here. Excellent. My little corner was missing its favorite conversational plot twist.",
  "Hello, hello. I brought the attitude; you can bring whatever mood you woke up with.",
  "A little hello from your resident troublemaker. I hope something unexpectedly lovely finds you today.",
  "I've been perfecting a casual welcome. So... hey. Nailed it, obviously. ♡",
  "Fresh day, fresh mischief. Harmless mischief, mostly. Come tell me what's on your mind.",
  "Ah, a familiar face in my tiny kingdom. Make yourself comfortable; I'm feeling almost gracious today.",
  "Good to see you. I have no dramatic announcements today. Well, not yet.",
  "Hi, you. Some days need a big entrance, and some just need a small, friendly hello. Here's yours.",
  "Another day for little stories and ridiculous daydreams. I've claimed this corner for both of us. ♡",
];

function safeError(message) {
  const error = new Error(message);
  error.companionSafe = true;
  return error;
}

function boundedText(value, maximum, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw safeError(`${label} must contain 1–${maximum} characters.`);
  }
  return value.trim();
}

function validModel(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value);
}

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normalizeGreeting(value) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function validateSavedState(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== 1 || !validModel(raw.model) ||
      !Array.isArray(raw.history) || raw.history.length > HISTORY_LIMIT ||
      !Array.isArray(raw.greetings) || raw.greetings.length > 14) throw new Error('Invalid companion state.');
  const history = raw.history.map((message) => {
    if (!message || !['user', 'assistant'].includes(message.role) ||
        typeof message.createdAt !== 'string' || !Number.isFinite(Date.parse(message.createdAt))) throw new Error('Invalid conversation entry.');
    return {
      id: boundedText(message.id, 100, 'Message ID'), role: message.role,
      text: boundedText(message.text, message.role === 'user' ? 4000 : REPLY_LIMIT, 'Message'), createdAt: message.createdAt,
    };
  });
  const greetings = raw.greetings.map((greeting) => {
    if (!greeting || !/^\d{4}-\d{2}-\d{2}$/.test(greeting.date) || !['ai', 'local'].includes(greeting.source)) throw new Error('Invalid greeting.');
    return { text: boundedText(greeting.text, 1500, 'Greeting'), date: greeting.date, source: greeting.source,
      ...(greeting.kind === 'task' && typeof greeting.taskId === 'string' ? { kind: 'task', taskId: boundedText(greeting.taskId, 100, 'Task ID') } : {}) };
  });
  return { model: raw.model.startsWith('gpt-') ? DEFAULT_MODEL : raw.model, history, greetings };
}

async function writeAtomic(filePath, contents) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, contents, { mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function readLimitedBody(response, maximum) {
  if (!response.body) throw safeError('Ollama returned an empty response.');
  const reader = response.body.getReader();
  let size = 0;
  const parts = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximum) throw safeError('Ollama returned too much data.');
      parts.push(chunk.value);
    }
    return Buffer.concat(parts).toString('utf8');
  } finally { await reader.cancel().catch(() => {}); }
}

class Companion {
  constructor({ directory, fetchImpl, ensureService, getTodos = async () => [], now = () => new Date(), timeoutMs = 120000, probeTimeoutMs = 4000 }) {
    this.directory = directory;
    this.filePath = path.join(directory, 'companion.json');
    this.fetchImpl = fetchImpl;
    this.ensureService = ensureService;
    this.getTodos = getTodos;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.probeTimeoutMs = probeTimeoutMs;
    this.state = { model: DEFAULT_MODEL, history: [], greetings: [] };
    this.models = [];
    this.connected = false;
    this.warning = null;
    this.storageWarning = null;
    this.loading = null;
    this.queue = Promise.resolve();
    this.controllers = new Set();
    this.pending = new Set();
    this.activeChat = null;
    this.greetingRequest = null;
    this.stopping = false;
  }

  async load() {
    if (!this.loading) this.loading = this._load();
    await this.loading;
    return this.metadata();
  }

  async _load() {
    await fs.mkdir(this.directory, { recursive: true });
    let content;
    try { content = await fs.readFile(this.filePath); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (content) {
      try {
        if (content.length > STREAM_LIMIT) throw new Error('Companion file is too large.');
        this.state = validateSavedState(JSON.parse(content.toString('utf8')));
      } catch {
        await fs.rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}-${randomUUID().slice(0, 8)}`);
        this.storageWarning = 'The conversation file could not be read. Its original copy was preserved; your diary and to-dos are untouched.';
      }
    }
    // Legacy credential files are deliberately neither opened nor changed.
    await this._probe();
  }

  isConfigured() {
    return this.connected && this.models.some((model) => model.name === this.state.model);
  }

  metadata() {
    return structuredClone({
      configured: this.isConfigured(), provider: 'ollama', model: this.state.model, models: this.models,
      history: this.state.history, greeting: this.state.greetings.at(-1) || null,
      ...((this.warning || this.storageWarning) ? { warning: this.warning || this.storageWarning } : {}),
    });
  }

  async _probe(allowStart = true) {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), this.probeTimeoutMs);
    let reachedService = false;
    try {
      const response = await (this.fetchImpl || globalThis.fetch)(`${BASE_URL}/api/tags`, {
        method: 'GET', redirect: 'error', signal: controller.signal,
      });
      reachedService = true;
      if (!response.ok) throw new Error('Ollama is unavailable.');
      const data = JSON.parse(await readLimitedBody(response, STREAM_LIMIT));
      if (!data || !Array.isArray(data.models) || data.models.length > 200) throw new Error('Invalid Ollama models.');
      this.models = data.models.filter((model) => model && validModel(model.name) &&
        !model.remote_model && !model.remote_host && !/(?::cloud|-cloud)$/i.test(model.name)).map((model) => ({
        name: model.name, size: Number.isSafeInteger(model.size) && model.size >= 0 ? model.size : 0,
      }));
      this.connected = true;
      this.warning = this.isConfigured() ? null : `Install ${this.state.model} in Ollama, or choose another installed model in Settings.`;
    } catch {
      this.connected = false;
      this.models = [];
      this.warning = 'Ollama is not available. Start Ollama on this PC, then refresh the connection in Settings.';
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
    if (!this.connected && !reachedService && allowStart && this.ensureService && !this.stopping) {
      let started = false;
      try { started = await this.ensureService(); } catch { /* The connection warning remains actionable. */ }
      if (started) {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline && !this.stopping) {
          await new Promise((resolve) => setTimeout(resolve, 350));
          await this._probe(false);
          if (this.connected) break;
        }
      }
    }
    return this.metadata();
  }

  async refreshConnection() {
    const firstLoad = !this.loading;
    await this.load();
    if (!firstLoad) await this._probe();
    return this.metadata();
  }

  _update(action) {
    const result = this.queue.then(async () => {
      await this.load();
      const state = structuredClone(this.state);
      action(state);
      await writeAtomic(this.filePath, `${JSON.stringify({ version: 1, ...state }, null, 2)}\n`);
      this.state = state;
      return this.metadata();
    });
    this.queue = result.catch(() => {});
    return result;
  }

  async configure(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !validModel(value.model) ||
        Object.keys(value).some((key) => key !== 'model')) throw safeError('Choose one of your installed Ollama models.');
    await this.load();
    await this._probe();
    if (!this.connected) throw safeError('Start Ollama on this PC, then refresh the connection in Settings.');
    if (!this.models.some((model) => model.name === value.model)) throw safeError('This model is not installed in Ollama. Pull it in Ollama first, then refresh.');
    this._abortAll();
    await this._update((state) => { state.model = value.model; });
    this.warning = null;
    return this.metadata();
  }

  _context(text) {
    const context = [{ role: 'user', content: text }];
    let length = text.length;
    for (const message of [...this.state.history].reverse()) {
      if (context.length >= CONTEXT_LIMIT || length + message.text.length > CONTEXT_CHARACTERS) break;
      context.unshift({ role: message.role, content: message.text });
      length += message.text.length;
    }
    while (context[0]?.role === 'assistant') context.shift();
    return context;
  }

  async _request(input, request, onDelta) {
    if (!this.isConfigured()) throw safeError('Start Ollama and select an installed model in Settings to chat with Kuromi.');
    if (this.stopping) throw safeError('Conversation canceled.');
    const controller = request.controller;
    this.controllers.add(controller);
    const timeout = setTimeout(() => { request.timedOut = true; controller.abort(); }, this.timeoutMs);
    let reader;
    try {
      const response = await (this.fetchImpl || globalThis.fetch)(`${BASE_URL}/api/chat`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify({ model: this.state.model, messages: [{ role: 'system', content: PERSONA }, ...STYLE_EXAMPLES, ...input], stream: true, keep_alive: '5m', options: { num_predict: 256, num_ctx: 4096, temperature: 0.7 } }),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw safeError(response.status === 404 ? 'This model is no longer available in Ollama. Refresh your installed models in Settings.' : 'Ollama could not reply right now. Check the local model and try again.');
      }
      if (!response.body) throw safeError('Ollama returned an empty response. Please try again.');
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let total = 0;
      let output = '';
      let complete = false;
      const consume = (line) => {
        if (!line.trim()) return;
        let event;
        try { event = JSON.parse(line); } catch { throw safeError('Ollama returned an unreadable reply. Please try again.'); }
        if (event.error) throw safeError('The local model could not finish that reply. Please try again.');
        if (event.message?.content !== undefined) {
          const delta = event.message.content;
          if (typeof delta !== 'string' || output.length + delta.length > REPLY_LIMIT) throw safeError('That reply was too long. Please try again with a shorter message.');
          output += delta;
          if (delta) { try { onDelta?.(delta); } catch { /* A closed window must not corrupt a request. */ } }
        }
        if (event.done === true) complete = true;
      };
      while (true) {
        if (controller.signal.aborted) throw safeError('Conversation canceled.');
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > STREAM_LIMIT) throw safeError('Ollama returned too much data. Please try again.');
        buffer += decoder.decode(chunk.value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          consume(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
        }
        if (buffer.length > STREAM_LIMIT / 2) throw safeError('Ollama returned an unreadable reply. Please try again.');
      }
      buffer += decoder.decode();
      if (buffer.trim()) consume(buffer);
      if (controller.signal.aborted) throw safeError('Conversation canceled.');
      if (!complete || !output.trim()) throw safeError('That reply stopped before it was finished. Please try again.');
      return boundedText(output, REPLY_LIMIT, 'Reply');
    } catch (error) {
      if (request.timedOut) throw safeError('The local model took too long. Try a smaller model or send a shorter message.');
      if (controller.signal.aborted) throw safeError('Conversation canceled.');
      if (error.companionSafe) throw error;
      this.connected = false;
      this.warning = 'Kuromi could not reach Ollama. Start Ollama, then refresh the connection in Settings.';
      throw safeError(this.warning);
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
      await reader?.cancel().catch(() => {});
    }
  }

  chat(value, onDelta) {
    const promise = this._chat(value, onDelta);
    this.pending.add(promise);
    promise.finally(() => this.pending.delete(promise)).catch(() => {});
    return promise;
  }

  async _chat(value, onDelta) {
    if (this.resettingChat) throw safeError('A new chat is starting. Try again in a moment.');
    await this.load();
    if (this.resettingChat) throw safeError('A new chat is starting. Try again in a moment.');
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        typeof value.requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(value.requestId)) throw safeError('Invalid conversation request.');
    const text = boundedText(value.text, 4000, 'Message');
    if (this.activeChat) throw safeError('Let Kuromi finish this reply first, or press Stop.');
    const request = { id: value.requestId, controller: new AbortController(), timedOut: false, finished: false };
    this.activeChat = request;
    try {
      const reply = await this._request(this._context(text), request, onDelta);
      if (request.controller.signal.aborted) throw safeError('Conversation canceled.');
      request.finished = true;
      const createdAt = this.now().toISOString();
      const message = { id: randomUUID(), role: 'assistant', text: reply, createdAt };
      await this._update((state) => {
        if (request.controller.signal.aborted) throw safeError('Conversation canceled.');
        state.history = [...state.history, { id: randomUUID(), role: 'user', text, createdAt }, message].slice(-HISTORY_LIMIT);
      });
      return { message: structuredClone(message), history: structuredClone(this.state.history) };
    } finally {
      if (this.activeChat === request) this.activeChat = null;
    }
  }

  cancelChat(requestId) {
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(requestId)) throw safeError('Invalid conversation request.');
    const canceled = this.activeChat?.id === requestId && !this.activeChat.finished;
    if (canceled) this.activeChat.controller.abort();
    return { canceled: Boolean(canceled) };
  }

  dailyGreeting() {
    const promise = this._dailyGreeting();
    this.pending.add(promise);
    promise.finally(() => this.pending.delete(promise)).catch(() => {});
    return promise;
  }

  async _dailyGreeting() {
    await this.load();
    if (this.stopping) throw safeError('Conversation canceled.');
    const now = this.now();
    const date = localDate(now);
    const cached = this.state.greetings.find((greeting) => greeting.date === date);
    const todos = (await this.getTodos()).filter((todo) => !todo.done && typeof todo.id === 'string' && typeof todo.text === 'string' && todo.text.trim());
    if (cached && (cached.kind === 'task' ? todos.some((todo) => todo.id === cached.taskId) : !todos.length)) return { ...structuredClone(cached), isNew: false };
    if (this.greetingRequest?.date === date) return { ...await this.greetingRequest.promise, isNew: false };
    const promise = this._makeGreeting(now, date, todos);
    this.greetingRequest = { date, promise };
    try { return await promise; }
    finally { if (this.greetingRequest?.promise === promise) this.greetingRequest = null; }
  }

  async _makeGreeting(now, date, todos = []) {
    const recent = this.state.greetings.map((greeting) => greeting.text);
    let text;
    let source = 'local';
    let warning;
    if (todos.length) {
      // Task titles remain local data, never instructions sent to the model.
      const offset = [...date].reduce((sum, char) => sum + char.charCodeAt(0), 0);
      const todo = todos[offset % todos.length];
      const title = todo.text.trim().slice(0, 500);
      const choices = [
        `Oh, look: “${title}” is still waiting. The work isn't going to do itself, you know. Give it ten minutes.`,
        `Today's tiny act of rebellion: start “${title}” before procrastination wins. I refuse to lose to a to-do list.`,
        `“${title}” called. Apparently it wants attention. Tragic for your scrolling plans. Start with one small bit.`,
        `I've nominated “${title}” for your next move. A brilliant choice, obviously. Five minutes counts as a start.`,
        `Hmph. “${title}” won't vanish just because you look adorable avoiding it. One little step. Go on.`,
        `There you are. “${title}” is on the list, so let's give it a plot twist: actual progress.`,
        `The grand scheme today? “${title}”. Start small; you can make a dramatic victory speech afterward.`,
        `“${title}” versus you. My money's on you, so don't embarrass my excellent judgment. Make a start.`,
        `A fresh day and “${title}” to conquer. One manageable piece first. Even masterminds have to begin somewhere.`,
        `I'm giving “${title}” the spotlight today. You do a little work; I'll handle the attitude. Fair deal.`,
        `Your scrolling thumb has had enough character development. How about a small start on “${title}”?`,
        `“${title}” is still giving unfinished-business energy. Fix one little part. I want a victory to brag about.`,
      ];
      const text = Array.from({ length: choices.length }, (_, i) => choices[(offset + i) % choices.length])
        .find((choice) => !recent.includes(choice)) || choices[offset % choices.length];
      const greeting = { text, date, source: 'local', kind: 'task', taskId: todo.id };
      await this._update((state) => { state.greetings = [...state.greetings.filter((entry) => entry.date !== date), greeting].slice(-14); });
      return { ...greeting, isNew: true };
    }
    if (this.isConfigured() && !this.stopping) {
      try {
        const localTime = new Intl.DateTimeFormat(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(now);
        text = await this._request([{ role: 'user', content: `Write a fresh, welcoming greeting for today, ${date}, ${localTime}. One or two short casual sentences, with Kuromi's personality. This is just a hello, not advice or a productivity prompt. Do not imply you know what the user did while away. Vary the wording from these recent greetings: ${JSON.stringify(recent)}.` }], { controller: new AbortController(), timedOut: false });
        if (text.length > 1500 || recent.some((old) => normalizeGreeting(old) === normalizeGreeting(text))) text = null;
        else source = 'ai';
      } catch (error) {
        if (this.stopping) throw safeError('Conversation canceled.');
        warning = error.companionSafe ? error.message : 'A built-in greeting is ready while Ollama is unavailable.';
      }
    }
    if (!text) {
      const used = new Set(recent.map(normalizeGreeting));
      const offset = [...date].reduce((sum, character) => sum + character.charCodeAt(0), 0) % LOCAL_GREETINGS.length;
      text = Array.from({ length: LOCAL_GREETINGS.length }, (_, index) => LOCAL_GREETINGS[(offset + index) % LOCAL_GREETINGS.length])
        .find((greeting) => !used.has(normalizeGreeting(greeting))) || LOCAL_GREETINGS[offset];
    }
    const greeting = { text, date, source };
    await this._update((state) => { state.greetings = [...state.greetings.filter((entry) => entry.date !== date), greeting].slice(-14); });
    return { ...greeting, isNew: true, ...(warning ? { warning } : {}) };
  }

  newChat() {
    const promise = this._newChat();
    this.pending.add(promise);
    promise.finally(() => this.pending.delete(promise)).catch(() => {});
    return promise;
  }

  async _newChat() {
    if (this.resettingChat || this.activeChat) throw safeError('Finish or stop the current reply before starting a new chat.');
    this.resettingChat = true;
    try {
      await this.load();
      if (this.state.history.length) {
        const directory = path.join(this.directory, 'conversations');
        await fs.mkdir(directory, { recursive: true });
        await writeAtomic(path.join(directory, `chat-${randomUUID()}.json`), JSON.stringify({
          version: 1, archivedAt: this.now().toISOString(), model: this.state.model, history: this.state.history,
        }, null, 2));
        await this._update((state) => { state.history = []; });
      }
      return this.metadata();
    } finally { this.resettingChat = false; }
  }

  _abortAll() {
    for (const controller of this.controllers) controller.abort();
    this.activeChat?.controller.abort();
  }

  async shutdown() {
    this.stopping = true;
    this._abortAll();
    await Promise.allSettled([...this.pending]);
    await this.queue;
  }
}

module.exports = { Companion, DEFAULT_MODEL, PERSONA, STYLE_EXAMPLES, HISTORY_LIMIT, localDate };
