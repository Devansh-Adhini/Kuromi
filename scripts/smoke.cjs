'use strict';

// Runs the real Electron main/preload/renderer against an isolated temporary journal.
// Ollama responses, external search and the export save dialog are intercepted in
// the main process; live local inference is verified separately during release QA.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');
const task = '<img src=x onerror="window.__injected=true"> Finish a little mischief';
const thought = 'A small thought — saved privately, even after restarting. <script>window.__injected=true</script>';
const model = 'llama3.2:3b';
const chatText = 'I had a long day today.';
const chatReply = 'You made it through today. Come sit with me for a minute. We can take the next little thing slowly. ♡';
let application;
let page;
const errors = [];

async function createProfile(prefix) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const today = new Date();
  const localDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  // Avoid an incidental real inference during renderer startup, even if Ollama
  // happens to be running on the developer's machine.
  await fs.writeFile(path.join(userData, 'companion.json'), JSON.stringify({ version: 1, model, history: [],
    greetings: [{ text: 'Hey, you. A fresh page for us today. What is on your mind?', date: localDay, source: 'local' }] }));
  return userData;
}

async function launch(userData) {
  application = await electron.launch({
    args: [root],
    cwd: root,
    env: { ...process.env, KUROMI_USER_DATA: userData },
    timeout: 30000,
  });
  page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.kuromi), null, { timeout: 15000 });
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 15000 });
  await page.locator('#pet-button').waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas || !canvas.width || !canvas.height) return false;
    const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let visible = 0;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 80) visible++;
    return visible > 2000;
  }, null, { timeout: 15000 });
  // Automated clicks should not accidentally pass through to apps beneath the pet.
  await page.evaluate(() => window.kuromi.setInteractive(true));
}

async function tab(name) {
  const panel = page.locator('#panel');
  if (!await panel.isVisible()) await page.locator('#pet-button').click();
  await page.locator(`[data-tab="${name}"]`).click();
}

async function canvasHash() {
  return page.locator('canvas').evaluate((canvas) => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let value = 2166136261;
    for (let i = 0; i < pixels.length; i++) value = Math.imul(value ^ pixels[i], 16777619);
    return value >>> 0;
  });
}

async function startupChecks() {
  await launch(await createProfile('kuromi-startup-'));
  try {
    // Hold only the AI initialization response in this disposable app instance.
    // Reloading then exercises the normal document startup with a slow AI service.
    await application.evaluate(({ ipcMain }) => {
      globalThis.__slowCompanion = new Promise((resolve) => { globalThis.__releaseSlowCompanion = resolve; });
      globalThis.__slowGreeting = new Promise((resolve) => { globalThis.__releaseSlowGreeting = resolve; });
      ipcMain.removeHandler('kuromi:get-companion');
      ipcMain.handle('kuromi:get-companion', () => globalThis.__slowCompanion);
      ipcMain.removeHandler('kuromi:daily-greeting');
      ipcMain.handle('kuromi:daily-greeting', () => globalThis.__slowGreeting);
    });
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    assert.equal(await page.evaluate(() => document.body.dataset.companionReady === 'true'), false);
    await tab('tasks');
    await page.locator('#todo-input').fill('Offline tools remain available while AI starts');
    await page.locator('#todo-form').evaluate((form) => form.requestSubmit());
    await page.getByText('Offline tools remain available while AI starts', { exact: true }).first().waitFor();
    const saved = await page.evaluate(() => window.kuromi.load());
    assert.equal(saved.todos.length, 1, 'To-dos save while AI startup is still pending');
    assert.equal(await page.evaluate(() => document.body.dataset.companionReady === 'true'), false);
    await application.evaluate((_electron, name) => {
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      const date = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
      globalThis.__releaseSlowCompanion({ configured: false, provider: 'ollama', model: name, models: [], history: [],
        greeting: { text: 'A cached greeting from yesterday.', date, source: 'local' } });
    }, model);
    await page.waitForFunction(() => document.body.dataset.companionReady === 'true');
    assert.notEqual((await page.locator('#greeting-date').innerText()).trim(), '· TODAY', 'A stale greeting displays its saved date');
    await application.evaluate(() => {
      const today = new Date();
      const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      globalThis.__releaseSlowGreeting({ text: 'A fresh greeting for today.', date, source: 'local', isNew: true });
    });
    await page.getByText('A fresh greeting for today.', { exact: true }).waitFor({ state: 'attached' });
    assert.equal((await page.locator('#greeting-date').innerText()).trim(), '· TODAY');
    console.log('PASS: offline tools initialize and persist a task before slow AI initialization completes.');
  } finally {
    await application.close();
    application = null;
  }
}

async function motionChecks() {
  const result = await page.evaluate(async () => {
    const { PetAnimator, ANIMATIONS } = await import('./pet.js');
    const { evaluateRigPose } = await import('./rig-pose.js');
    const canvas = document.createElement('canvas');
    canvas.id = 'motion-test-canvas';
    Object.assign(canvas.style, { position: 'fixed', left: '12px', top: '12px', zIndex: '1000', background: '#f5eff8' });
    document.body.append(canvas);
    const pet = globalThis.__testPet = new PetAnimator(canvas);
    await pet.ready;
    cancelAnimationFrame(pet.frameRequest);
    const sheet = document.createElement('canvas'); sheet.width = 960; sheet.height = 1230;
    const ctx = sheet.getContext('2d');
    ctx.fillStyle = '#f2eaf7'; ctx.fillRect(0, 0, sheet.width, sheet.height);
    ctx.fillStyle = '#4b3559'; ctx.font = '600 18px Segoe UI';
    ctx.fillText('Kuromi · one 3D body across all 25 gestures', 12, 28);
    ctx.font = '12px Segoe UI'; ctx.fillText('Fixed anatomy · continuous joint angles · actual desktop renderer', 12, 47);
    function inspect() {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let left=canvas.width, top=canvas.height, right=-1, bottom=-1, area=0, hash=2166136261;
      for(let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++) {
        const offset=(y*canvas.width+x)*4;
        for(let c=0;c<4;c++) hash=Math.imul(hash^data[offset+c],16777619);
        if(data[offset+3] <= 40) continue;
        left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);area++;
      }
      return {left,top,right,bottom,area,hash:hash>>>0,width:canvas.width,height:canvas.height};
    }
    const states=[]; let index=0;
    for(const name of Object.keys(ANIMATIONS)) {
      const frames=[];
      for(const elapsed of [0, 0.08, 0.25, 0.65, 1.1, 1.4, 2.2, 3.1, 4.95]) {
        pet.renderPose(evaluateRigPose(name,elapsed,{time:elapsed}));
        frames.push({elapsed,...inspect(),bookVisible:pet.rig?.book.visible});
        if(elapsed===1.1) {
          const x=(index%5)*192,y=60+Math.floor(index/5)*234;
          ctx.fillStyle='#fdf9ff';ctx.fillRect(x+2,y,188,230);
          ctx.fillStyle='#4b3559';ctx.fillText(name,x+10,y+18);
          ctx.drawImage(canvas,x,y+24,192,208);
        }
      }
      states.push({name,frames});index++;
    }
    const directions=[];
    for(let index=0;index<61;index++) {
      const pose=evaluateRigPose('idle',0,{time:0,lookX:-1+index/30});
      pet.renderPose(pose);directions.push({yaw:pet.rig?.head.rotation.y,hash:inspect().hash});
    }
    const stats=pet.getStats();
    return {stats,states,directions,contact:sheet.toDataURL('image/png').split(',')[1]};
  });
  try {
    await fs.writeFile(path.join(output,'rig-all-states.png'),Buffer.from(result.contact,'base64'));
    await fs.writeFile(path.join(output,'rig-all-states.json'),JSON.stringify({...result,contact:undefined},null,2));
    assert.equal(result.stats.renderer, 'rigged 3D WebGL', 'This GPU must render the volumetric model, not a fallback');
    assert.equal(result.stats.model?.author, 'jiayingc', 'The renderer uses the supplied Sketchfab model');
    assert.ok(result.stats.triangles>=170172, 'The renderer retains the original model geometry');
    assert.equal(result.states.length,25);
    for(const {name,frames} of result.states) for(const frame of frames) {
      assert.ok(frame.area>2000, `${name} at ${frame.elapsed}s remains visible`);
      assert.ok(frame.left>1 && frame.top>1 && frame.right<frame.width-2 && frame.bottom<frame.height-2,
        `${name} at ${frame.elapsed}s keeps ears, feet and tail within canvas: ${JSON.stringify(frame)}`);
      assert.equal(frame.bookVisible, ['thinking','review'].includes(name), `${name} reading prop`);
    }
    assert.equal(new Set(result.directions.map(item=>item.yaw)).size,61,'The rendered rig has 61 distinct head directions');
    assert.ok(new Set(result.directions.map(item=>item.hash)).size>40,'Continuous turns change real rendered pixels');
    for (const name of ['wave', 'head-tilt', 'talk', 'review']) {
      await page.evaluate((animation) => {
        const pet = globalThis.__testPet;
        pet.play(animation, { loop: true });
        pet.previousTime = performance.now(); pet.tick(pet.previousTime);
      }, name);
      await page.waitForTimeout(400);
      await page.locator('#motion-test-canvas').screenshot({ path: path.join(output, `motion-${name}.png`), omitBackground: true });
      await page.evaluate(()=>cancelAnimationFrame(globalThis.__testPet.frameRequest));
    }
    const fallback = await page.evaluate(async () => {
      const pet=globalThis.__testPet;
      const {evaluateRigPose}=await import('./rig-pose.js');
      async function until(predicate) {
        const deadline=performance.now()+5000;
        while(!predicate()) {
          if(performance.now()>deadline) throw new Error('Timed out waiting for the WebGL context transition.');
          await new Promise(resolve=>setTimeout(resolve,20));
        }
      }
      function hash() {
        const data=pet.context.getImageData(0,0,pet.canvas.width,pet.canvas.height).data;
        let value=2166136261;for(const byte of data)value=Math.imul(value^byte,16777619);return value>>>0;
      }
      pet.renderer.forceContextLoss();
      await until(()=>pet.contextLost && pet.fallback?.complete && pet.fallback?.naturalWidth);
      const renderer=pet.getStats().renderer;
      pet.renderPose(evaluateRigPose('idle',0,{reducedMotion:true}));const standing=hash();
      pet.renderPose(evaluateRigPose('review',0,{reducedMotion:true}));const reading=hash();
      pet.renderer.forceContextRestore();
      await until(()=>!pet.contextLost);
      pet.renderPose(evaluateRigPose('idle',0,{reducedMotion:true}));
      return {renderer,standing,reading,restored:pet.getStats().renderer,restoredPixels:hash()};
    });
    assert.equal(fallback.renderer,'fixed-proportion illustration fallback','Context loss keeps the pet available');
    assert.equal(fallback.standing,fallback.reading,'Software fallback keeps one consistent body for every state');
    assert.equal(fallback.restored,'rigged 3D WebGL','The volumetric pet returns after context restoration');
    assert.notEqual(fallback.restoredPixels,fallback.standing,'Restoration renders the actual 3D body');
    console.log(`Animation renderer: ${JSON.stringify(await page.evaluate(() => globalThis.__testPet.getStats()))}`);
  } finally {
    await page.evaluate(() => { globalThis.__testPet.destroy(); document.querySelector('#motion-test-canvas').remove(); delete globalThis.__testPet; });
  }
}

async function installMockAI() {
  await application.evaluate(() => {
    globalThis.__mockAI = { requests: [], chatRequests: [], canceled: 0, models: [], failChat: false };
    globalThis.fetch = async (url, options = {}) => {
      const address = String(url);
      globalThis.__mockAI.requests.push(address);
      if (address === 'http://127.0.0.1:11434/api/tags') {
        return Response.json({ models: globalThis.__mockAI.models });
      }
      if (address !== 'http://127.0.0.1:11434/api/chat') throw new Error('Unexpected external request in test.');
      if (globalThis.__mockAI.failChat) throw new TypeError('A simulated local connection failure.');
      const body = JSON.parse(options.body);
      const latest = [...body.messages].reverse().find((entry) => entry.role === 'user');
      const text = latest?.content || '';
      const canceledReply = text.includes('Please cancel this reply.');
      const chunks = canceledReply ? ['A little thought… <img src=x onerror="window.__injected=true"> ', 'this reply should have been canceled.'] :
        ['You made it through today. ', 'Come sit with me for a minute. ', 'We can take the next little thing slowly. ♡'];
      globalThis.__mockAI.chatRequests.push({ model: body.model, stream: body.stream, text, messages: body.messages });
      const encoder = new TextEncoder();
      const events = chunks.map((content) => ({ message: { role: 'assistant', content }, done: false }));
      events.push({ message: { role: 'assistant', content: '' }, done: true });
      let timer;
      let stopped = false;
      const stream = new ReadableStream({
        start(controller) {
          let index = 0;
          const abort = () => {
            if (stopped) return;
            stopped = true;
            clearTimeout(timer);
            globalThis.__mockAI.canceled++;
            controller.error(new DOMException('Aborted', 'AbortError'));
          };
          options.signal?.addEventListener('abort', abort, { once: true });
          const pump = () => {
            if (stopped) return;
            if (index === events.length) {
              stopped = true;
              options.signal?.removeEventListener('abort', abort);
              controller.close();
              return;
            }
            const event = events[index++];
            // Network chunks need not align with NDJSON line or text boundaries.
            const encoded = encoder.encode(`${JSON.stringify(event)}\r\n`);
            const middle = Math.floor(encoded.length / 2);
            controller.enqueue(encoded.slice(0, middle));
            controller.enqueue(encoded.slice(middle));
            timer = setTimeout(pump, canceledReply ? 1000 : 350);
          };
          timer = setTimeout(pump, 100);
        },
        cancel() { stopped = true; clearTimeout(timer); },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
    };
  });
}

async function chatChecks() {
  await page.waitForFunction(() => document.body.dataset.companionReady === 'true', null, { timeout: 25000 });
  await installMockAI();
  await tab('settings');
  await page.locator('#ai-refresh').click();
  await page.waitForFunction(async () => !(await window.kuromi.getCompanion()).configured);
  await tab('chat');
  const initial = await page.evaluate(() => window.kuromi.getCompanion());
  assert.equal(initial.configured, false);
  assert.equal(initial.history.length, 0);
  await page.locator('#connect-ai').waitFor({ state: 'visible' });
  const unavailableModel = await page.evaluate(async () => {
    try { await window.kuromi.chat({ text: 'Are you there?', requestId: 'missing-model-test' }); return false; }
    catch { return true; }
  });
  assert.equal(unavailableModel, true, 'Unavailable local model must fail instead of fabricating a reply');
  const greeting = await page.evaluate(() => window.kuromi.dailyGreeting());
  const cachedGreeting = await page.evaluate(() => window.kuromi.dailyGreeting());
  assert.equal(cachedGreeting.text, greeting.text);
  assert.equal(cachedGreeting.date, greeting.date);
  assert.equal(cachedGreeting.isNew, false, 'Daily greeting is cached for the current local day');
  await page.locator('#daily-greeting').waitFor({ state: 'visible' });

  await page.locator('#connect-ai').click();
  await application.evaluate((_electron, name) => { globalThis.__mockAI.models = [{ name, size: 2_000_000_000 }]; }, model);
  await page.locator('#ai-refresh').click();
  await page.locator(`#ai-model option[value="${model}"]`).waitFor({ state: 'attached' });
  await page.locator('#ai-model').selectOption(model);
  await page.locator('#ai-form').evaluate((form) => form.requestSubmit());
  await page.waitForFunction(async () => (await window.kuromi.getCompanion()).configured === true);
  const configured = await page.evaluate(() => window.kuromi.getCompanion());
  assert.equal(configured.model, model);
  assert.equal(configured.provider, 'ollama');
  assert.equal(await page.locator('#ai-key').count(), 0, 'Local AI requires no API-key field');

  await tab('chat');
  await page.locator('#chat-input').fill(chatText);
  await page.locator('#chat-form').evaluate((form) => { form.requestSubmit(); form.requestSubmit(); });
  await page.getByText('You made it through today.', { exact: false }).waitFor();
  assert.equal((await page.locator('#chat-log').innerText()).includes(chatReply), false, 'Partial text is displayed before the full response arrives');
  await tab('settings');
  assert.equal(await page.locator('#ai-model').isDisabled(), true, 'Cannot change model during a reply');
  assert.equal(await page.locator('#ai-refresh').isDisabled(), true, 'Cannot refresh the model connection during a reply');
  assert.equal(await page.locator('#ai-connect').isDisabled(), true);
  await tab('chat');
  await page.screenshot({ path: path.join(output, 'chat-stream.png'), omitBackground: true });
  await page.waitForFunction(async () => (await window.kuromi.getCompanion()).history.length === 2);
  await page.getByText(chatReply, { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('#chat-send').disabled);
  assert.ok((await page.locator('#chat-log').innerText()).includes(chatReply));
  const requests = await application.evaluate(() => globalThis.__mockAI.chatRequests);
  assert.equal(requests.length, 1, 'Repeated submit while streaming sends only one request');
  assert.equal(requests[0].model, model);
  assert.equal(requests[0].stream, true);
  await page.locator('#toast').waitFor({ state: 'hidden' });
  await page.screenshot({ path: path.join(output, 'chat.png'), omitBackground: true });

  await page.locator('#chat-input').fill('Please cancel this reply.');
  await page.locator('#chat-form').evaluate((form) => form.requestSubmit());
  await page.getByText('A little thought…', { exact: false }).waitFor();
  assert.equal(await page.locator('#chat-log img').count(), 0, 'Streamed model output must render as safe text');
  assert.equal(await page.evaluate(() => Boolean(window.__injected)), false);
  await page.locator('#chat-stop').click();
  await page.waitForFunction(async () => (await window.kuromi.getCompanion()).history.length === 2 && !document.querySelector('#chat-send').disabled);
  assert.equal(await application.evaluate(() => globalThis.__mockAI.canceled), 1, 'Stop aborts the in-flight request');
  assert.equal((await page.evaluate(() => window.kuromi.getCompanion())).history.length, 2, 'Canceled response does not persist a partial conversation pair');
  assert.equal(await page.locator('#chat-log script, #chat-log img').count(), 0);
  const addresses = await application.evaluate(() => globalThis.__mockAI.requests);
  assert.ok(addresses.every((address) => new URL(address).origin === 'http://127.0.0.1:11434'), 'AI talks only to the fixed loopback service');
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const userData = await createProfile('kuromi-ui-');
  try {
    await startupChecks();
    await launch(userData);
    const movingFrame = await canvasHash();
    await page.waitForTimeout(200);
    assert.notEqual(await canvasHash(), movingFrame, 'The articulated 3D model receives continuous animation');
    const timing = await page.evaluate(() => new Promise((resolve) => {
      const times = [];
      const start = performance.now();
      let prior;
      function sample(now) {
        if (prior !== undefined) times.push(now - prior);
        prior = now;
        if (now - start < 1200) requestAnimationFrame(sample);
        else {
          times.sort((a, b) => a - b);
          resolve({ frames: times.length, medianMs: times[Math.floor(times.length * 0.5)], p95Ms: times[Math.floor(times.length * 0.95)] });
        }
      }
      requestAnimationFrame(sample);
    }));
    assert.ok(timing.frames > 10, 'Animation frames continue to be scheduled');
    console.log(`Observed display cadence: ${(1000 / timing.medianMs).toFixed(1)} fps median; p95 frame interval ${timing.p95Ms.toFixed(2)} ms. This measures this display, not a guaranteed120 fps.`);
    await motionChecks();
    await chatChecks();
    await tab('tasks');
    await page.locator('#todo-input').fill(task);
    await page.locator('#todo-form').evaluate((form) => form.requestSubmit());
    await page.getByText(task, { exact: true }).first().waitFor();
    assert.equal(await page.locator('#todo-list img').count(), 0, 'Task input must render as text');
    assert.equal(await page.evaluate(() => Boolean(window.__injected)), false);
    let saved = await page.evaluate(() => window.kuromi.load());
    assert.equal(saved.todos.length, 1);
    assert.equal(saved.todos[0].text, task);
    assert.equal(saved.todos[0].done, false);

    await page.locator('#close-panel').click();
    await page.locator('#pet-button').hover();
    await page.locator('#hover-card').waitFor({ state: 'visible' });
    assert.ok((await page.locator('#hover-card').innerText()).includes(task), 'Pending task appears above pet on hover');
    await page.locator('#toast').waitFor({ state: 'hidden' });
    await page.locator('#pet-button').hover();
    await page.locator('#hover-card').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(output, 'hover.png') });

    await tab('tasks');
    await page.getByRole('button', { name: `Complete ${task}`, exact: true }).or(page.getByRole('checkbox', { name: `Complete ${task}`, exact: true })).click();
    await page.waitForFunction(async () => (await window.kuromi.load()).todos[0]?.done === true);
    await page.locator('#close-panel').click();
    await page.locator('#pet-button').hover();
    await page.waitForTimeout(250);
    assert.equal((await page.locator('#hover-card').innerText()).includes(task), false, 'Completed task disappears from hover reminder');
    await tab('tasks');
    if (!await page.getByRole('button', { name: `Reopen ${task}`, exact: true }).or(page.getByRole('checkbox', { name: `Reopen ${task}`, exact: true })).isVisible()) {
      await page.locator('#show-completed').click();
    }
    await page.getByRole('button', { name: `Reopen ${task}`, exact: true }).or(page.getByRole('checkbox', { name: `Reopen ${task}`, exact: true })).click();
    await page.waitForFunction(async () => (await window.kuromi.load()).todos[0]?.done === false);

    await tab('diary');
    await page.locator('#thought-input').fill(thought);
    await page.locator('#thought-mood').selectOption('dreamy');
    await page.locator('#thought-form').evaluate((form) => form.requestSubmit());
    await page.getByText(thought, { exact: true }).waitFor();
    assert.equal(await page.locator('#thought-list script').count(), 0, 'Journal input must render as text');

    const exported = path.join(userData, 'export.json');
    await application.evaluate(({ dialog, shell }, filePath) => {
      globalThis.__searches = [];
      shell.openExternal = async (url) => { globalThis.__searches.push(url); };
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, exported);
    const result = await page.evaluate(() => window.kuromi.exportJournal());
    assert.equal(result.canceled, false);
    const exportContent = JSON.parse(await fs.readFile(exported, 'utf8'));
    assert.equal(exportContent.thoughts[0].text, thought);
    await tab('chat');
    await page.locator('#chat-input').fill('Check that my private notes stay private.');
    await page.locator('#chat-form').evaluate((form) => form.requestSubmit());
    await page.waitForFunction(async () => (await window.kuromi.getCompanion()).history.length === 4);
    await page.waitForFunction(() => !document.querySelector('#chat-send').disabled);
    const privateRequest = await application.evaluate(() => globalThis.__mockAI.chatRequests.at(-1));
    assert.equal(JSON.stringify(privateRequest.messages).includes(task), false, 'To-do text is excluded from model context');
    assert.equal(JSON.stringify(privateRequest.messages).includes(thought), false, 'Diary text is excluded from model context');
    await application.evaluate(() => { globalThis.__mockAI.failChat = true; });
    await page.locator('#chat-input').fill('A temporary connection failure should not save this.');
    await page.locator('#chat-form').evaluate((form) => form.requestSubmit());
    await page.waitForFunction(async () => !(await window.kuromi.getCompanion()).configured && document.querySelector('#chat-stop').hidden);
    assert.equal(await page.locator('#chat-send').isDisabled(), true, 'Connection failure updates the renderer to disconnected');
    assert.equal((await page.evaluate(() => window.kuromi.getCompanion())).history.length, 4, 'Failed inference never persists a partial conversation');
    await application.evaluate(() => { globalThis.__mockAI.failChat = false; });
    await tab('settings');
    await page.locator('#ai-refresh').click();
    await page.waitForFunction(() => document.querySelector('#ai-status').textContent.includes('connected'));

    await tab('search');
    const query = 'Kuromi & My Melody + "diary" #かわいい';
    await page.locator('#search-input').fill(query);
    await page.locator('#search-form').evaluate((form) => form.requestSubmit());
    for (let attempt = 0; attempt < 50; attempt++) {
      if ((await application.evaluate(() => globalThis.__searches)).length) break;
      await page.waitForTimeout(100);
    }
    const searches = await application.evaluate(() => globalThis.__searches);
    assert.equal(searches.length, 1);
    const searchURL = new URL(searches[0]);
    assert.equal(searchURL.origin, 'https://www.google.com');
    assert.equal(searchURL.pathname, '/search');
    assert.equal(searchURL.searchParams.get('q'), query);

    await tab('settings');
    await page.evaluate(async () => {
      const { PetAnimator } = await import('./pet.js');
      const original = PetAnimator.prototype.renderPose;
      PetAnimator.prototype.renderPose = function (pose) {
        original.call(this, pose);
        if (this.canvas.id === 'pet-canvas') globalThis.__reducedState = {
          state: this.currentState, pose: { ...pose }, bookVisible: this.rig.book.visible,
          eyeMorph: this.rig.eyes?.morphTargetInfluences?.slice() || [],
        };
      };
      globalThis.__restorePetRender = () => { PetAnimator.prototype.renderPose = original; };
    });
    await page.locator('#reduced-motion').check();
    await page.waitForFunction(async () => (await window.kuromi.load()).settings.reducedMotion === true);
    await page.waitForTimeout(250);
    await page.locator('#pet-canvas').evaluate((canvas) => {
      globalThis.__stillPixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      globalThis.__stillImage = canvas.toDataURL('image/png').split(',')[1];
      globalThis.__stillMood = document.querySelector('#pet-button').getAttribute('aria-expanded');
      globalThis.__stillState = globalThis.__reducedState;
    });
    await page.waitForTimeout(250);
    const stillDifference = await page.locator('#pet-canvas').evaluate((canvas) => {
      const before = globalThis.__stillPixels;
      const after = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let maximumPremultiplied = 0, maximumAlpha = 0, changedPixels = 0;
      for (let i = 0; i < after.length; i += 4) {
        let changed = false;
        for (let channel = 0; channel < 3; channel++) {
          const difference = Math.abs(after[i + channel] * after[i + 3] / 255 - before[i + channel] * before[i + 3] / 255);
          maximumPremultiplied = Math.max(maximumPremultiplied, difference);
          changed ||= difference > 0;
        }
        maximumAlpha = Math.max(maximumAlpha, Math.abs(after[i + 3] - before[i + 3]));
        if (changed) changedPixels++;
      }
      delete globalThis.__stillPixels;
      const result = { maximumPremultiplied, maximumAlpha, changedPixels, pixels: after.length / 4, sameSize: before.length === after.length,
        beforeImage: globalThis.__stillImage, afterImage: canvas.toDataURL('image/png').split(',')[1],
        beforeMood: globalThis.__stillMood, afterMood: document.querySelector('#pet-button').getAttribute('aria-expanded'),
        beforeState: globalThis.__stillState, afterState: globalThis.__reducedState };
      delete globalThis.__stillImage; delete globalThis.__stillMood;
      delete globalThis.__stillState; delete globalThis.__reducedState;
      globalThis.__restorePetRender(); delete globalThis.__restorePetRender;
      return result;
    });
    await fs.writeFile(path.join(output,'reduced-before.png'),Buffer.from(stillDifference.beforeImage,'base64'));
    await fs.writeFile(path.join(output,'reduced-after.png'),Buffer.from(stillDifference.afterImage,'base64'));
    delete stillDifference.beforeImage; delete stillDifference.afterImage;
    assert.deepEqual(stillDifference.afterState, stillDifference.beforeState, 'Reduced motion holds the exact pose, expression and prop state');
    // Compare visible color contributions: unassociated RGB can swing 0→255 at
    // alpha 1 when Canvas changes its readback backend, despite only 1/255 of
    // visible difference. Premultiplied color and alpha catch actual movement.
    assert.ok(stillDifference.sameSize && stillDifference.maximumPremultiplied <= 2 && stillDifference.maximumAlpha <= 1,
      `Reduced motion holds the pet still: ${JSON.stringify(stillDifference)}`);
    await page.locator('#always-on-top').uncheck();
    await page.waitForFunction(async () => (await window.kuromi.load()).settings.alwaysOnTop === false);
    for (let attempt = 0; attempt < 50; attempt++) {
      if (!await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop())) break;
      await page.waitForTimeout(20);
    }
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()), false);
    await tab('chat');
    await page.screenshot({ path: path.join(output, 'desktop.png') });
    const originalPosition = await page.evaluate(() => window.kuromi.getWindowPosition());
    try {
      const invalidAreaRejected = await page.evaluate(async () => {
        try { await window.kuromi.setVisibleArea({ x: -1, y: 0, width: 100, height: 100 }); return false; }
        catch { return true; }
      });
      assert.equal(invalidAreaRejected, true, 'Desktop visible-area IPC validates bounds');
      const moved = await page.evaluate(() => window.kuromi.moveWindow({ x: 100000, y: 100000 }));
      assert.deepEqual(await page.evaluate(() => window.kuromi.getWindowPosition()), moved, 'Window movement returns its actual clamped position');
      const displays = await application.evaluate(({ screen }) => screen.getAllDisplays().map((display) => display.workArea));
      const surface = await page.evaluate(() => {
        const bounds = ['#pet-button', '#panel', '#hover-card', '#speech', '#toast']
          .map((selector) => document.querySelector(selector))
          .filter((node) => !node.hidden && node.getClientRects().length)
          .map((node) => node.getBoundingClientRect());
        return { left: Math.floor(Math.min(...bounds.map((rect) => rect.left))),
          top: Math.floor(Math.min(...bounds.map((rect) => rect.top))),
          right: Math.ceil(Math.max(...bounds.map((rect) => rect.right))),
          bottom: Math.ceil(Math.max(...bounds.map((rect) => rect.bottom))) };
      });
      assert.ok(displays.some((area) => moved.x + surface.left >= area.x && moved.y + surface.top >= area.y &&
        moved.x + surface.right <= area.x + area.width && moved.y + surface.bottom <= area.y + area.height),
      'Visible pet and cards stay within a desktop work area');
    } finally {
      await page.evaluate((position) => window.kuromi.moveWindow(position), originalPosition);
    }
    await application.close();
    application = null;

    await launch(userData);
    await page.waitForFunction(() => document.body.dataset.companionReady === 'true', null, { timeout: 25000 });
    await installMockAI();
    await application.evaluate((_electron, name) => { globalThis.__mockAI.models = [{ name, size: 2_000_000_000 }]; }, model);
    await tab('settings');
    await page.locator('#ai-refresh').click();
    await page.waitForFunction(async () => (await window.kuromi.getCompanion()).configured);
    await tab('chat');
    saved = await page.evaluate(() => window.kuromi.load());
    assert.equal(saved.todos[0].text, task, 'Task survives restart');
    assert.equal(saved.todos[0].done, false);
    assert.equal(saved.thoughts[0].text, thought, 'Journal survives restart');
    assert.equal(saved.thoughts[0].mood, 'dreamy');
    assert.equal(saved.settings.reducedMotion, true, 'Motion preference survives restart');
    assert.equal(saved.settings.alwaysOnTop, false, 'Window preference survives restart');
    const companion = await page.evaluate(() => window.kuromi.getCompanion());
    assert.equal(companion.configured, true, 'Installed selected local model remains configured after restart');
    assert.equal(companion.model, model);
    assert.equal(companion.history.length, 4, 'Only completed conversations survive restart');
    assert.equal(companion.history[0].text, chatText);
    assert.equal(companion.history[1].text, chatReply);
    await page.getByText(chatReply, { exact: true }).first().waitFor();
    await tab('tasks');
    await page.getByText(task, { exact: true }).first().waitFor();
    await tab('diary');
    await page.getByText(thought, { exact: true }).waitFor();
    assert.deepEqual(errors, [], 'Renderer has no uncaught exceptions');
    console.log('PASS: real Electron UI; Ollama NDJSON streaming and cancellation using a local fake transport; fixed loopback/model discovery; private-note exclusion; cached daily greeting; all 25 rigged 3D gestures and continuous head tracking; context loss/recovery; reduced motion; safe task/thought text; hover completion; export; encoded Google search; native window settings; restart persistence.');
    console.log(`Screenshots: ${path.join(output, 'desktop.png')} and ${path.join(output, 'hover.png')}`);
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (application) await application.close();
    // Preserve test data with screenshots for a failed run; all paths are isolated.
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
