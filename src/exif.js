'use strict';
const fs = require('node:fs');
const path = require('node:path');

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Fallback for HEIC/HEIF when the container walk finds nothing: locate the
// embedded EXIF block ("Exif\0\0" + TIFF header) and parse that directly.
async function heicFallback(filePath, exifr) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(8 * 1024 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const data = buf.subarray(0, bytesRead);
    const marker = Buffer.from('Exif\0\0');
    for (let at = data.indexOf(marker); at !== -1; at = data.indexOf(marker, at + 1)) {
      const tiff = data.subarray(at + 6, at + 6 + 65536);
      const sig = tiff.subarray(0, 4).toString('latin1');
      if (sig !== 'MM\0*' && sig !== 'II*\0') continue;
      const tags = await exifr.parse(tiff, ['DateTimeOriginal', 'CreateDate']).catch(() => null);
      const d = tags && (tags.DateTimeOriginal || tags.CreateDate);
      if (d instanceof Date && !isNaN(d)) return d;
    }
  } finally { await fh.close(); }
  return null;
}

// Finds a date written in a file name, e.g. IMG_20261008_101500.jpg,
// PXL_20261008_..., 2026-10-08 10.15.00.jpg, IMG-20261008-WA0001.jpg.
// Returns 'YYYY-MM-DD' or null. Impossible dates and dates in the future are ignored.
const NAME_DATE = /(?<!\d)(20\d\d)[-_. ]?(\d\d)[-_. ]?(\d\d)(?=\D|\d{6}(?!\d)|$)/g;
function dateFromName(name, now = new Date()) {
  const base = path.basename(String(name), path.extname(String(name)));
  for (const m of base.matchAll(NAME_DATE)) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) continue; // e.g. 20261345
    if (dt.getTime() > now.getTime() + 24 * 3600 * 1000) continue;                          // future = not a date
    return ymd(dt);
  }
  return null;
}

// Returns { takenDate: 'YYYY-MM-DD'|null, dateSource: 'camera'|'filename'|'file'|'none', takenAt: ISO|null }
// Order of trust: camera (EXIF) > date in the file name > file modified date.
async function readDate(filePath) {
  try {
    const exifr = require('exifr');
    const tags = await exifr.parse(filePath, ['DateTimeOriginal', 'CreateDate']);
    let d = tags && (tags.DateTimeOriginal || tags.CreateDate);
    if (!(d instanceof Date && !isNaN(d)) && /\.hei[cf]$/i.test(filePath)) d = await heicFallback(filePath, exifr);
    if (d instanceof Date && !isNaN(d)) {
      return { takenDate: ymd(d), dateSource: 'camera', takenAt: d.toISOString() };
    }
  } catch { /* fall through */ }
  const named = dateFromName(filePath);
  if (named) return { takenDate: named, dateSource: 'filename', takenAt: named + 'T00:00:00' };
  try {
    const st = await fs.promises.stat(filePath);
    const d = st.mtime;
    return { takenDate: ymd(d), dateSource: 'file', takenAt: d.toISOString() };
  } catch {
    return { takenDate: null, dateSource: 'none', takenAt: null };
  }
}

function isImage(file, extensions) {
  return extensions.includes(path.extname(file).toLowerCase());
}

module.exports = { readDate, dateFromName, isImage, ymd };
