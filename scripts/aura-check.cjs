'use strict';

// Runs against a disposable profile. No user records or model inference are used.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');

async function launch(profile) {
  const app = await electron.launch({ args: [root], cwd: root,
    env: { ...process.env, KUROMI_USER_DATA: profile }, timeout: 30000 });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.companionReady === 'true');
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#pet-canvas');
    return canvas?.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 96);
  });
  await page.evaluate(() => window.kuromi.setInteractive(true));
  return { app, page, errors };
}

async function tab(page, name) {
  if (!await page.locator('#panel').isVisible()) await page.locator('#pet-button').evaluate(button => button.click());
  await page.locator(`[data-tab="${name}"]`).evaluate(button => button.click());
}

async function toggle(page, selector, enabled) {
  await tab(page, 'settings');
  const input = page.locator(selector);
  await input.setChecked(enabled);
  await page.waitForFunction(({ selector, enabled }) => document.querySelector(selector).checked === enabled,
    { selector, enabled });
}

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'kuromi-aura-'));
  const createdAt = new Date().toISOString();
  const day = new Date();
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  const todos = [{ id: 'saved-task', text: 'Finish one little victory', done: false, createdAt }];
  const thoughts = [{ id: 'saved-note', text: 'A note worth keeping.', mood: 'dreamy', createdAt }];
  const history = [{ id: 'saved-chat', role: 'user', text: 'A previous conversation.', createdAt },
    { id: 'saved-reply', role: 'assistant', text: 'Hmph. I remembered, obviously. ♡', createdAt }];
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(profile, 'journal.json'), JSON.stringify({ version: 1, todos, thoughts, settings: {} }));
  await fs.writeFile(path.join(profile, 'companion.json'), JSON.stringify({ version: 1, model: 'llama3.2:3b', history,
    greetings: [{ text: 'Come on. That little victory is waiting for you.', date, source: 'local', kind: 'task', taskId: 'saved-task' }] }));

  let session = await launch(profile);
  try {
    let { app, page, errors } = session;
    assert.equal(await page.locator('#pet-aura').isHidden(), true, 'Legacy profiles start with aura off');
    assert.equal((await page.evaluate(() => window.kuromi.load())).settings.aura, false);
    await toggle(page, '#aura', true);
    await page.waitForFunction(() => !document.querySelector('#pet-aura').hidden);
    assert.equal((await page.evaluate(() => window.kuromi.load())).settings.aura, true);
    assert.equal(await page.locator('#pet-aura').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator('#pet-aura > span').count(), 8, 'Hearts and sparkles are decorative');
    assert.ok(await page.locator('#pet-aura').evaluate(node => [node, ...node.querySelectorAll('*')]
      .every(element => getComputedStyle(element).pointerEvents === 'none')), 'Aura passes pointer input through');

    await toggle(page, '#reduced-motion', true);
    await page.waitForFunction(() => document.body.classList.contains('reduced-motion'));
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#pet-aura').evaluate(node => node.getAnimations({ subtree: true }).length), 0,
      'Reduced motion holds every aura layer still');
    await page.evaluate(async () => {
      const { PetAnimator } = await import('./pet.js');
      const original = PetAnimator.prototype.renderPose;
      PetAnimator.prototype.renderPose = function (pose) {
        original.call(this, pose);
        if (this.canvas.id === 'pet-canvas') globalThis.__auraTestPet = this;
      };
      globalThis.__restoreAuraTest = () => { PetAnimator.prototype.renderPose = original; };
    });
    await page.waitForFunction(() => Boolean(globalThis.__auraTestPet));
    const hitArea = await page.evaluate(() => {
      const pet = globalThis.__auraTestPet;
      pet.play('idle');
      const rect = pet.canvas.getBoundingClientRect();
      const before = [];
      for (let y = 0; y <= 10; y++) for (let x = 0; x <= 10; x++) {
        before.push(pet.hitTest(rect.left + rect.width * x / 10, rect.top + rect.height * y / 10, true));
      }
      return before;
    });
    assert.ok(hitArea.some(Boolean) && hitArea.some(value => !value), 'Model retains a silhouette shaped hit area');
    await toggle(page, '#aura', false);
    const hitsWithoutAura = await page.evaluate(() => {
      const pet = globalThis.__auraTestPet;
      const rect = pet.canvas.getBoundingClientRect();
      const hits = [];
      for (let y = 0; y <= 10; y++) for (let x = 0; x <= 10; x++) {
        hits.push(pet.hitTest(rect.left + rect.width * x / 10, rect.top + rect.height * y / 10, true));
      }
      return hits;
    });
    assert.deepEqual(hitsWithoutAura, hitArea, 'Aura does not enlarge the model hit area');
    await toggle(page, '#aura', true);
    await page.evaluate(() => globalThis.__restoreAuraTest());
    await toggle(page, '#reduced-motion', false);
    for (const name of ['chat', 'tasks', 'diary', 'search', 'settings']) {
      await tab(page, name);
      assert.equal(await page.locator(`[data-view="${name}"]`).isVisible(), true, `${name} remains available`);
    }
    await tab(page, 'chat');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(output, 'aura-dialog.png'), omitBackground: true });
    await tab(page, 'settings');
    await page.locator('#pet-scale').evaluate(input => {
      input.value = '1.25';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--pet-scale') === '1.25');
    await tab(page, 'chat');
    await page.waitForTimeout(300);
    const bounds = await page.locator('#pet-aura').boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height,
      'Aura stays within the desktop window at maximum UI size');
    await page.screenshot({ path: path.join(output, 'aura-dialog-large.png'), omitBackground: true });
    assert.deepEqual(errors, []);
    await app.close();

    session = await launch(profile);
    ({ app, page, errors } = session);
    assert.equal(await page.locator('#pet-aura').isVisible(), true, 'Aura preference survives a full relaunch');
    assert.equal(await page.locator('#aura').isChecked(), true);
    const saved = await page.evaluate(() => window.kuromi.load());
    assert.deepEqual(saved.todos, todos);
    assert.deepEqual(saved.thoughts, thoughts);
    assert.deepEqual((await page.evaluate(() => window.kuromi.getSavedCompanion())).history, history);
    assert.deepEqual(errors, []);
    console.log('PASS: aura toggle persists; existing records and all tabs remain available; reduced motion holds the aura still; decoration leaves the hit area unchanged; normal and large dialog screenshots captured.');
  } finally { await session.app.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
