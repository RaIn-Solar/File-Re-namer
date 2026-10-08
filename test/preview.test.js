'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { needsPreview, previewFor } = require('../src/preview');
const { readDate } = require('../src/exif');

const heic = path.join(__dirname, 'fixtures', 'iphone.heic');

test('only HEIC/HEIF need a converted preview', () => {
  assert.ok(needsPreview('a.HEIC') && needsPreview('b.heif'));
  assert.ok(!needsPreview('c.jpg'));
});

test('HEIC converts to a cached, valid JPEG', async () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'jpo-prev-'));
  const url = await previewFor(heic, cache);
  const file = new URL(url).pathname;
  const head = fs.readFileSync(file).subarray(0, 3);
  assert.deepEqual([...head], [0xff, 0xd8, 0xff]);
  const mtime = fs.statSync(file).mtimeMs;
  assert.equal(await previewFor(heic, cache), url); // cache hit
  assert.equal(fs.statSync(file).mtimeMs, mtime);
});

test('a corrupt HEIC rejects instead of hanging the queue', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jpo-bad-'));
  const bad = path.join(d, 'bad.heic'); fs.writeFileSync(bad, 'nope');
  await assert.rejects(previewFor(bad, d));
  assert.ok(await previewFor(heic, d)); // queue still works
});

test('EXIF date is read from an iPhone-style HEIC', async () => {
  const r = await readDate(heic);
  assert.equal(r.dateSource, 'camera');
  assert.equal(r.takenDate, '2025-06-15');
});
