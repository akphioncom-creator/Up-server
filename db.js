// ডাটাবেস (SQLite): একটি ফাইলেই সব ডেটা থাকে, আলাদা ডাটাবেস সার্ভার লাগে না
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'smartcard.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'operator',   -- admin | operator
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS cards (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    unique_code    TEXT NOT NULL UNIQUE,   -- কিউআর কোডের সংখ্যা (সার্ভার তৈরি করে)
    client_id      TEXT UNIQUE,            -- অ্যাপের নিজস্ব id; একই ডেটা দুইবার পাঠালে ডুপ্লিকেট ঠেকায়
    nid            TEXT NOT NULL UNIQUE,
    name           TEXT NOT NULL,
    father_name    TEXT NOT NULL,
    mother_name    TEXT NOT NULL,
    phone          TEXT NOT NULL,
    dob            TEXT NOT NULL,          -- DD/MM/YYYY (০০ চলবে)
    age            INTEGER,
    age_text       TEXT NOT NULL DEFAULT '',
    gender         TEXT NOT NULL,
    marital_status TEXT NOT NULL,
    spouse_nid     TEXT NOT NULL DEFAULT '',
    occupation     TEXT NOT NULL,
    social_status  TEXT NOT NULL,
    ward           TEXT NOT NULL,
    village        TEXT NOT NULL,
    upazila        TEXT NOT NULL,
    district       TEXT NOT NULL,
    photo          TEXT NOT NULL DEFAULT '',   -- ছবির ফাইলের নাম (uploads ফোল্ডারে)
    created_at     TEXT NOT NULL,              -- কার্ড তৈরির তারিখ (ISO)
    updated_at     TEXT NOT NULL,
    created_by     INTEGER REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_cards_name  ON cards(name);
  CREATE INDEX IF NOT EXISTS idx_cards_phone ON cards(phone);
`);

module.exports = db;
