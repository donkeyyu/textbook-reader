const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('textbookDesktop', Object.freeze({
  restore: () => ipcRenderer.invoke('vault:restore'),
  chooseVault: () => ipcRenderer.invoke('vault:choose'),
  list: (token) => ipcRenderer.invoke('vault:list', token),
  customCatalog: (token) => ipcRenderer.invoke('vault:custom:read', token),
  saveCustomCatalog: (token, revision, edit) => ipcRenderer.invoke('vault:custom:save', token, revision, edit),
  customDeletions: (token) => ipcRenderer.invoke('vault:custom:deletions', token),
  planCustomDeletion: (token, revision, kind, id, replacement) => ipcRenderer.invoke('vault:custom:plan', token, revision, kind, id, replacement),
  applyCustomDeletion: (token, id) => ipcRenderer.invoke('vault:custom:apply', token, id),
  links: (token) => ipcRenderer.invoke('vault:links', token),
  moveStatus: (token) => ipcRenderer.invoke('vault:moves', token),
  planMove: (token, from, to, revision) => ipcRenderer.invoke('vault:move:plan', token, from, to, revision),
  planRepair: (token, notice) => ipcRenderer.invoke('vault:move:repair', token, notice),
  applyMove: (token, operation) => ipcRenderer.invoke('vault:move:apply', token, operation),
  read: (token, path) => ipcRenderer.invoke('vault:read', token, path),
  save: (token, path, source, revision) => ipcRenderer.invoke('vault:save', token, path, source, revision),
  copy: (token, path, source, revision, replaceIdentity) => ipcRenderer.invoke('vault:copy', token, path, source, revision, replaceIdentity),
  protectDraft: (token, path, source) => ipcRenderer.invoke('vault:protect-draft', token, path, source),
  recoveries: (token) => ipcRenderer.invoke('vault:recoveries', token),
  onChange: (callback) => {
    const listener = (_event, change) => callback(change);
    ipcRenderer.on('vault:change', listener);
    return () => ipcRenderer.removeListener('vault:change', listener);
  },
  saveState: (token, state) => ipcRenderer.invoke('vault:state', token, state),
  readSettings: (token) => ipcRenderer.invoke('vault:settings:read', token),
  saveSettings: (token, revision, patch) => ipcRenderer.invoke('vault:settings:save', token, revision, patch),
  // Make the native close guard see a CodeMirror edit during that same event turn.
  setDirty: (dirty) => { ipcRenderer.sendSync('vault:dirty', dirty); },
}));

contextBridge.exposeInMainWorld('textbookResources', Object.freeze({
  context: () => ipcRenderer.invoke('textbooks:context'),
  status: () => ipcRenderer.invoke('textbooks:status'),
  add: (token, id) => ipcRenderer.invoke('textbooks:add', token, id),
  catalog: (token) => ipcRenderer.invoke('textbooks:catalog', token),
  notes: (token) => ipcRenderer.invoke('textbooks:notes', token),
  note: (token, sourceId) => ipcRenderer.invoke('textbooks:note', token, sourceId),
}));
