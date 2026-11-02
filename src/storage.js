import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';

const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/data' : path.join(process.cwd(), 'data'));
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function clean(str) {
  return (str || '').replace(/^\uFEFF/, '').trim();
}

const MONGO_URI = clean(process.env.MONGO_URI);

let mongoPromise = null;

async function getCollection() {
  if (!MONGO_URI) return null;
  try {
    if (!mongoPromise) {
      const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
      mongoPromise = client.connect().then(c => c.db('ytbot').collection('users'));
    }
    return await mongoPromise;
  } catch (err) {
    console.warn('MongoDB connection fallback:', err.message);
    return null;
  }
}

try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (err) {}

function loadLocalUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return {};
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch (err) {
    return {};
  }
}

function persistLocalUsers(users) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
  } catch (err) {}
}

export async function getUser(userId) {
  const col = await getCollection();
  if (col) {
    try {
      const doc = await col.findOne({ userId: String(userId) });
      if (doc) return doc;
    } catch (e) {
      console.warn('MongoDB getUser error:', e.message);
    }
  }
  const users = loadLocalUsers();
  return users[String(userId)] || null;
}

export async function saveUser(userId, data) {
  const col = await getCollection();
  const updatePayload = {
    ...data,
    userId: String(userId),
    updatedAt: new Date().toISOString()
  };

  if (col) {
    try {
      await col.updateOne(
        { userId: String(userId) },
        { $set: updatePayload },
        { upsert: true }
      );
    } catch (e) {
      console.warn('MongoDB saveUser error:', e.message);
    }
  }

  // Also sync to local file
  const users = loadLocalUsers();
  users[String(userId)] = {
    ...(users[String(userId)] || {}),
    ...updatePayload
  };
  persistLocalUsers(users);

  return users[String(userId)];
}

export async function deleteUser(userId) {
  const col = await getCollection();
  if (col) {
    try {
      await col.deleteOne({ userId: String(userId) });
    } catch (e) {}
  }
  const users = loadLocalUsers();
  if (users[String(userId)]) {
    delete users[String(userId)];
    persistLocalUsers(users);
    return true;
  }
  return false;
}
