'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { version } = require('../package.json');

const run = promisify(execFile);
const root = path.resolve(__dirname, '..');
const cache = path.join(root, '.cache', 'nsis');
const archive = path.join(cache, 'nsis-3.13.zip');
const checksum = 'ba63dffc4410ee89193e1cb5a41989991bd77c61068da17e3156d136b7b0b3d8';
const nsisUrl = 'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.13/nsis-3.13.zip';

async function compiler() {
  await fs.mkdir(cache, { recursive: true });
  const hasArchive = await fs.access(archive).then(() => true, () => false);
  if (!hasArchive) {
    const partial = `${archive}.download`;
    await run('curl.exe', ['-fLsS', '--retry', '2', '--max-time', '300', nsisUrl, '-o', partial], { windowsHide: true });
    const digest = createHash('sha256').update(await fs.readFile(partial)).digest('hex');
    if (digest !== checksum) throw new Error('The NSIS download failed its SHA-256 check.');
    await fs.rename(partial, archive);
  }
  const digest = createHash('sha256').update(await fs.readFile(archive)).digest('hex');
  if (digest !== checksum) throw new Error(`The NSIS archive is incomplete or invalid: ${archive}`);
  const compilerDir = await fs.mkdtemp(path.join(cache, 'compiler-'));
  await run('tar.exe', ['-xf', archive, '-C', compilerDir], { windowsHide: true });
  return path.join(compilerDir, 'nsis-3.13', 'makensis.exe');
}

async function uninstallManifest(directory, relative = '') {
  const lines = [];
  let bytes = 0;
  for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
    if (/[$"\r\n]/.test(entry.name)) throw new Error(`Unsupported installer file name: ${entry.name}`);
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      const contents = await uninstallManifest(directory, name);
      lines.push(...contents.lines, `RMDir "$INSTDIR\\${name}"`);
      bytes += contents.bytes;
    } else if (entry.isFile()) {
      lines.push(`Delete "$INSTDIR\\${name}"`);
      bytes += (await fs.stat(path.join(directory, name))).size;
    } else throw new Error(`Unexpected installer entry: ${name}`);
  }
  return { lines, bytes };
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Build the Windows installer on Windows.');
  const makensis = await compiler();
  const stage = path.join(root, '.cache', 'installer-stage');
  const { stdout } = await run(process.execPath, [path.join(__dirname, 'package.cjs')], {
    cwd: root, windowsHide: true, env: { ...process.env, KUROMI_PACKAGE_DIR: stage },
  });
  process.stdout.write(stdout);
  const payload = path.join(stage, 'Kuromi Desktop-win32-x64');
  const ollama = path.join(root, 'runtime', 'ollama');
  const hasOllama = await fs.access(path.join(ollama, 'ollama.exe')).then(() => true, () => false);
  if (hasOllama) {
    const license = path.join(root, 'installer', 'OLLAMA-LICENSE');
    const bundled = path.join(payload, 'resources', 'ollama');
    await fs.access(license);
    await fs.cp(ollama, bundled, { recursive: true });
    await fs.copyFile(license, path.join(bundled, 'LICENSE'));
  }
  const manifest = await uninstallManifest(payload);
  const uninstallFiles = path.join(stage, 'uninstall-files.nsh');
  await fs.writeFile(uninstallFiles, `${manifest.lines.join('\n')}\n`);
  const output = path.join(root, 'release', `Kuromi Desktop Setup ${version}.exe`);
  const result = await run(makensis, [
    '/V2', `/DOUTPUT=${output}`, `/DVERSION=${version}`, `/DPAYLOAD=${payload}`,
    `/DAPP_ICON=${path.join(root, 'assets', 'icon.ico')}`, `/DUNINSTALL_FILES=${uninstallFiles}`,
    `/DSIZE_KB=${Math.ceil(manifest.bytes / 1024)}`, path.join(root, 'installer', 'kuromi.nsi'),
  ], { cwd: root, windowsHide: true });
  process.stdout.write(result.stdout);
  console.log(`Installer: ${output}`);
}

main().catch((error) => { console.error(error.stderr || error.message); process.exitCode = 1; });
