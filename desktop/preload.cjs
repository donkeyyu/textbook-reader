const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('textbookDesktop', Object.freeze({
  restore: () => ipcRenderer.invoke('vault:restore'),
  chooseVault: () => ipcRenderer.invoke('vault:choose'),
  list: (token) => ipcRenderer.invoke('vault:list', token),
  read: (token, path) => ipcRenderer.invoke('vault:read', token, path),
  save: (token, path, source, revision) => ipcRenderer.invoke('vault:save', token, path, source, revision),
  saveState: (token, state) => ipcRenderer.invoke('vault:state', token, state),
  // Make the native close guard see a CodeMirror edit during that same event turn.
  setDirty: (dirty) => { ipcRenderer.sendSync('vault:dirty', dirty); },
}));

contextBridge.exposeInMainWorld('textbookResources', Object.freeze({
  context: () => ipcRenderer.invoke('textbooks:context'),
  status: () => ipcRenderer.invoke('textbooks:status'),
  add: (token, id) => ipcRenderer.invoke('textbooks:add', token, id),
  catalog: (token) => ipcRenderer.invoke('textbooks:catalog', token),
}));
