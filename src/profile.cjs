'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

// The Electron profile can be replaced independently of the saved workspace.
async function prepareProfile(legacy, directory) {
  if (legacy === directory) return directory;
  try {
    if (!(await fs.stat(directory)).isDirectory()) throw new Error('The Kuromi data path is not a directory.');
    return directory;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  await fs.mkdir(path.dirname(directory), { recursive: true });
  const stage = await fs.mkdtemp(`${directory}-migration-`);
  try {
    for (const name of ['journal.json', 'journal.json.bak', 'companion.json', 'companion.json.bak', 'conversations']) {
      try { await fs.cp(path.join(legacy, name), path.join(stage, name), { recursive: name === 'conversations' }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await fs.rename(stage, directory);
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
  return directory;
}

module.exports = { prepareProfile };
