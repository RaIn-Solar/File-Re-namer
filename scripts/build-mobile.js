'use strict';
// Assembles the phone web app into dist-mobile/ (the folder that gets hosted).
// It shares the naming rules and category list with the desktop app by copying them.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist-mobile');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'mobile'))) {
  fs.copyFileSync(path.join(root, 'mobile', f), path.join(out, f));
}
for (const f of ['src/naming.js', 'src/drive.js', 'config.default.json']) {
  fs.copyFileSync(path.join(root, f), path.join(out, path.basename(f)));
}
console.log('Built', out);
