'use strict';
const $ = (id) => document.getElementById(id);
const state = { config: null, photos: [], selected: new Set(), lastClicked: null, uploadRoot: '', job: null, jobMode: 'first' };

const jobInfo = () => ({ ...(state.job || {}), uploadRoot: state.uploadRoot });
const visitDate = () => (state.job ? state.job.visitDate : '');
const today = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
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
  setStatus(fresh.length ? `Added ${fresh.length} photo(s).` : 'Nothing new to add.');
  render();
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
  const visit = visitDate();
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
    const noPreview = () => { el.querySelector('.img').textContent = 'No preview (' + p.ext + ')'; };
    img.onerror = async () => {
      img.onerror = noPreview;
      const url = await window.api.preview(p.path);
      if (url) img.src = url; else noPreview();
    };
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
  const visit = visitDate();
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
  if (!j.customer || !j.jobName || !j.visitDate || !state.uploadRoot) return 'Fill in the job details first (Edit job).';
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
    html += `<div class="callout">⚠ ${n} photo(s) are dated other than the visit date (${visitDate()}): ${off.map((d) => `${d.date} (${d.count})`).join(', ')}. Go back and fix them if that’s wrong.</div>`;
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
  $('rootLabel').title = state.uploadRoot;
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
  $('useVisit').onclick = () => applyDate(visitDate());
  $('exclude').onclick = removeSelected;
  $('review').onclick = review;
  $('modalCancel').onclick = () => { $('modal').hidden = true; };
  $('doUpload').onclick = doUpload;
  wireJobDialog();
  $('editJob').onclick = () => openJob('edit');
  $('newJob').onclick = () => openJob('new');
  $('tutorialBtn').onclick = () => runTour();
  window.api.onProgress(({ done, total }) => { $('modalTitle').textContent = `Copying… ${done} / ${total}`; });

  const grid = $('grid');
  ['dragenter', 'dragover'].forEach((t) => grid.addEventListener(t, (e) => { e.preventDefault(); grid.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((t) => grid.addEventListener(t, (e) => { e.preventDefault(); grid.classList.remove('drag'); }));
  grid.addEventListener('drop', (e) => addPaths([...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean)));

  document.addEventListener('keydown', (e) => {
    if (/INPUT|TEXTAREA/.test(document.activeElement.tagName) || !$('modal').hidden || !$('jobModal').hidden || window.Tour.isOpen()) return;
    const c = state.config.categories.find((x) => x.key === e.key);
    if (c) setCategory(c.id);
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); $('selectAll').click(); }
  });
  renderJob();
  render();

  // First launch: tour, then the job window. Later launches: straight to the job window.
  if (!state.config.tutorialSeen) runTour(() => openJob('first'));
  else openJob('first');
}

// ---------- job details dialog ----------
function renderJob() {
  const box = $('jobSummary');
  box.innerHTML = '';
  if (!state.job) { box.innerHTML = '<span class="none">No job set up yet</span>'; return; }
  const items = [['Customer', state.job.customer], ['Job', state.job.jobName], ['Visit date', state.job.visitDate], ['Files folder', state.uploadRoot]];
  for (const [label, value] of items) {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = '<small></small><span></span>';
    el.children[0].textContent = label;
    el.children[1].textContent = value;
    el.children[1].title = value;
    box.appendChild(el);
  }
}

function openJob(mode) {            // 'first' | 'new' | 'edit'
  state.jobMode = mode;
  const job = state.job;
  const fresh = mode !== 'edit' || !job;
  $('customer').value = fresh ? '' : job.customer;
  $('jobName').value = fresh ? '' : job.jobName;
  $('visitDate').value = fresh ? today() : job.visitDate;
  $('rootLabel').textContent = state.uploadRoot || 'Not set';
  $('rootLabel').title = state.uploadRoot;
  $('jobTitle').textContent = mode === 'edit' ? 'Edit job details' : mode === 'new' ? 'Start a new job' : 'Set up the job';
  $('jobIntro').textContent = mode === 'new' && state.photos.length
    ? 'This clears the photos currently loaded (nothing is deleted from your phone or computer) and starts a new set of file names.'
    : 'These details go into every file name and decide which folder the photos are filed in.';
  $('jobSubmit').textContent = mode === 'edit' ? 'Save' : 'Start';
  $('jobCancel').hidden = mode === 'first' || !state.job;     // can't dismiss until a job exists
  $('jobError').textContent = '';
  document.querySelectorAll('#jobForm input').forEach((n) => n.classList.remove('bad'));
  $('jobModal').hidden = false;
  $('customer').focus();
}

function wireJobDialog() {
  $('pickRoot').onclick = async () => {
    const dir = await window.api.pickUploadRoot();
    if (!dir) return;
    state.uploadRoot = dir;
    $('rootLabel').textContent = dir; $('rootLabel').title = dir;
    window.api.setConfig({ uploadRoot: dir });
  };
  $('jobCancel').onclick = () => { $('jobModal').hidden = true; };
  $('jobModal').addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('jobCancel').hidden) $('jobCancel').click(); });
  $('jobForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const job = { customer: $('customer').value.trim(), jobName: $('jobName').value.trim(), visitDate: $('visitDate').value };
    const missing = [];
    if (!job.customer) missing.push(['customer', 'customer name']);
    if (!job.jobName) missing.push(['jobName', 'job name']);
    if (!job.visitDate) missing.push(['visitDate', 'visit date']);
    document.querySelectorAll('#jobForm input').forEach((n) => n.classList.toggle('bad', missing.some(([id]) => id === n.id)));
    if (!state.uploadRoot) missing.push([null, 'customer files folder']);
    if (missing.length) {
      $('jobError').textContent = 'Please fill in: ' + missing.map((m) => m[1]).join(', ') + '.';
      const first = missing.find((m) => m[0]);
      if (first) $(first[0]).focus();
      return;
    }
    if (state.jobMode === 'new' && state.photos.length &&
        !confirm(`Start a new job? The ${state.photos.length} photo(s) currently loaded will be cleared. Nothing is deleted from your phone or computer.`)) return;
    if (state.jobMode === 'new') { state.photos = []; state.selected.clear(); setStatus(''); }
    state.job = job;
    $('jobModal').hidden = true;
    renderJob();
    render();
  });
}

// ---------- tutorial ----------
const TOUR_STEPS = [
  { title: 'Welcome to Job Photo Organizer', text: 'This 1-minute tour shows how to turn a pile of phone photos into correctly named, correctly filed pictures for the customer record. Use Next, the arrow keys, or Skip.' },
  { target: '#jobSummary', title: 'The job details', text: 'Every job starts with a small window asking for the customer name, job name, visit date and the customer files folder. They are shown here, and they become part of every file name.' },
  { target: '#jobBtns', title: 'New job / Edit job', text: '“New job” asks for a fresh set of details and clears the current photos — use it when you move on to a different customer or job. “Edit job” fixes a typo without clearing anything.' },
  { target: '#addButtons', title: 'Add the photos', text: 'Add photos or a whole folder, or just drag them into the window. For a phone, plug it in and browse to its DCIM / Camera folder, or copy the pictures to the computer first.' },
  { target: '#grid', title: 'Your photos', text: 'Click a photo to select it; Shift-click selects a range and Ctrl-click adds one. Each card shows its label and date. An orange date means it is not the visit date, or the camera date was missing.' },
  { target: '#secCategory', title: '1. What are they for?', text: 'With photos selected, pick the type — Sales Walkthrough, Inspection, and so on — or press its number key. The type is built into the new file name, so the same spot photographed for two purposes never gets mixed up.' },
  { target: '#secArea', title: '2. Where or what? (optional)', text: 'Add an area such as Roof, Meter or Inverter and click “Apply to selected”. It is added to the file name too.' },
  { target: '#secDates', title: '3. Check the dates', text: 'Photos are dated from the camera. Any date that is not the visit date is flagged here. Fix a photo’s date with “Set on selected”, or use the visit date in one click.' },
  { target: '#review', title: 'Review & rename', text: 'When every photo has a type, review the old → new names, then “Rename & upload” copies them into the customer’s folder. Your originals are never changed.' },
  { target: '#tutorialBtn', pulse: true, doneLabel: 'Got it', title: 'Want to see this again?', text: 'That’s the whole process! You can replay this tutorial any time with the Tutorial button, highlighted here at the top right.' },
];

function runTour(after) {
  window.api.setConfig({ tutorialSeen: true });
  state.config.tutorialSeen = true;
  window.Tour.start(TOUR_STEPS, { onEnd: after });
}
init();
