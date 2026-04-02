/**
 * database.js — NEDB setup for lead and callback persistence.
 *
 * NEDB is an embedded NoSQL database — no server, no Docker, no setup.
 * Data is stored in plain files on disk and loaded into memory on startup.
 * The API is intentionally similar to MongoDB, so the patterns transfer directly.
 *
 * Two collections:
 *   leads     — captured contact details + sentiment analysis
 *   callbacks — callback requests with preferred time
 *
 * Both files are created automatically on first write.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';
import Datastore from '@seald-io/nedb';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = join(__dirname, '../data');

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// Each Datastore maps to a file on disk.
// autoload: true — loads the file into memory when first accessed.
export const leads = new Datastore({
  filename: join(DATA_DIR, 'leads.db'),
  autoload: true,
});

export const callbacks = new Datastore({
  filename: join(DATA_DIR, 'callbacks.db'),
  autoload: true,
});

/**
 * Insert a document and return it with the auto-generated _id.
 * Wraps NEDB's callback-style API in a Promise.
 */
export function insert(collection, doc) {
  return new Promise((resolve, reject) => {
    collection.insert({ ...doc, createdAt: new Date().toISOString() }, (err, newDoc) => {
      if (err) {
        reject(err);
      } else {
        resolve(newDoc);
      }
    });
  });
}

/**
 * Update a document by query. Returns the number of updated docs.
 */
export function update(collection, query, changes) {
  return new Promise((resolve, reject) => {
    collection.update(query, { $set: changes }, {}, (err, count) => {
      if (err) {
        reject(err);
      } else {
        resolve(count);
      }
    });
  });
}

/**
 * Find all documents matching a query, sorted by createdAt descending.
 */
export function findAll(collection, query = {}) {
  return new Promise((resolve, reject) => {
    collection.find(query).sort({ createdAt: -1 }).exec((err, docs) => {
      if (err) {
        reject(err);
      } else {
        resolve(docs);
      }
    });
  });
}
