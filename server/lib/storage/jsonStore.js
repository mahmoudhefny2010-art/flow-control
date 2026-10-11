// Dev / demonstration storage engine.
// Persists the whole database to a single JSON file (data/db.json).
// Implements the same async interface as the MongoDB adapter so the rest
// of the application is storage-agnostic.
const fs = require('fs');
const path = require('path');

const COLLECTIONS = ['users', 'services', 'counters', 'tickets', 'feedback', 'notifications', 'settings', 'legacyState', 'auditLogs'];

function matchValue(docValue, cond) {
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    for (const [op, val] of Object.entries(cond)) {
      switch (op) {
        case '$eq': if (docValue !== val) return false; break;
        case '$ne': if (docValue === val) return false; break;
        case '$in': if (!val.includes(docValue)) return false; break;
        case '$nin': if (val.includes(docValue)) return false; break;
        case '$gt': if (!(docValue > val)) return false; break;
        case '$gte': if (!(docValue >= val)) return false; break;
        case '$lt': if (!(docValue < val)) return false; break;
        case '$lte': if (!(docValue <= val)) return false; break;
        case '$exists': if ((docValue !== undefined) !== !!val) return false; break;
        default: return false;
      }
    }
    return true;
  }
  if (Array.isArray(docValue) && Array.isArray(cond)) {
    return cond.every((c) => docValue.includes(c));
  }
  return docValue === cond;
}

function getPath(obj, dotted) {
  return dotted.split('.').reduce((acc, key) => (acc === undefined || acc === null ? undefined : acc[key]), obj);
}

function match(doc, filter = {}) {
  return Object.entries(filter).every(([key, cond]) => matchValue(getPath(doc, key), cond));
}

function applyUpdate(doc, update) {
  const next = JSON.parse(JSON.stringify(doc));
  for (const [op, fields] of Object.entries(update)) {
    for (const [field, value] of Object.entries(fields)) {
      const keys = field.split('.');
      let target = next;
      for (let i = 0; i < keys.length - 1; i += 1) {
        if (target[keys[i]] === undefined || target[keys[i]] === null) target[keys[i]] = {};
        target = target[keys[i]];
      }
      const last = keys[keys.length - 1];
      if (op === '$set') target[last] = value;
      else if (op === '$unset') delete target[last];
      else if (op === '$inc') target[last] = (target[last] || 0) + value;
      else if (op === '$push') {
        if (!Array.isArray(target[last])) target[last] = [];
        target[last].push(value);
      } else if (op === '$pull') {
        if (Array.isArray(target[last])) target[last] = target[last].filter((x) => x !== value);
      } else if (op === '$addToSet') {
        if (!Array.isArray(target[last])) target[last] = [];
        if (!target[last].some((x) => JSON.stringify(x) === JSON.stringify(value))) target[last].push(value);
      }
    }
  }
  return next;
}

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = null;
    this.writeTimer = null;
    this.ready = this.load();
  }

  async load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      this.data = JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.data = {};
      } else if (err instanceof SyntaxError) {
        throw new Error(`Dev data file contains invalid JSON: ${this.filePath}`, { cause: err });
      } else {
        throw err;
      }
    }
    for (const col of COLLECTIONS) {
      if (!Array.isArray(this.data[col])) this.data[col] = [];
    }
    return this;
  }

  persist() {
    // debounce writes
    clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.flush(), 50);
  }

  // Immediate synchronous write (used before process exit)
  flush() {
    clearTimeout(this.writeTimer);
    this.writeTimer = null;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error('[storage] failed to persist JSON store:', err.message);
    }
  }

  find(col, filter = {}, opts = {}) {
    let rows = this.data[col].filter((doc) => match(doc, filter));
    if (opts.sort) {
      const [[key, dir]] = Object.entries(opts.sort);
      rows = [...rows].sort((a, b) => {
        const va = getPath(a, key); const vb = getPath(b, key);
        if (va < vb) return dir === 1 ? -1 : 1;
        if (va > vb) return dir === 1 ? 1 : -1;
        return 0;
      });
    }
    if (opts.skip) rows = rows.slice(opts.skip);
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return Promise.resolve(JSON.parse(JSON.stringify(rows)));
  }

  findOne(col, filter = {}) {
    const doc = this.data[col].find((d) => match(d, filter));
    return Promise.resolve(doc ? JSON.parse(JSON.stringify(doc)) : null);
  }

  count(col, filter = {}) {
    return Promise.resolve(this.data[col].filter((doc) => match(doc, filter)).length);
  }

  insert(col, doc) {
    this.data[col].push(JSON.parse(JSON.stringify(doc)));
    this.persist();
    return Promise.resolve(JSON.parse(JSON.stringify(doc)));
  }

  update(col, filter, update, opts = {}) {
    const idx = this.data[col].findIndex((doc) => match(doc, filter));
    if (idx === -1) {
      if (opts.upsert) {
        const base = typeof filter === 'object' ? JSON.parse(JSON.stringify(filter)) : {};
        const doc = applyUpdate(base, update);
        // strip operator keys that may leak from filter (none here) and ensure _id
        if (!doc._id) doc._id = require('crypto').randomUUID();
        this.data[col].push(doc);
        this.persist();
        return Promise.resolve(JSON.parse(JSON.stringify(doc)));
      }
      return Promise.resolve(null);
    }
    const doc = applyUpdate(this.data[col][idx], update);
    this.data[col][idx] = doc;
    this.persist();
    return Promise.resolve(JSON.parse(JSON.stringify(doc)));
  }

  delete(col, filter = {}) {
    const before = this.data[col].length;
    this.data[col] = this.data[col].filter((doc) => !match(doc, filter));
    this.persist();
    return Promise.resolve({ deletedCount: before - this.data[col].length });
  }

  // Bulk helper used by the seeder
  async insertMany(col, docs) {
    for (const doc of docs) await this.insert(col, doc);
    return { insertedCount: docs.length };
  }

  async drop() {
    for (const col of COLLECTIONS) this.data[col] = [];
    this.flush();
    return true;
  }
}

module.exports = { JsonStore, COLLECTIONS };
