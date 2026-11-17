// মূল সার্ভার ফাইল: চালু করতে  npm start
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('ত্রুটি: .env ফাইলে কমপক্ষে ৩২ অক্ষরের JWT_SECRET দিন (.env.example দেখুন)।');
  process.exit(1);
}

const { router: authRouter, requireAuth } = require('./auth');
const cardsRouter = require('./cards');
const verifyRouter = require('./verify');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

const origins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
if (origins.length) app.use(cors({ origin: origins }));

app.use(express.json({ limit: '2mb' })); // ভেক্টর ডেটার জন্য লিমিট বাড়ানো হলো

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api/verify', verifyRouter);
app.use('/api/cards', requireAuth, cardsRouter);

app.use((req, res) => res.status(404).json({ error: 'এই ঠিকানা পাওয়া যায়নি।' }));

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'ছবি ৩ এমবির বেশি হওয়া যাবে না।' });
  }
  if (err && err.message === 'INVALID_IMAGE_TYPE') {
    return res.status(415).json({ error: 'শুধু JPG, PNG বা WEBP ছবি দেওয়া যাবে।' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON সঠিক নয়।' });
  }
  console.error(err);
  res.status(500).json({ error: 'সার্ভারে একটি সমস্যা হয়েছে।' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`সার্ভার চালু আছে: http://localhost:${PORT}`);
});