// প্রথম ইউজার (admin) তৈরি করার স্ক্রিপ্ট (PostgreSQL)
// ব্যবহার:  node seed.js <ইউজারনেম> <পাসওয়ার্ড> [admin|operator]
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const [username, password, role = 'admin'] = process.argv.slice(2);

if (!username || !password) {
  console.log('ব্যবহার: node seed.js <ইউজারনেম> <পাসওয়ার্ড> [admin|operator]');
  process.exit(1);
}
if (password.length < 8) {
  console.log('পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।');
  process.exit(1);
}
if (!['admin', 'operator'].includes(role)) {
  console.log('role হবে admin অথবা operator।');
  process.exit(1);
}

async function seedUser() {
  const cleanUsername = username.trim();
  const passwordHash = bcrypt.hashSync(password, 10);

  try {
    await db.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
      [cleanUsername, passwordHash, role]
    );
    console.log(`ইউজার তৈরি হয়েছে: ${cleanUsername} (${role})`); } catch (err) { if (err && (err.code === '23505' \vert{}\vert{} String(err.message).includes('UNIQUE') \vert{}\vert{} String(err.message).includes('duplicate'))) { console.log('এই ইউজারনেম আগেই আছে।'); } else { console.error('ইউজার তৈরি করতে সমস্যা হয়েছে:', err); } process.exitCode = 1; } finally { await db.pool.end(); } }  seedUser(); ```  ---  ### ২. `cards.js` (`faceVector` স্ট্রিং/JSON পার্সিং সেফটি ও `req.user` সেফটি যুক্ত করে সংশোধিত) `multipart/form-data` বা JSON থেকে `faceVector` স্ট্রিং হিসেবে এলে যেন ক্র্যাশ বা `400` এরর না হয়, সেজন্য `normalizeFaceVector` হেল্পার যোগ করা হয়েছে এবং `req.user?.id \vert{}\vert{} null` ব্যবহার করা হয়েছে।  ```javascript const express = require('express'); const crypto = require('crypto'); const path = require('path'); const fs = require('fs'); const db = require('./db'); const { upload, removePhoto, UPLOAD_DIR } = require('./upload'); const { requireRole } = require('./auth'); const face = require('./face');  const router = express.Router(); const MARRIED = 'বিবাহিত';  const str = (v) => (v === undefined \vert{}\vert{} v === null ? '' : String(v).trim()); const toEnglishDigits = (text) => String(text).replace(/[০-৯]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x09e6 + 48));  function normalizeFaceVector(rawVector) { let vec = rawVector; if (typeof vec === 'string') { const trimmed = vec.trim(); if (!trimmed) return null; try { vec = JSON.parse(trimmed); } catch (_) { return null; } } if (!Array.isArray(vec) \vert{}\vert{} vec.length !== face.DESCRIPTOR_DIM) { return null; } const nums = vec.map((n) => Number(n)); if (nums.some((n) => !Number.isFinite(n))) { return null; } return nums; }  // অ্যাপ থেকে পাঠানো ফেস ভেক্টর (JSON অ্যারে বা JSON স্ট্রিং) কে Buffer এ রূপান্তর function parseFaceVector(body) { const normalized = normalizeFaceVector(body && body.faceVector); if (normalized) { return face.toBlob(normalized); } return null; }  function toCard(row) { return { id: row.client_id \vert{}\vert{} String(row.id), uniqueCode: row.unique_code, name: row.name, phone: row.phone, nid: row.nid, photoUrl: row.photo ? `/api/cards/${row.unique_code}/photo` : '',
    hasFace: Boolean(row.face_vector),
    scannedAt: row.scanned_at,
    createdAt: row.created_at,
  };
}

// POST /api/cards — নতুন কার্ড
router.post('/', upload.single('photo'), async (req, res) => {
  const photoName = req.file ? req.file.filename : '';
  let body = req.body || {};

  try {
    if (body.data) {
      body = typeof body.data === 'string' ? JSON.parse(body.data) : body.data;
    }

    const faceVectorBuffer = parseFaceVector(body);
    const cleanNid = toEnglishDigits(str(body.nid));

    // এনআইডি চেক
    const nidRes = await db.query('SELECT unique_code FROM cards WHERE nid = $1', [cleanNid]);
    if (nidRes.rows.length > 0) {
      removePhoto(photoName);
      return res.status(409).json({
        error: 'এই এনআইডি দিয়ে কার্ড আগেই তৈরি করা আছে।',
        uniqueCode: nidRes.rows[0].unique_code,
      });
    }

    const code = String(crypto.randomInt(100000000000, 1000000000000));
    const now = new Date().toISOString();
    const createdBy = req.user && Number.isInteger(req.user.id) && req.user.id > 0 ? req.user.id : null;

    const result = await db.query(
      `INSERT INTO cards (
        unique_code, client_id, nid, name, father_name, mother_name, phone, dob, age, age_text,
        gender, marital_status, spouse_nid, occupation, social_status, area_type, area_name, ward,
        village, upazila, district, photo, face_vector, created_at, updated_at, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING *`,
      [
        code,
        body.clientId || null,
        cleanNid,
        str(body.name),
        str(body.fatherName),
        str(body.motherName),
        str(body.phone),
        str(body.dob),
        body.age === '' || body.age === undefined || body.age === null ? null : Number(body.age),
        str(body.ageText),
        str(body.gender),
        str(body.maritalStatus),
        str(body.spouseNid),
        str(body.occupation),
        str(body.socialStatus),
        str(body.areaType),
        str(body.areaName),
        str(body.ward),
        str(body.village),
        str(body.upazila),
        str(body.district),
        photoName,
        faceVectorBuffer,
        now,
        now,
        createdBy,
      ]
    );

    res.status(201).json({ card: toCard(result.rows[0]) });
  } catch (err) {
    removePhoto(photoName);
    console.error(err);
    res.status(500).json({ error: 'কার্ড তৈরি করা যায়নি।' });
  }
});

// POST /api/cards/face-search — অ্যাপ থেকে আসা ভেক্টর দিয়ে সার্চ
router.post('/face-search', upload.none(), async (req, res) => {
  try {
    const incomingVector = normalizeFaceVector(req.body && req.body.faceVector);
    if (!incomingVector) {
      return res.status(400).json({ error: 'ভেক্টর সঠিক নয়।' });
    }

    const rows = (await db.query('SELECT * FROM cards WHERE face_vector IS NOT NULL')).rows;
    let best = null;

    for (const row of rows) {
      const stored = face.fromBlob(row.face_vector);
      const d = face.distance(incomingVector, stored);
      if (best === null || d < best.distance) best = { distance: d, row };
    }

    if (!best || best.distance > face.MATCH_DISTANCE) {
      return res.json({ match: false, message: 'মিল পাওয়া যায়নি।' });
    }

    const alreadyScanned = Boolean(best.row.scanned_at);
    if (!alreadyScanned) {
      const scannedAt = new Date().toISOString();
      await db.query('UPDATE cards SET scanned_at = $1 WHERE id = $2', [scannedAt, best.row.id]);
      best.row.scanned_at = scannedAt;
    }

    res.json({
      match: true,
      status: alreadyScanned ? 'duplicate' : 'success',
      card: toCard(best.row),
      distance: best.distance,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'সার্চে সমস্যা হয়েছে।' });
  }
});

module.exports = router;
