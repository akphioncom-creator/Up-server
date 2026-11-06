// কার্ডের তথ্যের CRUD + ইতিহাস (সবই লগইন লাগে)
// শুধু তথ্য (ও ব্যক্তির ছবি) সার্ভারে থাকে; কার্ডের ডিজাইন/ছবি (PNG) সার্ভারে পাঠানো বা রাখা হয় না
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const { upload, removePhoto, UPLOAD_DIR } = require('./upload');
const { requireRole } = require('./auth');
const { logEvent, toEvent, CLIENT_ACTIONS } = require('./events');

const router = express.Router();

const GENDER_OPTIONS = ['পুরুষ', 'মহিলা', 'তৃতীয় লিঙ্গ'];
const MARITAL_OPTIONS = ['বিবাহিত', 'অবিবাহিত', 'বিধবা', 'বিপত্নিক'];
const OCCUPATION_OPTIONS = ['কৃষক', 'শ্রমিক', 'ব্যবসায়ী', 'গৃহিণী', 'অন্যান্য'];
const SOCIAL_STATUS_OPTIONS = ['Extremely Poor', 'Poor', 'Middle Class', 'Disabled'];
const MARRIED = 'বিবাহিত';

// বদল ধরার জন্য: অ্যাপের ফিল্ড → ডাটাবেসের কলাম (বয়স নিজে নিজে হিসাব হয় বলে বাদ)
const TRACKED_FIELDS = {
  nid: 'nid',
  name: 'name',
  fatherName: 'father_name',
  motherName: 'mother_name',
  phone: 'phone',
  dob: 'dob',
  gender: 'gender',
  maritalStatus: 'marital_status',
  spouseNid: 'spouse_nid',
  occupation: 'occupation',
  socialStatus: 'social_status',
  ward: 'ward',
  village: 'village',
  upazila: 'upazila',
  district: 'district',
};

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

// ১২ ডিজিটের এমন কোড তৈরি যা আগে নেই (মুছে ফেলা কার্ডের কোডও বাদ; crypto দিয়ে, Math.random নয়)
const codeExists = db.prepare('SELECT 1 FROM cards WHERE unique_code = ?');
function generateUniqueCode() {
  for (let i = 0; i < 30; i++) {
    const code = String(crypto.randomInt(100000000000, 1000000000000));
    if (!codeExists.get(code)) return code;
  }
  throw new Error('ইউনিক কোড তৈরি করা যায়নি');
}

// সক্রিয় (মুছে না ফেলা) কার্ড খোঁজা
const findActive = (code) =>
  db.prepare('SELECT * FROM cards WHERE unique_code = ? AND deleted_at IS NULL').get(code);
// মুছে ফেলা কার্ডসহ যেকোনো কার্ড খোঁজা
const findAny = (code) => db.prepare('SELECT * FROM cards WHERE unique_code = ?').get(code);

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
    deletedAt: row.deleted_at || null,
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

  if (v.nid && !/^\d{1,20}$/.test(v.nid)) errors.push('nid শুধু সংখ্যা হতে হবে (সর্বোচ্চ ২০ ডিজিট)');
  if (v.phone && !/^\+?\d{1,15}$/.test(v.phone)) errors.push('phone শুধু সংখ্যা হতে হবে (সর্বোচ্চ ১৫ ডিজিট)');
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

// স্বামী/স্ত্রীর এনআইডি নিয়ে সমস্যা আছে কিনা:
// - নিজের এনআইডি ও স্বামী/স্ত্রীর এনআইডি এক হতে পারবে না
// - স্বামী/স্ত্রীর এনআইডি দিয়ে সার্ভারে আগেই সক্রিয় কার্ড থাকলে নিবন্ধন হবে না
// সমস্যা থাকলে { status, error } ফেরত দেয়, না থাকলে null
function spouseProblem(v) {
  if (!v.spouseNid) return null;
  if (v.spouseNid === v.nid) {
    return { status: 400, error: 'নিজের এনআইডি ও স্বামী/স্ত্রীর এনআইডি এক হতে পারে না।' };
  }
  const row = db.prepare('SELECT 1 FROM cards WHERE nid = ? AND deleted_at IS NULL').get(v.spouseNid);
  if (row) {
    return {
      status: 409,
      error: 'স্বামী/স্ত্রীর এনআইডি নম্বর দিয়ে সার্ভারে আগেই কার্ড আছে, তাই এই নিবন্ধন করা যাবে না।',
    };
  }
  return null;
}

// ---------- রাউট ----------

// POST /api/cards — নতুন কার্ডের তথ্য (JSON অথবা multipart: photo + data)
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
      if (same.deleted_at) {
        return res.status(409).json({ error: 'এই কার্ডটি আগে মুছে ফেলা হয়েছে।', uniqueCode: same.unique_code });
      }
      logEvent({ cardId: same.id, uniqueCode: same.unique_code, action: 'duplicate_submit', user: req.user, ip: req.ip });
      return res.status(200).json({ card: toCard(same), duplicate: true });
    }
  }

  // একই এনআইডি-র সক্রিয় কার্ড আগেই থাকলে নতুন তৈরি হবে না
  const nidRow = db.prepare('SELECT * FROM cards WHERE nid = ? AND deleted_at IS NULL').get(v.nid);
  if (nidRow) {
    removePhoto(photoName);
    return res.status(409).json({
      error: 'এই এনআইডি দিয়ে কার্ড আগেই তৈরি করা আছে।',
      uniqueCode: nidRow.unique_code,
    });
  }

  // স্বামী/স্ত্রীর এনআইডি সার্ভারে আগেই থাকলে (বা নিজের এনআইডির সাথে এক হলে) নতুন কার্ড হবে না
  const spouseIssue = spouseProblem(v);
  if (spouseIssue) {
    removePhoto(photoName);
    return res.status(spouseIssue.status).json({ error: spouseIssue.error, field: 'spouseNid' });
  }

  try {
    const code = generateUniqueCode();
    const now = new Date().toISOString();

    const result = db.prepare(`
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

    logEvent({
      cardId: Number(result.lastInsertRowid),
      uniqueCode: code,
      action: 'created',
      user: req.user,
      ip: req.ip,
      details: { cardDate: v.createdAt, hasPhoto: Boolean(photoName), name: v.name },
    });

    res.status(201).json({ card: toCard(findAny(code)) });
  } catch (err) {
    removePhoto(photoName);
    // একই সময়ে দুজন একই এনআইডি পাঠালে ডাটাবেসের ইউনিক ইনডেক্স দ্বিতীয়জনকে ঠেকিয়ে দেয়
    if (err && String(err.code).startsWith('SQLITE_CONSTRAINT') && String(err.message).includes('cards.nid')) {
      return res.status(409).json({ error: 'এই এনআইডি দিয়ে কার্ড আগেই তৈরি করা আছে।' });
    }
    console.error('Card insert error:', err);
    res.status(500).json({ error: 'কার্ড সংরক্ষণ করতে সমস্যা হয়েছে।' });
  }
});

// GET /api/cards?page=1&limit=50&q=রহিম  — তালিকা ও খোঁজা
// ?status=deleted দিলে মুছে ফেলা কার্ডের তালিকা (শুধু admin)
router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const q = str(req.query.q);

  const wantDeleted = req.query.status === 'deleted';
  if (wantDeleted && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'এই কাজের অনুমতি আপনার নেই।' });
  }

  const conditions = [wantDeleted ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'];
  const params = {};
  if (q) {
    conditions.push('(name LIKE @like OR nid LIKE @like OR phone LIKE @like OR unique_code LIKE @like)');
    params.like = `%${q}%`;
  }
  const where = 'WHERE ' + conditions.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) AS n FROM cards ${where}`).get(params).n;
  const rows = db
    .prepare(`SELECT * FROM cards ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset: (page - 1) * limit });

  res.json({ total, page, limit, items: rows.map(toCard) });
});

// GET /api/cards/check-nid/:nid — এই এনআইডি দিয়ে সার্ভারে সক্রিয় কার্ড আছে কিনা (শুধু আছে/নেই জানায়, অন্য তথ্য নয়)
// অবশ্যই '/:code' রাউটের আগে থাকতে হবে, নাহলে 'check-nid' কে কোড ভেবে ফেলবে
router.get('/check-nid/:nid', (req, res) => {
  const nid = toEnglishDigits(str(req.params.nid));
  if (!/^\d{1,20}$/.test(nid)) {
    return res.status(400).json({ error: 'এনআইডি শুধু সংখ্যা হতে হবে।' });
  }
  const row = db.prepare('SELECT 1 FROM cards WHERE nid = ? AND deleted_at IS NULL').get(nid);
  res.json({ exists: Boolean(row) });
});

// GET /api/cards/:code — একটি কার্ডের তথ্য
router.get('/:code', (req, res) => {
  const row = findActive(req.params.code);
  if (!row) return res.status(404).json({ error: 'কার্ড পাওয়া যায়নি।' });
  res.json({ card: toCard(row) });
});

// GET /api/cards/:code/history — এই কার্ডের পুরো ইতিহাস (নতুন থেকে পুরনো)
// মুছে ফেলা কার্ডের ইতিহাস শুধু admin দেখতে পারবে
router.get('/:code/history', (req, res) => {
  const row = findAny(req.params.code);
  if (!row || (row.deleted_at && req.user.role !== 'admin')) {
    return res.status(404).json({ error: 'কার্ড পাওয়া যায়নি।' });
  }

  const events = db
    .prepare('SELECT * FROM events WHERE unique_code = ? ORDER BY id DESC')
    .all(row.unique_code)
    .map(toEvent);

  res.json({
    uniqueCode: row.unique_code,
    createdAt: row.created_at,
    deletedAt: row.deleted_at || null,
    total: events.length,
    events,
  });
});

// POST /api/cards/:code/events  { "action": "card_saved" | "card_opened" }
// অ্যাপ কার্ড খুললে বা গ্যালারিতে সেভ করলে এটি ডেকে ইতিহাসে জানিয়ে দেবে (শুধু তথ্য, কার্ডের ছবি পাঠানো হয় না)
router.post('/:code/events', (req, res) => {
  const row = findActive(req.params.code);
  if (!row) return res.status(404).json({ error: 'কার্ড পাওয়া যায়নি।' });

  const action = str(req.body && req.body.action);
  if (!CLIENT_ACTIONS.includes(action)) {
    return res.status(400).json({ error: `action হবে: ${CLIENT_ACTIONS.join(' / ')}` });
  }

  logEvent({ cardId: row.id, uniqueCode: row.unique_code, action, user: req.user, ip: req.ip });
  res.status(201).json({ ok: true });
});

// GET /api/cards/:code/photo — ব্যক্তির ছবি (লগইন করা ব্যবহারকারীর জন্য)
router.get('/:code/photo', (req, res) => {
  const row = findActive(req.params.code);
  if (!row || !row.photo) return res.status(404).json({ error: 'ছবি পাওয়া যায়নি।' });
  res.sendFile(path.join(UPLOAD_DIR, path.basename(row.photo)));
});

// PUT /api/cards/:code — তথ্য বদলানো (কোড বদলায় না; কী কী বদলালো তা ইতিহাসে লেখা হয়)
router.put('/:code', upload.single('photo'), (req, res) => {
  const newPhoto = req.file ? req.file.filename : '';

  const existing = findActive(req.params.code);
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

  const clash = db
    .prepare('SELECT unique_code FROM cards WHERE nid = ? AND id != ? AND deleted_at IS NULL')
    .get(v.nid, existing.id);
  if (clash) {
    removePhoto(newPhoto);
    return res.status(409).json({ error: 'এই এনআইডি অন্য কার্ডে ব্যবহার হয়েছে।', uniqueCode: clash.unique_code });
  }

  // বদলানোর সময়: স্বামী/স্ত্রীর এনআইডি নতুন করে দিলে বা বদলালে একই যাচাই (আগের সেভ করা মান অপরিবর্তিত থাকলে পুরনো তথ্য আটকাবে না)
  const spouseIssue = v.spouseNid !== existing.spouse_nid || v.spouseNid === v.nid ? spouseProblem(v) : null;
  if (spouseIssue) {
    removePhoto(newPhoto);
    return res.status(spouseIssue.status).json({ error: spouseIssue.error, field: 'spouseNid' });
  }

  // কোন ঘরে কী ছিল, কী হলো — আগে-পরে তুলনা
  const changes = {};
  for (const [field, column] of Object.entries(TRACKED_FIELDS)) {
    const before = existing[column] === null || existing[column] === undefined ? '' : String(existing[column]);
    const after = v[field] === null || v[field] === undefined ? '' : String(v[field]);
    if (before !== after) changes[field] = { from: before, to: after };
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

  if (Object.keys(changes).length || newPhoto) {
    logEvent({
      cardId: existing.id,
      uniqueCode: existing.unique_code,
      action: 'updated',
      user: req.user,
      ip: req.ip,
      details: { changes, photoChanged: Boolean(newPhoto) },
    });
  }

  res.json({ card: toCard(findAny(existing.unique_code)) });
});

// DELETE /api/cards/:code — শুধু admin। তথ্য মোছা হয় না, শুধু "মুছে ফেলা" চিহ্ন বসে; ইতিহাস থেকে যায়
router.delete('/:code', requireRole('admin'), (req, res) => {
  const row = findActive(req.params.code);
  if (!row) return res.status(404).json({ error: 'কার্ড পাওয়া যায়নি।' });

  const now = new Date().toISOString();
  db.prepare('UPDATE cards SET deleted_at = ?, deleted_by = ? WHERE id = ?').run(now, req.user.id, row.id);

  logEvent({ cardId: row.id, uniqueCode: row.unique_code, action: 'deleted', user: req.user, ip: req.ip, details: { name: row.name } });
  res.json({ ok: true });
});

// POST /api/cards/:code/restore — মুছে ফেলা কার্ড ফিরিয়ে আনা (শুধু admin)
router.post('/:code/restore', requireRole('admin'), (req, res) => {
  const row = findAny(req.params.code);
  if (!row || !row.deleted_at) return res.status(404).json({ error: 'মুছে ফেলা কোনো কার্ড পাওয়া যায়নি।' });

  const clash = db.prepare('SELECT unique_code FROM cards WHERE nid = ? AND deleted_at IS NULL').get(row.nid);
  if (clash) {
    return res.status(409).json({ error: 'এই এনআইডি এখন অন্য কার্ডে ব্যবহার হচ্ছে।', uniqueCode: clash.unique_code });
  }

  db.prepare('UPDATE cards SET deleted_at = NULL, deleted_by = NULL WHERE id = ?').run(row.id);
  logEvent({ cardId: row.id, uniqueCode: row.unique_code, action: 'restored', user: req.user, ip: req.ip });
  res.json({ card: toCard(findAny(row.unique_code)) });
});

module.exports = router;
