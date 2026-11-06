'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULT_SETTINGS = Object.freeze({
  alwaysOnTop: true,
  roaming: false,
  reducedMotion: false,
  scale: 1,
});
const MOODS = new Set(['neutral', 'happy', 'sad', 'frustrated', 'dreamy']);
const LIMITS = Object.freeze({ todoText: 500, thoughtText: 10000, todos: 2000, thoughts: 10000 });

function text(value, maximum, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new Error(`${label} must contain 1–${maximum} characters.`);
  }
  return value.trim();
}

function validateSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid settings.');
  const clean = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, key)) throw new Error(`Unknown setting: ${key}`);
    if (key === 'scale') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.65 || value > 1.5) {
        throw new Error('Pet size must be between 0.65 and 1.5.');
      }
    } else if (typeof value !== 'boolean') throw new Error(`Invalid value for ${key}.`);
    clean[key] = value;
  }
  return clean;
}

function validatePosition(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !Number.isSafeInteger(value.x) || !Number.isSafeInteger(value.y) ||
      Math.abs(value.x) > 1000000 || Math.abs(value.y) > 1000000) {
    throw new Error('Invalid desktop position.');
  }
  return { x: value.x, y: value.y };
}

function validateRecord(record, kind) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid saved entry.');
  const id = text(record.id, 100, 'Entry ID');
  const createdAt = record.createdAt;
  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) throw new Error('Invalid entry date.');
  if (kind === 'todo') {
    if (typeof record.done !== 'boolean') throw new Error('Invalid task status.');
    return { id, text: text(record.text, LIMITS.todoText, 'Task'), done: record.done, createdAt };
  }
  if (!MOODS.has(record.mood)) throw new Error('Invalid thought mood.');
  return { id, text: text(record.text, LIMITS.thoughtText, 'Thought'), mood: record.mood, createdAt };
}

function validateSavedState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 1 ||
      !Array.isArray(raw.todos) || !Array.isArray(raw.thoughts) ||
      raw.todos.length > LIMITS.todos || raw.thoughts.length > LIMITS.thoughts) {
    throw new Error('Invalid saved journal format.');
  }
  const todos = raw.todos.map((entry) => validateRecord(entry, 'todo'));
  const thoughts = raw.thoughts.map((entry) => validateRecord(entry, 'thought'));
  const ids = [...todos, ...thoughts].map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate saved entry IDs.');
  return {
    todos,
    thoughts,
    settings: { ...DEFAULT_SETTINGS, ...validateSettings(raw.settings || {}) },
    ...(raw.position ? { position: validatePosition(raw.position) } : {}),
  };
}

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = null;
    this.loading = null;
    this.queue = Promise.resolve();
    this.recoveredFile = null;
  }

  async load() {
    if (!this.loading) this.loading = this._load();
    await this.loading;
    return structuredClone(this.state);
  }

  async _load() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    let content;
    try {
      content = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (content !== undefined) {
      try {
        this.state = validateSavedState(JSON.parse(content));
      } catch {
        // Preserve the original file for recovery instead of overwriting it.
        this.recoveredFile = `${this.filePath}.corrupt-${Date.now()}-${randomUUID().slice(0, 8)}`;
        await fs.rename(this.filePath, this.recoveredFile);
      }
    }
    if (!this.state) this.state = { todos: [], thoughts: [], settings: { ...DEFAULT_SETTINGS } };
  }

  mutate(update) {
    const result = this.queue.then(async () => {
      await this.load();
      const draft = structuredClone(this.state);
      update(draft);
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporaryPath, `${JSON.stringify({ version: 1, ...draft }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
        await fs.rename(temporaryPath, this.filePath);
      } catch (error) {
        await fs.unlink(temporaryPath).catch(() => {});
        throw error;
      }
      this.state = draft;
      return structuredClone(this.state);
    });
    this.queue = result.catch(() => {});
    return result;
  }

  addTodo(value) {
    const task = text(value, LIMITS.todoText, 'Task');
    return this.mutate((state) => {
      if (state.todos.length >= LIMITS.todos) throw new Error('Your task list is full. Remove some completed tasks first.');
      state.todos.push({ id: randomUUID(), text: task, done: false, createdAt: new Date().toISOString() });
    });
  }

  toggleTodo(value) {
    const id = text(value, 100, 'Task ID');
    return this.mutate((state) => {
      const task = state.todos.find((entry) => entry.id === id);
      if (!task) throw new Error('This task no longer exists.');
      task.done = !task.done;
    });
  }

  deleteTodo(value) {
    const id = text(value, 100, 'Task ID');
    return this.mutate((state) => {
      const index = state.todos.findIndex((entry) => entry.id === id);
      if (index < 0) throw new Error('This task no longer exists.');
      state.todos.splice(index, 1);
    });
  }

  addThought(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid thought.');
    const thought = text(value.text, LIMITS.thoughtText, 'Thought');
    const mood = value.mood ?? 'neutral';
    if (!MOODS.has(mood)) throw new Error('Choose a valid mood.');
    return this.mutate((state) => {
      if (state.thoughts.length >= LIMITS.thoughts) throw new Error('Your journal is full. Export it before removing older thoughts.');
      state.thoughts.push({ id: randomUUID(), text: thought, mood, createdAt: new Date().toISOString() });
    });
  }

  deleteThought(value) {
    const id = text(value, 100, 'Thought ID');
    return this.mutate((state) => {
      const index = state.thoughts.findIndex((entry) => entry.id === id);
      if (index < 0) throw new Error('This thought no longer exists.');
      state.thoughts.splice(index, 1);
    });
  }

  updateSettings(value) {
    const patch = validateSettings(value);
    return this.mutate((state) => { Object.assign(state.settings, patch); });
  }

  updatePosition(value) {
    const position = validatePosition(value);
    return this.mutate((state) => { state.position = position; });
  }

  async flush() {
    await this.queue;
  }
}

module.exports = { Store, DEFAULT_SETTINGS, LIMITS, validatePosition };
