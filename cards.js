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

// ১২ ডিজিটের এমন কোড তৈরি যা আগে নেই (crypto দিয়ে, Math.random নয়)
const codeExists = db.prepare('SELECT 1 FROM cards WHERE unique_code = ?');
function generateUniqueCode() {
  for (let i = 0; i < 30; i++) {
    const code = String(crypto.randomInt(100000000000, 1000000000000));
    if (!codeExists.get(code)) return code;
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
    ward: row.ward,
    village: row.village,
    upazila: row.upazila,
    district: row.district,
    photoUrl: row.photo ? `/api/cards/${row.unique_code}/photo` : '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

  // কার্ড তৈরির তারিখ: অ্যাপ ISO তারিখ দিলে সেটা, না দিলে সার্ভারের এখনকার সময়
  const parsed = v.createdAt ? new Date(v.createdAt) : null;
  v.createdAt = parsed && !isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();

  return { errors, value: v };
}

// ---------- রাউট ----------

// POST /api/cards — নতুন কার্ড (JSON অথবা multipart: photo + data)
router.post('/', upload.single('photo'), (req, res) => {
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

  // একই ডেটা দুইবার পাঠালে (যেমন নেট কেটে গিয়ে আবার পাঠানো) নতুন কার্ড না বানিয়ে আগেরটাই ফেরত
  if (v.clientId) {
    const same = db.prepare('SELECT * FROM cards WHERE client_id = ?').get(v.clientId);
    if (same) {
      removePhoto(photoName);
      return res.status(200).json({ card: toCard(same), duplicate: true });
    }
  }

  // একই এনআইডি-র কার্ড আগেই থাকলে নতুন তৈরি হবে না
  const nidRow = db.prepare('SELECT * FROM cards WHERE nid = ?').get(v.nid);
  if (nidRow) {
    removePhoto(photoName);
    return res.status(409).json({
      error: 'এই এনআইডি দিয়ে কার্ড আগেই তৈরি করা আছে।',
      uniqueCode: nidRow.unique_code,
    });
  }

  try {
    const code = generateUniqueCode();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO cards (
        unique_code, client_id, nid, name, father_name, mother_name, phone, dob, age, age_text,
        gender, marital_status, spouse_nid, occupation, social_status, ward, village, upazila,
        district, photo, created_at, updated_at, created_by
      ) VALUES (
        @code, @clientId, @nid, @name, @fatherName, @motherName, @phone, @dob, @age, @ageText,
        @gender, @maritalStatus, @spouseNid, @occupation, @socialStatus, @ward, @village, @upazila,
        @district, @photo, @createdAt, @updatedAt, @createdBy
      )
    `).run({ ...v, code, photo: photoName, updatedAt: now, createdBy: req.user.id });

    const row = db.prepare('SELECT * FROM cards WHERE unique_code = ?').get(code);
    res.status(201).json({ card: toCard(row) });
  } catch (err) {
    removePhoto(photoName);
    console.error('Card insert error:', err);
    res.status(500).json({ error: 'কার্ড সংরক্ষণ করতে সমস্যা হয়েছে।' });
  }
});

// GET /api/cards?page=1&limit=50&q=রহিম — তালিকা ও খোঁজা
router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const q = str(req.query.q);

  const where = q ? 'WHERE name LIKE @like OR nid LIKE @like OR phone LIKE @like OR unique_code LIKE @like' : '';
  const params = q ? { like: `%${q}%` } : {};

  const total = db.prepare(`SELECT COUNT(*) AS n FROM cards ${where}`).get(params).n;
  const rows = db
    .prepare(`SELECT * FROM cards ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset: (page - 1) * limit });

  res.json({ total, page, limit, items: rows.map(toCard) });
});

// GET /api/cards/:code — একটি কার্ড
router.get('/:code', (req, res) => {
  const row = db.prepare('SELECT * FROM cards WHERE unique_code = ?').get(req.params.code);
  if (!row) return res.status(404).json({ error: 'কার্ড পাওয়া যায়নি।' });
  res.json({ card: toCard(row) });
});

// GET /api/cards/:code/photo — ছবি (লগইন করা ব্যবহারকারীর জন্য)
router.get('/:code/photo', (req, res) => {
  const row = db.prepare('SELECT photo FROM cards WHERE unique_code = ?').get(req.params.code);
  if (!row || !row.photo) return res.status(404).json({ error: 'ছবি পাওয়া যায়নি।' });
  res.sendFile(path.join(UPLOAD_DIR, path.basename(row.photo)));
});

// PUT /api/cards/:code — তথ্য বদলানো (নতুন ছবি দিলে পুরনোটা মুছে যাবে; কোড বদলায় না)
router.put('/:code', upload.single('photo'), (req, res) => {
  const newPhoto = req.file ? req.file.filename : '';

  const existing = db.prepare('SELECT * FROM cards WHERE unique_code = ?').get(req.params.code);
  if (!existing) {
    removePhoto(newPhoto);
    return res.status(404).json({ error: 'কার্ড পাওয়া যায়নি।' });
  }

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

  const clash = db.prepare('SELECT unique_code FROM cards WHERE nid = ? AND id != ?').get(v.nid, existing.id);
  if (clash) {
    removePhoto(newPhoto);
    return res.status(409).json({ error: 'এই এনআইডি অন্য কার্ডে ব্যবহার হয়েছে।', uniqueCode: clash.unique_code });
  }

  db.prepare(`
    UPDATE cards SET
      nid=@nid, name=@name, father_name=@fatherName, mother_name=@motherName, phone=@phone,
      dob=@dob, age=@age, age_text=@ageText, gender=@gender, marital_status=@maritalStatus,
      spouse_nid=@spouseNid, occupation=@occupation, social_status=@socialStatus, ward=@ward,
      village=@village, upazila=@upazila, district=@district, photo=@photo, updated_at=@updatedAt
    WHERE id=@id
  `).run({ ...v, photo: newPhoto || existing.photo, updatedAt: new Date().toISOString(), id: existing.id });

  if (newPhoto && existing.photo) removePhoto(existing.photo);

  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(existing.id);
  res.json({ card: toCard(row) });
});

// DELETE /api/cards/:code — শুধু admin মুছতে পারবে
router.delete('/:code', requireRole('admin'), (req, res) => {
  const row = db.prepare('SELECT * FROM cards WHERE unique_code = ?').get(req.params.code);
  if (!row) return res.status(404).json({ error: 'কার্ড পাওয়া যায়নি।' });

  db.prepare('DELETE FROM cards WHERE id = ?').run(row.id);
  removePhoto(row.photo);
  res.json({ ok: true });
});

module.exports = router;
