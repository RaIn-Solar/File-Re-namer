'use strict';
// Minimal spotlight tour: dims the page, highlights one element per step and
// shows a card next to it. Exposes window.Tour.
(function () {
  const $ = (id) => document.getElementById(id);
  const PAD = 6;
  let steps = [], i = 0, onEnd = null, open = false;

  function place(target) {
    const spot = $('tourSpot'), card = $('tourCard'), root = $('tour');
    const vw = window.innerWidth, vh = window.innerHeight;
    const cw = card.offsetWidth, ch = card.offsetHeight;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

    if (!target) {                       // centered, no highlight
      root.classList.add('dim');
      card.style.left = clamp((vw - cw) / 2, 12, vw) + 'px';
      card.style.top = clamp((vh - ch) / 2, 12, vh) + 'px';
      return;
    }
    root.classList.remove('dim');
    const r = target.getBoundingClientRect();
    spot.style.left = r.left - PAD + 'px';
    spot.style.top = r.top - PAD + 'px';
    spot.style.width = r.width + PAD * 2 + 'px';
    spot.style.height = r.height + PAD * 2 + 'px';

    let left, top;
    if (r.top < 120 && r.bottom + ch + 20 < vh) {                // top nav: card below, right-aligned
      left = r.right - cw; top = r.bottom + 18;
    } else if (r.left > vw * 0.55 && r.left - cw - 20 > 8) {          // target on the right: card to its left
      left = r.left - cw - 20; top = r.top;
    } else if (r.bottom + ch + 20 < vh) {                       // room below
      left = r.left; top = r.bottom + 18;
    } else if (r.top - ch - 20 > 8) {                           // room above
      left = r.left; top = r.top - ch - 18;
    } else {                                                    // fall back to the right side
      left = r.right + 20; top = r.top;
    }
    card.style.left = clamp(left, 12, vw - cw - 12) + 'px';
    card.style.top = clamp(top, 12, vh - ch - 12) + 'px';
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
    if (target) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    $('tourSpot').classList.toggle('pulse', !!s.pulse);
    place(target);
    $('tourNext').focus();
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
