// ডাটাবেস (SQLite): একটি ফাইলেই সব ডেটা থাকে, আলাদা ডাটাবেস সার্ভার লাগে না
// শুধু কার্ডের তথ্য (ও ব্যক্তির ছবির ফাইল) রাখা হয়; তৈরি করা কার্ডের ছবি (PNG) সার্ভারে রাখা হয় না
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
    nid            TEXT NOT NULL,          -- সক্রিয় কার্ডের মধ্যে ইউনিক (নিচের ইনডেক্স দেখুন)
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
    photo          TEXT NOT NULL DEFAULT '',   -- ব্যক্তির ছবির ফাইলের নাম (uploads ফোল্ডারে)
    created_at     TEXT NOT NULL,              -- কার্ড তৈরির তারিখ (ISO)
    updated_at     TEXT NOT NULL,
    created_by     INTEGER REFERENCES users(id),
    deleted_at     TEXT,                       -- মুছলে আসল ডেটা মোছা হয় না, শুধু এখানে সময় বসে (সফট ডিলিট)
    deleted_by     INTEGER REFERENCES users(id)
  );

  -- একই এনআইডি দুটি সক্রিয় কার্ডে থাকতে পারবে না; মুছে ফেলা কার্ডের এনআইডি আবার ব্যবহার করা যাবে
  CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_nid_active ON cards(nid) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_cards_name  ON cards(name);
  CREATE INDEX IF NOT EXISTS idx_cards_phone ON cards(phone);

  -- ইতিহাস: কার্ডের জীবনে কখন কী হলো (তৈরি, বদল, সেভ, যাচাই, মোছা...)। কখনো মোছা বা বদলানো হয় না
  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id     INTEGER,                  -- ইচ্ছাকৃতভাবে FOREIGN KEY নেই, যাতে কার্ড হারালেও ইতিহাস থাকে
    unique_code TEXT NOT NULL,
    action      TEXT NOT NULL,
    actor_id    INTEGER,
    actor_name  TEXT,                     -- কে করেছে (লগইন করা ইউজার); কিউআর যাচাইয়ে খালি
    details     TEXT,                     -- JSON: কী কী বদলেছে ইত্যাদি
    ip          TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_events_code ON events(unique_code, id);
  CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at);
`);

module.exports = db;
