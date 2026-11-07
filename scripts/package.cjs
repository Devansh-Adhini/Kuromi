'use strict';

const path = require('node:path');

async function main() {
  const { packager } = await import('@electron/packager');
  const fs = require('node:fs');
  const { createHash } = require('node:crypto');
  const { version } = require('electron/package.json');
  const filename = `electron-v${version}-win32-x64.zip`;
  const localRuntime = path.resolve(__dirname, '..', '.cache', filename);
  if (fs.existsSync(localRuntime)) {
    const checksum = createHash('sha256');
    for await (const chunk of fs.createReadStream(localRuntime)) checksum.update(chunk);
    if (checksum.digest('hex') !== require('electron/checksums.json')[filename]) {
      throw new Error('The cached Electron runtime did not pass its SHA256 check. Remove the incomplete cached ZIP and retry.');
    }
  }
  const outputs = await packager({
    dir: path.resolve(__dirname, '..'),
    out: process.env.KUROMI_PACKAGE_DIR || path.resolve(__dirname, '..', 'release'),
    name: 'Kuromi Desktop',
    executableName: 'Kuromi Desktop',
    icon: path.resolve(__dirname, '..', 'assets', 'icon.ico'),
    platform: 'win32',
    arch: 'x64',
    ...(fs.existsSync(localRuntime) ? { electronZipDir: path.dirname(localRuntime) } : {}),
    asar: true,
    overwrite: true,
    prune: true,
    ignore: [/^\/release(?:\/|$)/, /^\/runtime(?:\/|$)/, /^\/test(?:\/|$)/, /^\/test-results(?:\/|$)/, /^\/scripts(?:\/|$)/, /^\/installer(?:\/|$)/, /^\/kuromi\.(?:glb|zip)$/i, /^\/Launch Kuromi\.lnk$/i, /^\/\.git(?:\/|$)/, /^\/\.cache(?:\/|$)/, /^\/\.test-artifacts(?:\/|$)/],
    win32metadata: { CompanyName: 'Personal desktop companion', FileDescription: 'Kuromi Desktop', ProductName: 'Kuromi Desktop' },
  });
  for (const output of outputs) {
    fs.copyFileSync(path.resolve(__dirname, '..', 'assets', 'ATTRIBUTION.md'), path.join(output, 'MODEL-CREDITS.md'));
    process.stdout.write(`Packaged Kuromi: ${output}\n`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
