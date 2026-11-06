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
// অ্যাপে শুধু পাসওয়ার্ড জানা লোকই ঢুকতে পারে, তাই যে ঢুকবে সে পূর্ণ অনুমতি (admin) পাবে:
// কার্ড মুছতে ও পারসন লিস্টের রিস্টার্ট করতে আলাদা কোনো অ্যাডমিন লাগে না।
const appLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'অনেকবার চেষ্টা হয়েছে, ১৫ মিনিট পরে আবার চেষ্টা করুন।' },
});

// দুই পাসওয়ার্ডের দৈর্ঘ্য আলাদা হলেও সমান সময়ে তুলনা করার জন্য আগে হ্যাশ করা হয়
const sha256 = (text) => crypto.createHash('sha256').update(String(text)).digest();

// ---------- অ্যাপের পাসওয়ার্ডের সংরক্ষণ ----------
// অ্যাপ থেকে পাসওয়ার্ড একবার বদলালে নতুন পাসওয়ার্ডের হ্যাশ ডাটাবেসের settings টেবিলে থাকে, তখন থেকে সেটাই চলে।
// একবারও না বদলালে .env এর APP_PASSWORD চলে। (পাসওয়ার্ড কখনো সাধারণ লেখায় জমা থাকে না)
const PASSWORD_MIN = 4;
const PASSWORD_MAX = 72; // bcrypt এর সীমা

const getSetting = (key) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
};
const setSetting = (key, value) =>
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));

// টোকেন সংস্করণ: পাসওয়ার্ড বদলালে বাড়ে, ফলে আগের সব ফোনের পুরোনো টোকেন অচল হয়ে যায় (আবার নতুন পাসওয়ার্ডে ঢুকতে হয়)
const getTokenVersion = () => parseInt(getSetting('token_version') || '0', 10) || 0;

// দেওয়া পাসওয়ার্ড বর্তমান অ্যাপ-পাসওয়ার্ডের সাথে মেলে কিনা; কোনো পাসওয়ার্ডই সেট না থাকলে null
function checkAppPassword(password) {
  const savedHash = getSetting('app_password_hash');
  if (savedHash) return bcrypt.compareSync(password, savedHash);

  const expected = process.env.APP_PASSWORD;
  if (!expected) return null;
  return crypto.timingSafeEqual(sha256(password), sha256(expected));
}

// 'app-user' ইউজার বের করা (না থাকলে তৈরি); কার্ডের created_by এর জন্য একটি আসল ইউজার লাগে
function getAppUser() {
  const role = 'admin';
  const username = 'app-user';

  let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    // এই ইউজারের পাসওয়ার্ড কেউ জানে না (এলোমেলো); ঢোকা হয় শুধু অ্যাপের পাসওয়ার্ড দিয়ে
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
  return user;
}

const signAppToken = (user) =>
  jwt.sign(
    { sub: user.id, username: user.username, role: user.role, ver: getTokenVersion() },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

// পাসওয়ার্ড যাচাই/বদলের চেষ্টাও সীমিত: কেউ ফোন হাতে পেয়ে পাসওয়ার্ড আন্দাজ করতে না পারে
const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'অনেকবার চেষ্টা হয়েছে, ১৫ মিনিট পরে আবার চেষ্টা করুন।' },
});

// POST /api/auth/app-login  { "password": "..." }
router.post('/app-login', appLoginLimiter, (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'পাসওয়ার্ড দিন।' });
  }

  const ok = checkAppPassword(password);
  if (ok === null) {
    return res.status(503).json({ error: 'সার্ভারে APP_PASSWORD সেট করা নেই (.env ফাইল দেখুন)।' });
  }
  if (!ok) {
    return res.status(401).json({ error: 'পাসওয়ার্ড ভুল।' });
  }

  const user = getAppUser();
  res.json({ token: signAppToken(user), user: { id: user.id, username: user.username, role: user.role } });
});

// POST /api/auth/verify-password  { "password": "..." } — লগইন করা অবস্থায় বর্তমান পাসওয়ার্ড ঠিক কিনা যাচাই
// ভুল হলে 401 নয়, 403 দেওয়া হয়: অ্যাপ 401 পেলে মনে করে টোকেনের মেয়াদ শেষ এবং লগইন পাতায় ফিরে যায়
// (পাসওয়ার্ড বদলের পাতায় "বর্তমান পাসওয়ার্ড" মিললে তবেই নতুন পাসওয়ার্ডের ঘর দেখানো হয়)
router.post('/verify-password', passwordLimiter, requireAuth, (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'বর্তমান পাসওয়ার্ড দিন।' });
  }
  if (!checkAppPassword(password)) {
    return res.status(403).json({ error: 'বর্তমান পাসওয়ার্ড ভুল।' });
  }
  res.json({ ok: true });
});

// POST /api/auth/change-password  { "currentPassword": "...", "newPassword": "..." }
// বর্তমান পাসওয়ার্ড সার্ভারে আবার যাচাই হয়। সফল হলে নতুন পাসওয়ার্ড সংরক্ষণ হয়,
// অন্য সব ফোনের পুরোনো টোকেন বাতিল হয়, আর এই ফোনের জন্য নতুন টোকেন ফেরত আসে (ফলে এই ফোনে আবার লগইন লাগে না)
router.post('/change-password', passwordLimiter, requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
    return res.status(400).json({ error: 'বর্তমান ও নতুন পাসওয়ার্ড দিন।' });
  }
  if (!checkAppPassword(currentPassword)) {
    return res.status(403).json({ error: 'বর্তমান পাসওয়ার্ড ভুল।' });
  }
  if (newPassword.length < PASSWORD_MIN) {
    return res.status(400).json({ error: `নতুন পাসওয়ার্ড কমপক্ষে ${PASSWORD_MIN} অক্ষরের হতে হবে।` });
  }
  if (newPassword.length > PASSWORD_MAX) {
    return res.status(400).json({ error: `নতুন পাসওয়ার্ড সর্বোচ্চ ${PASSWORD_MAX} অক্ষরের হতে পারে।` });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'নতুন পাসওয়ার্ড বর্তমানটির মতো হতে পারবে না।' });
  }

  // হ্যাশ সংরক্ষণ ও টোকেন সংস্করণ বাড়ানো একসাথে, মাঝপথে থেমে গেলে কোনোটাই অর্ধেক থাকবে না
  const save = db.transaction(() => {
    setSetting('app_password_hash', bcrypt.hashSync(newPassword, 10));
    setSetting('token_version', getTokenVersion() + 1);
  });
  save();

  const user = getAppUser();
  res.json({ ok: true, token: signAppToken(user) });
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

    // পাসওয়ার্ড বদলের পর আগের টোকেন (পুরোনো সংস্করণ) আর চলবে না। অ্যাডমিনের ইউজারনেম-লগইনের টোকেনে ver নেই, সেটা বাদ
    if (payload.username === 'app-user' && (payload.ver || 0) !== getTokenVersion()) {
      return res.status(401).json({ error: 'পাসওয়ার্ড বদলেছে, আবার লগইন করুন।' });
    }

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
