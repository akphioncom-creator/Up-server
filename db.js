// ডাটাবেস (Supabase PostgreSQL): ক্লাউড ডাটাবেজ কানেকশন ও টেবিল সেটআপ
const { Pool } = require('pg');

// রেন্ডারের Environment Variable থেকে DATABASE_URL নিয়ে কানেক্ট করবে
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // ক্লাউড ডাটাবেজের সিকিউর কানেকশনের জন্য প্রয়োজন
  }
});

// ডাটাবেজ টেবিলগুলো ইনিশিয়ালাইজ করার ফাংশন
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
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
    console.log('Supabase PostgreSQL database tables initialized successfully!');
  } catch (err) {
    console.error('Error initializing database tables:', err);
  } finally {
    client.release();
  }
}

initDatabase();

module.exports = pool;
