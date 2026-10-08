'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  pickPhotos: () => ipcRenderer.invoke('dialog:photos'),
  pickPhotoFolder: () => ipcRenderer.invoke('dialog:photoFolder'),
  pickUploadRoot: () => ipcRenderer.invoke('dialog:uploadRoot'),
  scan: (paths) => ipcRenderer.invoke('photos:scan', paths),
  plan: (photos, job) => ipcRenderer.invoke('plan', { photos, job }),
  upload: (photos, job) => ipcRenderer.invoke('upload', { photos, job }),
  onProgress: (cb) => ipcRenderer.on('upload:progress', (_e, p) => cb(p)),
  pathForFile: (file) => webUtils.getPathForFile(file),
});
