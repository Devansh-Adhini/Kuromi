import { PetAnimator } from './pet.js';

const $ = (selector) => document.querySelector(selector);
const api = window.kuromi;
let state;
let tab = 'chat';
let panelOpen = true;
let showCompleted = false;
let petHovered = false;
let hoverTimer;
let speechTimer;
let toastTimer;
let drag;
let ignoreClick = false;
let interactive = true;
let lastInteraction = Date.now();
let roaming = false;
let roamDirection = -1;
let surfaceFrame;
let lastSurface = '';
let companion = { configured: false, history: [], greeting: null, models: [] };
let pendingChat;
let chatFrame;
let greetingPending = false;
let unsubscribeChat;
let companionLoading = true;
let aiBusy = false;
let chatFollowsLatest = true;
let chatScrollTop = 0;
const MOODS = { neutral: 'just me', happy: 'happy ♡', sad: 'a little blue', frustrated: 'grumpy', dreamy: 'dreamy ✦' };
const lines = {
  task: ["It's on our list. I'll keep an eye on it.", 'A plan worthy of my kingdom. Leave it with me.', "Written down. My Melody isn't out-organizing us today."],
  done: ['Ha! Another little victory. I knew we could.', "Finished! Baku, take notes. That's how it's done.", "You did it. I'm… a little proud of you. Just a little!"],
  reopen: ['A sequel? Fine. Back on the list.', "Round two. This time we're bringing extra attitude."],
  search: ['A clue! Your browser has the rest.', 'Investigation time. No mystery gets past us.', 'Even a mastermind does a little research.'],
  neutral: ["Tucked into the diary. I'm quite good at this, you know.", "A fresh page for your thoughts. I've always liked keeping a diary.", 'Written down. Sometimes a page is the best place to start.'],
  happy: ["Heh. You look happy. Maybe it's contagious.", 'This one deserves a little heart in the margin. ♡', "I'm keeping this good memory. For you, obviously."],
  sad: ["I'll keep you company. We can take today slowly.", "You don't have to put on a tough face with me.", 'A quiet page, a little company. One small thing at a time.'],
  frustrated: ['Ugh, I get it. Put it on the page. Then breathe.', "Hmph. Some days really do deserve a grumpy diary entry.", "Write it out. We can plot our next move when you're ready."],
  dreamy: ['A little daydream? Your secret is safe with me.', "This sounds like the start of a romance novel. I'm listening.", "Hearts in the margins? Don't look at me like that!"],
};
const previousLines = new Map();
let previousAnimation;
function chooseAnimation(names) {
  const options = names.filter((name) => name !== previousAnimation);
  previousAnimation = options[Math.floor(Math.random() * options.length)];
  return previousAnimation;
}

function line(kind) {
  const options = lines[kind].filter((value) => value !== previousLines.get(kind));
  const selected = options[Math.floor(Math.random() * options.length)];
  previousLines.set(kind, selected);
  return selected;
}
const animator = new PetAnimator($('#pet-canvas'));

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  scheduleSurface();
  toastTimer = setTimeout(() => { $('#toast').hidden = true; scheduleSurface(); }, 4500);
}

function report(error) {
  console.error(error);
  animator.play('sulk');
  toast(error?.message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'That did not save. Please try again.');
}

function speak(text, action = 'wave', duration = 4500) {
  lastInteraction = Date.now();
  animator.play(action);
  clearTimeout(speechTimer);
  $('#speech').textContent = text;
  $('#speech').hidden = panelOpen || !$('#hover-card').hidden;
  speechTimer = setTimeout(() => { $('#speech').hidden = true; scheduleSurface(); }, duration);
  scheduleSurface();
}

function updateHover() {
  const pending = state?.todos.filter((todo) => !todo.done) || [];
  $('#hover-card').hidden = panelOpen || !petHovered || !pending.length || Boolean(drag?.moved);
  if (!$('#hover-card').hidden) $('#speech').hidden = true;
  scheduleSurface();
}

// Clamp the visible companion and cards, rather than the large transparent
// backing window. This lets her reach the upper desktop and screen edges.
function scheduleSurface() {
  cancelAnimationFrame(surfaceFrame);
  surfaceFrame = requestAnimationFrame(async () => {
    if (!api?.setVisibleArea || !state) return;
    const bounds = ['#pet-button', '#panel', '#hover-card', '#speech', '#toast']
      .map((selector) => $(selector))
      .filter((node) => node && !node.hidden && node.getClientRects().length)
      .map((node) => node.getBoundingClientRect());
    const left = Math.max(0, Math.floor(Math.min(...bounds.map((rect) => rect.left))));
    const top = Math.max(0, Math.floor(Math.min(...bounds.map((rect) => rect.top))));
    const right = Math.min(innerWidth, Math.ceil(Math.max(...bounds.map((rect) => rect.right))));
    const bottom = Math.min(innerHeight, Math.ceil(Math.max(...bounds.map((rect) => rect.bottom))));
    const visible = { x: left, y: top, width: right - left, height: bottom - top };
    const key = JSON.stringify(visible);
    if (lastSurface === key) return;
    lastSurface = key;
    try { await api.setVisibleArea(visible); }
    catch (error) { lastSurface = ''; report(error); }
  });
}

function openPanel(view = tab) {
  panelOpen = true;
  $('#panel').hidden = false;
  $('#pet-button').setAttribute('aria-expanded', 'true');
  $('#speech').hidden = true;
  lastInteraction = Date.now();
  selectTab(view);
  updateHover();
}

function closePanel() {
  panelOpen = false;
  $('#panel').hidden = true;
  $('#pet-button').setAttribute('aria-expanded', 'false');
  // Moving focus out prevents a hidden input from receiving desktop typing.
  $('#pet-button').focus({ preventScroll: true });
  petHovered = false;
  updateHover();
}

function selectTab(name) {
  tab = name;
  lastInteraction = Date.now();
  document.querySelectorAll('[data-tab]').forEach((button) => {
    const active = button.dataset.tab === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-view]').forEach((view) => { view.hidden = view.dataset.view !== name; });
  $('.panel-content').scrollTop = 0;
  $('#panel').classList.toggle('showing-chat', name === 'chat');
  if (name === 'diary') animator.play('thinking');
  else if (name === 'tasks') animator.play('review');
  else if (name === 'search') animator.play('waiting');
  const focusTarget = { chat: companion.configured ? '#chat-input' : null, tasks: '#todo-input', diary: '#thought-input', search: '#search-input' }[name];
  if (focusTarget) setTimeout(() => $(focusTarget).focus({ preventScroll: true }), 30);
  if (name === 'chat') requestAnimationFrame(() => {
    if (chatFollowsLatest) scrollChat();
    else $('#chat-log').scrollTop = chatScrollTop;
  });
}

async function mutate(action, message, reaction = 'happy') {
  state = await action();
  render();
  if (message) speak(message, reaction);
  checkDailyGreeting();
  return state;
}

function todoRow(todo, compact = false) {
  const row = element('div', `todo-entry${todo.done ? ' done' : ''}`);
  const check = element('button', 'todo-check', todo.done ? '✓' : '');
  check.type = 'button';
  check.setAttribute('role', 'checkbox');
  check.setAttribute('aria-checked', String(todo.done));
  check.setAttribute('aria-label', `${todo.done ? 'Reopen' : 'Complete'} ${todo.text}`);
  check.addEventListener('click', async () => {
    check.disabled = true;
    try {
      const lastPlan = !todo.done && state.todos.filter((entry) => !entry.done).length === 1;
      const reaction = todo.done ? chooseAnimation(['waiting', 'head-shake'])
        : lastPlan ? chooseAnimation(['dance', 'fist-pump']) : chooseAnimation(['nod', 'fist-pump', 'excited']);
      await mutate(() => api.toggleTodo(todo.id), line(todo.done ? 'reopen' : 'done'), reaction);
    } catch (error) { check.disabled = false; report(error); }
  });
  row.append(check, element('span', 'todo-text', todo.text));
  if (!compact) {
    const remove = element('button', 'delete-button', '×');
    remove.setAttribute('aria-label', `Delete ${todo.text}`);
    remove.title = 'Remove this to-do';
    remove.addEventListener('click', () => mutate(() => api.deleteTodo(todo.id)).catch(report));
    row.append(remove);
  }
  return row;
}

function empty(target, icon, message) {
  const node = element('div', 'empty-state');
  node.append(element('span', '', icon), document.createTextNode(message));
  target.append(node);
}

function render() {
  const pending = state.todos.filter((todo) => !todo.done);
  const done = state.todos.length - pending.length;
  $('#task-count').textContent = String(pending.length);
  $('#task-count').hidden = !pending.length;
  $('#todo-summary').textContent = `${pending.length} LITTLE ${pending.length === 1 ? 'PLAN' : 'PLANS'} LEFT${done ? ` · ${done} FINISHED` : ''}`;
  $('#show-completed').textContent = showCompleted ? 'Hide finished' : 'Show finished';
  $('#show-completed').setAttribute('aria-pressed', String(showCompleted));
  $('#todo-list').replaceChildren();
  const shown = state.todos.filter((todo) => showCompleted || !todo.done);
  shown.forEach((todo) => $('#todo-list').append(todoRow(todo)));
  if (!shown.length) empty($('#todo-list'), done ? '✦' : '✓', done ? 'All caught up. I suppose we make a pretty good team.' : 'No plans yet. Go on, give me something to plot.');
  $('#hover-count').textContent = `${pending.length} to go`;
  $('#hover-todos').replaceChildren(...pending.map((todo) => todoRow(todo, true)));
  $('#thought-list').replaceChildren();
  $('#diary-summary').textContent = `${state.thoughts.length} ${state.thoughts.length === 1 ? 'THOUGHT' : 'THOUGHTS'}, SAFELY TUCKED AWAY`;
  for (const thought of [...state.thoughts].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const entry = element('article', 'thought-entry');
    const meta = element('div', 'thought-meta');
    const date = element('time', '', new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(thought.createdAt)));
    date.dateTime = thought.createdAt;
    const remove = element('button', 'delete-button', '×');
    remove.setAttribute('aria-label', 'Delete thought');
    remove.title = 'Delete this thought';
    let armed = false;
    remove.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        remove.textContent = 'Delete?';
        remove.setAttribute('aria-label', 'Confirm delete thought');
        setTimeout(() => { armed = false; remove.textContent = '×'; remove.setAttribute('aria-label', 'Delete thought'); }, 4000);
        return;
      }
      try { await mutate(() => api.deleteThought(thought.id)); } catch (error) { report(error); }
    });
    meta.append(date, element('span', 'mood-tag', MOODS[thought.mood] || 'just me'), remove);
    entry.append(meta, element('p', '', thought.text));
    $('#thought-list').append(entry);
  }
  if (!state.thoughts.length) empty($('#thought-list'), '♡', 'A fresh page. Tell me whatever is on your mind.');
  applySettings();
  updateHover();
}

function applySettings() {
  const settings = state.settings;
  $('#always-on-top').checked = settings.alwaysOnTop;
  $('#roaming').checked = settings.roaming;
  $('#reduced-motion').checked = settings.reducedMotion;
  $('#pet-scale').value = settings.scale;
  $('#size-label').textContent = `${Math.round(settings.scale * 100)}%`;
  document.body.classList.toggle('reduced-motion', settings.reducedMotion);
  document.documentElement.style.setProperty('--pet-scale', String(settings.scale));
  animator.setReducedMotion(settings.reducedMotion);
  if (animator.scale !== settings.scale) animator.setScale(settings.scale);
  scheduleSurface();
}

document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => selectTab(button.dataset.tab)));
$('#close-panel').addEventListener('click', closePanel);
$('#hover-open').addEventListener('click', () => openPanel('tasks'));
$('#show-completed').addEventListener('click', () => { showCompleted = !showCompleted; render(); });

$('#todo-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#todo-input');
  const text = input.value.trim();
  if (!text) return input.focus();
  const button = $('#todo-form button');
  button.disabled = true;
  try {
    await mutate(() => api.addTodo(text), line('task'), 'review');
    input.value = '';
    input.focus();
  } catch (error) { report(error); }
  finally { button.disabled = false; }
});

$('#thought-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('#thought-input').value.trim();
  if (!text) return $('#thought-input').focus();
  const mood = $('#thought-mood').value;
  const button = $('#thought-form button');
  button.disabled = true;
  try {
    const reply = line(mood);
    const reaction = chooseAnimation({ neutral: ['thinking', 'nod'], happy: ['giggle', 'smug'],
      dreamy: ['shy', 'curtsy'], frustrated: ['pout', 'head-shake'], sad: ['head-tilt', 'listen'] }[mood]);
    await mutate(() => api.addThought({ text, mood }), reply, reaction);
    $('#thought-input').value = '';
  } catch (error) { report(error); }
  finally { button.disabled = false; }
});

async function search(query) {
  if (!query.trim()) return $('#search-input').focus();
  const button = $('#search-form .primary');
  button.disabled = true;
  try {
    await api.search(query);
    speak(line('search'), 'thinking');
    toast('Google results opened in your browser.');
  } catch (error) { report(error); }
  finally { button.disabled = false; }
}
$('#search-form').addEventListener('submit', (event) => { event.preventDefault(); search($('#search-input').value); });
$('#export-journal').addEventListener('click', async () => {
  try {
    const result = await api.exportJournal();
    if (!result.canceled) toast('Your diary was exported. A little keepsake.');
  } catch (error) { report(error); }
});

for (const [selector, setting] of [['#always-on-top', 'alwaysOnTop'], ['#roaming', 'roaming'], ['#reduced-motion', 'reducedMotion'], ['#pet-scale', 'scale']]) {
  $(selector).addEventListener('change', async (event) => {
    const value = setting === 'scale' ? Number(event.target.value) : event.target.checked;
    try { await mutate(() => api.updateSettings({ [setting]: value })); }
    catch (error) { applySettings(); report(error); }
  });
}
$('#pet-scale').addEventListener('input', (event) => { $('#size-label').textContent = `${Math.round(Number(event.target.value) * 100)}%`; });
$('#hide-pet').addEventListener('click', () => api.hide().catch(report));
$('#quit').addEventListener('click', () => api.quit().catch(report));

async function refreshStartup() {
  const { supported, enabled } = await api.getStartup();
  $('#launch-at-login-setting').hidden = !supported;
  $('#launch-at-login').checked = enabled;
}

$('#launch-at-login').addEventListener('change', async (event) => {
  const input = event.target;
  const requested = input.checked;
  input.disabled = true;
  try { input.checked = (await api.setStartup(requested)).enabled; }
  catch (error) { input.checked = !requested; report(error); }
  finally { input.disabled = false; }
});

function messageBubble(message) {
  const bubble = element('article', `chat-message ${message.role}`);
  bubble.append(element('span', 'message-author', message.role === 'user' ? 'YOU' : 'KUROMI'), element('p', '', message.text));
  return bubble;
}

function scrollChat() {
  if (!chatFollowsLatest) return;
  const log = $('#chat-log');
  log.scrollTop = log.scrollHeight;
}

$('#chat-log').addEventListener('scroll', () => {
  const log = $('#chat-log');
  if (!log.clientHeight) return;
  chatScrollTop = log.scrollTop;
  chatFollowsLatest = log.scrollHeight - log.scrollTop - log.clientHeight < 32;
});

function renderCompanion() {
  const log = $('#chat-log');
  const previousScrollTop = log.clientHeight ? log.scrollTop : chatScrollTop;
  $('#chat-messages').replaceChildren(...companion.history.map(messageBubble));
  $('#chat-connect-note').hidden = companion.configured || companionLoading;
  $('#chat-input').disabled = !companion.configured || Boolean(pendingChat) || aiBusy;
  $('#chat-input').placeholder = companion.configured ? "Tell me what's on your mind…" : 'Connect AI in Settings to chat…';
  $('#chat-send').disabled = !companion.configured || Boolean(pendingChat) || aiBusy;
  $('#new-chat').disabled = companionLoading || Boolean(pendingChat) || aiBusy;
  $('#chat-send').hidden = Boolean(pendingChat);
  $('#chat-stop').hidden = !pendingChat;
  $('#ai-status').textContent = companionLoading || aiBusy ? 'Checking Ollama…' : companion.configured ? 'Local · connected' : 'Not connected';
  $('#ai-status').classList.toggle('connected', companion.configured);
  const models = companion.models || [];
  $('#ai-model').replaceChildren(...models.map((model) => {
    const option = element('option', '', model.name);
    option.value = model.name;
    return option;
  }));
  if (!models.length) {
    const option = element('option', '', companionLoading ? 'Looking for local models…' : 'No local models found');
    option.value = '';
    $('#ai-model').append(option);
  }
  $('#ai-model').value = models.some((model) => model.name === companion.model) ? companion.model : models[0]?.name || '';
  $('#ai-connect').disabled = companionLoading || aiBusy || Boolean(pendingChat) || !models.length;
  $('#ai-refresh').disabled = companionLoading || aiBusy || Boolean(pendingChat);
  $('#ai-model').disabled = companionLoading || aiBusy || Boolean(pendingChat);
  $('#ai-warning').hidden = !companion.warning;
  $('#ai-warning').textContent = companion.warning || '';
  if (companion.greeting) showGreeting(companion.greeting);
  if (pendingChat) {
    $('#chat-messages').append(messageBubble({ role: 'user', text: pendingChat.userText }));
    const reply = messageBubble({ role: 'assistant', text: pendingChat.text || '…' });
    reply.classList.add('streaming');
    reply.querySelector('p').id = 'stream-text';
    $('#chat-messages').append(reply);
  }
  scrollChat();
  if (!chatFollowsLatest && log.clientHeight) log.scrollTop = previousScrollTop;
  scheduleSurface();
}

function showGreeting(greeting) {
  $('#greeting-text').textContent = greeting.text;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  $('#greeting-date').textContent = greeting.date === today ? '· TODAY' : `· ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${greeting.date}T12:00:00`))}`;
  $('#greeting-source').textContent = greeting.source === 'local' && greeting.kind !== 'task' ? 'Offline greeting' : '';
}

async function checkDailyGreeting() {
  if (companionLoading || greetingPending || document.hidden || !api?.dailyGreeting) return;
  greetingPending = true;
  try {
    const greeting = await api.dailyGreeting();
    companion.greeting = greeting;
    showGreeting(greeting);
    if (greeting.isNew) {
      const reaction = greeting.kind === 'task' ? chooseAnimation(['beckon', 'smug']) : chooseAnimation(['wave', 'curtsy']);
      animator.play(reaction);
      if (!panelOpen) speak(greeting.text, reaction, 9000);
      else if (tab === 'chat' && !pendingChat) scrollChat();
    }
    if (greeting.warning) {
      companion = await api.getCompanion();
      renderCompanion();
      $('#ai-warning').textContent = greeting.warning;
      $('#ai-warning').hidden = false;
    }
  } catch (error) {
    // A greeting should never interrupt a task or block offline tools.
    console.error('Daily greeting:', error.message);
  } finally { greetingPending = false; }
}

$('#new-chat').addEventListener('click', async () => {
  if (pendingChat || aiBusy) return;
  aiBusy = true; renderCompanion();
  try {
    companion = await api.newChat();
    chatFollowsLatest = true; chatScrollTop = 0;
    renderCompanion();
    animator.play('wave');
    $('#chat-input').focus({ preventScroll: true });
  } catch (error) { report(error); }
  finally { aiBusy = false; renderCompanion(); if (panelOpen) $('#chat-input').focus({ preventScroll: true }); }
});

window.addEventListener('blur', () => { if (panelOpen) closePanel(); });
const unsubscribeBlur = api?.onWindowBlur?.(() => { if (panelOpen) closePanel(); });
document.addEventListener('pointerdown', (event) => {
  if (panelOpen && !event.target.closest?.('#panel, #pet-button, #hover-card, #speech')) closePanel();
});

$('#connect-ai').addEventListener('click', () => { selectTab('settings'); $('#ai-refresh').focus(); });
$('#ai-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (aiBusy || pendingChat || companionLoading) return;
  const model = $('#ai-model').value;
  if (!model) return;
  aiBusy = true;
  renderCompanion();
  try {
    companion = await api.configureAI({ model });
    renderCompanion();
    toast('Local model ready. Come say hello. ♡');
    selectTab('chat');
  } catch (error) { report(error); }
  finally { aiBusy = false; renderCompanion(); }
});
$('#ai-refresh').addEventListener('click', async () => {
  if (aiBusy || pendingChat || companionLoading) return;
  aiBusy = true;
  renderCompanion();
  try {
    companion = await api.refreshConnection();
    renderCompanion();
  } catch (error) { report(error); }
  finally { aiBusy = false; renderCompanion(); }
});

function receiveChatDelta(event) {
  if (!pendingChat || pendingChat.id !== event.requestId || pendingChat.stopped || typeof event.delta !== 'string') return;
  pendingChat.text += event.delta;
  animator.setTalking?.(true);
  if (chatFrame) return;
  chatFrame = requestAnimationFrame(() => {
    chatFrame = null;
    const text = $('#stream-text');
    if (text && pendingChat) {
      text.textContent = pendingChat.text;
      scrollChat();
    }
  });
}

$('#chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pendingChat) return;
  if (!companion.configured) { selectTab('settings'); $('#ai-refresh').focus(); return; }
  const userText = $('#chat-input').value.trim();
  if (!userText) return;
  const request = { id: crypto.randomUUID(), userText, text: '', stopped: false };
  pendingChat = request;
  chatFollowsLatest = true;
  $('#chat-input').value = '';
  renderCompanion();
  animator.play('listen', { loop: true });
  try {
    const response = await api.chat({ text: userText, requestId: request.id });
    companion.history = response.history;
    let reactions = ['happy', 'nod', 'smug'];
    if (/\b(tired|sad|lonely|rough|exhausted|long day|upset|overwhelmed)\b/i.test(userText)) reactions = ['head-tilt', 'listen'];
    else if (/\b(blush|romance|daydream)\b/i.test(response.message.text)) reactions = ['shy', 'curtsy'];
    else if (/\b(hehe|haha|giggle)\b/i.test(response.message.text)) reactions = ['giggle', 'smug'];
    else if (/\b(finished|completed|did it|proud)\b/i.test(userText)) reactions = ['fist-pump', 'excited'];
    const reaction = chooseAnimation(reactions);
    if (!panelOpen && !request.stopped) speak(response.message.text, reaction, 9000);
    else if (!request.stopped) animator.play(reaction, { duration: 2200 });
  } catch (error) {
    if (!$('#chat-input').value) $('#chat-input').value = userText;
    if (request.stopped) toast('Stopped. Your message is ready to edit.');
    else {
      try { companion = await api.getCompanion(); } catch { companion.configured = false; }
      report(error);
    }
  } finally {
    pendingChat = null;
    cancelAnimationFrame(chatFrame);
    chatFrame = null;
    animator.setTalking?.(false);
    if (['waiting', 'listen'].includes(animator.currentState)) animator.play('idle');
    renderCompanion();
    if (panelOpen && tab === 'chat') $('#chat-input').focus({ preventScroll: true });
  }
});
$('#chat-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $('#chat-form').requestSubmit();
  }
});
$('#chat-input').addEventListener('focus', () => { if (!pendingChat && animator.currentState === 'idle') animator.play('listen', { duration: 3500 }); });
$('#chat-stop').addEventListener('click', async () => {
  if (!pendingChat) return;
  pendingChat.stopped = true;
  $('#chat-stop').disabled = true;
  try { await api.cancelChat(pendingChat.id); }
  catch (error) { report(error); }
  finally { $('#chat-stop').disabled = false; }
});

// The transparent padding passes clicks to the desktop. Electron forwards mouse
// movement so the visible pet and cards can become interactive again.
function setInteractive(value) {
  if (interactive === value) return;
  interactive = value;
  api?.setInteractive(value);
}
document.addEventListener('mousemove', (event) => {
  const surface = event.target.closest?.('[data-interactive]');
  const onPet = surface?.id === 'pet-button';
  const hit = onPet && animator.hitTest(event.clientX, event.clientY);
  setInteractive(Boolean(drag || (onPet ? hit : surface)));
  $('#pet-button').style.cursor = hit ? 'grab' : 'default';
  if (onPet) {
    petHovered = hit;
    updateHover();
  }
  animator.lookAt(event.clientX, event.clientY);
});
document.addEventListener('mouseleave', () => { if (!drag) setInteractive(false); });
document.addEventListener('pointerdown', () => { lastInteraction = Date.now(); });
document.addEventListener('keydown', (event) => {
  lastInteraction = Date.now();
  if (event.key === 'Escape' && panelOpen) closePanel();
});
for (const selector of ['#hover-card']) {
  $(selector).addEventListener('mouseenter', () => {
    clearTimeout(hoverTimer);
    petHovered = true;
    updateHover();
  });
  $(selector).addEventListener('mouseleave', () => {
    hoverTimer = setTimeout(() => { petHovered = false; updateHover(); }, 220);
  });
}
$('#pet-button').addEventListener('mouseleave', () => {
  hoverTimer = setTimeout(() => { petHovered = false; updateHover(); }, 220);
});

$('#pet-button').addEventListener('pointerdown', async (event) => {
  if (event.button !== 0 || !api) return;
  if (!animator.hitTest(event.clientX, event.clientY, true)) { setInteractive(false); return; }
  const gesture = { x: event.screenX, y: event.screenY, latestX: event.screenX, latestY: event.screenY, moved: false, position: null, pending: false };
  drag = gesture;
  $('#pet-button').setPointerCapture(event.pointerId);
  try { gesture.position = await api.getWindowPosition(); }
  catch (error) { drag = null; report(error); }
});
$('#pet-button').addEventListener('pointermove', (event) => {
  if (!drag?.position) return;
  const dx = event.screenX - drag.x;
  const dy = event.screenY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 5) return;
  drag.moved = true;
  document.body.classList.add('dragging');
  animator.setDragging(true, dx < 0 ? 'left' : 'right');
  updateHover();
  const position = { x: Math.round(drag.position.x + dx), y: Math.round(drag.position.y + dy) };
  api.moveWindow(position).catch(report);
});
function finishDrag() {
  if (!drag) return;
  ignoreClick = drag.moved;
  const wasMoved = drag.moved;
  drag = null;
  document.body.classList.remove('dragging');
  animator.setDragging(false);
  updateHover();
  if (wasMoved) { lastInteraction = Date.now(); setTimeout(() => { ignoreClick = false; }, 250); }
}
$('#pet-button').addEventListener('pointerup', finishDrag);
$('#pet-button').addEventListener('pointercancel', finishDrag);
$('#pet-button').addEventListener('lostpointercapture', finishDrag);
$('#pet-button').addEventListener('click', (event) => {
  if (ignoreClick) { ignoreClick = false; return; }
  if (event.detail !== 0 && !animator.hitTest(event.clientX, event.clientY, true)) return;
  panelOpen ? closePanel() : openPanel();
  animator.play('wave', { duration: 1200 });
});

setInterval(async () => {
  if (!state || document.hidden || pendingChat || roaming || drag || panelOpen || petHovered || state.settings.reducedMotion || Date.now() - lastInteraction < 25000) return;
  if (!state.settings.roaming) {
    const idleReactions = ['look-around', 'head-tilt', 'stretch', 'ear-twitch', 'doze', 'thinking', 'smug', 'tiptoe', 'yawn'];
    if (animator.currentState === 'idle') animator.play(chooseAnimation(idleReactions));
    return;
  }
  roaming = true;
  try {
    const initial = await api.getWindowPosition();
    const started = performance.now();
    animator.play(roamDirection < 0 ? 'walk-left' : 'walk-right', { duration: 6000 });
    let prior = initial;
    while (performance.now() - started < 5500 && !document.hidden && !panelOpen && !petHovered && !drag && state.settings.roaming && !state.settings.reducedMotion) {
      const desired = { x: initial.x + Math.round((performance.now() - started) * 0.012) * roamDirection, y: initial.y };
      const next = await api.moveWindow(desired);
      if (next.x === prior.x && Math.abs(desired.x - prior.x) > 2) break;
      prior = next;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    roamDirection *= -1;
    if (!drag && animator.currentState.startsWith('walk-')) animator.play('idle');
    lastInteraction = Date.now();
  } catch (error) { report(error); }
  finally { roaming = false; }
}, 10000);

async function initialize() {
  if (!api) throw new Error('Please launch Kuromi Desktop.exe or use npm start. This companion needs its desktop shell.');
  $('#panel').classList.add('busy');
  try {
    [state] = await Promise.all([api.load(), animator.ready]);
    render();
    renderCompanion();
    selectTab('chat');
    refreshStartup().catch(report);
    unsubscribeChat = api.onChatDelta(receiveChatDelta);
    animator.play('wave');
    document.body.dataset.ready = 'true';
  } finally { $('#panel').classList.remove('busy'); }
  // Model startup and conversation storage must not block the independent tools.
  try { companion = await api.getCompanion(); }
  catch (error) {
    companion.warning = 'The conversation could not be loaded. Your to-dos and diary are ready to use.';
    console.error('Local conversation:', error.message);
  } finally {
    companionLoading = false;
    document.body.dataset.companionReady = 'true';
    renderCompanion();
  }
  checkDailyGreeting();
}
initialize().catch(report);
setInterval(checkDailyGreeting, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDailyGreeting(); });
const surfaceObserver = new ResizeObserver(scheduleSurface);
['#panel', '#hover-card', '#pet-button'].forEach((selector) => surfaceObserver.observe($(selector)));
window.addEventListener('resize', scheduleSurface);
$('#panel').addEventListener('animationend', scheduleSurface);
window.addEventListener('beforeunload', () => { unsubscribeChat?.(); unsubscribeBlur?.(); animator.destroy(); });
