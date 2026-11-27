// ডাটাবেস (Supabase PostgreSQL): ক্লাউড ডাটাবেজ কানেকশন ও টেবিল সেটআপ
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('CRITICAL ERROR: DATABASE_URL environment variable is not set! Please set DATABASE_URL in Render Environment settings.');
}

// রেন্ডারের Environment Variable থেকে DATABASE_URL নিয়ে কানেক্ট করবে
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false } // ক্লাউড ডাটাবেজের সিকিউর কানেকশনের জন্য অত্যন্ত জরুরি
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// নিষ্ক্রিয় বা বিচ্ছিন্ন ক্লায়েন্টের কারণে আনহ্যান্ডেলড এরর থেকে সার্ভার ক্র্যাশ রোধ করবে
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
});

// ডাটাবেজ টেবিলগুলো ইনিশিয়ালাইজ করার ফাংশন
async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    console.error('Skipping initDatabase because DATABASE_URL is missing.');
    return;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'operator',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS cards (
        id             SERIAL PRIMARY KEY,
        unique_code    TEXT NOT NULL UNIQUE,
        client_id      TEXT UNIQUE,
        nid            TEXT NOT NULL UNIQUE,
        name           TEXT NOT NULL,
        father_name    TEXT NOT NULL,
        mother_name    TEXT NOT NULL,
        phone          TEXT NOT NULL,
        dob            TEXT NOT NULL,
        age            INTEGER,
        age_text       TEXT NOT NULL DEFAULT '',
        gender         TEXT NOT NULL,
        marital_status TEXT NOT NULL,
        spouse_nid     TEXT NOT NULL DEFAULT '',
        occupation     TEXT NOT NULL,
        social_status  TEXT NOT NULL,
        area_type      TEXT NOT NULL DEFAULT '',
        area_name      TEXT NOT NULL DEFAULT '',
        scanned_at     TIMESTAMPTZ,
        ward           TEXT NOT NULL,
        village        TEXT NOT NULL,
        upazila        TEXT NOT NULL,
        district       TEXT NOT NULL,
        photo          TEXT NOT NULL DEFAULT '',
        face_vector    BYTEA,
        created_at     TIMESTAMPTZ NOT NULL,
        updated_at     TIMESTAMPTZ NOT NULL,
        created_by     INTEGER REFERENCES users(id)
      );

      CREATE INDEX IF NOT EXISTS idx_cards_name  ON cards(name);
      CREATE INDEX IF NOT EXISTS idx_cards_phone ON cards(phone);

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // পুরোনো DB তে face_vector কলাম না থাকলে যোগ করা (ALTER TABLE)
    await pool.query(`
      ALTER TABLE cards ADD COLUMN IF NOT EXISTS face_vector BYTEA;
    `);

    console.log('Supabase PostgreSQL database tables initialized successfully!');
  } catch (err) {
    console.error('Error initializing database tables:', err);
  }
}

const ready = initDatabase();

// মডিউল হিসেবে query, pool এবং ready এক্সপোর্ট করা হলো যাতে সব ফাইল থেকে সহজে ব্যবহার করা যায়
module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  ready,
};
