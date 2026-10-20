'use strict';
// Phone app: pick an EXISTING customer and job from Google Drive, name the photo with the
// same rules as the desktop app, and add it to that job folder. Photos are only held in
// memory, never saved to the phone. See src/drive.js for the data-safety rules.
(() => {
  const SCOPE = 'https://www.googleapis.com/auth/drive';
  const $ = (id) => document.getElementById(id);
  const cfg = window.APP_CONFIG || {};

  let drive = null;
  let config = { categories: [], areaSuggestions: [] };
  let category = null;
  let customer = null; // { id, name }
  let job = null; // { id, name }
  let customers = [];
  let token = null; // { value, expires }
  let tokenClient = null;
  let tokenWaiter = null;
  let confirmedJobId = null;

  const dateOf = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const today = () => dateOf(Date.now());
  const signedIn = () => !!(token && token.expires > Date.now());

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
  function renderList(ul, items, filter, onPick) {
    const f = filter.trim().toLowerCase();
    const shown = items.filter((i) => !f || i.name.toLowerCase().includes(f));
    ul.innerHTML = '';
    if (!shown.length) {
      const li = document.createElement('li');
      li.className = 'hint';
      li.textContent = items.length ? 'No match. Check the spelling.' : 'Nothing found.';
      ul.appendChild(li);
      return;
    }
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
  const renderCustomers = () => renderList($('customerList'), customers, $('customerSearch').value, pickCustomer);
  const renderJobs = () => renderList($('jobList'), jobs, $('jobSearch').value, pickJob);
  $('customerSearch').addEventListener('input', renderCustomers);
  $('jobSearch').addEventListener('input', renderJobs);

  async function loadCustomers() {
    $('customerList').innerHTML = '<li class="hint">Loading customers…</li>';
    try {
      customers = await getDrive().listCustomers();
      renderCustomers();
    } catch (e) {
      $('customerList').innerHTML = '';
      const li = document.createElement('li'); li.className = 'hint'; li.textContent = `Could not load customers: ${e.message}`;
      $('customerList').appendChild(li);
    }
  }
  async function pickCustomer(c) {
    customer = c; job = null; jobs = [];
    $('customerName').textContent = c.name;
    $('customerChosen').hidden = false; $('customerPicker').hidden = true;
    $('jobCard').hidden = false; $('jobChosen').hidden = true; $('jobPicker').hidden = false;
    $('jobSearch').value = '';
    $('jobList').innerHTML = '<li class="hint">Loading jobs…</li>';
    try { jobs = await getDrive().listJobs(c.id); renderJobs(); } catch (e) {
      $('jobList').innerHTML = `<li class="hint">Could not load jobs: ${e.message}</li>`;
    }
    refreshReady();
  }
  function pickJob(j) {
    job = j;
    $('jobNameLabel').textContent = j.name;
    $('jobChosen').hidden = false; $('jobPicker').hidden = true;
    refreshReady();
  }
  $('changeCustomer').addEventListener('click', () => {
    customer = null; job = null;
    $('customerChosen').hidden = true; $('customerPicker').hidden = false; $('jobCard').hidden = true;
    renderCustomers(); refreshReady();
  });
  $('changeJob').addEventListener('click', () => {
    job = null; $('jobChosen').hidden = true; $('jobPicker').hidden = false; renderJobs(); refreshReady();
  });

  // ---- Types ----------------------------------------------------------------
  function renderTypes() {
    const box = $('types');
    box.innerHTML = '';
    config.categories.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = c.label; b.style.background = c.color;
      if (['#F9A8D4', '#F59E0B'].includes(c.color.toUpperCase())) b.style.color = '#111827';
      b.addEventListener('click', () => {
        category = c;
        [...box.children].forEach((x) => x.classList.toggle('on', x === b));
        refreshReady();
      });
      box.appendChild(b);
    });
    config.areaSuggestions.forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = a;
      b.addEventListener('click', () => { $('area').value = a; });
      $('areaChips').appendChild(b);
    });
  }

  function problem() {
    if (!signedIn()) return 'Connect Google Drive first.';
    if (!customer) return 'Pick the customer.';
    if (!job) return 'Pick the job.';
    if (!$('date').value) return 'Pick the photo date.';
    if (!category) return 'Pick what the photos are for.';
    return '';
  }
  function refreshReady() {
    const connected = signedIn();
    $('connectCard').hidden = connected;
    $('customerCard').hidden = !connected;
    if (!connected) $('jobCard').hidden = true;
    const p = problem();
    $('ready').textContent = p || `Ready: ${customer.name} / ${job.name} / ${category.label}`;
    $('takeBtn').disabled = $('pickBtn').disabled = !!p;
  }
  $('date').addEventListener('input', refreshReady);

  $('connectBtn').addEventListener('click', async () => {
    try { await signIn(); } catch (e) { return alert(e.message); }
    refreshReady();
    loadCustomers();
  });

  // ---- Uploading ------------------------------------------------------------
  let queue = Promise.resolve();
  function enqueue(file, date) {
    // Capture everything now so later changes to the form don't redirect a queued photo.
    const t = { customer, job, cat: category, area: $('area').value };
    const li = document.createElement('li');
    $('log').prepend(li);
    const run = async () => {
      li.className = 'busy'; li.textContent = 'Uploading…';
      try {
        const ext = (file.name.match(/\.[A-Za-z0-9]+$/) || [''])[0] || (file.type === 'image/png' ? '.png' : '.jpg');
        const d = getDrive();
        await d.verifyTarget(t.customer.id, t.job.id);
        const fields = { customer: t.customer.name, jobName: t.job.name, date, cat: t.cat, area: t.area, ext };
        // Sequence comes from what is already in Drive, so names don't collide across phones.
        const stem = Naming.buildName({ ...fields, seq: 0, ext: '' }).replace(/_000$/, '');
        const seq = await d.nextSeq(t.job.id, stem, ext);
        const name = await d.addPhoto(t.customer.id, t.job.id, Naming.buildName({ ...fields, seq }), file);
        li.className = 'ok'; li.textContent = `✓ ${t.customer.name} / ${t.job.name} / ${name}`;
      } catch (err) {
        li.className = 'err';
        li.textContent = `✗ Not uploaded: ${err.message}`;
        if (/^Blocked/.test(err.message)) return; // safety refusals are never retried
        const b = document.createElement('button');
        b.textContent = err.needsSignIn ? 'Sign in & retry' : 'Retry';
        b.addEventListener('click', async () => {
          try { if (err.needsSignIn || !signedIn()) await signIn(); } catch (e2) { return alert(e2.message); }
          b.remove(); queue = queue.then(run);
        });
        li.append(document.createElement('br'), b);
      }
    };
    queue = queue.then(run);
  }

  function handleFiles(input, useOwnDate) {
    const files = [...input.files];
    input.value = '';
    files.forEach((f) => enqueue(f, useOwnDate && f.lastModified ? dateOf(f.lastModified) : $('date').value));
  }
  async function start(input) {
    if (!signedIn()) {
      try { await signIn(); } catch (e) { return alert(e.message); }
      return refreshReady();
    }
    if (problem()) return;
    // Confirm the destination once per job so a wrong tap can't send photos to the wrong customer.
    if (confirmedJobId !== job.id) {
      if (!confirm(`Add photos to:\n\nContacts-Active / ${customer.name} / ${job.name}\n\nIs this correct?`)) return;
      confirmedJobId = job.id;
    }
    input.click();
  }
  $('takeBtn').addEventListener('click', () => start($('camera')));
  $('pickBtn').addEventListener('click', () => start($('gallery')));
  $('camera').addEventListener('change', () => handleFiles($('camera'), false));
  $('gallery').addEventListener('change', () => handleFiles($('gallery'), true));

  // ---- Settings -------------------------------------------------------------
  $('settingsBtn').addEventListener('click', () => $('settings').showModal());
  $('signOut').addEventListener('click', () => {
    if (token && window.google) google.accounts.oauth2.revoke(token.value, () => {});
    token = null; customer = null; job = null; drive = null; confirmedJobId = null;
    $('settings').close();
    $('customerChosen').hidden = true; $('customerPicker').hidden = false;
    refreshReady();
  });

  // ---- Start ----------------------------------------------------------------
  async function init() {
    try { config = await (await fetch('config.default.json')).json(); } catch { /* offline first run */ }
    renderTypes();
    $('date').value = today();
    refreshReady();
    const t = setInterval(() => { if (initAuth()) clearInterval(t); }, 300);
    setTimeout(() => clearInterval(t), 15000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  init();
})();
