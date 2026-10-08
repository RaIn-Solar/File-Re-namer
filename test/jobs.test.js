'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, MAX_JOBS } = require('../src/jobs');

const store = () => createStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jpo-jobs-')), 'saved-jobs.json'));

test('remembers a job and lists it, most recent first', () => {
  const s = store();
  s.remember({ customer: 'Smith John', jobName: 'Roof' });
  s.remember({ customer: 'Jones', jobName: 'Inverter swap' });
  assert.deepEqual(s.list().map((j) => j.customer), ['Jones', 'Smith John']);
});

test('the same customer + job (any case/spacing) is reused, not duplicated, and moves to the top', () => {
  const s = store();
  const a = s.remember({ customer: 'Smith John', jobName: 'Roof' });
  s.remember({ customer: 'Jones', jobName: 'X' });
  const again = s.remember({ customer: '  smith   john ', jobName: 'ROOF' });
  assert.equal(again.id, a.id);
  assert.equal(s.list().length, 2);
  assert.equal(s.list()[0].id, a.id);
});

test('passing an id renames in place', () => {
  const s = store();
  const a = s.remember({ customer: 'Smith', jobName: 'Roof' });
  s.remember({ id: a.id, customer: 'Smith John', jobName: 'Roof' });
  assert.deepEqual(s.list().map((j) => [j.id, j.customer]), [[a.id, 'Smith John']]);
});

test('only names are stored - no dates, paths or photos', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jpo-jobs-')), 's.json');
  createStore(file).remember({ customer: 'A', jobName: 'B', visitDate: '2026-01-01', uploadRoot: '/x', photos: [1] });
  const [e] = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(e).sort(), ['customer', 'id', 'jobName']);
});

test('marking complete deletes the saved data', () => {
  const s = store();
  const a = s.remember({ customer: 'A', jobName: 'B' });
  const b = s.remember({ customer: 'C', jobName: 'D' });
  assert.deepEqual(s.forget(a.id).map((j) => j.id), [b.id]);
  assert.equal(s.list().length, 1);
  assert.deepEqual(s.forget('nope').length, 1);
});

test('memory is capped and blank names are rejected', () => {
  const s = store();
  for (let i = 0; i < MAX_JOBS + 5; i++) s.remember({ customer: 'C' + i, jobName: 'J' });
  assert.equal(s.list().length, MAX_JOBS);
  assert.equal(s.list()[0].customer, 'C' + (MAX_JOBS + 4));
  assert.throws(() => s.remember({ customer: 'x', jobName: ' ' }));
});

test('a corrupt or missing file reads as empty', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jpo-jobs-')), 's.json');
  assert.deepEqual(createStore(file).list(), []);
  fs.writeFileSync(file, '{oops');
  assert.deepEqual(createStore(file).list(), []);
});
