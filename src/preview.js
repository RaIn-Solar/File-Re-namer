'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const HEIC = new Set(['.heic', '.heif']);
const needsPreview = (file) => HEIC.has(path.extname(file).toLowerCase());

// Chromium cannot display HEIC, so we convert to a cached JPEG. Conversions
// run one at a time so a big import doesn't freeze the app.
let chain = Promise.resolve();

function previewFor(file, cacheDir) {
  const run = async () => {
    const st = await fs.promises.stat(file);
    const key = crypto.createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}`).digest('hex');
    const out = path.join(cacheDir, key + '.jpg');
    if (!fs.existsSync(out)) {
      const convert = require('heic-convert');
      const jpeg = await convert({ buffer: await fs.promises.readFile(file), format: 'JPEG', quality: 0.5 });
      await fs.promises.mkdir(cacheDir, { recursive: true });
      await fs.promises.writeFile(out, Buffer.from(jpeg));
    }
    return pathToFileURL(out).href;
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

module.exports = { needsPreview, previewFor };
