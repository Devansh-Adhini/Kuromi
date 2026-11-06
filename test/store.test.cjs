'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Store, DEFAULT_SETTINGS, LIMITS } = require('../src/store.cjs');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kuromi-store-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'journal.json');
  return { directory, filePath, store: new Store(filePath) };
}

test('tasks, thoughts, settings and position survive a new store instance', async (t) => {
  const { store, filePath } = await fixture(t);
  assert.deepEqual((await store.load()).settings, DEFAULT_SETTINGS);
  let state = await store.addTodo('  finish my drawing  ');
  const id = state.todos[0].id;
  assert.equal(state.todos[0].text, 'finish my drawing');
  state = await store.toggleTodo(id);
  assert.equal(state.todos[0].done, true);
  await store.addThought({ text: 'A good day.\nA little dreamy.', mood: 'dreamy' });
  await store.updateSettings({ reducedMotion: true, scale: 1.2 });
  state = await store.updatePosition({ x: -400, y: 125 });
  assert.deepEqual(await new Store(filePath).load(), state);
  state = await store.deleteTodo(id);
  assert.equal(state.todos.length, 0);
  state = await store.deleteThought(state.thoughts[0].id);
  assert.equal(state.thoughts.length, 0);
});

test('concurrent writes do not lose entries or leave temporary files', async (t) => {
  const { store, directory, filePath } = await fixture(t);
  await Promise.all(Array.from({ length: 30 }, (_, index) => store.addTodo(`Task ${index}`)));
  const state = await new Store(filePath).load();
  assert.equal(state.todos.length, 30);
  assert.equal(new Set(state.todos.map((entry) => entry.id)).size, 30);
  assert.deepEqual(await fs.readdir(directory), ['journal.json']);
});

test('invalid payloads cannot change the saved state and a rejected mutation does not poison later writes', async (t) => {
  const { store, filePath } = await fixture(t);
  await store.addTodo('Keep me');
  const before = await fs.readFile(filePath, 'utf8');
  assert.throws(() => store.addTodo(' '), /Task must contain/);
  assert.throws(() => store.addTodo('x'.repeat(LIMITS.todoText + 1)), /Task must contain/);
  assert.throws(() => store.addThought({ text: 'Hello', mood: '__proto__' }), /valid mood/);
  assert.throws(() => store.updateSettings({ alwaysOnTop: 'false' }), /Invalid value/);
  assert.throws(() => store.updateSettings({ scale: NaN }), /Pet size/);
  assert.throws(() => store.updateSettings({ unrelated: true }), /Unknown setting/);
  assert.throws(() => store.updatePosition({ x: Infinity, y: 0 }), /Invalid desktop position/);
  await assert.rejects(store.toggleTodo('missing'), /no longer exists/);
  assert.equal(await fs.readFile(filePath, 'utf8'), before);
  assert.equal((await store.addTodo('Still works')).todos.length, 2);
});

test('callers cannot mutate the in-memory store through returned snapshots', async (t) => {
  const { store } = await fixture(t);
  const state = await store.addTodo('Original');
  state.todos[0].text = 'Changed outside the store';
  state.settings.alwaysOnTop = false;
  const loaded = await store.load();
  assert.equal(loaded.todos[0].text, 'Original');
  assert.equal(loaded.settings.alwaysOnTop, true);
});

test('a failed disk write leaves memory unchanged, removes temporary files, and allows a retry', async (t) => {
  const { store, directory, filePath } = await fixture(t);
  await store.addTodo('Already saved');
  await fs.unlink(filePath);
  await fs.mkdir(filePath);
  await assert.rejects(store.addTodo('Could not save'));
  assert.deepEqual((await store.load()).todos.map((entry) => entry.text), ['Already saved']);
  assert.deepEqual(await fs.readdir(directory), ['journal.json']);
  await fs.rmdir(filePath);
  const state = await store.addTodo('Retry succeeds');
  assert.deepEqual(state.todos.map((entry) => entry.text), ['Already saved', 'Retry succeeds']);
  assert.deepEqual(await new Store(filePath).load(), state);
});

test('corrupted data is preserved before starting a fresh journal', async (t) => {
  const { store, filePath } = await fixture(t);
  const damaged = '{"todos": not valid JSON';
  await fs.writeFile(filePath, damaged);
  const loaded = await store.load();
  assert.deepEqual(loaded.todos, []);
  assert.equal(await fs.readFile(store.recoveredFile, 'utf8'), damaged);
  await store.addTodo('Fresh entry');
  assert.equal((await new Store(filePath).load()).todos[0].text, 'Fresh entry');
  assert.equal(await fs.readFile(store.recoveredFile, 'utf8'), damaged);
});

test('malformed valid JSON is also preserved instead of silently discarding entries', async (t) => {
  const { store, filePath } = await fixture(t);
  await fs.writeFile(filePath, JSON.stringify({ version: 1, todos: [{ id: 'broken' }], thoughts: [] }));
  assert.equal((await store.load()).todos.length, 0);
  assert.ok(store.recoveredFile);
});
