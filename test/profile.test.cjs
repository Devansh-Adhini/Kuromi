'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { prepareProfile } = require('../src/profile.cjs');
const { Store } = require('../src/store.cjs');

test('the Windows workspace survives replacement of the old Electron profile', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kuromi-profile-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacy = path.join(root, 'old-profile');
  const workspace = path.join(root, 'saved-workspace');
  const journal = path.join(legacy, 'journal.json');
  const original = new Store(journal);
  await original.addTodo('A saved task');
  const saved = await original.addThought({ text: 'A saved note' });
  await fs.writeFile(path.join(legacy, 'companion.json'), '{"version":1,"model":"llama3.2:3b","history":[],"greetings":[]}');
  await fs.mkdir(path.join(legacy, 'conversations'));
  await fs.writeFile(path.join(legacy, 'conversations', 'chat-example.json'), '{}');

  await prepareProfile(legacy, workspace);
  assert.deepEqual(await new Store(journal).load(), saved, 'Migration leaves the original records in place');
  await fs.access(path.join(workspace, 'companion.json'));
  await fs.access(path.join(workspace, 'conversations', 'chat-example.json'));
  await fs.writeFile(journal, JSON.stringify({ version: 1, todos: [], thoughts: [] }));
  const reopened = await prepareProfile(legacy, workspace);
  assert.deepEqual(await new Store(path.join(reopened, 'journal.json')).load(), saved);
});
