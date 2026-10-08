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

// Returns { takenDate: 'YYYY-MM-DD'|null, dateSource: 'camera'|'file'|'none', takenAt: ISO|null }
async function readDate(filePath) {
  try {
    const exifr = require('exifr');
    const tags = await exifr.parse(filePath, ['DateTimeOriginal', 'CreateDate']);
    let d = tags && (tags.DateTimeOriginal || tags.CreateDate);
    if (!(d instanceof Date && !isNaN(d)) && /\.hei[cf]$/i.test(filePath)) d = await heicFallback(filePath, exifr);
    if (d instanceof Date && !isNaN(d)) {
      return { takenDate: ymd(d), dateSource: 'camera', takenAt: d.toISOString() };
    }
  } catch { /* fall through to file date */ }
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

module.exports = { readDate, isImage, ymd };
