// লগইন ও টোকেন যাচাই (JWT)
const express = require('express');
const crypto = require('crypto');
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

// POST /api/auth/login  { "username": "...", "password": "..." }
router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'ইউজারনেম ও পাসওয়ার্ড দিন।' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  const ok = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);

  if (!user || !ok) {
    return res.status(401).json({ error: 'ইউজারনেম অথবা পাসওয়ার্ড ভুল।' });
  }

  const token = jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// ---------- অ্যাপের পাসওয়ার্ড-লগইন ----------
// অ্যাপ শুধু পাসওয়ার্ড পাঠায়। সঠিক পাসওয়ার্ড .env ফাইলের APP_PASSWORD এ রাখতে হয়।
// কার্ডের created_by ঘরের জন্য একটি আসল ইউজার লাগে, তাই 'app-user' নামে একটি ইউজার নিজে থেকে তৈরি হয়।
// ভূমিকা (role) .env এর APP_ROLE থেকে আসে (admin অথবা operator; না দিলে operator)। কার্ড মুছতে admin লাগে।
const appLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'অনেকবার চেষ্টা হয়েছে, ১৫ মিনিট পরে আবার চেষ্টা করুন।' },
});

// দুই পাসওয়ার্ডের দৈর্ঘ্য আলাদা হলেও সমান সময়ে তুলনা করার জন্য আগে হ্যাশ করা হয়
const sha256 = (text) => crypto.createHash('sha256').update(String(text)).digest();

// POST /api/auth/app-login  { "password": "..." }
router.post('/app-login', appLoginLimiter, (req, res) => {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    return res.status(503).json({ error: 'সার্ভারে APP_PASSWORD সেট করা নেই (.env ফাইল দেখুন)।' });
  }

  const { password } = req.body || {};
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'পাসওয়ার্ড দিন।' });
  }
  if (!crypto.timingSafeEqual(sha256(password), sha256(expected))) {
    return res.status(401).json({ error: 'পাসওয়ার্ড ভুল।' });
  }

  const role = process.env.APP_ROLE === 'admin' ? 'admin' : 'operator';
  const username = 'app-user';

  let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    // এই ইউজারের পাসওয়ার্ড কেউ জানে না (এলোমেলো); ঢোকা হয় শুধু উপরের APP_PASSWORD দিয়ে
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
      username,
      bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10),
      role
    );
    user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  } else if (user.role !== role) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
    user.role = role;
  }

  const token = jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// প্রতিটি সুরক্ষিত রাউটের আগে বসে: Authorization: Bearer <token>
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
