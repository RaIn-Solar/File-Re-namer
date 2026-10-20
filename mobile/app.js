'use strict';
// Phone app: name the photo with the same rules as the desktop app, then upload it
// straight to Google Drive. Photos are only held in memory, never saved to the phone.
(() => {
  const SCOPE = 'https://www.googleapis.com/auth/drive';
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const cfg = window.APP_CONFIG || {};
  const settings = () => {
    const s = store.get('settings', {});
    return {
      clientId: s.clientId || cfg.googleClientId || '',
      rootFolder: DriveApi.parseFolderId(s.rootFolder || cfg.driveRootFolder || ''),
    };
  };

  let config = { categories: [], areaSuggestions: [] };
  let category = null;
  let token = null; // { value, expires }
  let tokenClient = null;
  let tokenWaiter = null;

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const dateOf = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // ---- Google sign-in -------------------------------------------------------
  function initAuth() {
    const { clientId } = settings();
    if (!clientId || !window.google || !google.accounts) return false;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) => {
        const w = tokenWaiter; tokenWaiter = null;
        if (r.error) { if (w) w.reject(new Error(r.error_description || r.error)); return; }
        token = { value: r.access_token, expires: Date.now() + (Number(r.expires_in) - 60) * 1000 };
        if (w) w.resolve(token.value);
        refreshReady();
      },
      error_callback: (e) => {
        const w = tokenWaiter; tokenWaiter = null;
        if (w) w.reject(new Error(e.type === 'popup_closed' ? 'Sign-in was cancelled' : (e.message || e.type)));
      },
    });
    return true;
  }
  const signedIn = () => !!(token && token.expires > Date.now());
  // Must be called from a tap (browsers block the sign-in popup otherwise).
  function signIn() {
    if (!tokenClient && !initAuth()) return Promise.reject(new Error('Google sign-in is not set up yet (Settings)'));
    return new Promise((resolve, reject) => {
      tokenWaiter = { resolve, reject };
      tokenClient.requestAccessToken({ prompt: signedIn() ? '' : (store.get('signedInBefore', false) ? '' : 'consent') });
      store.set('signedInBefore', true);
    });
  }
  const drive = DriveApi.createDrive({
    fetch: (...a) => fetch(...a),
    getToken: async () => {
      if (!signedIn()) { const e = new Error('Please sign in to Google'); e.needsSignIn = true; throw e; }
      return token.value;
    },
  });

  // ---- Job + types ----------------------------------------------------------
  // Drive folders use the names exactly as typed (e.g. "Inman, Rachel"), only tidying spaces.
  const tidy = (s) => String(s || '').trim().replace(/\s+/g, ' ');
  const jobFolderName = () => `${tidy($('customer').value)} / ${tidy($('jobName').value)}`;
  const savedJobs = () => store.get('jobs', []);

  function renderJobs() {
    const sel = $('savedJobs');
    sel.innerHTML = '<option value="">New job…</option>';
    savedJobs().forEach((j, i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = `${j.customer} – ${j.jobName}`;
      sel.appendChild(o);
    });
  }
  $('savedJobs').addEventListener('change', (e) => {
    const j = savedJobs()[e.target.value];
    $('forgetJob').hidden = !j;
    if (j) { $('customer').value = j.customer; $('jobName').value = j.jobName; }
    $('date').value = today();
    refreshReady();
  });
  $('saveJob').addEventListener('click', () => {
    const customer = $('customer').value.trim().replace(/\s+/g, ' ');
    const jobName = $('jobName').value.trim().replace(/\s+/g, ' ');
    if (!customer || !jobName) return alert('Enter the customer and job name first.');
    const rest = savedJobs().filter((j) => !(j.customer.toLowerCase() === customer.toLowerCase() && j.jobName.toLowerCase() === jobName.toLowerCase()));
    store.set('jobs', [{ customer, jobName }, ...rest].slice(0, 50));
    renderJobs(); $('savedJobs').value = 0; $('forgetJob').hidden = false;
  });
  $('forgetJob').addEventListener('click', () => {
    const i = $('savedJobs').value;
    if (i === '' || !confirm('Mark this job complete and remove it from this phone?')) return;
    store.set('jobs', savedJobs().filter((_, k) => k !== Number(i)));
    renderJobs(); $('customer').value = ''; $('jobName').value = ''; $('forgetJob').hidden = true; refreshReady();
  });

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
    const chips = $('areaChips');
    config.areaSuggestions.forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = a;
      b.addEventListener('click', () => { $('area').value = a; });
      chips.appendChild(b);
    });
  }

  function problem() {
    const s = settings();
    if (!s.clientId || !s.rootFolder) return 'Open Settings and enter the Google Drive folder and client ID.';
    if (!signedIn()) return 'Tap “Connect Google Drive” first.';
    if (!$('customer').value.trim() || !$('jobName').value.trim()) return 'Enter the customer and job name.';
    if (!$('date').value) return 'Pick the photo date.';
    if (!category) return 'Pick what the photos are for.';
    return '';
  }
  function refreshReady() {
    const s = settings();
    const p = problem();
    const needConnect = s.clientId && s.rootFolder && !signedIn();
    $('setup').hidden = !!(s.clientId && s.rootFolder);
    $('setupMsg').textContent = 'Open Settings and enter the Google Drive folder and the OAuth client ID.';
    $('ready').textContent = p || `Ready: ${jobFolderName()} / ${category.label}`;
    $('takeBtn').disabled = $('pickBtn').disabled = !!p && !needConnect;
    $('takeBtn').textContent = needConnect ? 'Connect Google Drive' : 'Take photo';
    $('pickBtn').textContent = needConnect ? 'Connect Google Drive' : 'Choose from gallery';
  }
  ['customer', 'jobName', 'date'].forEach((id) => $(id).addEventListener('input', refreshReady));

  // ---- Uploading ------------------------------------------------------------
  let queue = Promise.resolve();
  function enqueue(file, date) {
    // Capture everything now so later edits to the form don't change a queued photo.
    const job = {
      customer: $('customer').value, jobName: $('jobName').value, area: $('area').value,
      cat: category, folderName: jobFolderName(), root: settings().rootFolder,
      customerFolder: tidy($('customer').value), jobFolder: tidy($('jobName').value),
    };
    const li = document.createElement('li');
    $('log').prepend(li);
    const run = async () => {
      li.className = 'busy'; li.textContent = 'Uploading…';
      try {
        const ext = (file.name.match(/\.[A-Za-z0-9]+$/) || [''])[0] || (file.type === 'image/png' ? '.png' : '.jpg');
        // Customer folders must already exist (a typo should not create a duplicate); the job folder is created if missing.
        const customerId = await drive.findFolder(job.root, job.customerFolder);
        if (!customerId) throw new Error(`No customer folder named “${job.customerFolder}” in Drive. Check the spelling (Last, First).`);
        const dir = await drive.ensureFolder(customerId, job.jobFolder);
        // Sequence number comes from what's already in Drive, so names never collide.
        const stem = Naming.buildName({ ...job, date, seq: 0, ext: '' }).replace(/_000$/, '');
        const seq = await drive.nextSeq(dir, stem, ext);
        const name = Naming.buildName({ ...job, date, seq, ext });
        await drive.uploadFile(dir, name, file);
        li.className = 'ok'; li.textContent = `✓ ${job.folderName} / ${name}`;
      } catch (err) {
        li.className = 'err';
        li.textContent = `✗ Not uploaded: ${err.message}`;
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

  async function handleFiles(input, useOwnDate) {
    const files = [...input.files];
    input.value = '';
    files.forEach((f) => enqueue(f, useOwnDate && f.lastModified ? dateOf(f.lastModified) : $('date').value));
  }
  async function start(input) {
    if (!signedIn()) {
      try { await signIn(); } catch (e) { return alert(e.message); }
      return refreshReady();
    }
    if (!problem()) input.click();
  }
  $('takeBtn').addEventListener('click', () => start($('camera')));
  $('pickBtn').addEventListener('click', () => start($('gallery')));
  $('camera').addEventListener('change', () => handleFiles($('camera'), false));
  $('gallery').addEventListener('change', () => handleFiles($('gallery'), true));

  // ---- Settings -------------------------------------------------------------
  $('settingsBtn').addEventListener('click', () => {
    const s = store.get('settings', {});
    $('rootFolder').value = s.rootFolder || cfg.driveRootFolder || '';
    $('clientId').value = s.clientId || cfg.googleClientId || '';
    $('settings').showModal();
  });
  $('saveSettings').addEventListener('click', () => {
    store.set('settings', { rootFolder: $('rootFolder').value.trim(), clientId: $('clientId').value.trim() });
    tokenClient = null; token = null;
    setTimeout(() => { initAuth(); refreshReady(); }, 0);
  });
  $('signOut').addEventListener('click', () => {
    if (token && window.google) google.accounts.oauth2.revoke(token.value, () => {});
    token = null; $('settings').close(); refreshReady();
  });

  // ---- Start ----------------------------------------------------------------
  async function init() {
    try { config = await (await fetch('config.default.json')).json(); } catch { /* offline first run */ }
    renderTypes(); renderJobs();
    $('date').value = today();
    refreshReady();
    // The Google script loads async; wait for it before building the token client.
    const t = setInterval(() => { if (initAuth()) { clearInterval(t); refreshReady(); } }, 300);
    setTimeout(() => clearInterval(t), 15000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  init();
})();
