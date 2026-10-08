'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitize, planNames, summarizeDates } = require('../src/naming');
const cfg = require('../config.default.json');

const photo = (o) => ({ id: o.id, ext: '.JPG', include: true, takenDate: '2026-10-08', sortKey: o.id, ...o });

test('sanitize strips illegal characters and spaces', () => {
  assert.equal(sanitize('  Smith, John / Jr.  '), 'Smith,-John-Jr');
  assert.equal(sanitize('Café Núñez'), 'Cafe-Nunez');
  assert.equal(sanitize(''), '');
});

test('same object, different purpose gets different names', () => {
  const { plans } = planNames([
    photo({ id: 'a', category: 'sales-walkthrough', area: 'Roof' }),
    photo({ id: 'b', category: 'inspection', area: 'Roof' }),
  ], { customer: 'Smith John', jobName: 'Roof Replacement' }, cfg.categories);
  assert.equal(plans[0].newName, 'Smith-John_Roof-Replacement_2026-10-08_SalesWalk_Roof_001.jpg');
  assert.equal(plans[1].newName, 'Smith-John_Roof-Replacement_2026-10-08_Inspection_Roof_001.jpg');
});

test('sequence numbers are per date/category/area, ordered by capture time', () => {
  const { plans } = planNames([
    photo({ id: 'z', sortKey: '1', category: 'inspection', area: 'Meter' }),
    photo({ id: 'y', sortKey: '2', category: 'inspection', area: 'Meter' }),
    photo({ id: 'x', sortKey: '3', category: 'inspection', area: 'Meter', dateOverride: '2026-10-09' }),
  ], { customer: 'A', jobName: 'J' }, cfg.categories);
  assert.deepEqual(plans.map((p) => [p.id, p.newName]), [
    ['z', 'A_J_2026-10-08_Inspection_Meter_001.jpg'],
    ['y', 'A_J_2026-10-08_Inspection_Meter_002.jpg'],
    ['x', 'A_J_2026-10-09_Inspection_Meter_001.jpg'],
  ]);
});

test('missing category / date / customer are reported, not guessed', () => {
  const r = planNames([
    photo({ id: 'a' }),
    photo({ id: 'b', category: 'inspection', takenDate: null }),
  ], { customer: 'A', jobName: 'J' }, cfg.categories);
  assert.deepEqual(r.problems.map((p) => p.reason), ['No category chosen', 'No date']);
  assert.equal(planNames([photo({ id: 'c', category: 'inspection' })], { customer: '', jobName: 'J' }, cfg.categories).problems[0].reason, 'No customer name');
  assert.equal(planNames([photo({ id: 'c', category: 'inspection' })], { customer: 'A', jobName: ' ' }, cfg.categories).problems[0].reason, 'No job name');
});

test('excluded photos are skipped; date summary flags non-visit dates', () => {
  const ps = [photo({ id: 'a', include: false }), photo({ id: 'b' }), photo({ id: 'c', dateOverride: '2026-10-01' })];
  assert.equal(planNames(ps, { customer: 'A', jobName: 'J' }, cfg.categories).plans.length + 0, 0); // none have categories
  const s = summarizeDates(ps, '2026-10-08');
  assert.deepEqual(s, [
    { date: '2026-10-01', count: 1, matchesExpected: false },
    { date: '2026-10-08', count: 1, matchesExpected: true },
  ]);
});
