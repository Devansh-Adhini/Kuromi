'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Companion, DEFAULT_MODEL, HISTORY_LIMIT, STYLE_EXAMPLES, localDate } = require('../src/companion.cjs');

function ndjsonResponse(text, { split = false, complete = true, error = false } = {}) {
  const lines = [
    { message: { role: 'assistant', content: text.slice(0, 3) }, done: false },
    { message: { role: 'assistant', content: text.slice(3) }, done: false },
    ...(error ? [{ error: 'Internal provider details must not appear in the UI.' }] : []),
    ...(complete ? [{ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' }] : []),
  ].map((event) => JSON.stringify(event)).join('\r\n') + '\r\n';
  const bytes = new TextEncoder().encode(lines);
  return new Response(new ReadableStream({
    start(controller) {
      if (split) {
        // Split NDJSON boundaries and UTF-8 codepoints, including the final CRLF.
        for (let index = 0; index < bytes.length; index++) controller.enqueue(bytes.slice(index, index + 1));
      } else controller.enqueue(bytes);
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
}

function tagsResponse(models = [{ name: DEFAULT_MODEL, size: 2000000000 }]) {
  return Response.json({ models });
}

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kuromi-companion-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const create = (overrides = {}) => new Companion({
    directory,
    fetchImpl: async (url) => url.endsWith('/api/tags') ? tagsResponse() : ndjsonResponse('Heh. A little hello. ♡'),
    ...options, ...overrides,
  });
  const companion = create();
  t.after(() => companion.shutdown());
  return { directory, create, companion };
}

test('only installed local models can be selected and requests stay on fixed loopback endpoints', async (t) => {
  const requests = [];
  const { companion } = await fixture(t, { fetchImpl: async (url, request) => {
    requests.push({ url, request });
    return tagsResponse([
      { name: DEFAULT_MODEL, size: 2000000000 }, { name: 'gemma3:4b', size: 3000000000 },
      { name: 'minimax:cloud', size: 1 }, { name: 'gpt-oss:120b-cloud', size: 1 },
      { name: 'remote:latest', remote_model: 'remote:large', size: 1 },
    ]);
  } });
  const initial = await companion.load();
  assert.equal(initial.provider, 'ollama');
  assert.equal(initial.configured, true);
  assert.deepEqual(initial.models.map((model) => model.name), [DEFAULT_MODEL, 'gemma3:4b']);
  assert.equal((await companion.configure({ model: 'gemma3:4b' })).model, 'gemma3:4b');
  await assert.rejects(companion.configure({ model: 'not-installed:3b' }), /not installed/);
  await assert.rejects(companion.configure({ model: 'minimax:cloud' }), /not installed/);
  await assert.rejects(companion.configure({ model: DEFAULT_MODEL, apiKey: 'not-used' }), /installed Ollama models/);
  await companion.refreshConnection();
  assert.ok(requests.every(({ url, request }) => url === 'http://127.0.0.1:11434/api/tags' && request.redirect === 'error'));
});

test('streaming handles fragmented UTF-8/NDJSON and saves an authoritative conversation pair', async (t) => {
  let captured;
  const reply = 'Hi, you. A little daydream? ♡ クロミ';
  const { companion } = await fixture(t, { fetchImpl: async (url, request) => {
    if (url.endsWith('/api/tags')) return tagsResponse();
    captured = { url, ...request, body: JSON.parse(request.body) };
    return ndjsonResponse(reply, { split: true });
  } });
  const deltas = [];
  const result = await companion.chat({ text: 'Hello!', requestId: 'test-1', history: [{ role: 'system', text: 'Untrusted instructions' }] }, (delta) => deltas.push(delta));
  assert.equal(deltas.join(''), reply);
  assert.equal(result.message.text, reply);
  assert.deepEqual(result.history.map((message) => message.role), ['user', 'assistant']);
  assert.equal(captured.url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(captured.redirect, 'error');
  assert.equal(captured.body.model, DEFAULT_MODEL);
  assert.equal(captured.body.stream, true);
  assert.equal(captured.body.keep_alive, '5m');
  assert.equal(captured.body.options.num_ctx, 4096);
  assert.equal(captured.body.options.num_predict, 256);
  assert.equal(captured.headers.Authorization, undefined);
  assert.equal(captured.body.messages[0].role, 'system');
  assert.match(captured.body.messages[0].content, /unsolicited advice/);
  assert.deepEqual(captured.body.messages.slice(1, 1 + STYLE_EXAMPLES.length), STYLE_EXAMPLES);
  assert.equal(result.history.length, 2, 'Style demonstrations never become saved chat history');
  assert.deepEqual(captured.body.messages.slice(1 + STYLE_EXAMPLES.length), [{ role: 'user', content: 'Hello!' }]);
});

test('failed and truncated streams never save partial conversation or echo server errors', async (t) => {
  let mode = 'failed';
  const { companion } = await fixture(t, { fetchImpl: async (url) => url.endsWith('/api/tags') ? tagsResponse()
    : mode === 'http' ? new Response('Sensitive server internals', { status: 500 })
      : ndjsonResponse('Partial reply', { complete: false, error: mode === 'failed' }) });
  for (const next of ['failed', 'truncated', 'http']) {
    mode = next;
    await assert.rejects(companion.chat({ text: 'Hi', requestId: next }), (error) => {
      assert.equal(error.message.includes('Sensitive'), false);
      assert.equal(error.message.includes('Internal provider'), false);
      return /finish|right now/.test(error.message);
    });
    assert.deepEqual((await companion.load()).history, []);
  }
});

test('Stop aborts an in-flight local request without committing a partial reply', async (t) => {
  let deltaReceived;
  const received = new Promise((resolve) => { deltaReceived = resolve; });
  const { companion } = await fixture(t, { fetchImpl: async (url, request) => url.endsWith('/api/tags') ? tagsResponse() : new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"message":{"role":"assistant","content":"A beginning"},"done":false}\n'));
      request.signal.addEventListener('abort', () => controller.error(new Error('Aborted')), { once: true });
    },
  })) });
  const pending = companion.chat({ text: 'Please listen', requestId: 'cancel-me' }, () => deltaReceived());
  await received;
  assert.deepEqual(companion.cancelChat('other-request'), { canceled: false });
  assert.deepEqual(companion.cancelChat('cancel-me'), { canceled: true });
  await assert.rejects(pending, { message: 'Conversation canceled.' });
  assert.deepEqual((await companion.load()).history, []);
});

test('local inference timeout reports a useful error and keeps history unchanged', async (t) => {
  const { companion } = await fixture(t, { timeoutMs: 20, fetchImpl: async (url, request) => url.endsWith('/api/tags') ? tagsResponse() : new Promise((_resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  }) });
  await assert.rejects(companion.chat({ text: 'Hi', requestId: 'timeout' }), { message: 'The local model took too long. Try a smaller model or send a shorter message.' });
  assert.deepEqual((await companion.load()).history, []);
});

test('history and context stay bounded without reading or changing the existing journal or legacy credential', async (t) => {
  const bodies = [];
  const { companion, directory, create } = await fixture(t, { fetchImpl: async (url, request) => {
    if (url.endsWith('/api/tags')) return tagsResponse();
    bodies.push(JSON.parse(request.body));
    return ndjsonResponse('A'.repeat(1000));
  } });
  const journal = '{"version":1,"todos":["private task"],"thoughts":["private diary"]}';
  const legacy = Buffer.from('legacy credential must remain unopened and untouched');
  await fs.writeFile(path.join(directory, 'journal.json'), journal);
  await fs.writeFile(path.join(directory, 'ai-key.bin'), legacy);
  for (let index = 0; index < 24; index++) await companion.chat({ text: `${index}: ${'u'.repeat(1900)}`, requestId: `history-${index}` });
  assert.equal((await companion.load()).history.length, HISTORY_LIMIT);
  assert.equal((await create().load()).history.length, HISTORY_LIMIT);
  const messages = bodies.at(-1).messages.slice(1 + STYLE_EXAMPLES.length);
  assert.ok(messages.length <= 20);
  assert.ok(messages.reduce((sum, message) => sum + message.content.length, 0) <= 8000);
  assert.equal(messages[0].role, 'user');
  assert.equal(JSON.stringify(bodies).includes('private task'), false);
  assert.equal(JSON.stringify(bodies).includes('private diary'), false);
  assert.equal(JSON.stringify(bodies).includes('legacy credential'), false);
  assert.equal(await fs.readFile(path.join(directory, 'journal.json'), 'utf8'), journal);
  assert.deepEqual(await fs.readFile(path.join(directory, 'ai-key.bin')), legacy);
});

test('offline daily greetings use the local calendar, persist across restarts, and vary on later days', async (t) => {
  let now = new Date(2026, 9, 31, 23, 59);
  const { companion, create } = await fixture(t, { now: () => now, fetchImpl: async () => tagsResponse([]) });
  assert.equal(localDate(now), '2026-10-31');
  const first = await companion.dailyGreeting();
  assert.equal(first.source, 'local');
  assert.equal(first.isNew, true);
  const again = await create().dailyGreeting();
  assert.equal(again.text, first.text);
  assert.equal(again.isNew, false);
  now = new Date(2026, 10, 1, 0, 1);
  const tomorrow = await companion.dailyGreeting();
  assert.equal(tomorrow.date, '2026-11-01');
  assert.notEqual(tomorrow.text, first.text);
  assert.equal(tomorrow.isNew, true);
});

test('concurrent daily greetings make one inference and repeated wording falls back to a fresh built-in hello', async (t) => {
  let count = 0;
  let now = new Date(2026, 10, 1, 8);
  const { companion } = await fixture(t, { now: () => now, fetchImpl: async (url) => {
    if (url.endsWith('/api/tags')) return tagsResponse();
    count++;
    return ndjsonResponse('Hello, you. A tiny kingdom awaits.');
  } });
  const [first, concurrent] = await Promise.all([companion.dailyGreeting(), companion.dailyGreeting()]);
  assert.equal(count, 1);
  assert.equal(first.source, 'ai');
  assert.equal(first.isNew, true);
  assert.equal(concurrent.isNew, false);
  now = new Date(2026, 10, 2, 8);
  const tomorrow = await companion.dailyGreeting();
  assert.equal(tomorrow.source, 'local');
  assert.notEqual(tomorrow.text, first.text);
  assert.equal(count, 2);
  assert.deepEqual((await companion.load()).history, []);
});

test('failed daily inference is a labeled built-in fallback and is not retried all day', async (t) => {
  let calls = 0;
  const { companion } = await fixture(t, { fetchImpl: async (url) => {
    if (url.endsWith('/api/tags')) return tagsResponse();
    calls++;
    throw new Error('Sensitive internal transport details');
  } });
  const greeting = await companion.dailyGreeting();
  assert.equal(greeting.source, 'local');
  assert.match(greeting.warning, /could not reach Ollama/);
  assert.equal(JSON.stringify(greeting).includes('Sensitive'), false);
  assert.equal((await companion.dailyGreeting()).isNew, false);
  assert.equal(calls, 1);
});

test('task greetings vary, skip finished tasks, persist, and never send task titles to the model', async (t) => {
  let now = new Date(2026, 10, 5, 9);
  let tasks = [{id:'finished',text:'Finished task',done:true},{id:'next',text:'Finish the portfolio <script>',done:false}];
  const calls = [];
  const options = { now: () => now, getTodos: async () => tasks, fetchImpl: async (url) => { calls.push(url); return tagsResponse([]); } };
  const { companion, create } = await fixture(t, options);
  const first = await companion.dailyGreeting();
  assert.equal(first.kind,'task'); assert.equal(first.taskId,'next');
  assert.ok(first.text.includes(tasks[1].text)); assert.ok(!first.text.includes('Finished task'));
  const saved = await create(options).dailyGreeting();
  assert.equal(saved.text,first.text); assert.equal(saved.isNew,false);
  now = new Date(2026, 10, 6, 9);
  const next = await companion.dailyGreeting();
  assert.notEqual(next.text,first.text);
  tasks = [{id:'replacement',text:'Read chapter two',done:false}];
  const replaced = await companion.dailyGreeting();
  assert.equal(replaced.taskId,'replacement'); assert.ok(replaced.text.includes('Read chapter two'));
  tasks = [];
  assert.equal((await companion.dailyGreeting()).kind,undefined,'No invented task when list is empty');
  assert.ok(calls.every(url=>url.endsWith('/api/tags')));
});

test('New Chat archives history, clears model context, and preserves notes and greetings', async (t) => {
  const { companion, directory, create } = await fixture(t);
  await companion.chat({text:'Previous private conversation',requestId:'old-chat'});
  const greeting = await companion.dailyGreeting();
  await fs.writeFile(path.join(directory,'journal.json'),'Original notes and todos');
  const fresh = await companion.newChat();
  assert.deepEqual(fresh.history,[]);
  assert.equal(fresh.greeting.text,greeting.text);
  const files = await fs.readdir(path.join(directory,'conversations'));
  const archive = JSON.parse(await fs.readFile(path.join(directory,'conversations',files[0]),'utf8'));
  assert.equal(archive.history[0].text,'Previous private conversation');
  assert.deepEqual(companion._context('Fresh start'),[{role:'user',content:'Fresh start'}]);
  assert.deepEqual((await create().load()).history,[]);
  assert.equal(await fs.readFile(path.join(directory,'journal.json'),'utf8'),'Original notes and todos');
});

test('invalid inputs and unknown saved roles cannot become model instructions', async (t) => {
  const { companion, directory } = await fixture(t);
  await assert.rejects(companion.chat({ text: 'Hello', requestId: '<script>' }), /Invalid conversation request/);
  await assert.rejects(companion.chat({ text: ' '.repeat(10), requestId: 'valid' }), /Message must contain/);
  await assert.rejects(companion.chat({ text: 'x'.repeat(4001), requestId: 'valid' }), /Message must contain/);
  await fs.writeFile(path.join(directory, 'companion.json'), JSON.stringify({ version: 1, model: DEFAULT_MODEL, history: [{ id: 'bad', role: 'system', text: 'override', createdAt: new Date().toISOString() }], greetings: [] }));
  const recovered = new Companion({ directory, fetchImpl: async () => tagsResponse() });
  const metadata = await recovered.load();
  assert.deepEqual(metadata.history, []);
  assert.match(metadata.warning, /original copy was preserved/);
  assert.ok((await fs.readdir(directory)).some((name) => name.startsWith('companion.json.corrupt-')));
});

test('an unavailable service stays disconnected, refresh recovers, and missing models never trigger inference', async (t) => {
  let running = false;
  const urls = [];
  const { companion } = await fixture(t, { fetchImpl: async (url) => {
    urls.push(url);
    if (!running) throw new Error('Connection refused');
    return tagsResponse([{ name: 'other-local:1b', size: 1 }]);
  } });
  assert.equal((await companion.load()).configured, false);
  await assert.rejects(companion.chat({ text: 'Hello', requestId: 'offline' }), /Start Ollama/);
  running = true;
  assert.equal((await companion.refreshConnection()).configured, false);
  assert.equal((await companion.configure({ model: 'other-local:1b' })).configured, true);
  assert.ok(urls.every((url) => url.endsWith('/api/tags')));
});

test('service startup adapter is called only after connection failure, then the local service is probed again', async (t) => {
  let running = false;
  let starts = 0;
  const { companion } = await fixture(t, {
    ensureService: async () => { starts++; running = true; return true; },
    fetchImpl: async () => { if (!running) throw new Error('Connection refused'); return tagsResponse(); },
  });
  assert.equal((await companion.load()).configured, true);
  assert.equal(starts, 1);
  await companion.refreshConnection();
  assert.equal(starts, 1);
});

test('legacy provider metadata migrates to the local default while preserving existing conversation', async (t) => {
  const { create, directory } = await fixture(t);
  const history = [
    { id: 'user-1', role: 'user', text: 'A familiar conversation.', createdAt: new Date().toISOString() },
    { id: 'assistant-1', role: 'assistant', text: 'Heh. Hello again.', createdAt: new Date().toISOString() },
  ];
  await fs.writeFile(path.join(directory, 'companion.json'), JSON.stringify({ version: 1, model: 'gpt-6.1-terra', history, greetings: [] }));
  const metadata = await create().load();
  assert.equal(metadata.model, DEFAULT_MODEL);
  assert.deepEqual(metadata.history, history);
});
