'use strict';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readDate, isImage } = require('./src/exif');
const { planNames, summarizeDates } = require('./src/naming');
const { upload } = require('./src/organizer');
const { needsPreview, previewFor } = require('./src/preview');
const { sanitize } = require('./src/naming');

const userFile = () => path.join(app.getPath('userData'), 'config.json');

// Defaults ship with the app; <userData>/config.json overrides any key
// (e.g. company categories, shared upload folder).
function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.default.json'), 'utf8'));
  try { Object.assign(cfg, JSON.parse(fs.readFileSync(userFile(), 'utf8'))); } catch { /* none yet */ }
  return cfg;
}
function saveConfig(patch) {
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(userFile(), 'utf8')); } catch { /* none yet */ }
  fs.mkdirSync(path.dirname(userFile()), { recursive: true });
  fs.writeFileSync(userFile(), JSON.stringify({ ...cur, ...patch }, null, 2));
}

function walk(p, exts, out = []) {
  let st;
  try { st = fs.statSync(p); } catch { return out; }
  if (st.isDirectory()) {
    for (const f of fs.readdirSync(p)) walk(path.join(p, f), exts, out);
  } else if (isImage(p, exts)) {
    out.push(p);
  }
  return out;
}

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 980, minHeight: 640,
    title: 'Job Photo Organizer',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:set', (_e, patch) => { saveConfig(patch); return loadConfig(); });

ipcMain.handle('dialog:photos', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Select photos', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: loadConfig().imageExtensions.map((e) => e.slice(1)) }],
  });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('dialog:photoFolder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Select a folder of photos', properties: ['openDirectory'] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('dialog:uploadRoot', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Select the customer files folder', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

// Expands files/folders into photo records with their dates.
ipcMain.handle('photos:scan', async (_e, paths) => {
  const exts = loadConfig().imageExtensions;
  const files = [...new Set(paths.flatMap((p) => walk(p, exts)))];
  const photos = [];
  for (const f of files) {
    const d = await readDate(f);
    photos.push({
      id: f, path: f, name: path.basename(f), ext: path.extname(f),
      url: pathToFileURL(f).href,
      takenDate: d.takenDate, dateSource: d.dateSource, sortKey: d.takenAt || '',
    });
  }
  return photos;
});

ipcMain.handle('photos:preview', (_e, file) => {
  if (!needsPreview(file)) return null;
  return previewFor(file, path.join(app.getPath('userData'), 'previews')).catch(() => null);
});

ipcMain.handle('plan', (_e, { photos, job }) => {
  const cfg = loadConfig();
  const { plans, problems } = planNames(photos, job, cfg.categories);
  return { plans, problems, dates: summarizeDates(photos, job.visitDate) };
});

ipcMain.handle('upload', async (_e, { photos, job }) => {
  const cfg = loadConfig();
  const { plans, problems } = planNames(photos, job, cfg.categories);
  if (problems.length) throw new Error('Some photos are not ready (customer, job name, category or date missing).');
  const byId = new Map(photos.map((p) => [p.id, p]));
  const items = plans.map((pl) => ({ ...pl, source: byId.get(pl.id).path, area: byId.get(pl.id).area || '' }));
  return upload(items, {
    root: job.uploadRoot,
    customerFolder: [sanitize(job.customer), sanitize(job.jobName)].filter(Boolean).join('_'),
    onProgress: (done, total) => win && win.webContents.send('upload:progress', { done, total }),
  });
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
