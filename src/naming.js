'use strict';
// Pure naming logic: no filesystem access, so it is easy to test.

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;

function sanitize(text) {
  return String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(ILLEGAL, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

function pad(n, width = 3) {
  return String(n).padStart(width, '0');
}

// Effective date (YYYY-MM-DD) for a photo: manual override wins, then the
// camera date, then the file-modified date.
function effectiveDate(photo) {
  return photo.dateOverride || photo.takenDate || null;
}

// Plans the final file name for every included photo.
//   photos: [{ id, ext, category (category id), area, takenDate, dateOverride, include, sortKey }]
//   job:    { customer, jobName }
//   categories: config categories
// Returns [{ id, newName, folder, date, categoryLabel }] and problems[] describing
// photos that cannot be named yet.
function planNames(photos, job, categories) {
  const catById = new Map(categories.map((c) => [c.id, c]));
  const customer = sanitize(job.customer);
  const jobName = sanitize(job.jobName);
  const problems = [];
  const plans = [];
  const counters = new Map();

  const ordered = photos
    .filter((p) => p.include !== false)
    .sort((a, b) => (a.sortKey || '').localeCompare(b.sortKey || '') || String(a.id).localeCompare(String(b.id)));

  for (const p of ordered) {
    const cat = catById.get(p.category);
    const date = effectiveDate(p);
    if (!cat) { problems.push({ id: p.id, reason: 'No category chosen' }); continue; }
    if (!date) { problems.push({ id: p.id, reason: 'No date' }); continue; }
    if (!customer) { problems.push({ id: p.id, reason: 'No customer name' }); continue; }
    if (!jobName) { problems.push({ id: p.id, reason: 'No job name' }); continue; }

    const area = sanitize(p.area);
    const groupKey = [date, cat.id, area].join('|');
    const seq = (counters.get(groupKey) || 0) + 1;
    counters.set(groupKey, seq);

    const parts = [customer, jobName, date, cat.short || sanitize(cat.label), area, pad(seq)].filter(Boolean);
    plans.push({
      id: p.id,
      newName: parts.join('_') + String(p.ext || '').toLowerCase(),
      folder: sanitize(cat.label),
      date,
      categoryLabel: cat.label,
    });
  }
  return { plans, problems };
}

// Summarises the dates in a batch so the user can confirm them.
function summarizeDates(photos, expectedDate) {
  const counts = new Map();
  for (const p of photos) {
    if (p.include === false) continue;
    const d = effectiveDate(p) || 'unknown';
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  const rows = [...counts.entries()].sort().map(([date, count]) => ({
    date, count, matchesExpected: !expectedDate || date === expectedDate,
  }));
  return rows;
}

module.exports = { sanitize, pad, effectiveDate, planNames, summarizeDates };
