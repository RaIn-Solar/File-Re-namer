'use strict';
// "Limited memory" for multi-day jobs. Only the customer name and job name are
// stored (never photos, dates or paths). Capped so it can't grow without bound.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_JOBS = 50;
const clean = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const same = (a, b) => clean(a.customer).toLowerCase() === clean(b.customer).toLowerCase()
  && clean(a.jobName).toLowerCase() === clean(b.jobName).toLowerCase();

function createStore(file) {
  const read = () => {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return (Array.isArray(data) ? data : [])
        .filter((e) => e && e.id && clean(e.customer) && clean(e.jobName))
        .map((e) => ({ id: String(e.id), customer: clean(e.customer), jobName: clean(e.jobName) }));
    } catch { return []; }
  };
  const write = (list) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(list, null, 2));
  };

  // Saves (or updates) a job and moves it to the top. Passing the id of an existing
  // entry renames it in place; otherwise a job with the same names is reused.
  function remember({ id, customer, jobName }) {
    const job = { customer: clean(customer), jobName: clean(jobName) };
    if (!job.customer || !job.jobName) throw new Error('Customer and job name are required');
    let list = read();
    let entry = (id && list.find((e) => e.id === id)) || list.find((e) => same(e, job));
    if (entry) Object.assign(entry, job);
    else entry = { id: crypto.randomUUID(), ...job };
    list = [entry, ...list.filter((e) => e !== entry && !same(e, entry))].slice(0, MAX_JOBS);
    write(list);
    return { id: entry.id, list };
  }

  // Marks a job complete: deletes it from the saved data.
  function forget(id) {
    const list = read().filter((e) => e.id !== id);
    write(list);
    return list;
  }

  return { list: read, remember, forget };
}

module.exports = { createStore, MAX_JOBS };
