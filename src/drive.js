'use strict';
// Google Drive access for the phone app, built to be unable to damage existing data.
//
// Safety rules, enforced in code (not by convention):
//  1. Write-only: the only requests that can leave this module are GET (listing/reading)
//     and the multipart POST that creates a brand-new file. There is no code path for
//     delete, trash, move, rename or overwrite, and `call` refuses anything else.
//  2. No folders are ever created. Customer and job folders must already exist.
//  3. Locked location: every upload re-checks, directly with Drive, that the target is
//     a real, non-trashed folder chain root > customer > job > Photos (all existing)
//     before anything is written.
//  4. A file is never replaced: if the name is taken the new file gets _v2, _v3, ...
//  5. Optional allow-list of customer folder names (used while testing).

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
const PHOTOS = 'photos';

// Accepts a Drive folder link (…/folders/<id>?…, …?id=<id>) or a bare id.
function parseFolderId(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/folders\/([\w-]+)/) || s.match(/[?&]id=([\w-]+)/);
  if (m) return m[1];
  return /^[\w-]{10,}$/.test(s) ? s : '';
}

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

// "name.jpg" -> "name_v2.jpg" (n >= 2). Used when a file with the same name exists.
function versionedName(name, n) {
  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0;
  return hasExt ? `${name.slice(0, dot)}_v${n}${name.slice(dot)}` : `${name}_v${n}`;
}

function createDrive({ fetch, getToken, rootId, allowedCustomers = [] }) {
  if (!rootId) throw new Error('No root folder configured');

  // The single choke point for every Drive request.
  async function call(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const isRead = method === 'GET' && url.startsWith(`${API}/files`);
    const isCreate = method === 'POST' && url.startsWith(`${UPLOAD}?uploadType=multipart`);
    if (!isRead && !isCreate) throw new Error(`Blocked: this app may only read or add files (${method})`);
    const res = await fetch(url, {
      ...init,
      method,
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

  async function list(query, fields = 'nextPageToken,files(id,name)') {
    const out = [];
    let pageToken;
    do {
      const params = {
        q: query, fields, pageSize: '1000', spaces: 'drive',
        supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
      };
      if (pageToken) params.pageToken = pageToken;
      const r = await call(`${API}/files?${new URLSearchParams(params)}`);
      out.push(...(r.files || []));
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }

  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  const listFolders = (parentId, extra = '') => list(`mimeType='${FOLDER}' and trashed=false and ${q(parentId)} in parents${extra ? ` and ${extra}` : ''}`).then((r) => r.sort(byName));

  // Customers are never listed wholesale. A search needs typed text; Drive matches each
  // word, then every typed word must also appear in the folder name.
  async function searchCustomers(text) {
    const terms = String(text || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
    if (!terms.length || terms.join('').length < 2) return [];
    const contains = terms.map((t) => `name contains ${q(t)}`).join(' and ');
    const found = await listFolders(rootId, contains);
    return found.filter((f) => terms.every((t) => f.name.toLowerCase().includes(t))
      && (!allowedCustomers.length || allowedCustomers.includes(f.name)));
  }
  const listJobs = (customerId) => listFolders(customerId);

  const getFolder = (id) => call(`${API}/files/${encodeURIComponent(id)}?${new URLSearchParams({
    fields: 'id,name,mimeType,trashed,parents', supportsAllDrives: 'true',
  })}`);

  // The job's existing "Photos" folder (created by the company's own process, never by this app).
  async function findPhotosFolder(jobId) {
    const match = (await listFolders(jobId)).filter((f) => f.name.trim().toLowerCase() === PHOTOS);
    if (match.length !== 1) {
      throw new Error(match.length ? 'This job has more than one Photos folder.' : 'This job has no Photos folder yet.');
    }
    return match[0];
  }

  // Re-reads the folders from Drive and proves root > customer > job > Photos. Returns their names.
  async function verifyTarget(customerId, jobId, photosId) {
    const [customer, job, photos] = await Promise.all([getFolder(customerId), getFolder(jobId), getFolder(photosId)]);
    const ok = (f) => f && f.mimeType === FOLDER && !f.trashed;
    if (!ok(customer) || !(customer.parents || []).includes(rootId)) {
      throw new Error('Blocked: that customer folder is not directly inside Contacts-Active.');
    }
    if (allowedCustomers.length && !allowedCustomers.includes(customer.name)) {
      throw new Error(`Blocked: uploads are limited to ${allowedCustomers.join(', ')} for now.`);
    }
    if (!ok(job) || !(job.parents || []).includes(customerId)) {
      throw new Error('Blocked: that job folder is not directly inside the customer folder.');
    }
    if (!ok(photos) || photos.name.trim().toLowerCase() !== PHOTOS || !(photos.parents || []).includes(jobId)) {
      throw new Error('Blocked: that is not the Photos folder inside the job folder.');
    }
    return { customer: customer.name, job: job.name };
  }

  // Next sequence number for names like <prefix>_<###>.<ext> already in the Photos folder.
  async function nextSeq(photosId, prefix, ext) {
    const files = await list(`${q(photosId)} in parents and trashed=false`);
    let max = 0;
    for (const f of files) {
      if (!f.name.startsWith(prefix + '_') || !f.name.toLowerCase().endsWith(ext.toLowerCase())) continue;
      const m = f.name.slice(prefix.length + 1).match(/^(\d+)\./);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max + 1;
  }

  // Creates a NEW file in the job's Photos folder after re-verifying the location. Never replaces:
  // a taken name becomes name_v2, name_v3, ... Returns the final name.
  async function addPhoto(customerId, jobId, photosId, name, blob) {
    await verifyTarget(customerId, jobId, photosId);
    const taken = new Set((await list(`${q(photosId)} in parents and trashed=false`)).map((f) => f.name.toLowerCase()));
    let finalName = name;
    for (let n = 2; taken.has(finalName.toLowerCase()); n++) finalName = versionedName(name, n);

    const boundary = 'photo' + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name: finalName, parents: [photosId] });
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
      `--${boundary}\r\nContent-Type: ${blob.type || 'image/jpeg'}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ]);
    await call(`${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=id,name`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return finalName;
  }

  return { searchCustomers, listJobs, findPhotosFolder, verifyTarget, nextSeq, addPhoto, call };
}

const driveApi = { parseFolderId, versionedName, createDrive };
if (typeof module !== 'undefined') module.exports = driveApi;
else globalThis.DriveApi = driveApi;
