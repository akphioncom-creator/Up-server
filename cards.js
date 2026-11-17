const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { upload, removePhoto, UPLOAD_DIR } = require('./upload');
const { requireRole } = require('./auth');
const face = require('./face');

const router = express.Router();
const MARRIED = 'বিবাহিত';

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const toEnglishDigits = (text) => String(text).replace(/[০-৯]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x09e6 + 48));

// অ্যাপ থেকে পাঠানো ফেস ভেক্টর (JSON অ্যারে) কে Buffer এ রূপান্তর
function parseFaceVector(body) {
  if (body.faceVector && Array.isArray(body.faceVector) && body.faceVector.length === 128) {
    return face.toBlob(body.faceVector);
  }
  return null;
}

function toCard(row) {
  return {
    id: row.client_id || String(row.id),
    uniqueCode: row.unique_code,
    name: row.name,
    phone: row.phone,
    nid: row.nid,
    photoUrl: row.photo ? `/api/cards/${row.unique_code}/photo` : '',
    hasFace: Boolean(row.face_vector),
    scannedAt: row.scanned_at,
    createdAt: row.created_at,
  };
}

// POST /api/cards — নতুন কার্ড
router.post('/', upload.single('photo'), async (req, res) => {
  const photoName = req.file ? req.file.filename : '';
  let body = req.body;

  try {
    if (body.data) body = JSON.parse(body.data); // multipart হলে data ফিল্ডে JSON থাকে

    const faceVectorBuffer = parseFaceVector(body);

    // এনআইডি চেক
    const nidRes = await db.query('SELECT unique_code FROM cards WHERE nid = $1', [toEnglishDigits(body.nid)]);
    if (nidRes.rows.length > 0) {
      removePhoto(photoName);
      return res.status(409).json({ error: 'এই এনআইডি দিয়ে কার্ড আগেই তৈরি করা আছে।', uniqueCode: nidRes.rows[0].unique_code });
    }

    const code = String(crypto.randomInt(100000000000, 1000000000000));
    const now = new Date().toISOString();

    const result = await db.query(
      `INSERT INTO cards (
        unique_code, client_id, nid, name, father_name, mother_name, phone, dob, age, age_text,
        gender, marital_status, spouse_nid, occupation, social_status, area_type, area_name, ward,
        village, upazila, district, photo, face_vector, created_at, updated_at, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING *`,
      [
        code, body.clientId || null, toEnglishDigits(body.nid), body.name, body.fatherName, body.motherName, body.phone,
        body.dob, body.age, body.ageText, body.gender, body.maritalStatus, body.spouseNid || '',
        body.occupation, body.socialStatus, body.areaType || '', body.areaName || '', body.ward,
        body.village, body.upazila, body.district, photoName, faceVectorBuffer, now, now, req.user.id
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
    const incomingVector = req.body.faceVector; // অ্যাপ থেকে আসা অ্যারে
    if (!Array.isArray(incomingVector) || incomingVector.length !== 128) {
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
      distance: best.distance
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'সার্চে সমস্যা হয়েছে।' });
  }
});

module.exports = router;