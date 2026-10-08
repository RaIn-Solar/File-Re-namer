'use strict';
const $ = (id) => document.getElementById(id);
const state = { config: null, photos: [], selected: new Set(), lastClicked: null, uploadRoot: '', job: null, jobMode: 'first', savedJobs: [] };

const jobInfo = () => ({ ...(state.job || {}), uploadRoot: state.uploadRoot });
const visitDate = () => (state.job ? state.job.visitDate : '');
const today = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const catLabel = (id) => (state.config.categories.find((c) => c.id === id) || {}).label;

// Each photo type gets its own color (config `color`, with a distinct fallback palette).
const FALLBACK_COLORS = ['#2563EB', '#0891B2', '#F59E0B', '#7C3AED', '#FF1A1A', '#16A34A', '#F9A8D4', '#64748B'];
function catColor(id) {
  const i = state.config.categories.findIndex((c) => c.id === id);
  if (i < 0) return null;
  return state.config.categories[i].color || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
}
function inkFor(hex) {              // black or white text, whichever reads better on this color
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#111111' : '#ffffff';
}
function paint(el, id) {
  const c = catColor(id);
  if (!c) return;
  el.style.setProperty('--cat', c);
  el.style.setProperty('--cat-ink', inkFor(c));
}
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
  if (!fresh.length) { setStatus('Nothing new to add.'); return; }
  setStatus('');
  await confirmDates(fresh);
  state.photos.push(...fresh);
  setStatus(`Added ${fresh.length} photo(s).`);
  render();
}

// ---------- date confirmation ----------
const SOURCE_LABEL = { camera: 'camera', filename: 'file name', file: 'file date (less reliable)' };

// Shows the dates found in the files that were just added and asks which date to use.
// Photos with no readable date get the visit date. Resolves once the user confirms.
function confirmDates(fresh) {
  const sensed = fresh.filter((p) => p.takenDate);
  const visit = visitDate();
  if (!sensed.length) {
    fresh.forEach((p) => { p.dateOverride = visit; p.dateConfirmed = true; });
    return Promise.resolve();
  }
  const groups = new Map();
  for (const p of sensed) {
    const g = groups.get(p.takenDate) || { n: 0, src: new Set() };
    g.n += 1; g.src.add(SOURCE_LABEL[p.dateSource] || p.dateSource);
    groups.set(p.takenDate, g);
  }
  const undated = fresh.length - sensed.length;
  const differs = [...groups.keys()].some((d) => d !== visit);
  $('dateIntro').textContent = `The app found ${groups.size === 1 ? 'a date' : groups.size + ' different dates'} in the ${fresh.length} photo${fresh.length === 1 ? '' : 's'} you just added. Please confirm which date to use.` +
    (differs ? ` (The job’s visit date is ${visit}.)` : '');
  const t = $('dateTable');
  t.innerHTML = '<thead><tr><th>Date found</th><th>Photos</th><th>Read from</th></tr></thead><tbody></tbody>';
  for (const [d, g] of [...groups.entries()].sort()) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td></td><td></td>';
    tr.children[0].textContent = d + (d === visit ? ' (visit date)' : '');
    if (d !== visit) tr.children[0].className = 'warn';
    tr.children[1].textContent = g.n;
    tr.children[2].textContent = [...g.src].join(', ');
    t.tBodies[0].appendChild(tr);
  }
  if (undated) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td></td><td></td>';
    tr.children[0].textContent = 'No date found'; tr.children[1].textContent = undated; tr.children[2].textContent = `will use ${visit}`;
    t.tBodies[0].appendChild(tr);
  }
  $('optFound').textContent = groups.size === 1 ? `Yes, use ${[...groups.keys()][0]}` : 'Use the date found in each photo';
  $('optVisit').textContent = `Use the visit date (${visit}) for all of them`;
  document.querySelector('input[name=dateChoice][value=found]').checked = true;
  $('customDate').value = '';
  $('dateError').textContent = '';
  $('dateModal').hidden = false;
  $('dateOk').focus();

  return new Promise((resolve) => {
    $('dateForm').onsubmit = (e) => {
      e.preventDefault();
      const choice = document.querySelector('input[name=dateChoice]:checked').value;
      const custom = $('customDate').value;
      if (choice === 'custom' && !custom) { $('dateError').textContent = 'Pick the date to use.'; return; }
      for (const p of fresh) {
        if (choice === 'visit') p.dateOverride = visit;
        else if (choice === 'custom') p.dateOverride = custom;
        else if (!p.takenDate) p.dateOverride = visit;
        p.dateConfirmed = true;
      }
      $('dateModal').hidden = true;
      resolve();
    };
  });
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
  sel.forEach((p) => { p.dateOverride = value; p.dateConfirmed = true; });
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
    const off = visit && d !== visit && !p.dateConfirmed;
    const approx = !p.dateConfirmed && !p.dateOverride && p.dateSource !== 'camera';
    el.innerHTML = `<div class="bar"></div><div class="img"></div><div class="meta">
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
    if (p.category) paint(el, p.category);
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
  const rowsBy = {};
  const visit = visitDate();
  for (const p of active()) {
    const d = eDate(p) || 'No date';
    const r = rowsBy[d] || (rowsBy[d] = { n: 0, attn: 0 });
    r.n += 1;
    if (!p.dateConfirmed && visit && d !== visit) r.attn += 1;     // only unconfirmed dates need a look
  }
  box.innerHTML = '';
  const rows = Object.entries(rowsBy).sort();
  if (!rows.length) { box.textContent = 'Add photos to see their dates.'; return; }
  for (const [d, r] of rows) {
    const row = document.createElement('div');
    row.className = r.attn ? 'bad' : 'good';
    row.innerHTML = '<span></span><span></span>';
    row.children[0].textContent = d + (r.attn ? ' ⚠ not visit date' : d !== visit && visit ? ' (confirmed)' : '');
    row.children[1].textContent = r.n + ' photo' + (r.n === 1 ? '' : 's');
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
  const { plans } = await window.api.plan(photos, jobInfo());
  const byId = new Map(photos.map((p) => [p.id, p]));
  const unconfirmed = photos.filter((p) => !p.dateConfirmed && eDate(p) !== visitDate());
  let html = '';
  if (unconfirmed.length) {
    html += `<div class="callout">⚠ ${unconfirmed.length} photo(s) are dated other than the visit date (${visitDate()}) and haven’t been confirmed. Go back and check them.</div>`;
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
  state.savedJobs = await window.api.jobsList();
  $('rootLabel').textContent = state.uploadRoot || 'Not set';
  $('rootLabel').title = state.uploadRoot;
  $('areas').innerHTML = state.config.areaSuggestions.map((a) => `<option value="${esc(a)}">`).join('');
  const cats = $('categories');
  for (const c of state.config.categories) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<kbd>${esc(c.key || '')}</kbd><span></span>`;
    b.lastChild.textContent = c.label;
    paint(b, c.id);
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
  $('completeJob').onclick = completeJob;
  $('tutorialBtn').onclick = () => runTour();
  window.api.onProgress(({ done, total }) => { $('modalTitle').textContent = `Copying… ${done} / ${total}`; });

  const grid = $('grid');
  ['dragenter', 'dragover'].forEach((t) => grid.addEventListener(t, (e) => { e.preventDefault(); grid.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((t) => grid.addEventListener(t, (e) => { e.preventDefault(); grid.classList.remove('drag'); }));
  grid.addEventListener('drop', (e) => addPaths([...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean)));

  document.addEventListener('keydown', (e) => {
    if (/INPUT|TEXTAREA/.test(document.activeElement.tagName) || !$('modal').hidden || !$('jobModal').hidden || !$('dateModal').hidden || window.Tour.isOpen()) return;
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
  $('editJob').disabled = $('completeJob').disabled = !state.job;
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
  const pick = $('savedJobs');
  pick.innerHTML = '';
  pick.add(new Option('— Choose a saved job —', ''));
  for (const j of state.savedJobs) pick.add(new Option(`${j.customer} — ${j.jobName}`, j.id));
  $('savedWrap').hidden = !state.savedJobs.length;
  $('remember').checked = mode === 'edit' && !!(job && job.id);
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
  $('savedJobs').addEventListener('change', () => {
    const j = state.savedJobs.find((x) => x.id === $('savedJobs').value);
    if (!j) return;
    $('customer').value = j.customer;
    $('jobName').value = j.jobName;
    $('visitDate').value = today();            // the date always resets to today
    $('remember').checked = true;
    $('jobError').textContent = '';
    document.querySelectorAll('#jobForm input').forEach((n) => n.classList.remove('bad'));
    $('jobSubmit').focus();
  });
  $('jobCancel').onclick = () => { $('jobModal').hidden = true; };
  $('jobModal').addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('jobCancel').hidden) $('jobCancel').click(); });
  $('jobForm').addEventListener('submit', async (e) => {
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
    try {
      const editing = state.jobMode === 'edit' && state.job ? state.job.id : undefined;
      if ($('remember').checked) {
        const r = await window.api.jobsRemember({ id: editing, customer: job.customer, jobName: job.jobName });
        job.id = r.id; state.savedJobs = r.list;
      } else if (editing) {
        state.savedJobs = await window.api.jobsForget(editing);   // un-ticked: delete the saved copy
      }
    } catch (err) {
      $('jobError').textContent = 'Could not save the job: ' + err.message;
      return;
    }
    if (state.jobMode === 'new') { state.photos = []; state.selected.clear(); setStatus(''); }
    state.job = job;
    $('jobModal').hidden = true;
    renderJob();
    render();
  });
}

// Finished with the job: delete its saved data and start over.
async function completeJob() {
  const j = state.job;
  if (!j) return;
  const n = state.photos.length;
  const msg = `Mark “${j.jobName}” for ${j.customer} as complete?\n\n` +
    (j.id ? 'Its saved name will be deleted from this program and will no longer appear in the saved jobs list.'
          : 'This job was not saved, so there is nothing to delete.') +
    (n ? `\n\nThe ${n} photo(s) still loaded here will be cleared (nothing is deleted from your phone or computer).` : '') +
    '\n\nPhotos already filed in the customer folder are not affected.';
  if (!confirm(msg)) return;
  if (j.id) state.savedJobs = await window.api.jobsForget(j.id);
  state.job = null; state.photos = []; state.selected.clear();
  setStatus('Job marked complete.', 'ok');
  renderJob(); render();
  openJob('first');
}

// ---------- tutorial ----------
const TOUR_STEPS = [
  { title: 'Welcome to Job Photo Organizer', text: 'This 1-minute tour shows how to turn a pile of phone photos into correctly named, correctly filed pictures for the customer record. Use Next or the arrow keys to flip between steps or press Skip to close this tutorial.' },
  { target: '#jobSummary', title: 'The job details', text: 'Every job starts with a small window asking for the customer name, job name, visit date and the customer files folder. They are shown here, and they become part of every file name. Tick “Remember this job” for work that takes several days, then pick it from the list next time — the date always starts as today.' },
  { target: '#jobBtns', title: 'New job, Edit job, Mark complete', text: '“New job” starts a fresh set of renames for a different job and clears the current photos. “Edit job” fixes a typo without clearing anything. When all the work is finished, “Mark job complete” deletes the saved job from the program.' },
  { target: '#addButtons', title: 'Add the photos', text: 'Add photos or a whole folder, or just drag them into the window. For a phone, plug it in and browse to its DCIM / Camera folder, or copy the pictures to the computer first. The app reads the dates in the photos and asks you to confirm which date to use.' },
  { target: '#grid', title: 'Your photos', text: 'Your photos only show up here after you drag and drop them into this area (or add them with the buttons above) — the app can’t see photos that are still on your phone or elsewhere on the computer. Once they are here, click a photo to select it; Shift-click selects a range and Ctrl-click adds one. Each card shows its label and date, and an orange date means it is not the visit date.' },
  { target: '#secCategory', title: '1. What are they for?', text: 'With photos selected, pick the type — Sales Walkthrough, Inspection, and so on — or press its number key. Every type has its own color, shown on its button and on the photos you label. The type is built into the new file name, so the same spot photographed for two purposes never gets mixed up.' },
  { target: '#secArea', title: '2. Where or what? (optional)', text: 'Add an area such as Roof, Meter or Inverter and click “Apply to selected”. It is added to the file name too.' },
  { target: '#secDates', title: '3. Check the dates', text: 'Dates come from the photo itself — the camera, the file name, or the file date. Any date that is not the visit date is flagged here. Fix a photo’s date with “Set for selected”, or use the visit date in one click.' },
  { target: '#review', title: 'Review & rename', text: 'When every photo has a type, review the old → new names, then “Rename & upload” copies them into the customer’s folder. Your originals are never changed.' },
  { target: '#tutorialBtn', pulse: true, doneLabel: 'Got it', title: 'Want to see this again?', text: 'That’s the whole process! You can replay this tutorial any time with the Tutorial button, highlighted here at the top right.' },
];

function runTour(after) {
  window.api.setConfig({ tutorialSeen: true });
  state.config.tutorialSeen = true;
  window.Tour.start(TOUR_STEPS, { onEnd: after });
}
init();
