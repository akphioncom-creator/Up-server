// মুখের ভেক্টর — Python face_service (face_recognition) কে HTTP দিয়ে কল করে।
// Node সার্ভার নিজে মডেল চালায় না, তাই @vladmandic/face-api বা @tensorflow/tfjs-node লাগে না।
//
// cards.js এর ব্যবহার করা ইন্টারফেস একই থাকে:
//   extractFace(buf) -> { valid, message, descriptor? (Float32Array, 128) }
//   toBlob(desc), fromBlob(buf), distance(a,b), warmUp()
//
// .env এ লাগবে:
//   FACE_SERVICE_URL=http://localhost:8001
//   FACE_API_KEY=একটি-লম্বা-গোপন-কী
//   (ঐচ্ছিক) FACE_MATCH_DISTANCE=0.5  // এর কম হলে "একই ব্যক্তি"

const MODEL_NAME = 'face-recognition-128-v1';
const MATCH_DISTANCE = Number(process.env.FACE_MATCH_DISTANCE || 0.5);

// Python সার্ভিসের ভেক্টর সংখ্যা (face_recognition = 128)
const DESCRIPTOR_DIM = 128;

// সার্ভিসের ঠিকানা ও কী
const SERVICE_URL = (process.env.FACE_SERVICE_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.FACE_API_KEY || '';

// face_service.py এর /face/check এর বিকল্প: আমরা extractFace দিয়ে embedding নিই,
// তারপর দরকার হলে check আলাদা করে করি। এখানে embedding endpoint ব্যবহার করছি।
const EMBEDDING_PATH = '/face/embedding';
const HEALTH_PATH = '/health';

// সময়সীমা (দীর্ঘ ছবি/ধীর সার্ভারের জন্য)
const TIMEOUT_MS = 30000;

function codedError(code, message, cause) {
  const err = new Error(message);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

// সার্ভিস ব্যবহারযোগ্য কিনা আগেভাগে যাচাই (warmUp)
async function checkService() {
  if (!SERVICE_URL || !API_KEY) {
    throw codedError('FACE_ENGINE_UNAVAILABLE', 'FACE_SERVICE_URL বা FACE_API_KEY সেট করা নেই');
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(SERVICE_URL + HEALTH_PATH, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`health ${res.status}`);
    return true;
  } catch (e) {
    throw codedError('FACE_ENGINE_UNAVAILABLE', 'Face service available নয়', e);
  }
}

// ছবির বাফার Python সার্ভিসে পাঠিয়ে ভেক্টর নেওয়া
// ফেরত: { valid, message, descriptor?: Float32Array }
async function extractFace(imageBuffer) {
  if (!SERVICE_URL || !API_KEY) {
    throw codedError('FACE_ENGINE_UNAVAILABLE', 'FACE_SERVICE_URL বা FACE_API_KEY সেট করা নেই');
  }

  const form = new FormData();
  form.append('image', new Blob([imageBuffer], { type: 'image/jpeg' }), 'face.jpg');

  let res;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    res = await fetch(SERVICE_URL + EMBEDDING_PATH, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: form,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw codedError('FACE_ENGINE_UNAVAILABLE', 'Face service এ যোগাযোগ করা যায়নি', e);
  } finally {
    clearTimeout(timer);
  }

  let json = {};
  try {
    json = await res.json();
  } catch (e) {
    // JSON না হলে নিচে হ্যান্ডেল
  }

  if (res.status === 401) {
    throw codedError('FACE_ENGINE_UNAVAILABLE', 'Face service API key ভুল', new Error('401'));
  }
  if (!res.ok) {
    return { valid: false, message: json.detail || json.message || 'ছবি যাচাই করা যায়নি।' };
  }

  if (!json.valid) {
    return { valid: false, message: json.message || 'ছবিতে ঠিক একটি স্পষ্ট মুখ পাওয়া যায়নি।' };
  }

  const arr = Array.isArray(json.embedding) ? json.embedding : [];
  if (arr.length !== DESCRIPTOR_DIM) {
    throw codedError('FACE_ENGINE_UNAVAILABLE', 'ভেক্টরের মাপ প্রত্যাশিত নয়', new Error(`dim=${arr.length}`));
  }

  return { valid: true, message: '', descriptor: Float32Array.from(arr) };
}

// ডেটাবেসে রাখার জন্য: Float32Array → Buffer (128 × 4 = 512 বাইট)
function toBlob(descriptor) {
  const f32 = Float32Array.from(descriptor);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

// Buffer → Float32Array (কপি করে নেওয়া হয়)
function fromBlob(buf) {
  const copy = Buffer.from(buf);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

// দুটি ভেক্টরের ইউক্লিডিয়ান দূরত্ব (face_recognition এর মতোই)
function distance(a, b) {
  if (a.length !== b.length || a.length === 0) throw new Error('ভেক্টরের মাপ মেলেনি');
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// সার্ভার চালুর সময় Python সার্ভিস আগেভাগে যাচাই
function warmUp() {
  return checkService();
}

module.exports = {
  extractFace,
  toBlob,
  fromBlob,
  distance,
  warmUp,
  MATCH_DISTANCE,
  MODEL_NAME,
  DESCRIPTOR_DIM,
};