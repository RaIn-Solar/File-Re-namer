'use strict';
const fs = require('node:fs');
const path = require('node:path');

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Returns { takenDate: 'YYYY-MM-DD'|null, dateSource: 'camera'|'file'|'none', takenAt: ISO|null }
async function readDate(filePath) {
  try {
    const exifr = require('exifr');
    const tags = await exifr.parse(filePath, ['DateTimeOriginal', 'CreateDate']);
    const d = tags && (tags.DateTimeOriginal || tags.CreateDate);
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
