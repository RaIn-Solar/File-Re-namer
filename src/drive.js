'use strict';
// Google Drive helpers for the phone app. Pure functions over an injected `fetch`
// and an `getToken()` so they can be tested without a network.

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';

// Accepts a Drive folder link (…/folders/<id>?…, …?id=<id>) or a bare id.
function parseFolderId(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/folders\/([\w-]+)/) || s.match(/[?&]id=([\w-]+)/);
  if (m) return m[1];
  return /^[\w-]{10,}$/.test(s) ? s : '';
}

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function createDrive({ fetch, getToken }) {
  async function call(url, init = {}) {
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${await getToken()}` },
    });
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).error.message; } catch { /* ignore */ }
      const err = new Error(msg || `Google Drive error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async function list(query) {
    const out = [];
    let pageToken;
    do {
      const params = {
        q: query, fields: 'nextPageToken,files(id,name)', pageSize: '1000', spaces: 'drive',
        supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
      };
      if (pageToken) params.pageToken = pageToken;
      const r = await call(`${API}/files?${new URLSearchParams(params)}`);
      out.push(...(r.files || []));
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }

  // Finds a sub-folder by exact name or creates it.
  async function ensureFolder(parentId, name) {
    const found = await list(`mimeType='${FOLDER}' and trashed=false and ${q(parentId)} in parents and name=${q(name)}`);
    if (found.length) return found[0].id;
    const made = await call(`${API}/files?supportsAllDrives=true&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
    });
    return made.id;
  }

  // Resolves root/<path…> creating whatever is missing.
  async function ensurePath(rootId, names) {
    let id = rootId;
    for (const n of names) id = await ensureFolder(id, n);
    return id;
  }

  // Highest sequence number already used by files in `folderId` that start with `prefix`
  // (name without the _### suffix). Used so two phones never overwrite each other.
  async function nextSeq(folderId, prefix, ext) {
    const files = await list(`${q(folderId)} in parents and trashed=false`);
    let max = 0;
    for (const f of files) {
      if (!f.name.startsWith(prefix + '_') || !f.name.toLowerCase().endsWith(ext.toLowerCase())) continue;
      const m = f.name.slice(prefix.length + 1).match(/^(\d+)\./);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max + 1;
  }

  async function uploadFile(folderId, name, blob) {
    const boundary = 'photo' + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name, parents: [folderId] });
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
      `--${boundary}\r\nContent-Type: ${blob.type || 'image/jpeg'}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ]);
    return call(`${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=id,name`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
  }

  return { ensureFolder, ensurePath, nextSeq, uploadFile, call };
}

const driveApi = { parseFolderId, createDrive };
if (typeof module !== 'undefined') module.exports = driveApi;
else globalThis.DriveApi = driveApi;
