'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kuromi', Object.freeze({
  load: () => ipcRenderer.invoke('kuromi:load'),
  loadModel: () => ipcRenderer.invoke('kuromi:load-model'),
  addTodo: (text) => ipcRenderer.invoke('kuromi:add-todo', text),
  toggleTodo: (id) => ipcRenderer.invoke('kuromi:toggle-todo', id),
  deleteTodo: (id) => ipcRenderer.invoke('kuromi:delete-todo', id),
  addThought: (entry) => ipcRenderer.invoke('kuromi:add-thought', entry),
  deleteThought: (id) => ipcRenderer.invoke('kuromi:delete-thought', id),
  updateSettings: (patch) => ipcRenderer.invoke('kuromi:update-settings', patch),
  search: (query) => ipcRenderer.invoke('kuromi:search', query),
  exportJournal: () => ipcRenderer.invoke('kuromi:export-journal'),
  getWindowPosition: () => ipcRenderer.invoke('kuromi:get-position'),
  moveWindow: (position) => ipcRenderer.invoke('kuromi:move', position),
  setVisibleArea: (rectangle) => ipcRenderer.invoke('kuromi:set-visible-area', rectangle),
  getCompanion: () => ipcRenderer.invoke('kuromi:get-companion'),
  newChat: () => ipcRenderer.invoke('kuromi:new-chat'),
  onWindowBlur: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('A blur listener must be a function.');
    const listener = () => callback();
    ipcRenderer.on('kuromi:window-blur', listener);
    return () => ipcRenderer.removeListener('kuromi:window-blur', listener);
  },
  configureAI: (configuration) => ipcRenderer.invoke('kuromi:configure-ai', configuration),
  refreshConnection: () => ipcRenderer.invoke('kuromi:refresh-connection'),
  chat: (request) => ipcRenderer.invoke('kuromi:chat', request),
  cancelChat: (requestId) => ipcRenderer.invoke('kuromi:cancel-chat', requestId),
  dailyGreeting: () => ipcRenderer.invoke('kuromi:daily-greeting'),
  onChatDelta: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('A chat listener must be a function.');
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('kuromi:chat-delta', listener);
    return () => ipcRenderer.removeListener('kuromi:chat-delta', listener);
  },
  setInteractive: (interactive) => ipcRenderer.send('kuromi:interactive', interactive),
  minimize: () => ipcRenderer.invoke('kuromi:hide'),
  hide: () => ipcRenderer.invoke('kuromi:hide'),
  quit: () => ipcRenderer.invoke('kuromi:quit'),
}));
