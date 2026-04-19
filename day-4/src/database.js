/**
 * database.js — NEDB setup for all persistent collections.
 *
 * Day 4 adds two new collections to what Day 3 had:
 *
 *   users     — persistent user profiles (preferences survive across sessions)
 *   sessions  — one document per conversation, summarised by the LLM at session end
 *
 * Day 3 collections (kept as-is):
 *   leads     — captured contact details + sentiment analysis
 *   callbacks — callback requests with preferred time
 *
 * All four files are created automatically on first write.
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

export const leads = new Datastore({
  filename: join(DATA_DIR, 'leads.db'),
  autoload: true,
});

export const callbacks = new Datastore({
  filename: join(DATA_DIR, 'callbacks.db'),
  autoload: true,
});

// New in Day 4: persistent user profiles.
// Each user has a name, contact info, preferences, and a last session summary.
export const users = new Datastore({
  filename: join(DATA_DIR, 'users.db'),
  autoload: true,
});

// New in Day 4: one document per session, written by the LLM via end_session tool.
// The most recent summary is also cached on the users document as last_session_summary.
export const sessions = new Datastore({
  filename: join(DATA_DIR, 'sessions.db'),
  autoload: true,
});

/**
 * Insert a document and return it with the auto-generated _id.
 */
export function insert(collection, doc) {
  return new Promise((resolve, reject) => {
    collection.insert({ ...doc, createdAt: new Date().toISOString() }, (err, newDoc) => {
      if (err) { reject(err); } else { resolve(newDoc); }
    });
  });
}

/**
 * Update a document by query. Returns the number of updated docs.
 */
export function update(collection, query, changes) {
  return new Promise((resolve, reject) => {
    collection.update(query, { $set: changes }, {}, (err, count) => {
      if (err) { reject(err); } else { resolve(count); }
    });
  });
}

/**
 * Find the first document matching a query, or null if none exists.
 * Used for user lookups — we try phone, then email, then name.
 */
export function findOne(collection, query) {
  return new Promise((resolve, reject) => {
    collection.findOne(query, (err, doc) => {
      if (err) { reject(err); } else { resolve(doc); }
    });
  });
}

/**
 * Find all documents matching a query, sorted by createdAt descending.
 */
export function findAll(collection, query = {}) {
  return new Promise((resolve, reject) => {
    collection.find(query).sort({ createdAt: -1 }).exec((err, docs) => {
      if (err) { reject(err); } else { resolve(docs); }
    });
  });
}
