// কার্ডের সব রুট: তৈরি, তালিকা, একটি দেখা, ছবি, বদলানো, মুছা,
// মুখ যাচাই ও ভেক্টর (Python face_service), ফেস সার্চ, QR স্ক্যান, ইতিহাস, ইভেন্ট, restore।
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { upload, removePhoto, UPLOAD_DIR } = require('./upload');
const { requireRole } = require('./auth');
const face = require('./face');

const router = express.Router();

const GENDER_OPTIONS = ['পুরুষ', 'মহিলা', 'তৃতীয় লিঙ্গ'];
const MARITAL_OPTIONS = ['বিবাহিত', 'অবিবাহিত', 'বিধবা', 'বিপত্নিক'];
const OCCUPATION_OPTIONS = ['কৃষক', 'শ্রমিক', 'ব্যবসায়ী', 'গৃহিণী', 'অন্যান্য'];
const SOCIAL_STATUS_OPTIONS = ['Extremely Poor', 'Poor', 'Middle Class', 'Disabled'];
const MARRIED = 'বিবাহিত';

// ---------- সহায়ক ফাংশন ----------

const toEnglishDigits = (text) =>
  String(text).replace(/[০-৯]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x09e6 + 48));

const isValidDob = (value) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!m) return false;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  const now = new Date();

  if (year < 1900 || year > now.getFullYear()) return false;
  if (month > 12 || day > 31) return false;
  if (month === 0) return true;
  if (year === now.getFullYear() && month > now.getMonth() + 1) return false;
  if (day === 0) return true;

  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return false;
  return d.getTime() <= now.getTime();
};

async function generateUniqueCode() {
  for (let i = 0; i < 30; i++) {
    const code = String(crypto.randomInt(100000000000, 1000000000000));
    const found = await db.query('SELECT 1 FROM cards WHERE unique_code = $1', [code]);
    if (found.rows.length === 0) return code;
  }
  throw new Error('ইউনিক কোড তৈরি করা যায়নি');
}

function toCard(row) {
  return {
    id: row.client_id || String(row.id),
    uniqueCode: row.unique_code,
    nid: row.nid,
    name: row.name,
    fatherName: row.father_name,
    motherName: row.mother_name,
    phone: row.phone,
    dob: row.dob,
    age: row.age,
    ageText: row.age_text,
    gender: row.gender,
    maritalStatus: row.marital_status,
    spouseNid: row.spouse_nid,
    occupation: row.occupation,
    socialStatus: row.social_status,
    areaType: row.area_type,
    areaName: row.area_name,
    ward: row.ward,
    village: row.village,
    upazila: row.upazila,
    district: row.district,
    photoUrl: row.photo ? `/api/cards/${row.unique_code}/photo` : '',
    hasFace: Boolean(row.face_vector),
    scannedAt: row.scanned_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readPayload(req) {
  if (req.body && typeof req.body.data === 'string') {
    return JSON.parse(req.body.data);
  }
  return req.body || {};
}

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

function validate(body) {
  const errors = [];
  const v = {
    clientId: str(body.clientId || body.id) || null,
    name: str(body.name),
    fatherName: str(body.fatherName),
    motherName: str(body.motherName),
    nid: toEnglishDigits(str(body.nid)),
    phone: toEnglishDigits(str(body.phone)),
    dob: toEnglishDigits(str(body.dob)),
    gender: str(body.gender),
    maritalStatus: str(body.maritalStatus),
    spouseNid: toEnglishDigits(str(body.spouseNid)),
    occupation: str(body.occupation),
    socialStatus: str(body.socialStatus),
    areaType: str(body.areaType),
    areaName: str(body.areaName),
    ward: toEnglishDigits(str(body.ward)),
    village: str(body.village),
    upazila: str(body.upazila),
    district: str(body.district),
    age: Number.isInteger(Number(body.age)) && body.age !== '' && body.age !== null ? Number(body.age) : null,
    ageText: str(body.ageText),
    createdAt: str(body.createdAt),
  };

  const required = ['name', 'fatherName', 'motherName', 'nid', 'phone', 'dob', 'gender',
    'maritalStatus', 'occupation', 'socialStatus', 'ward', 'village', 'upazila', 'district'];
  for (const key of required) {
    if (!v[key]) errors.push(`${key} দেওয়া হয়নি`);
  }

  if (v.nid && !/^\d{6,20}$/.test(v.nid)) errors.push('nid শুধু সংখ্যা হতে হবে (৬-২০ ডিজিট)');
  if (v.phone && !/^\+?\d{6,15}$/.test(v.phone)) errors.push('phone সঠিক নয়');
  if (v.dob && !isValidDob(v.dob)) errors.push('dob সঠিক নয় (DD/MM/YYYY)');
  if (v.gender && !GENDER_OPTIONS.includes(v.gender)) errors.push('gender সঠিক নয়');
  if (v.maritalStatus && !MARITAL_OPTIONS.includes(v.maritalStatus)) errors.push('maritalStatus সঠিক নয়');
  if (v.occupation && !OCCUPATION_OPTIONS.includes(v.occupation)) errors.push('occupation সঠিক নয়');
  if (v.socialStatus && !SOCIAL_STATUS_OPTIONS.includes(v.socialStatus)) errors.push('socialStatus সঠিক নয়');

  if (v.maritalStatus === MARRIED) {
    if (!v.spouseNid) errors.push('বিবাহিত হলে spouseNid বাধ্যতামূলক');
  } else {
    v.spouseNid = '';
  }

  const parsed = v.createdAt ? new Date(v.createdAt) : null;
  v.createdAt = parsed && !isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();

  return { errors, value: v };
}

async function buildFaceVector(photoName) {
  if (!photoName) return null;
  const filePath = path.join(UPLOAD_DIR, path.basename(photoName));
  let buffer;
  try {
    buffer = await fs.promises.readFile(filePath);
  } catch (e) {
    return null;
  }
  const result = await face.extractFace(buffer);
  if (!result.valid) {
    return { valid: false, message: result.message || 'ছবিতে স্পষ্ট মুখ পাওয়া যায়নি।' };
  }
  return { valid: true, descriptor: result.descriptor };
}

// ইভেন্ট সংরক্ষণ (হিস্ট্রি টেবিলে এক লাইন) — ব্যর্থ হলে চুপচাপ বাদ, কার্ডের কাজ আটকাবে না
async function logCardEvent(cardId, uniqueCode, action, userId) {
  try {
    await db.query(
      'INSERT INTO card_events (card_id, unique_code, action, user_id, created_at) VALUES ($1,$2,$3,$4,$5)',
      [cardId, uniqueCode, action, userId || null, new Date().toISOString()]
    );
  } catch (e) {
    console.warn('logCardEvent failed:', e.message);
  }
}

// ---------- রাউট ----------

// POST /api/cards — নতুন কার্ড (JSON অথবা multipart: photo + data)
router.post('/', upload.single('photo'), async (req, res) => {
  const photoName = req.file ? req.file.filename : '';

  let body;
  try {
    body = readPayload(req);
  } catch (e) {
    removePhoto(photoName);
    return res.status(400).json({ error: 'data ফিল্ডের JSON সঠিক নয়।' });
  }

  const { errors, value: v } = validate(body);
  if (errors.length) {
    removePhoto(photoName);
    return res.status(400).json({ error: 'তথ্য সঠিক নয়', details: errors });
  }

  try {
    if (v.clientId) {
      const sameRes = await db.query('SELECT * FROM cards WHERE client_id = $1', [v.clientId]);
      if (sameRes.rows.length > 0) {
        removePhoto(photoName);
        return res.status(200).json({ card: toCard(sameRes.rows[0]), duplicate: true });
      }
    }

    const nidRes = await db.query('SELECT * FROM cards WHERE nid = $1', [v.nid]);
    if (nidRes.rows.length > 0) {
      removePhoto(photoName);
      return res.status(409).json({
        error: 'এই এনআইডি দিয়ে কার্ড আগেই তৈরি করা আছে।',
        uniqueCode: nidRes.rows[0].unique_code,
      });
    }

    let faceVectorBuffer = null;
    if (photoName) {
      let fv;
      try {
        fv = await buildFaceVector(photoName);
      } catch (e) {
        removePhoto(photoName);
        console.error('Face extract error:', e);
        return res.status(503).json({ error: 'মুখ শনাক্তকরণ সার্ভিস পাওয়া যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।' });
      }
      if (!fv) {
        removePhoto(photoName);
        return res.status(400).json({ error: 'ছবির ফাইল পড়া যায়নি।' });
      }
      if (!fv.valid) {
        removePhoto(photoName);
        return res.status(400).json({ error: fv.message || 'ছবিতে স্পষ্ট মুখ পাওয়া যায়নি।' });
      }
      faceVectorBuffer = face.toBlob(fv.descriptor);
    }

    const code = await generateUniqueCode();
    const now = new Date().toISOString();

    const insertRes = await db.query(
      `INSERT INTO cards (
        unique_code, client_id, nid, name, father_name, mother_name, phone, dob, age, age_text,
        gender, marital_status, spouse_nid, occupation, social_status, area_type, area_name, ward,
        village, upazila, district, photo, face_vector, created_at, updated_at, created_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,$24,$25,$26
      ) RETURNING *`,
      [
        code, v.clientId, v.nid, v.name, v.fatherName, v.motherName, v.phone, v.dob, v.age, v.ageText,
        v.gender, v.maritalStatus, v.spouseNid, v.occupation, v.socialStatus, v.areaType, v.areaName, v.ward,
        v.village, v.upazila, v.district, photoName, faceVectorBuffer, v.createdAt, now, req.user.id,
      ]
    );

    await logCardEvent(insertRes.rows[0].id, code, 'card_created', req.user.id);
    res.status(201).json({ card: toCard(insertRes.rows[0]) });
  } catch (err) {
    removePhoto(photoName);
    console.error('Card insert error:', err);
    res.status(500).json({ error: 'কার্ড সংরক্ষণ করতে সমস্যা হয়েছে।' });
  }
});

// GET /api/cards?page=1&limit=50&q=... — তালিকা ও খোঁজা
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const q = str(req.query.q);

    const params = [];
    let where = '';
    if (q) {
      where = 'WHERE name ILIKE $1 OR nid ILIKE $1 OR phone ILIKE $1 OR unique_code ILIKE $1';
      params.push(`%${q}%`);
    }

    const totalRes = await db.query(`SELECT COUNT(*)::int AS n FROM cards ${where}`, params);
    const offset = (page - 1) * limit;
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const rowsRes = await db.query(
      `SELECT * FROM cards ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, limit, offset]
    );

    res.json({
      total: totalRes.rows[0].n,
      page,
      limit,
      items: rowsRes.rows.map(toCard),
    });
  } catch (err) {
    console.error('Card list error:', err);
    res.status(500).json({ error: 'তালিকা আনা যায়নি।' });
  }
});

// GET /api/cards/check-nid/:nid — এনআইডি সার্ভারে আছে কিনা
router.get('/check-nid/:nid', async (req, res) => {
  try {
    const nid = toEnglishDigits(str(req.params.nid));
    if (!nid) return res.status(400).json({ error: 'এনআইডি দেওয়া হয়নি।' });
    const r = await db.query('SELECT 1 FROM cards WHERE nid = $1', [nid]);
    res.json({ exists: r.rows.length > 0 });
  } catch (err) {
    console.error('check-nid error:', err);
    res.status(500).json({ error: 'এনআইডি যাচাই করা যায়নি।' });
  }
});

// GET /api/cards/scans/summary — মোট ও স্ক্যান হওয়া
router.get('/scans/summary', async (req, res) => {
  try {
    const totalRes = await db.query('SELECT COUNT(*)::int AS n FROM cards');
    const scannedRes = await db.query('SELECT COUNT(*)::int AS n FROM cards WHERE scanned_at IS NOT NULL');
    res.json({ total: totalRes.rows[0].n, scanned: scannedRes.rows[0].n });
  } catch (err) {
    console.error('scans summary error:', err);
    res.status(500).json({ error: 'অগ্রগতি আনা যায়নি।' });
  }
});

// POST /api/cards/scans/reset — সব স্ক্যান চিহ্ন মুছে ফেলা (admin)
router.post('/scans/reset', requireRole('admin'), async (req, res) => {
  try {
    const r = await db.query('UPDATE cards SET scanned_at = NULL WHERE scanned_at IS NOT NULL');
    res.json({ ok: true, cleared: r.rowCount });
  } catch (err) {
    console.error('scans reset error:', err);
    res.status(500).json({ error: 'রিস্টার্ট করা যায়নি।' });
  }
});

// POST /api/cards/face-check — ছবিতে মুখ আছে কিনা যাচাই (সংরক্ষণ করে না)
router.post('/face-check', upload.single('photo'), async (req, res) => {
  const photoName = req.file ? req.file.filename : '';
  if (!photoName) return res.status(400).json({ error: 'ছবি দেওয়া হয়নি।' });

  try {
    const buf = await fs.promises.readFile(path.join(UPLOAD_DIR, path.basename(photoName)));
    const result = await face.extractFace(buf);
    if (!result.valid) {
      return res.json({ valid: false, message: result.message || 'ছবিতে স্পষ্ট মুখ পাওয়া যায়নি।' });
    }
    return res.json({ valid: true, message: '' });
  } catch (e) {
    console.error('face-check error:', e);
    return res.status(503).json({ error: 'মুখ শনাক্তকরণ সার্ভিস পাওয়া যাচ্ছে না।' });
  } finally {
    removePhoto(photoName);
  }
});

// POST /api/cards/face-search — ছবি তুলে সার্ভারে খোঁজা (Python face_service)
router.post('/face-search', upload.single('photo'), async (req, res) => {
  const photoName = req.file ? req.file.filename : '';
  if (!photoName) return res.status(400).json({ error: 'ছবি দেওয়া হয়নি।' });

  let result;
  try {
    const buf = await fs.promises.readFile(path.join(UPLOAD_DIR, path.basename(photoName)));
    result = await face.extractFace(buf);
  } catch (e) {
    console.error('Face search extract error:', e);
    return res.status(503).json({ error: 'মুখ শনাক্তকরণ সার্ভিস পাওয়া যাচ্ছে না।' });
  } finally {
    removePhoto(photoName);
  }

  if (!result.valid) {
    return res.status(400).json({ error: result.message || 'ছবিতে স্পষ্ট মুখ পাওয়া যায়নি।' });
  }

  try {
    const rows = (await db.query('SELECT * FROM cards WHERE face_vector IS NOT NULL')).rows;
    let best = null;
    for (const row of rows) {
      try {
        const stored = face.fromBlob(row.face_vector);
        const d = face.distance(result.descriptor, stored);
        if (best === null || d < best.distance) {
          best = { distance: d, row };
        }
      } catch (e) {
        // বাদ
      }
    }

    if (!best || best.distance > face.MATCH_DISTANCE) {
      return res.json({
        match: false,
        message: 'এই মুখের সাথে কোনো নিবন্ধিত কার্ডের মিল পাওয়া যায়নি।',
      });
    }

    const alreadyScanned = Boolean(best.row.scanned_at);
    const scannedAt = alreadyScanned ? best.row.scanned_at : new Date().toISOString();

    if (!alreadyScanned) {
      await db.query('UPDATE cards SET scanned_at = $1 WHERE id = $2', [scannedAt, best.row.id]);
      await logCardEvent(best.row.id, best.row.unique_code, 'scan_face', req.user.id);
    }

    const fresh = (await db.query('SELECT * FROM cards WHERE id = $1', [best.row.id])).rows[0] || best.row;
    res.json({
      match: true,
      status: alreadyScanned ? 'duplicate' : 'success',
      card: { ...toCard(fresh), scannedAt },
      distance: Number(best.distance.toFixed(4)),
      threshold: face.MATCH_DISTANCE,
    });
  } catch (err) {
    console.error('face-search error:', err);
    res.status(500).json({ error: 'ফেস সার্চ করা যায়নি।' });
  }
});

// GET /api/cards/:code — একটি কার্ড
router.get('/:code', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM cards WHERE unique_code = $1', [req.params.code]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'কার্ড পাওয়া যায়নি।' });
    res.json({ card: toCard(r.rows[0]) });
  } catch (err) {
    console.error('card get error:', err);
    res.status(500).json({ error: 'কার্ড আনা যায়নি।' });
  }
});

// GET /api/cards/:code/photo
router.get('/:code/photo', async (req, res) => {
  try {
    const r = await db.query('SELECT photo FROM cards WHERE unique_code = $1', [req.params.code]);
    if (r.rows.length === 0 || !r.rows[0].photo) {
      return res.status(404).json({ error: 'ছবি পাওয়া যায়নি।' });
    }
    res.sendFile(path.join(UPLOAD_DIR, path.basename(r.rows[0].photo)));
  } catch (err) {
    console.error('card photo error:', err);
    res.status(500).json({ error: 'ছবি আনা যায়নি।' });
  }
});

// POST /api/cards/:code/face — নির্দিষ্ট কার্ডে ছবি দিয়ে ভেক্টর আপডেট
router.post('/:code/face', upload.single('photo'), async (req, res) => {
  const photoName = req.file ? req.file.filename : '';
  if (!photoName) return res.status(400).json({ error: 'ছবি দেওয়া হয়নি।' });

  try {
    const cardRes = await db.query('SELECT id FROM cards WHERE unique_code = $1', [req.params.code]);
    if (cardRes.rows.length === 0) {
      removePhoto(photoName);
      return res.status(404).json({ error: 'কার্ড পাওয়া যায়নি।' });
    }

    let fv;
    try {
      fv = await buildFaceVector(photoName);
    } catch (e) {
      removePhoto(photoName);
      console.error('Face enroll error:', e);
      return res.status(503).json({ error: 'মুখ শনাক্তকরণ সার্ভিস পাওয়া যাচ্ছে না।' });
    }
    if (!fv || !fv.valid) {
      removePhoto(photoName);
      return res.status(400).json({ error: (fv && fv.message) || 'ছবিতে স্পষ্ট মুখ পাওয়া যায়নি।' });
    }

    const blob = face.toBlob(fv.descriptor);
    await db.query('UPDATE cards SET face_vector = $1, updated_at = $2 WHERE id = $3', [
      blob, new Date().toISOString(), cardRes.rows[0].id,
    ]);
    await logCardEvent(cardRes.rows[0].id, req.params.code, 'face_updated', req.user.id);

    removePhoto(photoName);
    return res.json({ ok: true });
  } catch (err) {
    removePhoto(photoName);
    console.error('face enroll db error:', err);
    res.status(500).json({ error: 'ভেক্টর সংরক্ষণ করা যায়নি।' });
  }
});

// POST /api/cards/:code/scan — QR স্ক্যান চিহ্ন (একবারই; পরে duplicate)
router.post('/:code/scan', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM cards WHERE unique_code = $1', [req.params.code]);
    if (r.rows.length === 0) {
      return res.json({ status: 'notfound' });
    }
    const row = r.rows[0];

    if (row.scanned_at) {
      return res.json({
        status: 'duplicate',
        card: { ...toCard(row), scannedAt: row.scanned_at },
      });
    }

    const scannedAt = new Date().toISOString();
    await db.query('UPDATE cards SET scanned_at = $1 WHERE id = $2', [scannedAt, row.id]);
    await logCardEvent(row.id, row.unique_code, 'scan_qr', req.user.id);

    const fresh = (await db.query('SELECT * FROM cards WHERE id = $1', [row.id])).rows[0] || row;
    return res.json({
      status: 'success',
      card: { ...toCard(fresh), scannedAt },
    });
  } catch (err) {
    console.error('card scan error:', err);
    res.status(500).json({ error: 'স্ক্যান করা যায়নি।' });
  }
});

// GET /api/cards/:code/history — কার্ডের ইতিহাস (সর্বশেষ আগে)
router.get('/:code/history', async (req, res) => {
  try {
    const r = await db.query(
      'SELECT action, user_id, created_at FROM card_events WHERE unique_code = $1 ORDER BY created_at DESC LIMIT 200',
      [req.params.code]
    );
    res.json({ items: r.rows });
  } catch (err) {
    console.error('card history error:', err);
    res.status(500).json({ error: 'ইতিহাস আনা যায়নি।' });
  }
});

// POST /api/cards/:code/events — { action: 'card_opened' | 'card_saved' | ... }
router.post('/:code/events', async (req, res) => {
  const { action } = req.body || {};
  if (!action || typeof action !== 'string') {
    return res.status(400).json({ error: 'action দেওয়া হয়নি।' });
  }
  try {
    const r = await db.query('SELECT id FROM cards WHERE unique_code = $1', [req.params.code]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'কার্ড পাওয়া যায়নি।' });

    await logCardEvent(r.rows[0].id, req.params.code, action, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('card event error:', err);
    res.status(500).json({ error: 'ইভেন্ট সংরক্ষণ করা যায়নি।' });
  }
});

// POST /api/cards/:code/restore — মুছে ফেলা কার্ড ফেরানো (admin)
// ملاحظة: আপনার cards টেবিলে deleted_at কলাম নেই, তাই আপাতত কিছুই করার নেই — 200 ফেরত দিচ্ছি
router.post('/:code/restore', requireRole('admin'), async (req, res) => {
  try {
    const r = await db.query('SELECT id FROM cards WHERE unique_code = $1', [req.params.code]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'কার্ড পাওয়া যায়নি।' });
    res.json({ ok: true, restored: 0 });
  } catch (err) {
    console.error('card restore error:', err);
    res.status(500).json({ error: 'ফেরানো যায়নি।' });
  }
});

// PUT /api/cards/:code — তথ্য বদলানো (নতুন ছবি দিলে নতুন ভেক্টর)
router.put('/:code', upload.single('photo'), async (req, res) => {
  const newPhoto = req.file ? req.file.filename : '';

  try {
    const existingRes = await db.query('SELECT * FROM cards WHERE unique_code = $1', [req.params.code]);
    if (existingRes.rows.length === 0) {
      removePhoto(newPhoto);
      return res.status(404).json({ error: 'কার্ড পাওয়া যায়নি।' });
    }
    const existing = existingRes.rows[0];

    let body;
    try {
      body = readPayload(req);
    } catch (e) {
      removePhoto(newPhoto);
      return res.status(400).json({ error: 'data ফিল্ডের JSON সঠিক নয়।' });
    }

    const { errors, value: v } = validate(body);
    if (errors.length) {
      removePhoto(newPhoto);
      return res.status(400).json({ error: 'তথ্য সঠিক নয়', details: errors });
    }

    const clashRes = await db.query('SELECT unique_code FROM cards WHERE nid = $1 AND id != $2', [
      v.nid, existing.id,
    ]);
    if (clashRes.rows.length > 0) {
      removePhoto(newPhoto);
      return res.status(409).json({
        error: 'এই এনআইডি অন্য কার্ডে ব্যবহার হয়েছে।',
        uniqueCode: clashRes.rows[0].unique_code,
      });
    }

    let faceVectorBuffer = existing.face_vector || null;
    if (newPhoto) {
      let fv;
      try {
        fv = await buildFaceVector(newPhoto);
      } catch (e) {
        removePhoto(newPhoto);
        console.error('Face extract error (PUT):', e);
        return res.status(503).json({ error: 'মুখ শনাক্তকরণ সার্ভিস পাওয়া যাচ্ছে না।' });
      }
      if (!fv) {
        removePhoto(newPhoto);
        return res.status(400).json({ error: 'ছবির ফাইল পড়া যায়নি।' });
      }
      if (!fv.valid) {
        removePhoto(newPhoto);
        return res.status(400).json({ error: fv.message || 'ছবিতে স্পষ্ট মুখ পাওয়া যায়নি।' });
      }
      faceVectorBuffer = face.toBlob(fv.descriptor);
    }

    const updateRes = await db.query(
      `UPDATE cards SET
        nid=$1, name=$2, father_name=$3, mother_name=$4, phone=$5,
        dob=$6, age=$7, age_text=$8, gender=$9, marital_status=$10,
        spouse_nid=$11, occupation=$12, social_status=$13, area_type=$14, area_name=$15,
        ward=$16, village=$17, upazila=$18, district=$19, photo=$20,
        face_vector=$21, updated_at=$22
      WHERE id=$23 RETURNING *`,
      [
        v.nid, v.name, v.fatherName, v.motherName, v.phone,
        v.dob, v.age, v.ageText, v.gender, v.maritalStatus,
        v.spouseNid, v.occupation, v.socialStatus, v.areaType, v.areaName,
        v.ward, v.village, v.upazila, v.district, newPhoto || existing.photo,
        faceVectorBuffer, new Date().toISOString(),
        existing.id,
      ]
    );

    if (newPhoto && existing.photo) removePhoto(existing.photo);
    await logCardEvent(existing.id, existing.unique_code, 'card_updated', req.user.id);

    res.json({ card: toCard(updateRes.rows[0]) });
  } catch (err) {
    removePhoto(newPhoto);
    console.error('Card update error:', err);
    res.status(500).json({ error: 'কার্ড বদলানো যায়নি।' });
  }
});

// DELETE /api/cards/:code — শুধু admin
router.delete('/:code', requireRole('admin'), async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM cards WHERE unique_code = $1', [req.params.code]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'কার্ড পাওয়া যায়নি।' });

    await logCardEvent(r.rows[0].id, r.rows[0].unique_code, 'card_deleted', req.user.id);
    await db.query('DELETE FROM cards WHERE id = $1', [r.rows[0].id]);
    removePhoto(r.rows[0].photo);
    res.json({ ok: true });
  } catch (err) {
    console.error('Card delete error:', err);
    res.status(500).json({ error: 'কার্ড মোছা যায়নি।' });
  }
});

module.exports = router;