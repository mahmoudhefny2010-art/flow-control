// Storage factory: MongoDB when MONGODB_URI is provided, otherwise the
// file-backed dev store (ideal for development with the mock API).
const path = require('path');
const config = require('../../config');
const { JsonStore } = require('./jsonStore');
const { MongoStore } = require('./mongoStore');

let storePromise = null;

async function createStore() {
  if (storePromise) return storePromise;
  storePromise = (async () => {
    if (config.mongoUri) {
      const mongo = new MongoStore(config.mongoUri);
      await mongo.connect();
      console.log('[storage] connected to MongoDB');
      return mongo;
    }
    const json = new JsonStore(config.dataFile);
    await json.ready;
    console.log(`[storage] using dev JSON store at ${path.relative(process.cwd(), config.dataFile) || config.dataFile}`);
    return json;
  })();
  return storePromise;
}

// Convenience accessors used across the app (after init)
async function db() {
  return createStore();
}

module.exports = { createStore, db };
