'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFolderId, versionedName, createDrive } = require('../src/drive');

const FOLDER = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3/files';

test('parseFolderId accepts links and bare ids', () => {
  assert.equal(parseFolderId('https://drive.google.com/drive/folders/1AbC_dEf-1234567890?usp=sharing'), '1AbC_dEf-1234567890');
  assert.equal(parseFolderId('https://drive.google.com/open?id=1AbC_dEf-1234567890'), '1AbC_dEf-1234567890');
  assert.equal(parseFolderId('1AbC_dEf-1234567890'), '1AbC_dEf-1234567890');
  assert.equal(parseFolderId('not a folder'), '');
});

test('versionedName keeps the extension', () => {
  assert.equal(versionedName('a_001.jpg', 2), 'a_001_v2.jpg');
  assert.equal(versionedName('a_001.jpg', 3), 'a_001_v3.jpg');
  assert.equal(versionedName('noext', 2), 'noext_v2');
});

// Tiny in-memory Drive. `calls` records every request so tests can prove what was (not) sent.
function fakeDrive(opts = {}) {
  const items = [
    { id: 'root', name: 'Contacts-Active', mimeType: FOLDER, parents: ['top'] },
    { id: 'c1', name: 'Inman, Rachel', mimeType: FOLDER, parents: ['root'] },
    { id: 'c2', name: 'Smith, John', mimeType: FOLDER, parents: ['root'] },
    { id: 'j1', name: 'Roof', mimeType: FOLDER, parents: ['c1'] },
    { id: 'j2', name: 'Other job', mimeType: FOLDER, parents: ['c2'] },
    { id: 'p1', name: 'Photos', mimeType: FOLDER, parents: ['j1'] },
    { id: 'p2', name: 'Photos', mimeType: FOLDER, parents: ['j2'] },
    { id: 'docs', name: 'Documents', mimeType: FOLDER, parents: ['j1'] },
    { id: 'old', name: 'Old', mimeType: FOLDER, parents: ['c1'], trashed: true },
    { id: 'stray', name: 'Stray', mimeType: FOLDER, parents: ['elsewhere'] },
  ];
  const calls = [];
  let n = 0;
  const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
  const fetch = async (url, init = {}) => {
    calls.push({ method: init.method, url });
    assert.match(init.headers.Authorization, /^Bearer tok$/);
    const u = new URL(url);
    if (init.method === 'POST') {
      const text = await init.body.text();
      const meta = JSON.parse(text.match(/\r\n\r\n(\{.*\})\r\n/)[1]);
      const it = { id: `f${++n}`, name: meta.name, parents: meta.parents, mimeType: 'image/jpeg' };
      items.push(it);
      return json({ id: it.id, name: it.name });
    }
    const one = u.pathname.match(/\/drive\/v3\/files\/([^/]+)$/);
    if (one) {
      const it = items.find((i) => i.id === decodeURIComponent(one[1]));
      return it ? json(it) : json({ error: { message: 'Not found' } }, 404);
    }
    const query = u.searchParams.get('q');
    const parent = query.match(/'([^']+)' in parents/)[1];
    const folderOnly = query.includes('mimeType=');
    return json({ files: items.filter((i) => i.parents.includes(parent) && !i.trashed && (!folderOnly || i.mimeType === FOLDER)) });
  };
  return { items, calls, drive: createDrive({ fetch, getToken: async () => 'tok', rootId: 'root', ...opts }) };
}

test('lists customers and jobs under the fixed root only', async () => {
  const { drive } = fakeDrive();
  assert.deepEqual((await drive.listCustomers()).map((c) => c.name), ['Inman, Rachel', 'Smith, John']);
  assert.deepEqual((await drive.listJobs('c1')).map((j) => j.name), ['Roof']); // trashed folder hidden
});

test('allow-list hides other customers and blocks writing to them', async () => {
  const { drive, items } = fakeDrive({ allowedCustomers: ['Inman, Rachel'] });
  assert.deepEqual((await drive.listCustomers()).map((c) => c.name), ['Inman, Rachel']);
  await assert.rejects(drive.addPhoto('c2', 'j2', 'p2', 'x.jpg', new Blob(['x'])), /limited to Inman, Rachel/);
  assert.equal(items.filter((i) => i.mimeType === 'image/jpeg').length, 0);
});

test('refuses targets that are not root > customer > job', async () => {
  const { drive, items } = fakeDrive();
  const b = new Blob(['x']);
  await assert.rejects(drive.addPhoto('stray', 'j1', 'p1', 'x.jpg', b), /not directly inside Contacts-Active/);
  await assert.rejects(drive.addPhoto('c1', 'j2', 'p2', 'x.jpg', b), /not directly inside the customer/); // job of another customer
  await assert.rejects(drive.addPhoto('c1', 'old', 'p1', 'x.jpg', b), /not directly inside the customer/); // trashed
  await assert.rejects(drive.addPhoto('c1', 'root', 'p1', 'x.jpg', b), /not directly inside the customer/);
  await assert.rejects(drive.addPhoto('c1', 'missing', 'p1', 'x.jpg', b), /Not found/);
  await assert.rejects(drive.addPhoto('c1', 'j1', 'p2', 'x.jpg', b), /not the Photos folder/); // another job's Photos
  await assert.rejects(drive.addPhoto('c1', 'j1', 'docs', 'x.jpg', b), /not the Photos folder/); // wrong folder in the job
  await assert.rejects(drive.addPhoto('c1', 'j1', 'j1', 'x.jpg', b), /not the Photos folder/);
  assert.equal(items.filter((i) => i.mimeType === 'image/jpeg').length, 0);
});

test('same name is never replaced: v2, v3 are added and all files are kept', async () => {
  const { drive, items } = fakeDrive();
  const b = () => new Blob(['x'], { type: 'image/jpeg' });
  assert.equal(await drive.addPhoto('c1', 'j1', 'p1', 'A_001.jpg', b()), 'A_001.jpg');
  assert.equal(await drive.addPhoto('c1', 'j1', 'p1', 'A_001.jpg', b()), 'A_001_v2.jpg');
  assert.equal(await drive.addPhoto('c1', 'j1', 'p1', 'a_001.JPG', b()), 'a_001_v3.JPG'); // case-insensitive
  assert.deepEqual(items.filter((i) => i.mimeType === 'image/jpeg').map((i) => i.name), ['A_001.jpg', 'A_001_v2.jpg', 'a_001_v3.JPG']);
});

test('only reads and new-file uploads can leave the app; nothing else is allowed', async () => {
  const { drive, calls } = fakeDrive();
  for (const method of ['DELETE', 'PATCH', 'PUT']) {
    await assert.rejects(drive.call(`${API}/c1`, { method }), /Blocked/);
  }
  await assert.rejects(drive.call(API, { method: 'POST', body: '{}' }), /Blocked/); // folder/metadata create
  await assert.rejects(drive.call('https://www.googleapis.com/upload/drive/v3/files/f1?uploadType=multipart', { method: 'PATCH' }), /Blocked/); // overwrite
  assert.equal(calls.length, 0);
  await drive.addPhoto('c1', 'j1', 'p1', 'A_001.jpg', new Blob(['x']));
  assert.ok(calls.every((c) => c.method === 'POST' ? c.url.includes('/upload/drive/v3/files?uploadType=multipart') : c.method === undefined || c.method === 'GET'));
});

test('source code contains no delete / update / folder-creation request', () => {
  const src = require('node:fs').readFileSync(require.resolve('../src/drive.js'), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(src, /\b(DELETE|PATCH|PUT)\b|\btrash\b|createFolder|ensureFolder/);
});

test('nextSeq continues after existing files and ignores other prefixes', async () => {
  const { drive } = fakeDrive();
  const pre = 'A_J_2026-10-08_Inspection_Roof';
  assert.equal(await drive.nextSeq('p1', pre, '.jpg'), 1);
  await drive.addPhoto('c1', 'j1', 'p1', `${pre}_001.jpg`, new Blob(['x']));
  await drive.addPhoto('c1', 'j1', 'p1', `${pre}_002.jpg`, new Blob(['x']));
  await drive.addPhoto('c1', 'j1', 'p1', 'A_J_2026-10-08_Inspection_Roofing_009.jpg', new Blob(['x']));
  assert.equal(await drive.nextSeq('p1', pre, '.jpg'), 3);
});

test('Drive errors carry the status and message', async () => {
  const drive = createDrive({
    fetch: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'No access' } }) }),
    getToken: async () => 't', rootId: 'root',
  });
  await assert.rejects(drive.listCustomers(), (e) => e.status === 403 && e.message === 'No access');
});

test('finds the existing Photos folder; never creates one', async () => {
  const { drive, items, calls } = fakeDrive();
  assert.equal((await drive.findPhotosFolder('j1')).id, 'p1');
  items.push({ id: 'j3', name: 'No photos here', mimeType: FOLDER, parents: ['c1'] });
  await assert.rejects(drive.findPhotosFolder('j3'), /no Photos folder/);
  assert.ok(calls.every((c) => c.method === undefined || c.method === 'GET'));
  items.push({ id: 'p1b', name: 'photos', mimeType: FOLDER, parents: ['j1'] });
  await assert.rejects(drive.findPhotosFolder('j1'), /more than one/);
});
