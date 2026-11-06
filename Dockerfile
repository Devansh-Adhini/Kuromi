FROM node:24-bookworm-slim

RUN <<'INSTALL'
set -eu
apt-get update
set -- ca-certificates libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 \
    libgl1-mesa-dri xvfb x11vnc novnc websockify openbox dbus-x11 fonts-dejavu-core
apt-get -o Acquire::ForceHash=SHA256 --print-uris -y --no-install-recommends install "$@" > /tmp/kuromi-packages
node --input-type=module <<'DOWNLOAD'
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
const manifest = await readFile('/tmp/kuromi-packages', 'utf8');
const packages = [...manifest.matchAll(/^'([^']+)' (\S+) (\d+) SHA256:([a-f0-9]{64})$/gm)];
if (packages.length !== manifest.split('\n').filter(line => line.startsWith("'")).length) {
  throw new Error('APT did not provide SHA-256 checksums for all packages');
}
async function downloadPackages() {
  for (let entry; (entry = packages.shift());) {
    const [, url, filename, size, digest] = entry;
    if (basename(filename) !== filename) throw new Error('Invalid package filename');
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(600000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length !== Number(size) || createHash('sha256').update(bytes).digest('hex') !== digest) {
          throw new Error(`Checksum mismatch for ${filename}`);
        }
        await writeFile(`/var/cache/apt/archives/${filename}`, bytes);
        break;
      } catch (error) {
        if (attempt === 3) throw error;
      }
    }
  }
}
await Promise.all(Array.from({ length: 16 }, downloadPackages));
DOWNLOAD
apt-get install -y --no-install-recommends "$@"
rm -rf /var/lib/apt/lists/* /tmp/kuromi-packages
INSTALL

WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && node node_modules/electron/install.js
COPY src ./src
COPY assets ./assets
COPY --chmod=755 docker-start.sh /usr/local/bin/kuromi-start

ENV DISPLAY=:99 KUROMI_USER_DATA=/data KUROMI_CONTAINER=1
RUN mkdir /data /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix && chown node:node /data
USER node
EXPOSE 6080
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/kuromi-start"]
