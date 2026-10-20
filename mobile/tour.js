'use strict';
// Spotlight tutorial for the phone app: dims the page, highlights one element per step and
// shows a card above or below it. Steps whose element is not on screen yet (for example
// the label card before any photo is added) are shown centered. Exposes window.Tour.
(function () {
  const $ = (id) => document.getElementById(id);
  const PAD = 6;
  let steps = [], i = 0, onEnd = null, open = false;

  const visible = (el) => { const r = el && el.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0; };

  function place(target) {
    const spot = $('tourSpot'), card = $('tourCard'), root = $('tour');
    const vw = window.innerWidth, vh = window.innerHeight;
    const ch = card.offsetHeight;
    card.style.left = '12px';
    card.style.width = `${vw - 24}px`;
    if (!visible(target)) { // centered, no highlight
      root.classList.add('dim');
      card.style.top = Math.max(12, (vh - ch) / 2) + 'px';
      return;
    }
    root.classList.remove('dim');
    const r = target.getBoundingClientRect();
    spot.style.left = r.left - PAD + 'px';
    spot.style.top = r.top - PAD + 'px';
    spot.style.width = r.width + PAD * 2 + 'px';
    spot.style.height = r.height + PAD * 2 + 'px';
    // Card goes on whichever side of the highlight has more room.
    const below = vh - r.bottom - 12, above = r.top - 12;
    const top = below >= ch + 18 || below >= above ? r.bottom + 18 : r.top - ch - 18;
    card.style.top = Math.max(12, Math.min(top, vh - ch - 12)) + 'px';
  }

  function show() {
    const s = steps[i];
    $('tourStep').textContent = `Step ${i + 1} of ${steps.length}`;
    $('tourTitle').textContent = s.title;
    $('tourText').textContent = s.text;
    $('tourBack').hidden = i === 0;
    $('tourNext').textContent = i === steps.length - 1 ? (s.doneLabel || 'Done') : 'Next';
    $('tourSkip').hidden = i === steps.length - 1;
    const target = s.target ? document.querySelector(s.target) : null;
    if (visible(target)) target.scrollIntoView({ block: 'center' });
    $('tourSpot').classList.toggle('pulse', !!s.pulse);
    // Wait a frame so scrolling has settled before measuring.
    requestAnimationFrame(() => place(target));
    $('tourNext').focus({ preventScroll: true });
  }

  function end() {
    if (!open) return;
    open = false;
    $('tour').hidden = true;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', reflow);
    if (onEnd) onEnd();
  }
  const reflow = () => open && show();
  function go(d) { const n = i + d; if (n < 0) return; if (n >= steps.length) return end(); i = n; show(); }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); end(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  }

  function start(list, opts = {}) {
    if (open) return;
    steps = list; i = 0; onEnd = opts.onEnd || null; open = true;
    $('tour').hidden = false;
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', reflow);
    show();
  }

  $('tourNext').addEventListener('click', () => go(1));
  $('tourBack').addEventListener('click', () => go(-1));
  $('tourSkip').addEventListener('click', end);

  window.Tour = { start, isOpen: () => open };
})();
