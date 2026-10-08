'use strict';
const $ = (id) => document.getElementById(id);
const state = { config: null, photos: [], selected: new Set(), lastClicked: null, uploadRoot: '', busy: false };

const jobInfo = () => ({
  customer: $('customer').value.trim(),
  jobNumber: $('jobNumber').value.trim(),
  visitDate: $('visitDate').value,
  uploadRoot: state.uploadRoot,
});
const catLabel = (id) => (state.config.categories.find((c) => c.id === id) || {}).label;
const eDate = (p) => p.dateOverride || p.takenDate;
const active = () => state.photos.filter((p) => p.include !== false);

function setStatus(msg, kind = '') { const s = $('status'); s.textContent = msg; s.className = 'status ' + kind; }

// ---------- adding photos ----------
async function addPaths(paths) {
  if (!paths.length) return;
  setStatus('Reading photos…');
  const found = await window.api.scan(paths);
  const have = new Set(state.photos.map((p) => p.id));
  const fresh = found.filter((p) => !have.has(p.id));
  state.photos.push(...fresh);
  if (!$('visitDate').value) $('visitDate').value = mostCommonDate() || '';
  setStatus(fresh.length ? `Added ${fresh.length} photo(s).` : 'Nothing new to add.');
  render();
}
function mostCommonDate() {
  const c = {};
  for (const p of state.photos) if (p.takenDate) c[p.takenDate] = (c[p.takenDate] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0];
}

// ---------- selection ----------
function clickCard(p, ev) {
  const list = visible();
  if (ev.shiftKey && state.lastClicked) {
    const a = list.findIndex((x) => x.id === state.lastClicked), b = list.findIndex((x) => x.id === p.id);
    if (a >= 0 && b >= 0) list.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => state.selected.add(x.id));
  } else if (ev.ctrlKey || ev.metaKey) {
    state.selected.has(p.id) ? state.selected.delete(p.id) : state.selected.add(p.id);
  } else {
    state.selected = new Set([p.id]);
  }
  state.lastClicked = p.id;
  render();
}
const visible = () => active();
const selectedPhotos = () => state.photos.filter((p) => state.selected.has(p.id));

// ---------- edits ----------
function setCategory(id) {
  const sel = selectedPhotos();
  if (!sel.length) return setStatus('Select some photos first.', 'err');
  sel.forEach((p) => { p.category = id; });
  setStatus(`${sel.length} photo(s) marked “${catLabel(id)}”.`);
  render();
}
function applyArea() {
  const sel = selectedPhotos();
  if (!sel.length) return setStatus('Select some photos first.', 'err');
  sel.forEach((p) => { p.area = $('area').value.trim(); });
  render();
}
function applyDate(value) {
  const sel = selectedPhotos();
  if (!sel.length) return setStatus('Select some photos first.', 'err');
  if (!value) return setStatus('Pick a date first.', 'err');
  sel.forEach((p) => { p.dateOverride = value; });
  setStatus(`Date set to ${value} on ${sel.length} photo(s).`);
  render();
}
function removeSelected() {
  state.photos = state.photos.filter((p) => !state.selected.has(p.id));
  state.selected.clear();
  render();
}

// ---------- rendering ----------
function render() {
  const list = visible();
  const grid = $('grid');
  grid.querySelectorAll('.card').forEach((n) => n.remove());
  $('empty').hidden = list.length > 0;
  const visit = $('visitDate').value;
  for (const p of list) {
    const el = document.createElement('div');
    el.className = 'card' + (state.selected.has(p.id) ? ' sel' : '');
    const d = eDate(p);
    const off = visit && d !== visit;
    const approx = !p.dateOverride && p.dateSource !== 'camera';
    el.innerHTML = `<div class="img"></div><div class="meta">
      <div><span class="tag ${p.category ? '' : 'none'}"></span></div>
      <div class="date ${off || approx ? 'warn' : ''}"></div><div class="name"></div></div>`;
    const img = document.createElement('img');
    img.loading = 'lazy'; img.src = p.url; img.alt = '';
    img.onerror = () => { el.querySelector('.img').textContent = 'No preview (' + p.ext + ')'; };
    el.querySelector('.img').appendChild(img);
    el.querySelector('.tag').textContent = p.category ? catLabel(p.category) + (p.area ? ' · ' + p.area : '') : 'Unlabeled';
    el.querySelector('.date').textContent = (d || 'No date') + (p.dateOverride ? ' (set)' : approx ? ' (file date?)' : '') + (off ? ' ⚠' : '');
    el.querySelector('.name').textContent = p.name;
    el.title = p.path;
    el.addEventListener('click', (ev) => clickCard(p, ev));
    grid.appendChild(el);
  }
  const unl = list.filter((p) => !p.category).length;
  $('count').textContent = list.length ? `${list.length} photos · ${unl} unlabeled · ${state.selected.size} selected` : '';
  $('review').disabled = !list.length;
  renderDates();
}
function renderDates() {
  const box = $('dates');
  const counts = {};
  for (const p of active()) { const d = eDate(p) || 'No date'; counts[d] = (counts[d] || 0) + 1; }
  const visit = $('visitDate').value;
  box.innerHTML = '';
  const rows = Object.entries(counts).sort();
  if (!rows.length) { box.textContent = 'Add photos to see their dates.'; return; }
  for (const [d, n] of rows) {
    const row = document.createElement('div');
    const ok = !visit || d === visit;
    row.className = ok ? 'good' : 'bad';
    row.innerHTML = '<span></span><span></span>';
    row.children[0].textContent = d + (ok ? '' : ' ⚠ not visit date');
    row.children[1].textContent = n + ' photo' + (n === 1 ? '' : 's');
    box.appendChild(row);
  }
}

// ---------- review & upload ----------
function validate() {
  const j = jobInfo();
  if (!j.customer) return 'Enter the customer name at the top.';
  if (!state.uploadRoot) return 'Choose the customer files folder at the top.';
  const unl = active().filter((p) => !p.category).length;
  if (unl) return `${unl} photo(s) still have no type. Use “Select unlabeled” to find them.`;
  if (active().some((p) => !eDate(p))) return 'Some photos have no date. Set one on them.';
  return null;
}
async function review() {
  const err = validate();
  if (err) return setStatus(err, 'err');
  setStatus('');
  const photos = active();
  const { plans, dates } = await window.api.plan(photos, jobInfo());
  const byId = new Map(photos.map((p) => [p.id, p]));
  const off = dates.filter((d) => !d.matchesExpected);
  let html = '';
  if (off.length) {
    const n = off.reduce((s, d) => s + d.count, 0);
    html += `<div class="callout">⚠ ${n} photo(s) are dated other than the visit date (${$('visitDate').value}): ${off.map((d) => `${d.date} (${d.count})`).join(', ')}. Go back and fix them if that’s wrong.</div>`;
  }
  html += '<table><thead><tr><th>Original</th><th>New name</th><th>Goes to folder</th></tr></thead><tbody>';
  for (const pl of plans) {
    html += `<tr><td>${esc(byId.get(pl.id).name)}</td><td class="new">${esc(pl.newName)}</td><td>${esc(pl.folder)}</td></tr>`;
  }
  html += '</tbody></table>';
  $('modalBody').innerHTML = html;
  $('modalTitle').textContent = `Review ${plans.length} new file names`;
  $('doUpload').hidden = false; $('doUpload').disabled = false;
  $('modalCancel').textContent = 'Back';
  $('modal').hidden = false;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function doUpload() {
  $('doUpload').disabled = true;
  $('modalTitle').textContent = 'Copying…';
  try {
    const results = await window.api.upload(active(), jobInfo());
    const bad = results.filter((r) => !r.ok);
    $('modalTitle').textContent = bad.length ? `Done with ${bad.length} problem(s)` : `Done — ${results.length} photos filed`;
    $('modalBody').innerHTML = `<p class="${bad.length ? 'fail' : 'okc'}">${results.length - bad.length} of ${results.length} copied to <strong>${esc(state.uploadRoot)}</strong>. Your original phone photos were not changed.</p>` +
      (bad.length ? '<ul>' + bad.map((r) => `<li class="fail">${esc(r.newName)}: ${esc(r.error)}</li>`).join('') + '</ul>' : '');
    $('doUpload').hidden = true;
    $('modalCancel').textContent = 'Close';
    const okIds = new Set(results.filter((r) => r.ok).map((r) => r.id));
    state.photos = state.photos.filter((p) => !okIds.has(p.id));
    state.selected.clear();
    render();
  } catch (e) {
    $('modalTitle').textContent = 'Could not upload';
    $('modalBody').innerHTML = `<p class="fail">${esc(e.message)}</p>`;
    $('doUpload').disabled = false;
  }
}

// ---------- init ----------
async function init() {
  state.config = await window.api.getConfig();
  state.uploadRoot = state.config.uploadRoot || '';
  $('rootLabel').textContent = state.uploadRoot || 'Not set';
  $('areas').innerHTML = state.config.areaSuggestions.map((a) => `<option value="${esc(a)}">`).join('');
  const cats = $('categories');
  for (const c of state.config.categories) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<kbd>${esc(c.key || '')}</kbd><span></span>`;
    b.lastChild.textContent = c.label;
    b.addEventListener('click', () => setCategory(c.id));
    cats.appendChild(b);
  }
  $('addPhotos').onclick = async () => addPaths(await window.api.pickPhotos());
  $('addFolder').onclick = async () => addPaths(await window.api.pickPhotoFolder());
  $('clearAll').onclick = () => { state.photos = []; state.selected.clear(); render(); };
  $('selectAll').onclick = () => { state.selected = new Set(active().map((p) => p.id)); render(); };
  $('selectUnlabeled').onclick = () => { state.selected = new Set(active().filter((p) => !p.category).map((p) => p.id)); render(); };
  $('applyArea').onclick = applyArea;
  $('applyDate').onclick = () => applyDate($('overrideDate').value);
  $('useVisit').onclick = () => applyDate($('visitDate').value);
  $('exclude').onclick = removeSelected;
  $('review').onclick = review;
  $('modalCancel').onclick = () => { $('modal').hidden = true; };
  $('doUpload').onclick = doUpload;
  $('visitDate').addEventListener('change', render);
  $('pickRoot').onclick = async () => {
    const dir = await window.api.pickUploadRoot();
    if (!dir) return;
    state.uploadRoot = dir; $('rootLabel').textContent = dir;
    window.api.setConfig({ uploadRoot: dir });
  };
  window.api.onProgress(({ done, total }) => { $('modalTitle').textContent = `Copying… ${done} / ${total}`; });

  const grid = $('grid');
  ['dragenter', 'dragover'].forEach((t) => grid.addEventListener(t, (e) => { e.preventDefault(); grid.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((t) => grid.addEventListener(t, (e) => { e.preventDefault(); grid.classList.remove('drag'); }));
  grid.addEventListener('drop', (e) => addPaths([...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean)));

  document.addEventListener('keydown', (e) => {
    if (/INPUT|TEXTAREA/.test(document.activeElement.tagName) || !$('modal').hidden) return;
    const c = state.config.categories.find((x) => x.key === e.key);
    if (c) setCategory(c.id);
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); $('selectAll').click(); }
  });
  render();
}
init();
