'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFolderId, createDrive } = require('../src/drive');

test('parseFolderId accepts links and bare ids', () => {
  assert.equal(parseFolderId('https://drive.google.com/drive/folders/1AbC_dEf-1234567890?usp=sharing'), '1AbC_dEf-1234567890');
  assert.equal(parseFolderId('https://drive.google.com/drive/u/0/folders/1AbC_dEf-1234567890'), '1AbC_dEf-1234567890');
  assert.equal(parseFolderId('https://drive.google.com/open?id=1AbC_dEf-1234567890'), '1AbC_dEf-1234567890');
  assert.equal(parseFolderId('1AbC_dEf-1234567890'), '1AbC_dEf-1234567890');
  assert.equal(parseFolderId('not a folder'), '');
});

// Tiny in-memory Drive: folders and files with parents.
function fakeDrive() {
  const items = [];
  let n = 0;
  const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
  const fetch = async (url, init = {}) => {
    assert.match(init.headers.Authorization, /^Bearer tok$/);
    const u = new URL(url);
    if (init.method === 'POST' && u.pathname === '/upload/drive/v3/files') {
      const text = await init.body.text();
      const meta = JSON.parse(text.match(/\r\n\r\n(\{.*\})\r\n/)[1]);
      const it = { id: `f${++n}`, name: meta.name, parents: meta.parents, mimeType: 'image/jpeg' };
      items.push(it);
      return json({ id: it.id, name: it.name });
    }
    if (init.method === 'POST') {
      const body = JSON.parse(init.body);
      const it = { id: `d${++n}`, ...body };
      items.push(it);
      return json({ id: it.id });
    }
    const q = u.searchParams.get('q');
    const parent = q.match(/'([^']+)' in parents/)[1];
    const name = (q.match(/name='((?:[^'\\]|\\.)*)'/) || [])[1];
    const folderOnly = q.includes('mimeType=');
    const files = items.filter((i) => i.parents.includes(parent)
      && (!folderOnly || i.mimeType === 'application/vnd.google-apps.folder')
      && (name === undefined || i.name === name.replace(/\\(.)/g, '$1')));
    return json({ files });
  };
  return { items, drive: createDrive({ fetch, getToken: async () => 'tok' }) };
}

test('ensurePath creates missing folders once and reuses them', async () => {
  const { items, drive } = fakeDrive();
  const a = await drive.ensurePath('root', ['Smith-John_Roof', 'Inspection']);
  const b = await drive.ensurePath('root', ['Smith-John_Roof', 'Inspection']);
  assert.equal(a, b);
  assert.equal(items.length, 2);
});

test('nextSeq continues after existing files and ignores other prefixes', async () => {
  const { drive } = fakeDrive();
  const dir = await drive.ensurePath('root', ['J']);
  const pre = 'A_J_2026-10-08_Inspection_Roof';
  assert.equal(await drive.nextSeq(dir, pre, '.jpg'), 1);
  await drive.uploadFile(dir, `${pre}_001.jpg`, new Blob(['x'], { type: 'image/jpeg' }));
  await drive.uploadFile(dir, `${pre}_002.jpg`, new Blob(['x'], { type: 'image/jpeg' }));
  await drive.uploadFile(dir, 'A_J_2026-10-08_Inspection_Roofing_009.jpg', new Blob(['x']));
  assert.equal(await drive.nextSeq(dir, pre, '.jpg'), 3);
});

test('Drive errors carry the status and message', async () => {
  const drive = createDrive({
    fetch: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'No access' } }) }),
    getToken: async () => 't',
  });
  await assert.rejects(drive.ensureFolder('r', 'x'), (e) => e.status === 403 && e.message === 'No access');
});
