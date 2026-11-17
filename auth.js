// লগইন ও টোকেন যাচাই (JWT) + অ্যাপের পাসওয়ার্ড-ভিত্তিক লগইন + পাসওয়ার্ড বদলানো
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const router = express.Router();

// ডামি হ্যাশ: ইউজার না থাকলেও একই সময় লাগে, তাই কে আছে কে নেই তা সময় মেপে বোঝা যায় না
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'অনেকবার চেষ্টা হয়েছে, ১৫ মিনিট পরে আবার চেষ্টা করুন।' },
});

// অ্যাপের জন্য হালকা লিমিট (পাসওয়ার্ড ব্রুটফোর্স ঠেকাতে)
const appLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'অনেকবার চেষ্টা হয়েছে, একটু পরে আবার চেষ্টা করুন।' },
});

// টোকেন তৈরি (একই ফরম্যাট সব লগইনে)
function makeToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// ---------- ইউজারনেম+পাসওয়ার্ড লগইন (অ্যাডমিন/অপারেটরের জন্য) ----------

// POST /api/auth/login  { "username": "...", "password": "..." }
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: 'ইউজারনেম ও পাসওয়ার্ড দিন।' });
    }

    // PostgreSQL: async/await + $1 প্লেসহোল্ডার
    const result = await db.query('SELECT * FROM users WHERE username = $1', [username.trim()]);
    const user = result.rows[0];
    const ok = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);

    if (!user || !ok) {
      return res.status(401).json({ error: 'ইউজারনেম অথবা পাসওয়ার্ড ভুল।' });
    }

    const token = makeToken(user);
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'লগইন করা যায়নি।' });
  }
});

// ---------- অ্যাপের জন্য শুধু পাসওয়ার্ড-ভিত্তিক লগইন ----------
// অ্যাপ শুধু একটি পাসওয়ার্ড পাঠায়; সার্ভার সেই পাসওয়ার্ড মিলিয়ে টোকেন দেয়।
// পাসওয়ার্ড কোথায় রাখা হয়: settings টেবিলে key='app_password_hash' এ bcrypt হ্যাশ।
// প্রথমবার চালালে (কোনো হ্যাশ না থাকলে) APP_PASSWORD env থেকে হ্যাশ তৈরি করে সেভ করে।
async function getOrInitAppPasswordHash() {
  const r = await db.query("SELECT value FROM settings WHERE key = 'app_password_hash'");
  if (r.rows.length > 0) return r.rows[0].value;

  const initial = process.env.APP_PASSWORD;
  if (!initial) return null;

  const hash = bcrypt.hashSync(initial, 10);
  await db.query(
    "INSERT INTO settings (key, value) VALUES ('app_password_hash', $1) ON CONFLICT (key) DO NOTHING",
    [hash]
  );
  const again = await db.query("SELECT value FROM settings WHERE key = 'app_password_hash'");
  return again.rows[0] ? again.rows[0].value : null;
}

// অ্যাপ লগইনে টোকেনে যে "user" বসবে — সাধারণত operator রোলের একটি ভার্চুয়াল ইউজার
// (ডেটাবেজে operator ইউজার না থাকলে null থাকবে; requireAuth শুধু token যাচাই করে, DB লুকআপ করে না)
const APP_USER = { id: 0, username: 'app', role: 'operator' };

// POST /api/auth/app-login  { "password": "..." }
router.post('/app-login', appLoginLimiter, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'পাসওয়ার্ড দিন।' });
    }

    const storedHash = await getOrInitAppPasswordHash();
    const ok = bcrypt.compareSync(password, storedHash || DUMMY_HASH);

    if (!storedHash || !ok) {
      return res.status(401).json({ error: 'পাসওয়ার্ড ভুল।' });
    }

    const token = jwt.sign(
      { sub: APP_USER.id, username: APP_USER.username, role: APP_USER.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    res.json({ token, user: APP_USER });
  } catch (err) {
    console.error('app-login error:', err);
    res.status(500).json({ error: 'লগইন করা যায়নি।' });
  }
});

// ---------- প্রতিটি সুরক্ষিত রাউটের আগে বসে ----------
// Authorization: Bearer <token>
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'লগইন করা প্রয়োজন।' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, username: payload.username, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'টোকেন সঠিক নয় অথবা মেয়াদ শেষ, আবার লগইন করুন।' });
  }
}

// ---------- বর্তমান পাসওয়ার্ড যাচাই (পাসওয়ার্ড বদলানোর আগে) ----------
// POST /api/auth/verify-password  { "password": "..." }
router.post('/verify-password', requireAuth, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'পাসওয়ার্ড দিন।' });
    }

    const storedHash = await getOrInitAppPasswordHash();
    const ok = bcrypt.compareSync(password, storedHash || DUMMY_HASH);
    if (!storedHash || !ok) {
      return res.status(401).json({ error: 'পাসওয়ার্ড ভুল।' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('verify-password error:', err);
    res.status(500).json({ error: 'পাসওয়ার্ড যাচাই করা যায়নি।' });
  }
});

// ---------- পাসওয়ার্ড বদলানো ----------
// POST /api/auth/change-password  { "currentPassword": "...", "newPassword": "..." }
// নতুন পাসওয়ার্ডের হ্যাশ settings টেবিলে সেভ হয়, এবং নতুন টোকেন ফেরত যায়।
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || !currentPassword) {
      return res.status(400).json({ error: 'বর্তমান পাসওয়ার্ড দিন।' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ error: 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।' });
    }

    const storedHash = await getOrInitAppPasswordHash();
    const ok = bcrypt.compareSync(currentPassword, storedHash || DUMMY_HASH);
    if (!storedHash || !ok) {
      return res.status(401).json({ error: 'বর্তমান পাসওয়ার্ড ভুল।' });
    }

    const newHash = bcrypt.hashSync(newPassword, 10);
    await db.query(
      "INSERT INTO settings (key, value) VALUES ('app_password_hash', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [newHash]
    );

    // নতুন টোকেন (একই APP_USER দিয়ে) — অ্যাপ আগের টোকেন বদলে নেবে
    const token = jwt.sign(
      { sub: APP_USER.id, username: APP_USER.username, role: APP_USER.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    res.json({ ok: true, token });
  } catch (err) {
    console.error('change-password error:', err);
    res.status(500).json({ error: 'পাসওয়ার্ড বদলানো যায়নি।' });
  }
});

// নির্দিষ্ট ভূমিকা (যেমন admin) ছাড়া ঢুকতে না দেওয়া
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: 'এই কাজের অনুমতি আপনার নেই।' });
    }
    next();
  };
}

module.exports = { router, requireAuth, requireRole };