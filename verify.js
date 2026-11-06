// কার্ড যাচাই (লগইন ছাড়াই): কিউআর স্ক্যান করে পাওয়া কোড দিয়ে কার্ড আসল কিনা দেখা
// গোপনীয়তার জন্য শুধু সীমিত তথ্য ফেরত যায় — এনআইডি আংশিক ঢাকা, ফোন নম্বর/বাবা-মায়ের নাম নেই
const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { UPLOAD_DIR } = require('./upload');

const router = express.Router();

// একই আইপি থেকে বারবার কোড আন্দাজ করে খোঁজা ঠেকানো
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { valid: false, error: 'অনেকবার চেষ্টা হয়েছে, একটু পরে আবার চেষ্টা করুন।' },
});

router.use(verifyLimiter);

const isCode = (code) => /^\d{12,13}$/.test(code);

// এনআইডির শেষ ৩ ডিজিট ছাড়া বাকি সব ঢেকে দেওয়া
const maskNid = (nid) => (nid.length > 3 ? '*'.repeat(nid.length - 3) + nid.slice(-3) : '***');

// GET /api/verify/:code
router.get('/:code', (req, res) => {
  const { code } = req.params;
  if (!isCode(code)) {
    return res.status(400).json({ valid: false, error: 'কোড সঠিক নয়।' });
  }

  const row = db.prepare('SELECT * FROM cards WHERE unique_code = ?').get(code);
  if (!row) {
    return res.status(404).json({ valid: false, error: 'এই কোডের কোনো কার্ড পাওয়া যায়নি।' });
  }

  const showPhoto = process.env.VERIFY_SHOW_PHOTO === 'true' && row.photo;

  res.json({
    valid: true,
    card: {
      uniqueCode: row.unique_code,
      name: row.name,
      nid: maskNid(row.nid),
      gender: row.gender,
      ward: row.ward,
      village: row.village,
      upazila: row.upazila,
      district: row.district,
      socialStatus: row.social_status,
      createdAt: row.created_at,
      photoUrl: showPhoto ? `/api/verify/${row.unique_code}/photo` : '',
    },
  });
});

// GET /api/verify/:code/photo — .env এ VERIFY_SHOW_PHOTO=true থাকলে তবেই কাজ করবে
router.get('/:code/photo', (req, res) => {
  const { code } = req.params;
  if (process.env.VERIFY_SHOW_PHOTO !== 'true' || !isCode(code)) {
    return res.status(404).json({ error: 'পাওয়া যায়নি।' });
  }
  const row = db.prepare('SELECT photo FROM cards WHERE unique_code = ?').get(code);
  if (!row || !row.photo) return res.status(404).json({ error: 'পাওয়া যায়নি।' });
  res.sendFile(path.join(UPLOAD_DIR, path.basename(row.photo)));
});

module.exports = router;
