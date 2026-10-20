'use strict';
// Phone app: add photos first, label them, then upload them all to the job's Photos folder
// in Google Drive. Photos are only held in memory, never saved to the phone. Customers and
// jobs are existing Drive folders picked from search results. See src/drive.js for the
// data-safety rules.
(() => {
  const SCOPE = 'https://www.googleapis.com/auth/drive';
  const $ = (id) => document.getElementById(id);
  const cfg = window.APP_CONFIG || {};

  let drive = null;
  let config = { categories: [], areaSuggestions: [] };
  let customer = null; // { id, name }
  let job = null; // { id, name, photosId }
  let token = null; // { value, expires }
  let tokenClient = null;
  let tokenWaiter = null;
  let uploading = false;

  // Photos waiting to go: { id, file, thumb, date, cat, area, status, flag }
  let photos = [];
  let nextId = 1;
  const selected = new Set();

  const dateOf = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const today = () => dateOf(Date.now());
  const signedIn = () => !!(token && token.expires > Date.now());
  const catById = (id) => config.categories.find((c) => c.id === id);
  const waiting = () => photos.filter((p) => p.status !== 'done');

  // ---- Google sign-in -------------------------------------------------------
  function initAuth() {
    if (tokenClient) return true;
    if (!cfg.googleClientId || !window.google || !google.accounts) return false;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cfg.googleClientId,
      scope: SCOPE,
      callback: (r) => {
        const w = tokenWaiter; tokenWaiter = null;
        if (r.error) { if (w) w.reject(new Error(r.error_description || r.error)); return; }
        token = { value: r.access_token, expires: Date.now() + (Number(r.expires_in) - 60) * 1000 };
        if (w) w.resolve(token.value);
      },
      error_callback: (e) => {
        const w = tokenWaiter; tokenWaiter = null;
        if (w) w.reject(new Error(e.type === 'popup_closed' ? 'Sign-in was cancelled' : (e.message || e.type)));
      },
    });
    return true;
  }
  // Must be called from a tap (browsers block the sign-in popup otherwise).
  function signIn() {
    if (!initAuth()) return Promise.reject(new Error('Google sign-in is still loading. Try again in a moment.'));
    return new Promise((resolve, reject) => {
      tokenWaiter = { resolve, reject };
      let before = false;
      try { before = localStorage.getItem('signedInBefore') === '1'; localStorage.setItem('signedInBefore', '1'); } catch { /* ignore */ }
      tokenClient.requestAccessToken({ prompt: before ? '' : 'consent' });
    });
  }
  function getDrive() {
    if (!drive) {
      drive = DriveApi.createDrive({
        fetch: (...a) => fetch(...a),
        getToken: async () => {
          if (!signedIn()) { const e = new Error('Please sign in to Google'); e.needsSignIn = true; throw e; }
          return token.value;
        },
        rootId: cfg.driveRootFolderId,
        allowedCustomers: cfg.allowedCustomers || [],
      });
    }
    return drive;
  }

  // ---- Customer / job pickers -----------------------------------------------
  const hint = (ul, text) => { ul.innerHTML = ''; const li = document.createElement('li'); li.className = 'hint'; li.textContent = text; ul.appendChild(li); };
  function renderList(ul, items, filter, onPick) {
    const f = filter.trim().toLowerCase();
    const shown = items.filter((i) => !f || i.name.toLowerCase().includes(f));
    if (!shown.length) return hint(ul, items.length ? 'No match. Check the spelling.' : 'Nothing found.');
    ul.innerHTML = '';
    shown.slice(0, 50).forEach((i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = i.name;
      b.addEventListener('click', () => onPick(i));
      li.appendChild(b); ul.appendChild(li);
    });
    if (shown.length > 50) {
      const li = document.createElement('li');
      li.className = 'hint'; li.textContent = `Showing 50 of ${shown.length}. Type more to narrow.`;
      ul.appendChild(li);
    }
  }
  let jobs = [];
  const renderJobs = () => renderList($('jobList'), jobs, $('jobSearch').value, pickJob);
  $('jobSearch').addEventListener('input', renderJobs);

  // Customers are only looked up for what is typed; nothing is listed up front.
  let searchTimer = null;
  let searchId = 0;
  const showCustomerHint = () => hint($('customerList'), 'Type at least 2 letters of the customer name.');
  $('customerSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    const text = $('customerSearch').value;
    const mine = ++searchId;
    if (text.replace(/[\s,]/g, '').length < 2) return showCustomerHint();
    hint($('customerList'), 'Searching…');
    searchTimer = setTimeout(async () => {
      try {
        const found = await getDrive().searchCustomers(text);
        if (mine !== searchId) return; // a newer search replaced this one
        if (!found.length) return hint($('customerList'), 'No customer found. Check the spelling.');
        renderList($('customerList'), found, '', pickCustomer);
      } catch (e) {
        if (mine === searchId) hint($('customerList'), `Could not search: ${e.message}`);
      }
    }, 300);
  });

  async function pickCustomer(c) {
    customer = c; job = null; jobs = [];
    $('customerName').textContent = c.name;
    $('customerChosen').hidden = false; $('customerPicker').hidden = true;
    $('jobCard').hidden = false; $('jobChosen').hidden = true; $('jobPicker').hidden = false;
    $('jobNote').textContent = '';
    $('jobSearch').value = '';
    hint($('jobList'), 'Loading jobs…');
    try { jobs = await getDrive().listJobs(c.id); renderJobs(); } catch (e) {
      hint($('jobList'), `Could not load jobs: ${e.message}`);
    }
    refreshReady();
  }
  async function pickJob(j) {
    job = null;
    $('jobNameLabel').textContent = j.name;
    $('jobChosen').hidden = false; $('jobPicker').hidden = true;
    $('jobNote').textContent = 'Checking for the Photos folder…';
    refreshReady();
    try {
      const photosFolder = await getDrive().findPhotosFolder(j.id);
      if (customer && $('jobNameLabel').textContent === j.name) { job = { ...j, photosId: photosFolder.id }; $('jobNote').textContent = ''; }
    } catch (e) { $('jobNote').textContent = e.message; }
    refreshReady();
  }
  $('changeCustomer').addEventListener('click', () => {
    customer = null; job = null;
    $('customerChosen').hidden = true; $('customerPicker').hidden = false; $('jobCard').hidden = true;
    $('customerSearch').value = ''; showCustomerHint(); refreshReady();
  });
  $('changeJob').addEventListener('click', () => {
    job = null; $('jobNote').textContent = ''; $('jobChosen').hidden = true; $('jobPicker').hidden = false; renderJobs(); refreshReady();
  });

  // ---- Photos: add, select, label -------------------------------------------
  function makeThumb(p) {
    const fallback = () => { p.thumb = URL.createObjectURL(p.file); renderGrid(); };
    if (!window.createImageBitmap) return fallback();
    createImageBitmap(p.file, { resizeWidth: 240, resizeQuality: 'low' }).then((bmp) => {
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close && bmp.close();
      c.toBlob((b) => { if (!b) return fallback(); p.thumb = URL.createObjectURL(b); renderGrid(); }, 'image/jpeg', 0.7);
    }).catch(fallback);
  }
  function addFiles(files, ownDate) {
    files.forEach((f) => {
      const p = { id: nextId++, file: f, thumb: '', cat: null, area: '', status: 'pending', flag: false,
        date: ownDate && f.lastModified ? dateOf(f.lastModified) : $('date').value };
      photos.push(p);
      makeThumb(p);
    });
    renderGrid();
  }
  function renderGrid() {
    const grid = $('grid');
    grid.innerHTML = '';
    photos.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `thumb${selected.has(p.id) ? ' sel' : ''}${p.flag ? ' flag' : ''}${p.status === 'done' ? ' done' : ''}`;
      if (p.thumb) { const img = document.createElement('img'); img.src = p.thumb; img.alt = ''; b.appendChild(img); }
      const tag = document.createElement('div');
      const c = catById(p.cat);
      tag.className = 'tag';
      if (c) { tag.style.background = c.color; if (['#F9A8D4', '#F59E0B'].includes(c.color.toUpperCase())) tag.style.color = '#111827'; }
      tag.textContent = c ? `${c.label}${p.area ? ' · ' + p.area : ''}` : 'No type yet';
      b.appendChild(tag);
      const st = document.createElement('div');
      st.className = 'st';
      st.textContent = { done: '✓', busy: '…', error: '✗' }[p.status] || '';
      if (st.textContent) b.appendChild(st);
      b.title = p.date;
      b.addEventListener('click', () => {
        if (p.status === 'done') return;
        if (selected.has(p.id)) selected.delete(p.id); else selected.add(p.id);
        renderGrid();
      });
      grid.appendChild(b);
    });
    const n = waiting().length;
    $('selBar').hidden = !n;
    $('labelCard').hidden = !n;
    $('clearDone').hidden = !photos.some((p) => p.status === 'done');
    const sel = selectedPhotos().length;
    $('selCount').textContent = `${n} photo${n === 1 ? '' : 's'}, ${sel} selected`;
    $('labelHint').textContent = sel ? `${sel} selected. Pick a type to label them.` : 'Tap photos above to select them, then pick a type.';
    refreshReady();
  }
  const selectedPhotos = () => photos.filter((p) => selected.has(p.id) && p.status !== 'done');
  function onSelected(fn) {
    const s = selectedPhotos();
    if (!s.length) { $('labelHint').textContent = 'Select at least one photo first.'; $('labelHint').classList.add('warn'); return false; }
    $('labelHint').classList.remove('warn');
    s.forEach((p) => { fn(p); p.flag = false; });
    renderGrid();
    return true;
  }
  $('selAll').addEventListener('click', () => { waiting().forEach((p) => selected.add(p.id)); renderGrid(); });
  $('selNone').addEventListener('click', () => { selected.clear(); renderGrid(); });
  $('selUnlabeled').addEventListener('click', () => {
    selected.clear(); waiting().filter((p) => !p.cat).forEach((p) => selected.add(p.id)); renderGrid();
  });
  $('setArea').addEventListener('click', () => onSelected((p) => { p.area = $('area').value.trim(); }));
  $('clearArea').addEventListener('click', () => { $('area').value = ''; onSelected((p) => { p.area = ''; }); });
  $('setDate').addEventListener('change', () => { if ($('setDate').value) onSelected((p) => { p.date = $('setDate').value; }); });
  $('removeSel').addEventListener('click', () => {
    const s = selectedPhotos();
    if (!s.length) return onSelected(() => {});
    if (!confirm(`Remove ${s.length} photo${s.length === 1 ? '' : 's'} from this list?\n\nPhotos taken with the camera are not saved anywhere else and will be lost.`)) return;
    s.forEach((p) => { selected.delete(p.id); if (p.thumb) URL.revokeObjectURL(p.thumb); });
    photos = photos.filter((p) => !s.includes(p));
    renderGrid();
  });
  $('clearDone').addEventListener('click', () => {
    photos.filter((p) => p.status === 'done').forEach((p) => { if (p.thumb) URL.revokeObjectURL(p.thumb); });
    photos = photos.filter((p) => p.status !== 'done');
    renderGrid();
  });

  function renderTypes() {
    const box = $('types');
    box.innerHTML = '';
    config.categories.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = c.label; b.style.background = c.color;
      if (['#F9A8D4', '#F59E0B'].includes(c.color.toUpperCase())) b.style.color = '#111827';
      b.addEventListener('click', () => onSelected((p) => { p.cat = c.id; }));
      box.appendChild(b);
    });
    config.areaSuggestions.forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = a;
      b.addEventListener('click', () => { $('area').value = a; onSelected((p) => { p.area = a; }); });
      $('areaChips').appendChild(b);
    });
  }

  // File choosers must open straight from a tap, so these buttons do nothing else first.
  $('takeBtn').addEventListener('click', () => $('camera').click());
  $('pickBtn').addEventListener('click', () => $('gallery').click());
  const take = (input, own) => { const f = [...input.files]; input.value = ''; addFiles(f, own); };
  $('camera').addEventListener('change', () => take($('camera'), false));
  $('gallery').addEventListener('change', () => take($('gallery'), true));
  window.addEventListener('beforeunload', (e) => { if (waiting().length) { e.preventDefault(); e.returnValue = ''; } });

  // ---- Review & upload ------------------------------------------------------
  function refreshReady() {
    const connected = signedIn();
    $('connectCard').hidden = connected;
    $('customerCard').hidden = !connected;
    if (!connected) $('jobCard').hidden = true;
    const n = waiting().length;
    const unlabeled = waiting().filter((p) => !p.cat).length;
    $('ready').classList.remove('warn');
    if (uploading) $('ready').textContent = 'Uploading…';
    else if (!n) $('ready').textContent = 'Add photos to begin.';
    else if (unlabeled) $('ready').textContent = `${unlabeled} of ${n} photo${n === 1 ? '' : 's'} still need a type.`;
    else $('ready').textContent = `${n} photo${n === 1 ? '' : 's'} labeled. Choose the customer and job, then review.`;
    $('reviewBtn').disabled = uploading;
  }
  const warn = (text) => { $('ready').textContent = text; $('ready').classList.add('warn'); };

  $('connectBtn').addEventListener('click', async () => {
    try { await signIn(); } catch (e) { return alert(e.message); }
    refreshReady();
    showCustomerHint();
  });

  let plan = null;
  $('reviewBtn').addEventListener('click', async () => {
    const todo = waiting();
    if (!todo.length) return warn('Add photos first.');
    const missing = todo.filter((p) => !p.cat);
    if (missing.length) {
      todo.forEach((p) => { p.flag = !p.cat; });
      renderGrid();
      warn(`${missing.length} photo${missing.length === 1 ? ' needs' : 's need'} a type. They are outlined in red.`);
      return;
    }
    if (!signedIn()) {
      try { await signIn(); } catch (e) { return alert(e.message); }
      refreshReady(); showCustomerHint();
      return warn('Connected. Now pick the customer and job, then tap Review & upload again.');
    }
    if (!customer) return warn('Pick the customer first.');
    if (!job) return warn($('jobNote').textContent || 'Pick the job first.');
    try {
      const d = getDrive();
      await d.verifyTarget(customer.id, job.id, job.photosId);
      // Names continue after what is already in Drive, so numbers never collide.
      const groups = new Map();
      [...todo].sort((a, b) => (a.file.lastModified || 0) - (b.file.lastModified || 0) || a.id - b.id).forEach((p) => {
        const ext = (p.file.name.match(/\.[A-Za-z0-9]+$/) || [''])[0] || (p.file.type === 'image/png' ? '.png' : '.jpg');
        const base = { customer: customer.name, jobName: job.name, date: p.date, cat: catById(p.cat), area: p.area };
        const stem = Naming.buildName({ ...base, seq: 0, ext: '' }).replace(/_000$/, '');
        const key = `${stem}|${ext.toLowerCase()}`;
        if (!groups.has(key)) groups.set(key, { base, stem, ext, items: [] });
        groups.get(key).items.push(p);
      });
      const items = [];
      for (const g of groups.values()) {
        const start = await d.nextSeq(job.photosId, g.stem, g.ext);
        g.items.forEach((p, i) => items.push({ p, name: Naming.buildName({ ...g.base, seq: start + i, ext: g.ext }) }));
      }
      plan = { customer, job, items };
    } catch (e) { return warn(`Could not prepare the upload: ${e.message}`); }
    $('reviewWhere').textContent = `Contacts-Active / ${customer.name} / ${job.name} / Photos`;
    const ul = $('reviewList');
    ul.innerHTML = '';
    plan.items.forEach((i) => { const li = document.createElement('li'); li.textContent = i.name; ul.appendChild(li); });
    $('reviewYes').textContent = `Upload ${plan.items.length} photo${plan.items.length === 1 ? '' : 's'}`;
    $('reviewDlg').showModal();
  });
  $('reviewNo').addEventListener('click', () => { plan = null; $('reviewDlg').close(); });
  $('reviewYes').addEventListener('click', async () => {
    const run = plan; plan = null;
    $('reviewDlg').close();
    if (!run || uploading) return;
    uploading = true; refreshReady();
    const d = getDrive();
    for (const { p, name } of run.items) {
      p.status = 'busy'; renderGrid();
      const li = document.createElement('li');
      try {
        const finalName = await d.addPhoto(run.customer.id, run.job.id, run.job.photosId, name, p.file);
        p.status = 'done'; selected.delete(p.id);
        li.className = 'ok'; li.textContent = `✓ ${run.customer.name} / ${run.job.name} / Photos / ${finalName}`;
      } catch (err) {
        p.status = 'error';
        li.className = 'err'; li.textContent = `✗ ${name}: ${err.message}${/^Blocked/.test(err.message) ? '' : ' (tap Review & upload to retry)'}`;
        if (err.needsSignIn) li.textContent += ' Your Google sign-in expired.';
      }
      $('log').prepend(li);
    }
    uploading = false;
    renderGrid();
  });

  // ---- Settings -------------------------------------------------------------
  $('settingsBtn').addEventListener('click', () => $('settings').showModal());
  $('signOut').addEventListener('click', () => {
    if (token && window.google) google.accounts.oauth2.revoke(token.value, () => {});
    token = null; customer = null; job = null; drive = null;
    $('settings').close();
    $('customerChosen').hidden = true; $('customerPicker').hidden = false;
    $('customerSearch').value = ''; showCustomerHint();
    refreshReady();
  });

  // ---- Tutorial -------------------------------------------------------------
  const TOUR_STEPS = [
    { title: 'Welcome to Job Photos', text: 'This short tour shows how to send job-site photos straight to the customer\u2019s Google Drive folder. Tap Next to move on, or Skip to close it.' },
    { target: '#connectCard', title: 'Connect Google Drive', text: 'Sign in once with your company Google account. After that the customer search works. You\u2019ll only need to sign in again if the app asks.' },
    { target: '#customerCard', title: '1. Find the customer', text: 'Type at least 2 letters of the customer\u2019s name (Last, First) and tap the match. Customers only appear as you type, and only existing customer folders can be used.' },
    { target: '#jobCard', title: '2. Pick the job', text: 'Pick one of that customer\u2019s jobs. The app checks the job has a Photos folder; that\u2019s where everything will go. The date box sets the date for photos you take with the camera.' },
    { target: '#addRow', title: '3. Add all the photos first', text: 'Tap Take photo (again for each new one) or Choose from gallery. Photos collect below and nothing is uploaded yet. Photos taken here are not saved on your phone, so don\u2019t close the page before uploading.' },
    { target: '#grid', title: 'Select photos', text: 'Tap a photo to select it (tap again to deselect). Use Select all or Unlabeled to select several at once. Each photo shows its type and area, and red means it still needs a type.' },
    { target: '#labelCard', title: '4. Label the selected photos', text: 'With photos selected, tap a type such as Inspection. Every type has its own color. You can also set an area like Roof or Meter, or a different date. The type, area and date all become part of the file name. This section appears once you\u2019ve added photos.' },
    { target: '#reviewBtn', title: '5. Review & upload', text: 'When every photo has a type, tap this to see the final file names and where they\u2019re going, then confirm. Nothing already in Drive is ever replaced or deleted; a name that\u2019s already taken gets _v2, _v3, and so on.' },
    { target: '#tutorialBtn', pulse: true, doneLabel: 'Got it', title: 'Want to see this again?', text: 'That\u2019s the whole process! Replay this tutorial any time with the Tutorial button at the top.' },
  ];
  const tourSeen = () => { try { return localStorage.getItem('tutorialSeen') === '1'; } catch { return false; } };
  function runTour() {
    try { localStorage.setItem('tutorialSeen', '1'); } catch { /* ignore */ }
    window.Tour.start(TOUR_STEPS);
  }
  $('tutorialBtn').addEventListener('click', runTour);

  // ---- Start ----------------------------------------------------------------
  async function init() {
    try { config = await (await fetch('config.default.json')).json(); } catch { /* offline first run */ }
    renderTypes();
    $('date').value = today();
    $('setDate').value = today();
    renderGrid();
    const t = setInterval(() => { if (initAuth()) clearInterval(t); }, 300);
    setTimeout(() => clearInterval(t), 15000);
    if (!tourSeen()) runTour(); // first time on this phone
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  init();
})();
