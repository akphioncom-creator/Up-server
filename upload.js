// ছবি আপলোড (multer): শুধু JPG/PNG/WEBP, সর্বোচ্চ ৩ এমবি, নাম এলোমেলো করে সেভ
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // ব্যবহারকারীর দেওয়া নাম ব্যবহার হয় না, তাই পথ-সংক্রান্ত আক্রমণের সুযোগ নেই
    cb(null, crypto.randomBytes(16).toString('hex') + EXT_BY_MIME[file.mimetype]);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!EXT_BY_MIME[file.mimetype]) {
      return cb(new Error('INVALID_IMAGE_TYPE'));
    }
    cb(null, true);
  },
});

// ছবির ফাইল মুছে ফেলা (কার্ড মুছলে বা ছবি বদলালে)
function removePhoto(filename) {
  if (!filename) return;
  // শুধু ফাইলের নাম রাখা হয়, ফোল্ডারের অংশ কেটে ফেলা হয়
  const safe = path.basename(filename);
  fs.unlink(path.join(UPLOAD_DIR, safe), () => {});
}

module.exports = { upload, removePhoto, UPLOAD_DIR };
