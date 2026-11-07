'use strict';

const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell, dialog, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { Store, validatePosition } = require('./store.cjs');
const { Companion } = require('./companion.cjs');

const RENDERER_URL = pathToFileURL(path.join(__dirname, 'index.html')).href;
const STARTUP_NAME = 'KuromiDesktop';
const canStartAtLogin = process.platform === 'win32' && app.isPackaged;
let ownedOllama;
let petWindow;
let tray;
let store;
let companion;
let quitting = false;
let quitComplete = false;
let positionTimer;
let visibleArea;
let startingOllama;

function startInstalledOllama() {
  if (startingOllama) return startingOllama;
  startingOllama = (async () => {
    const projectDirectory = app.isPackaged
      ? path.resolve(path.dirname(app.getPath('exe')), '..', '..')
      : path.resolve(__dirname, '..');
    const locations = [
      app.isPackaged && { executable: path.join(process.resourcesPath, 'ollama', 'ollama.exe') },
      {
        executable: path.join(projectDirectory, 'runtime', 'ollama', 'ollama.exe'),
        modelsDirectory: path.join(projectDirectory, 'runtime', 'models'),
      },
      process.env.LOCALAPPDATA && { executable: path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe') },
      process.env.ProgramFiles && { executable: path.join(process.env.ProgramFiles, 'Ollama', 'ollama.exe') },
    ].filter(Boolean);
    for (const { executable, modelsDirectory } of locations) {
      try { await fs.access(executable); } catch { continue; }
      return new Promise((resolve) => {
        if (quitting) { resolve(false); return; }
        // On Windows a detached process bypasses libuv's CREATE_NO_WINDOW path.
        const child = spawn(executable, ['serve'], {
          windowsHide: true, stdio: 'ignore',
          env: {
            ...process.env, OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_NO_CLOUD: '1',
            ...(modelsDirectory ? { OLLAMA_MODELS: modelsDirectory } : {}),
          },
        });
        child.once('error', () => resolve(false));
        child.once('spawn', () => {
          ownedOllama = child;
          if (quitting) child.kill();
          child.unref();
          resolve(!quitting);
        });
        child.once('exit', () => { if (ownedOllama === child) ownedOllama = null; });
      });
    }
    return false;
  })().finally(() => { startingOllama = null; });
  return startingOllama;
}

function startupSettings() {
  if (!canStartAtLogin) return { supported: false, enabled: false };
  const options = { path: app.getPath('exe') };
  const { launchItems } = app.getLoginItemSettings(options);
  return { supported: true, enabled: launchItems.some((item) => item.name === STARTUP_NAME && item.scope === 'user' && item.enabled) };
}

function isTrusted(event) {
  return petWindow && event.sender === petWindow.webContents && event.senderFrame?.url === RENDERER_URL;
}

function handle(channel, action) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrusted(event)) throw new Error('This request is not allowed.');
    return action(...args);
  });
}

function clampPosition(position) {
  const { x, y } = validatePosition(position);
  const [width, height] = petWindow.getSize();
  const rect = visibleArea || { x: 0, y: 0, width, height };
  const area = screen.getDisplayMatching({ x: x + rect.x, y: y + rect.y, width: rect.width, height: rect.height }).workArea;
  return {
    x: Math.min(Math.max(x, area.x - rect.x), area.x + Math.max(0, area.width - rect.width) - rect.x),
    y: Math.min(Math.max(y, area.y - rect.y), area.y + Math.max(0, area.height - rect.height) - rect.y),
  };
}

function setVisibleArea(value) {
  const [width, height] = petWindow.getSize();
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !['x', 'y', 'width', 'height'].every((key) => Number.isSafeInteger(value[key])) ||
      value.x < 0 || value.y < 0 || value.width <= 0 || value.height <= 0 ||
      value.x + value.width > width || value.y + value.height > height) {
    throw new Error('Invalid visible desktop area.');
  }
  visibleArea = { x: value.x, y: value.y, width: value.width, height: value.height };
  const [x, y] = petWindow.getPosition();
  const position = clampPosition({ x, y });
  if (position.x !== x || position.y !== y) petWindow.setPosition(position.x, position.y, false);
  return position;
}

function rememberPosition() {
  clearTimeout(positionTimer);
  positionTimer = setTimeout(() => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const [x, y] = petWindow.getPosition();
    store.updatePosition({ x, y }).catch((error) => console.error('Could not save pet position:', error.message));
  }, 400);
}

function showPet() {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.show();
  petWindow.focus();
}

function trayImage() {
  const image = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'));
  if (!image.isEmpty()) return image.resize({ width: 24, height: 24 });
  const size = 24;
  const bitmap = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x - 12) ** 2 + (y - 13) ** 2 > 100 && !(y < 8 && (x < 8 || x > 16))) continue;
      const offset = (y * size + x) * 4;
      const eye = y >= 10 && y <= 13 && ((x >= 7 && x <= 9) || (x >= 15 && x <= 17));
      bitmap[offset] = eye ? 231 : 100;
      bitmap[offset + 1] = eye ? 176 : 35;
      bitmap[offset + 2] = eye ? 255 : 75;
      bitmap[offset + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width: size, height: size });
}

function registerIPC() {
  handle('kuromi:load', () => store.load());
  handle('kuromi:get-startup', startupSettings);
  handle('kuromi:set-startup', (enabled) => {
    if (!canStartAtLogin || typeof enabled !== 'boolean') throw new Error('Launch at login is available in the Windows build.');
    app.setLoginItemSettings({ name: STARTUP_NAME, path: app.getPath('exe'), openAtLogin: enabled });
    const actual = startupSettings();
    if (actual.enabled !== enabled) throw new Error('Windows did not apply the startup setting.');
    return actual;
  });
  // Fixed bundled asset only. The renderer cannot supply a filesystem path.
  handle('kuromi:load-model', () => fs.readFile(path.join(__dirname, '..', 'assets', 'kuromi.glb')));
  handle('kuromi:add-todo', (text) => store.addTodo(text));
  handle('kuromi:toggle-todo', (id) => store.toggleTodo(id));
  handle('kuromi:delete-todo', (id) => store.deleteTodo(id));
  handle('kuromi:add-thought', (entry) => store.addThought(entry));
  handle('kuromi:delete-thought', (id) => store.deleteThought(id));
  handle('kuromi:update-settings', async (patch) => {
    const state = await store.updateSettings(patch);
    petWindow.setAlwaysOnTop(state.settings.alwaysOnTop);
    return state;
  });
  handle('kuromi:search', async (value) => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 2000) {
      throw new Error('Enter a search of 1–2000 characters.');
    }
    const url = new URL('https://www.google.com/search');
    url.searchParams.set('q', value.trim());
    await shell.openExternal(url.href);
    return { ok: true };
  });
  handle('kuromi:export-journal', async () => {
    const state = await store.load();
    const result = await dialog.showSaveDialog(petWindow, {
      title: 'Save your thought log',
      defaultPath: path.join(app.getPath('documents'), `Kuromi journal ${new Date().toISOString().slice(0, 10)}.txt`),
      filters: [{ name: 'Text journal', extensions: ['txt'] }, { name: 'JSON journal', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const content = path.extname(result.filePath).toLowerCase() === '.json'
      ? `${JSON.stringify({ exportedAt: new Date().toISOString(), thoughts: state.thoughts }, null, 2)}\n`
      : `KUROMI — THOUGHT LOG\n\n${state.thoughts.map((entry) => `${entry.createdAt} · ${entry.mood}\n${entry.text}`).join('\n\n────────────\n\n')}\n`;
    await fs.writeFile(result.filePath, content, { encoding: 'utf8', mode: 0o600 });
    return { canceled: false, filePath: result.filePath };
  });
  handle('kuromi:get-position', () => {
    const [x, y] = petWindow.getPosition();
    return { x, y };
  });
  handle('kuromi:move', (value) => {
    const position = clampPosition(value);
    petWindow.setPosition(position.x, position.y, false);
    return position;
  });
  handle('kuromi:set-visible-area', setVisibleArea);
  handle('kuromi:get-companion', () => companion.load());
  handle('kuromi:new-chat', () => companion.newChat());
  handle('kuromi:configure-ai', (configuration) => companion.configure(configuration));
  handle('kuromi:refresh-connection', () => companion.refreshConnection());
  handle('kuromi:chat', (request) => companion.chat(request, (delta) => {
    if (!petWindow.isDestroyed()) petWindow.webContents.send('kuromi:chat-delta', { requestId: request.requestId, delta });
  }));
  handle('kuromi:cancel-chat', (requestId) => companion.cancelChat(requestId));
  handle('kuromi:daily-greeting', () => companion.dailyGreeting());
  ipcMain.on('kuromi:interactive', (event, interactive) => {
    if (!isTrusted(event) || typeof interactive !== 'boolean') return;
    // The browser-hosted Linux desktop cannot forward ignored mouse moves.
    if (process.env.KUROMI_CONTAINER === '1') return;
    petWindow.setIgnoreMouseEvents(!interactive, { forward: true });
  });
  handle('kuromi:hide', () => petWindow.hide());
  handle('kuromi:quit', () => app.quit());
}

async function start() {
  Menu.setApplicationMenu(null);
  store = new Store(path.join(app.getPath('userData'), 'journal.json'));
  companion = new Companion({ directory: app.getPath('userData'), ensureService: startInstalledOllama,
    getTodos: async () => (await store.load()).todos });
  const state = await store.load();
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(460, area.width);
  const height = Math.min(740, area.height);
  petWindow = new BrowserWindow({
    width,
    height,
    x: area.x + Math.max(0, area.width - width - 12),
    y: area.y + Math.max(0, area.height - height - 12),
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    hasShadow: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: state.settings.alwaysOnTop,
    show: false,
    title: 'Kuromi Desktop',
    icon: trayImage(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      devTools: !app.isPackaged,
    },
  });
  if (state.position) {
    const position = clampPosition(state.position);
    petWindow.setPosition(position.x, position.y);
  }
  petWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  petWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  petWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  petWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  petWindow.webContents.session.setPermissionCheckHandler(() => false);
  petWindow.on('moved', rememberPosition);
  petWindow.on('blur', () => {
    if (!petWindow.webContents.isDestroyed()) petWindow.webContents.send('kuromi:window-blur');
  });
  petWindow.on('close', (event) => {
    if (!quitting) { event.preventDefault(); petWindow.hide(); }
  });
  petWindow.once('ready-to-show', () => petWindow.show());
  registerIPC();
  tray = new Tray(trayImage());
  tray.setToolTip('Kuromi Desktop — click to bring her back');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Kuromi', click: showPet },
    { label: 'Hide Kuromi', click: () => petWindow.hide() },
    { type: 'separator' },
    { label: 'Quit Kuromi', click: () => app.quit() },
  ]));
  tray.on('click', showPet);
  await petWindow.loadURL(RENDERER_URL);
  if (store.recoveredFile) {
    await dialog.showMessageBox(petWindow, {
      type: 'warning', title: 'Your original journal is safe',
      message: 'Kuromi could not read the saved journal and started a fresh one.',
      detail: `The original file has been preserved at:\n${store.recoveredFile}`,
    });
  }
  for (const event of ['display-removed', 'display-metrics-changed']) {
    screen.on(event, () => {
      if (!petWindow || petWindow.isDestroyed()) return;
      const [x, y] = petWindow.getPosition();
      const position = clampPosition({ x, y });
      petWindow.setPosition(position.x, position.y);
    });
  }
}

app.setPath('userData', !app.isPackaged && process.env.KUROMI_USER_DATA
  ? path.resolve(process.env.KUROMI_USER_DATA)
  : path.join(app.getPath('appData'), 'kuromi-desktop'));
if (process.platform === 'win32') app.setAppUserModelId('com.kuromi.desktop');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else if (process.argv.includes('--quit-for-update')) {
  app.quit();
} else {
  app.on('second-instance', (_event, args) => {
    if (args.includes('--quit-for-update')) app.quit();
    else showPet();
  });
  app.on('activate', showPet);
  app.on('window-all-closed', () => { if (quitting) app.quit(); });
  app.on('before-quit', (event) => {
    if (!store || quitComplete) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    clearTimeout(positionTimer);
    const companionShutdown = companion?.shutdown();
    const pendingPosition = petWindow && !petWindow.isDestroyed()
      ? (() => { const [x, y] = petWindow.getPosition(); return store.updatePosition({ x, y }); })()
      : Promise.resolve();
    pendingPosition.catch((error) => console.error('Could not save pet position:', error.message))
      .then(() => Promise.allSettled([store.flush(), companionShutdown]))
      .finally(() => { ownedOllama?.kill(); quitComplete = true; app.quit(); });
  });
  app.whenReady().then(start).catch((error) => {
    dialog.showErrorBox('Kuromi could not start', error.message);
    app.quit();
  });
}
