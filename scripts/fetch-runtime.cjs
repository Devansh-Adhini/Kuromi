const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);
const root = path.resolve(__dirname, '..');
const name = 'electron-v45.2.1-win32-x64.zip';
const url = `https://cdn.npmmirror.com/binaries/electron/45.2.1/${name}`;
const size = 158187314;
const count = 128;
const chunkSize = Math.ceil(size / count);
const cache = path.join(root, '.cache');
const chunks = path.join(cache, 'chunks');

async function main() {
  await fs.mkdir(chunks, { recursive: true });
  let next = 0;
  let completed = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= count) return;
      const start = index * chunkSize;
      const end = Math.min(size - 1, start + chunkSize - 1);
      const length = end - start + 1;
      const target = path.join(chunks, `${index}.part`);
      const previous = await fs.stat(target).catch(() => null);
      if (previous?.size !== length) {
        await run('curl.exe', ['--location', '--fail', '--silent', '--show-error', '--retry', '3',
          '--connect-timeout', '20', '--max-time', '300', '--range', `${start}-${end}`,
          '--max-filesize', String(length), '--output', target, url], { windowsHide: true });
      }
      const stat = await fs.stat(target);
      if (stat.size !== length) throw new Error(`Chunk ${index}: expected ${length} bytes, got ${stat.size}`);
      completed++;
      console.log(`Downloaded ${completed}/${count} chunks`);
    }
  }
  if (!process.argv.includes('--assemble')) {
    await Promise.all(Array.from({ length: 16 }, worker));
  }
  const output = path.join(cache, 'electron-parallel.zip');
  const file = await fs.open(output, 'w');
  const hash = crypto.createHash('sha256');
  try {
    for (let index = 0; index < count; index++) {
      const data = await fs.readFile(path.join(chunks, `${index}.part`));
      const expectedLength = Math.min(chunkSize, size - index * chunkSize);
      if (data.length !== expectedLength) throw new Error(`Chunk ${index} is incomplete.`);
      hash.update(data);
      await file.write(data);
    }
  } finally {
    await file.close();
  }
  const actual = hash.digest('hex');
  const expected = JSON.parse(await fs.readFile(path.join(root, 'node_modules/electron/checksums.json'), 'utf8'))[name];
  if (!expected || actual !== expected) throw new Error(`SHA256 mismatch: ${actual}, expected ${expected}`);
  console.log(`Verified SHA256 ${actual}`);
  // The exact verified archive is also the packager's offline runtime cache.
  await fs.copyFile(output, path.join(cache, name));
  const destination = path.join(root, 'node_modules/electron/dist');
  await fs.mkdir(destination, { recursive: true });
  await run('python.exe', ['-m', 'zipfile', '-e', output, destination], { windowsHide: true, maxBuffer: 1024 * 1024 });
  await fs.writeFile(path.join(root, 'node_modules/electron/path.txt'), 'electron.exe');
  console.log('Electron runtime extracted and ready.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
