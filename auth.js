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
router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'ইউজারনেম ও পাসওয়ার্ড দিন।' });
  }

  try {
    const userRes = await db.query('SELECT * FROM users WHERE username = $1', [username.trim()]);
    const user = userRes.rows[0];
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
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'সার্ভার ত্রুটি।' });
  }
});

// ---------- অ্যাপের পাসওয়ার্ড-লগইন ----------
const appLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'অনেকবার চেষ্টা হয়েছে, ১৫ মিনিট পরে আবার চেষ্টা করুন।' },
});

// দুই পাসওয়ার্ডের দৈর্ঘ্য আলাদা হলেও সমান সময়ে তুলনা করার জন্য আগে হ্যাশ করা হয়
const sha256 = (text) => crypto.createHash('sha256').update(String(text)).digest();

const PASSWORD_MIN = 4;
const PASSWORD_MAX = 72; // bcrypt এর সীমা

const getSetting = async (key) => {
  const res = await db.query('SELECT value FROM settings WHERE key = $1', [key]);
  return res.rows.length > 0 ? res.rows[0].value : null;
};

const setSetting = async (key, value) => {
  await db.query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    [key, String(value)]
  );
};

// টোকেন সংস্করণ: পাসওয়ার্ড বদলালে বাড়ে
const getTokenVersion = async () => {
  const val = await getSetting('token_version');
  return parseInt(val || '0', 10) || 0;
};

// দেওয়া পাসওয়ার্ড বর্তমান অ্যাপ-পাসওয়ার্ডের সাথে মেলে কিনা
async function checkAppPassword(password) {
  const savedHash = await getSetting('app_password_hash');
  if (savedHash) return bcrypt.compareSync(password, savedHash);

  const expected = process.env.APP_PASSWORD;
  if (!expected) return null;
  return crypto.timingSafeEqual(sha256(password), sha256(expected));
}

// 'app-user' ইউজার বের করা (না থাকলে তৈরি)
async function getAppUser() {
  const role = 'admin';
  const username = 'app-user';

  let userRes = await db.query('SELECT * FROM users WHERE username = $1', [username]);
  let user = userRes.rows[0];

  if (!user) {
    const randomHash = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);
    await db.query('INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)', [
      username,
      randomHash,
      role,
    ]);
    userRes = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    user = userRes.rows[0];
  } else if (user.role !== role) {
    await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, user.id]);
    user.role = role;
  }
  return user;
}

const signAppToken = async (user) =>
  jwt.sign(
    { sub: user.id, username: user.username, role: user.role, ver: await getTokenVersion() },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'অনেকবার চেষ্টা হয়েছে, ১৫ মিনিট পরে আবার চেষ্টা করুন।' },
});

// POST /api/auth/app-login  { "password": "..." }
router.post('/app-login', appLoginLimiter, async (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'পাসওয়ার্ড দিন।' });
  }

  try {
    const ok = await checkAppPassword(password);
    if (ok === null) {
      return res.status(503).json({ error: 'সার্ভারে APP_PASSWORD সেট করা নেই (.env ফাইল দেখুন)।' });
    }
    if (!ok) {
      return res.status(401).json({ error: 'পাসওয়ার্ড ভুল।' });
    }

    const user = await getAppUser();
    const token = await signAppToken(user);
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.error('App login error:', err);
    res.status(500).json({ error: 'সার্ভার ত্রুটি।' });
  }
});

// POST /api/auth/verify-password
router.post('/verify-password', passwordLimiter, requireAuth, async (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'বর্তমান পাসওয়ার্ড দিন।' });
  }
  try {
    const isValid = await checkAppPassword(password);
    if (!isValid) {
      return res.status(403).json({ error: 'বর্তমান পাসওয়ার্ড ভুল।' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Verify password error:', err);
    res.status(500).json({ error: 'সার্ভার ত্রুটি।' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', passwordLimiter, requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
    return res.status(400).json({ error: 'বর্তমান ও নতুন পাসওয়ার্ড দিন।' });
  }

  try {
    const isValid = await checkAppPassword(currentPassword);
    if (!isValid) {
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

    // PostgreSQL ট্রানজেকশন
    await db.query('BEGIN');
    try {
      const newHash = bcrypt.hashSync(newPassword, 10);
      await db.query(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
        ['app_password_hash', newHash]
      );
      const currentVer = await getTokenVersion();
      await db.query(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
        ['token_version', String(currentVer + 1)]
      );
      await db.query('COMMIT');
    } catch (txErr) {
      await db.query('ROLLBACK');
      throw txErr;
    }

    const user = await getAppUser();
    const token = await signAppToken(user);
    res.json({ ok: true, token });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'সার্ভার ত্রুটি।' });
  }
});

// প্রতিটি সুরক্ষিত রাউটের আগে বসে
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'লগইন করা প্রয়োজন।' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (payload.username === 'app-user') {
      const currentVer = await getTokenVersion();
      if ((payload.ver || 0) !== currentVer) {
        return res.status(401).json({ error: 'পাসওয়ার্ড বদলেছে, আবার লগইন করুন।' });
      }
    }

    req.user = { id: payload.sub, username: payload.username, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'টোকেন সঠিক নয় অথবা মেয়াদ শেষ, আবার লগইন করুন।' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: 'এই কাজের অনুমতি আপনার নেই।' });
    }
    next();
  };
}

module.exports = { router, requireAuth, requireRole };
