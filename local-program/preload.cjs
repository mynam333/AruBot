const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aruLocal', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  start: () => ipcRenderer.invoke('agent:start'),
  stop: () => ipcRenderer.invoke('agent:stop'),
  discoverTits: () => ipcRenderer.invoke('tits:discover'),
  authenticateVtube: () => ipcRenderer.invoke('vtube:authenticate'),
  discoverVtube: () => ipcRenderer.invoke('vtube:discover'),
  triggerVtubeHotkey: (payload) => ipcRenderer.invoke('vtube:hotkey', payload),
  chooseSoundFolder: () => ipcRenderer.invoke('folder:chooseSound'),
  openSoundFolder: () => ipcRenderer.invoke('folder:openSound'),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  openDashboard: () => ipcRenderer.invoke('dashboard:open'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  remoteOverview: () => ipcRenderer.invoke('remote:overview'),
  remoteSaveCommand: (rule) => ipcRenderer.invoke('remote:command:save', rule),
  remoteDeleteCommand: (id) => ipcRenderer.invoke('remote:command:delete', id),
  remoteTestRoulette: (roulette) => ipcRenderer.invoke('remote:roulette:test', roulette),
  remotePopVideoDonation: () => ipcRenderer.invoke('remote:pvd:pop'),
  remoteControlVideoDonation: (control) => ipcRenderer.invoke('remote:pvd:control', control),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('agent-state', listener);
    return () => ipcRenderer.removeListener('agent-state', listener);
  },
  onLocalTask: (callback) => {
    const listener = (_event, task) => callback(task);
    ipcRenderer.on('local-task', listener);
    return () => ipcRenderer.removeListener('local-task', listener);
  },
});
