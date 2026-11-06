// লগইন ও টোকেন যাচাই (JWT)
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
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

// ---------- অ্যাপের পাসওয়ার্ড-লগইন ----------
// অ্যাপ শুধু একটি পাসওয়ার্ড পাঠায়; পাসওয়ার্ড ঠিক আছে কিনা সার্ভার ঠিক করে (.env এর APP_PASSWORD)
// সঠিক হলে সার্ভার একটি টোকেন দেয়, যা দিয়ে অ্যাপ বাকি সব কাজ (কার্ড পাঠানো, তালিকা দেখা) করে
const APP_USERNAME = 'app-device';

// অ্যাপের জন্য একটি নির্দিষ্ট ইউজার ডাটাবেসে থাকা দরকার (কে কার্ড বানাল তা ইতিহাসে লেখার জন্য)
// এর পাসওয়ার্ড এলোমেলো, তাই এই ইউজার দিয়ে সাধারণ /login এ ঢোকা সম্ভব নয়
let appUser = db.prepare('SELECT * FROM users WHERE username = ?').get(APP_USERNAME);
if (!appUser) {
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
    APP_USERNAME,
    bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10),
    'operator'
  );
  appUser = db.prepare('SELECT * FROM users WHERE username = ?').get(APP_USERNAME);
}

if (!process.env.APP_PASSWORD) {
  console.warn('সতর্কতা: .env এ APP_PASSWORD নেই, তাই ডিফল্ট পাসওয়ার্ড 1234 চলছে।');
}

// সময় মেপে পাসওয়ার্ড আন্দাজ করা ঠেকাতে সমান-সময়ের তুলনা
const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

// ভুল পাসওয়ার্ডের চেষ্টা সীমিত (সফল লগইন গোনা হয় না)
const appLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'অনেকবার ভুল পাসওয়ার্ড দেওয়া হয়েছে, ১৫ মিনিট পরে আবার চেষ্টা করুন।' },
});

// POST /api/auth/app-login  { "password": "1234" }
router.post('/app-login', appLoginLimiter, (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'পাসওয়ার্ড দিন।' });
  }

  const expected = process.env.APP_PASSWORD || '1234';
  if (!safeEqual(password.trim(), expected)) {
    return res.status(401).json({ error: 'পাসওয়ার্ড ভুল হয়েছে।' });
  }

  const token = jwt.sign(
    { sub: appUser.id, username: appUser.username, role: appUser.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  res.json({ token, user: { id: appUser.id, username: appUser.username, role: appUser.role } });
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
