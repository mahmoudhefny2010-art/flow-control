// MongoDB adapter. Exposes the same async interface as JsonStore.
// Activated when MONGODB_URI is set in the environment.
const { MongoClient } = require('mongodb');
const { COLLECTIONS } = require('./jsonStore');

class MongoStore {
  constructor(uri, dbName = 'miu_queueflow') {
    this.client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    this.dbName = dbName;
    this.db = null;
  }

  async connect() {
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    const cols = await this.db.listCollections().toArray();
    const names = new Set(cols.map((c) => c.name));
    for (const col of COLLECTIONS) {
      if (!names.has(col)) await this.db.createCollection(col);
    }
    return this;
  }

  col(name) {
    return this.db.collection(name);
  }

  find(c, filter = {}, opts = {}) {
    let cursor = this.col(c).find(filter);
    if (opts.sort) cursor = cursor.sort(opts.sort);
    if (opts.skip) cursor = cursor.skip(opts.skip);
    if (opts.limit) cursor = cursor.limit(opts.limit);
    return cursor.toArray();
  }

  findOne(c, filter = {}) {
    return this.col(c).findOne(filter);
  }

  count(c, filter = {}) {
    return this.col(c).countDocuments(filter);
  }

  insert(c, doc) {
    return this.col(c).insertOne(doc).then(() => doc);
  }

  async insertMany(c, docs) {
    if (!docs.length) return { insertedCount: 0 };
    const res = await this.col(c).insertMany(docs, { ordered: false });
    return { insertedCount: res.insertedCount };
  }

  update(c, filter, update, opts = {}) {
    return this.col(c).findOneAndUpdate(filter, update, {
      upsert: !!opts.upsert,
      returnDocument: 'after',
    });
  }

  delete(c, filter = {}) {
    return this.col(c).deleteMany(filter);
  }

  async drop() {
    for (const col of COLLECTIONS) await this.col(col).deleteMany({});
    return true;
  }

  async close() {
    await this.client.close();
  }
}

module.exports = { MongoStore };
