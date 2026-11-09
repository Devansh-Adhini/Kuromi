'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function writeAtomic(filePath, contents) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, contents, { flag: 'wx', mode: 0o600, flush: true });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function mirrorBackup(filePath, contents) {
  try { await writeAtomic(`${filePath}.bak`, contents); }
  catch (error) {
    // A successful primary save must not be retried because its backup failed.
    console.warn(`Could not update the ${path.basename(filePath)} backup:`, error.message);
  }
}

async function saveSnapshot(filePath, contents) {
  await writeAtomic(filePath, contents);
  await mirrorBackup(filePath, contents);
}

async function readSnapshot(filePath, decode) {
  let contents;
  try { contents = await fs.readFile(filePath); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try { return { contents, state: decode(contents) }; }
  catch { return { contents, state: null }; }
}

async function loadSnapshot(filePath, decode) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const primary = await readSnapshot(filePath, decode);
  if (primary?.state) {
    await mirrorBackup(filePath, primary.contents);
    return { state: primary.state };
  }

  const backup = await readSnapshot(`${filePath}.bak`, decode);
  const recoveredFile = primary ? `${filePath}.corrupt-${Date.now()}-${randomUUID().slice(0, 8)}` : null;
  if (recoveredFile) await fs.rename(filePath, recoveredFile);
  if (!backup?.state) return { recoveredFile };

  await writeAtomic(filePath, backup.contents);
  return { state: backup.state, recoveredFile, restoredBackup: true };
}

module.exports = { loadSnapshot, saveSnapshot, writeAtomic };
