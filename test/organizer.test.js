'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { upload } = require('../src/organizer');
const { readDate } = require('../src/exif');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jpo-'));

test('upload copies into customer/category, never overwrites, keeps originals, writes log', async () => {
  const src = tmp(), root = tmp();
  const f = path.join(src, 'IMG_1.jpg');
  fs.writeFileSync(f, 'pixels');
  const item = { source: f, newName: 'A_2026-10-08_Inspection_001.jpg', folder: 'Inspection', date: '2026-10-08', categoryLabel: 'Inspection', area: '' };

  const r1 = await upload([item], { root, customerFolder: 'A' });
  const r2 = await upload([item], { root, customerFolder: 'A' });
  assert.ok(r1[0].ok && r2[0].ok);
  assert.equal(path.basename(r2[0].dest), 'A_2026-10-08_Inspection_001-v2.jpg');
  assert.ok(fs.existsSync(f), 'original untouched');
  const log = fs.readFileSync(path.join(root, 'A', 'upload-log.csv'), 'utf8').trim().split('\n');
  assert.equal(log.length, 3); // header + 2 rows
});

test('a missing source reports failure instead of throwing', async () => {
  const root = tmp();
  const r = await upload([{ source: '/nope/x.jpg', newName: 'x.jpg', folder: 'F', date: 'd', categoryLabel: 'F' }], { root, customerFolder: 'A' });
  assert.equal(r[0].ok, false);
});

test('readDate falls back to file modified date when there is no EXIF', async () => {
  const d = tmp(), f = path.join(d, 'a.jpg');
  fs.writeFileSync(f, 'not really a jpeg');
  fs.utimesSync(f, new Date('2026-03-04T12:00:00'), new Date('2026-03-04T12:00:00'));
  const r = await readDate(f);
  assert.equal(r.takenDate, '2026-03-04');
  assert.equal(r.dateSource, 'file');
});

test('readDate prefers EXIF DateTimeOriginal', async () => {
  const d = tmp(), f = path.join(d, 'a.jpg');
  // Minimal JPEG with an EXIF DateTimeOriginal of 2025:06:15 09:30:00
  const sharp = null; void sharp;
  const ts = Buffer.from('2025:06:15 09:30:00\0');
  const ifd0 = Buffer.alloc(2 + 12 + 4); ifd0.writeUInt16LE(1, 0);
  ifd0.writeUInt16LE(0x8769, 2); ifd0.writeUInt16LE(4, 4); ifd0.writeUInt32LE(1, 6); ifd0.writeUInt32LE(8 + ifd0.length, 10);
  const exifIfd = Buffer.alloc(2 + 12 + 4); exifIfd.writeUInt16LE(1, 0);
  exifIfd.writeUInt16LE(0x9003, 2); exifIfd.writeUInt16LE(2, 4); exifIfd.writeUInt32LE(ts.length, 6);
  exifIfd.writeUInt32LE(8 + ifd0.length + exifIfd.length, 10);
  const tiff = Buffer.concat([Buffer.from('II*\0\x08\0\0\0', 'binary'), ifd0, exifIfd, ts]);
  const app1 = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const len = Buffer.alloc(2); len.writeUInt16BE(app1.length + 2);
  fs.writeFileSync(f, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, app1, Buffer.from([0xff, 0xd9])]));
  const r = await readDate(f);
  assert.equal(r.dateSource, 'camera');
  assert.equal(r.takenDate, '2025-06-15');
});

const { dateFromName } = require('../src/exif');
const NOW = new Date('2026-10-08T12:00:00');

test('dateFromName understands common phone / app file names', () => {
  assert.equal(dateFromName('IMG_20261006_101500.jpg', NOW), '2026-10-06');
  assert.equal(dateFromName('PXL_20261006_101500123.jpg', NOW), '2026-10-06');
  assert.equal(dateFromName('IMG-20261006-WA0001.jpeg', NOW), '2026-10-06');
  assert.equal(dateFromName('20261006101500.jpg', NOW), '2026-10-06');
  assert.equal(dateFromName('2026-10-06 10.15.00.png', NOW), '2026-10-06');
  assert.equal(dateFromName('/some/2026-dir/Screenshot_2026-10-06-10-15.png', NOW), '2026-10-06');
});

test('dateFromName ignores things that are not dates', () => {
  assert.equal(dateFromName('IMG_1234.jpg', NOW), null);
  assert.equal(dateFromName('IMG_20261345_1.jpg', NOW), null);   // month 13
  assert.equal(dateFromName('IMG_20260231.jpg', NOW), null);     // Feb 31
  assert.equal(dateFromName('IMG_20271001.jpg', NOW), null);     // future
  assert.equal(dateFromName('scan_120261006999.jpg', NOW), null);// digits run on
});

test('readDate uses a date in the file name when there is no EXIF, ahead of the file date', async () => {
  const d = tmp(), f = path.join(d, 'IMG_20250304_101500.jpg');
  fs.writeFileSync(f, 'not a jpeg');
  const r = await readDate(f);
  assert.equal(r.takenDate, '2025-03-04');
  assert.equal(r.dateSource, 'filename');
});
