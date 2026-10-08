'use strict';
const fs = require('node:fs');
const path = require('node:path');

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  let n = 1;
  while (fs.existsSync(candidate)) {
    n += 1;
    candidate = path.join(dir, `${base}-v${n}${ext}`);
  }
  return candidate;
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Copies each photo into <root>/<customer>/<category folder>/<new name>.
// Originals are never modified or deleted. Existing files are never overwritten.
// items: [{ source, newName, folder, date, categoryLabel, area }]
async function upload(items, { root, customerFolder, onProgress }) {
  if (!root) throw new Error('No upload folder selected');
  const results = [];
  const jobDir = path.join(root, customerFolder);
  await fs.promises.mkdir(jobDir, { recursive: true });

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    try {
      const dir = path.join(jobDir, it.folder);
      await fs.promises.mkdir(dir, { recursive: true });
      const dest = uniquePath(dir, it.newName);
      await fs.promises.copyFile(it.source, dest, fs.constants.COPYFILE_EXCL);
      const [a, b] = await Promise.all([fs.promises.stat(it.source), fs.promises.stat(dest)]);
      if (a.size !== b.size) throw new Error('Copy size mismatch');
      results.push({ ...it, dest, ok: true });
    } catch (err) {
      results.push({ ...it, ok: false, error: err.message });
    }
    if (onProgress) onProgress(i + 1, items.length);
  }

  // Append-only log so there is always a record of original -> new name.
  const logPath = path.join(jobDir, 'upload-log.csv');
  const isNew = !fs.existsSync(logPath);
  const header = 'uploaded_at,original_name,new_path,date,category,area,status\n';
  const now = new Date().toISOString();
  const lines = results.map((r) => [
    now, path.basename(r.source), r.ok ? path.relative(jobDir, r.dest) : '', r.date,
    r.categoryLabel, r.area || '', r.ok ? 'ok' : `FAILED: ${r.error}`,
  ].map(csvCell).join(',')).join('\n') + '\n';
  await fs.promises.appendFile(logPath, (isNew ? header : '') + lines);

  return results;
}

module.exports = { upload, uniquePath };
