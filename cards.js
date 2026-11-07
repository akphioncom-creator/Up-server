// কার্ডের CRUD: তৈরি, তালিকা, একটি দেখা, বদলানো, মুছা, ছবি দেখা (সবই লগইন লাগে)
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const { upload, removePhoto, UPLOAD_DIR } = require('./upload');
const { requireRole } = require('./auth');

const router = express.Router();

const GENDER_OPTIONS = ['পুরুষ', 'মহিলা', 'তৃতীয় লিঙ্গ'];
const MARITAL_OPTIONS = ['বিবাহিত', 'অবিবাহিত', 'বিধবা', 'বিপত্নিক'];
const OCCUPATION_OPTIONS = ['কৃষক', 'শ্রমিক', 'ব্যবসায়ী', 'গৃহিণী', 'অন্যান্য'];
const SOCIAL_STATUS_OPTIONS = ['Extremely Poor', 'Poor', 'Middle Class', 'Disabled'];
const MARRIED = 'বিবাহিত';

// ইউনিয়ন/পৌরসভার তালিকা (অ্যাপের তালিকার সাথে মিল রাখতে হবে); সব জায়গায় ওয়ার্ড ১–৯
const AREA_NAMES = {
  'ইউনিয়ন': [
    'নাওগাঁও', 'পুটিজানা', 'কুশমাইল', 'বালিয়ান', 'দেওখোলা', 'ফুলবাড়ীয়া', 'বাক্তা',
    'রাঙ্গামাটিয়া', 'এনায়েতপুর', 'কালাদহ', 'রাধাকানাই', 'আছিমপাটুলী', 'ভবানীপুর',
  ],
  'পৌরসভা': ['ফুলবাড়ীয়া পৌরসভা'],
};
const WARD_VALUES = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

// ---------- সহায়ক ফাংশন ----------

// বাংলা সংখ্যা → ইংরেজি সংখ্যা
const toEnglishDigits = (text) =>
  String(text).replace(/[০-৯]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x09e6 + 48));

// অ্যাপের মতোই জন্ম তারিখ যাচাই (DD/MM/YYYY; দিন/মাস অজানা হলে ০০)
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

// ১২ ডিজিটের এমন কোড তৈরি যা আগে নেই (crypto দিয়ে)
async function generateUniqueCode() {
  for (let i = 0; i < 30; i++) {
    const code = String(crypto.randomInt(100000000000, 1000000000000));
    const res = await db.query('SELECT 1 FROM cards WHERE unique_code = $1', [code]);
    if (res.rows.length === 0) return code;
  }
  throw new Error('ইউনিক কোড তৈরি করা যায়নি');
}

// ডাটাবেসের সারি → অ্যাপে পাঠানোর ফরম্যাট (camelCase)
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    scannedAt: row.scanned_at || null,
  };
}

// অ্যাপ JSON পাঠাক বা multipart (ছবি + "data" ফিল্ডে JSON), দুটোই চলবে
function readPayload(req) {
  if (req.body && typeof req.body.data === 'string') {
    return JSON.parse(req.body.data);
  }
  return req.body || {};
}

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

// ইনপুট যাচাই ও পরিষ্কার করা
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

  if (!v.village) v.village = v.areaName;

  const required = ['name', 'fatherName', 'motherName', 'nid', 'phone', 'dob', 'gender',
    'maritalStatus', 'occupation', 'socialStatus', 'areaType', 'areaName', 'ward', 'village', 'upazila', 'district'];
  for (const key of required) {
    if (!v[key]) errors.push(`${key} দেওয়া হয়নি`);
  }

  if (v.areaType && !AREA_NAMES[v.areaType]) {
    errors.push('areaType সঠিক নয় (ইউনিয়ন অথবা পৌরসভা)');
  } else if (v.areaType && v.areaName && !AREA_NAMES[v.areaType].includes(v.areaName)) {
    errors.push('areaName এই ধরনের তালিকায় নেই');
  }
  if (v.ward && !WARD_VALUES.includes(v.ward)) errors.push('ward ১ থেকে ৯ এর মধ্যে হতে হবে');

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

// ---------- রাউট ----------

// POST /api/cards — নতুন কার্ড
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

    const code = await generateUniqueCode();
    const now = new Date().toISOString();

    await db.query(`
      INSERT INTO cards (
        unique_code, client_id, nid, name, father_name, mother_name, phone, dob, age, age_text,
        gender, marital_status, spouse_nid, occupation, social_status, area_type, area_name, ward,
        village, upazila,
        district, photo, created_at, updated_at, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18,
        $19, $20,
        $21, $22, $23, $24, $25
      )
    `, [
      code, v.clientId, v.nid, v.name, v.fatherName, v.motherName, v.phone, v.dob, v.age, v.ageText,
      v.gender, v.maritalStatus, v.spouseNid, v.occupation, v.socialStatus, v.areaType, v.areaName, v.ward,
      v.village, v.upazila,
      v.district, photoName, v.createdAt, now, req.user.id
    ]);

    const rowRes = await db.query('SELECT * FROM cards WHERE unique_code = $1', [code]);
    res.status(201).json({ card: toCard(rowRes.rows[0]) });
  } catch (err) {
    removePhoto(photoName);
    console.error('Card insert error:', err);
    res.status(500).json({ error: 'কার্ড সংরক্ষণ করতে সমস্যা হয়েছে।' });
  }
});

// GET /api/cards?page=1&limit=50&q=রহিম — তালিকা ও খোঁজা
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const q = str(req.query.q);
    const offset = (page - 1) * limit;

    let where = '';
    let params = [];

    if (q) {
      where = 'WHERE name ILIKE $1 OR nid ILIKE $1 OR phone ILIKE $1 OR unique_code ILIKE $1';
      params.push(`%${q}%`);
    }

    const countRes = await db.query(`SELECT COUNT(*) AS n FROM cards ${where}`, params);
    const total = parseInt(countRes.rows[0].n, 10);

    let queryParams = [...params];
    queryParams.push(limit, offset);
    const rowsQuery = `SELECT * FROM cards ${where} ORDER BY created_at DESC LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`;
    
    const rowsRes = await db.query(rowsQuery, queryParams);

    res.json({ total, page, limit, items: rowsRes.rows.map(toCard) });
  } catch (err) {
    console.error('Cards list error:', err);
    res.status(500).json({ error: 'ডেটা লোড করতে সমস্যা হয়েছে।' });
  }
});

// GET /api/cards/check-nid/:nid
router.get('/check-nid/:nid', async (req, res) => {
  try {
    const nid = toEnglishDigits(str(req.params.nid));
    if (!/^\d{6,20}$/.test(nid)) {
      return res.status(400).json({ error: 'এনআইডি শুধু সংখ্যা হতে হবে (৬-২০ ডিজিট)।' });
    }
    const rowRes = await db.query('SELECT 1 FROM cards WHERE nid = $1', [nid]);
    res.json({ exists: rowRes.rows.length > 0 });
  } catch (err) {
    console.error('Check NID error:', err);
    res.status(500).json({ error: 'সার্ভার ত্রুটি।' });
  }
});

// ---------- অনুদানের কার্ড স্ক্যান ----------

const scanCounts = async () => {
  const res = await db.query('SELECT COUNT(*) AS total, COUNT(scanned_at) AS scanned FROM cards');
  return {
    total: parseInt(res.rows[0].total, 10),
    scanned: parseInt(res.rows[0].scanned, 10)
  };
};

router.get('/scans/summary', async (req, res) => {
  try {
    const summary = await scanCounts();
    res.json(summary);
  } catch (err) {
    console.error('Scan summary error:', err);
    res.status(500).json({ error: 'সার্ভার ত্রুটি।' });
  }
});

router.post('/scans/reset', requireRole('admin'), async (req, res) => {
  try {
    const result = await db.query('UPDATE cards SET scanned_at = NULL WHERE scanned_at IS NOT NULL');
    const summary = await scanCounts();
    res.json({ ok: true, cleared: result.rowCount, summary });
  } catch (err) {
    console.error('Scan reset error:', err);
    res.status(500).json({ error: 'সার্ভার ত্রুটি।' });
  }
});

router.post('/:code/scan', async (req, res) => {
  const code = req.params.code;
  if (!/^\d{12,13}$/.test(code)) {
    return res.status(404).json({ status: 'notfound', error: 'এই কোডের কোনো কার্ড পাওয়া যায়নি।' });
  }

  try {
    const now = new Date().toISOString();
    const claim = await db.query(
      'UPDATE cards SET scanned_at = $1 WHERE unique_code = $2 AND scanned_at IS NULL',
      [now, code]
    );

    const rowRes = await db.query('SELECT * FROM cards WHERE unique_code = $1', [code]);
    if (rowRes.rows.length === 0) {
      return res.status(404).json({ status: 'notfound', error: 'এই কোডের কোনো কার্ড পাওয়া যায়নি।' });
    }

    const row = rowRes.rows[0];
    const summary = await scanCounts();
    if (claim.rowCount === 1) {
      return res.json({ status: 'success', card: toCard(row), summary });
    }
    res.status(409).json({ status: 'duplicate', card: toCard(row), summary });
  } catch (err) {
    console.error('Scan error:', err);
    res.status(500).json({ error: 'সার্ভার ত্রুটি।' });
  }
});

// GET /api/cards/:code
router.get('/:code', async (req, res) => {
  try {
    const rowRes = await db.query('SELECT * FROM cards WHERE unique_code = $1', [req.params.code]);
    if (rowRes.rows.length === 0) return res.status(404).json({ error: 'কার্ড পাওয়া যায়নি।' });
    res.json({ card: toCard(rowRes.rows[0]) });
  } catch (err) {
    console.error('Get card error:', err);
    res.status(500).json({ error: 'সার্ভার ত্রুটি।' });
  }
});

// GET /api/cards/:code/photo
router.get('/:code/photo', async (req, res) => {
  try {
    const rowRes = await db.query('SELECT photo FROM cards WHERE unique_code = $1', [req.params.code]);
    if (rowRes.rows.length === 0 || !rowRes.rows[0].photo) return res.status(404).json({ error: 'ছবি পাওয়া যায়নি।' });
    res.sendFile(path.join(UPLOAD_DIR, path.basename(rowRes.rows[0].photo)));
  } catch (err) {
    console.error('Photo error:', err);
    res.status(500).json({ error: 'সার্ভার ত্রুটি।' });
  }
});

// PUT /api/cards/:code
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

    const clashRes = await db.query('SELECT unique_code FROM cards WHERE nid = $1 AND id != $2', [v.nid, existing.id]);
    if (clashRes.rows.length > 0) {
      removePhoto(newPhoto);
      return res.status(409).json({ error: 'এই এনআইডি অন্য কার্ডে ব্যবহার হয়েছে।', uniqueCode: clashRes.rows[0].unique_code });
    }

    const updatedAt = new Date().toISOString();
    const photoToSave = newPhoto || existing.photo;

    await db.query(`
      UPDATE cards SET
        nid=$1, name=$2, father_name=$3, mother_name=$4, phone=$5,
        dob=$6, age=$7, age_text=$8, gender=$9, marital_status=$10,
        spouse_nid=$11, occupation=$12, social_status=$13,
        area_type=$14, area_name=$15, ward=$16,
        village=$17, upazila=$18, district=$19, photo=$20, updated_at=$21
      WHERE id=$22
    `, [
      v.nid, v.name, v.fatherName, v.motherName, v.phone,
      v.dob, v.age, v.ageText, v.gender, v.maritalStatus,
      v.spouseNid, v.occupation, v.socialStatus,
      v.areaType, v.areaName, v.ward,
      v.village, v.upazila, v.district, photoToSave, updatedAt, existing.id
    ]);

    if (newPhoto && existing.photo) removePhoto(existing.photo);

    const rowRes = await db.query('SELECT * FROM cards WHERE id = $1', [existing.id]);
    res.json({ card: toCard(rowRes.rows[0]) });
  } catch (err) {
    removePhoto(newPhoto);
    console.error('Card update error:', err);
    res.status(500).json({ error: 'কার্ড আপডেট করতে সমস্যা হয়েছে।' });
  }
});

// DELETE /api/cards/:code
router.delete('/:code', requireRole('admin'), async (req, res) => {
  try {
    const rowRes = await db.query('SELECT * FROM cards WHERE unique_code = $1', [req.params.code]);
    if (rowRes.rows.length === 0) return res.status(404).json({ error: 'কার্ড পাওয়া যায়নি।' });

    const row = rowRes.rows[0];
    await db.query('DELETE FROM cards WHERE id = $1', [row.id]);
    removePhoto(row.photo);
    res.json({ ok: true });
  } catch (err) {
    console.error('Card delete error:', err);
    res.status(500).json({ error: 'কার্ড মুছতে সমস্যা হয়েছে।' });
  }
});

module.exports = router;
