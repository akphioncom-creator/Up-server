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
    area_type      TEXT NOT NULL DEFAULT '',   -- ইউনিয়ন | পৌরসভা
    area_name      TEXT NOT NULL DEFAULT '',   -- ইউনিয়ন/পৌরসভার নাম
    scanned_at     TEXT,                       -- অনুদানের কার্ড স্ক্যানের সময় (ISO); খালি (NULL) মানে এখনো স্ক্যান হয়নি
    ward           TEXT NOT NULL,
    village        TEXT NOT NULL,              -- এখন area_name-এর সমান (পুরোনো কোডের জন্য)
    upazila        TEXT NOT NULL,
    district       TEXT NOT NULL,
    photo          TEXT NOT NULL DEFAULT '',   -- ছবির ফাইলের নাম (uploads ফোল্ডারে)
    created_at     TEXT NOT NULL,              -- কার্ড তৈরির তারিখ (ISO)
    updated_at     TEXT NOT NULL,
    created_by     INTEGER REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_cards_name  ON cards(name);
  CREATE INDEX IF NOT EXISTS idx_cards_phone ON cards(phone);

  -- সার্ভারের ছোট সেটিংস: অ্যাপের বদলানো পাসওয়ার্ড (হ্যাশ করা) ও টোকেন সংস্করণ
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// আগে থেকে তৈরি ডাটাবেসে নতুন দুটি কলাম যোগ করা (নতুন ডাটাবেসে CREATE TABLE-ই যথেষ্ট; পুরোনো ডেটা মুছে যায় না)
const cardColumns = db.prepare('PRAGMA table_info(cards)').all().map((c) => c.name);
if (!cardColumns.includes('area_type')) {
  db.exec("ALTER TABLE cards ADD COLUMN area_type TEXT NOT NULL DEFAULT ''");
}
if (!cardColumns.includes('area_name')) {
  db.exec("ALTER TABLE cards ADD COLUMN area_name TEXT NOT NULL DEFAULT ''");
}
if (!cardColumns.includes('scanned_at')) {
  db.exec('ALTER TABLE cards ADD COLUMN scanned_at TEXT');
}

module.exports = db;
