// scripts/install-python-deps.js
// npm install শেষে এই স্ক্রিপ্ট চলে এবং face_service.py এর জন্য Python প্যাকেজ ইনস্টল করে।
// Python না থাকলে বা ইনস্টল ব্যর্থ হলে সার্ভার চালু হতে বাধা দেয় না — শুধু সতর্ক বার্তা দেয়।

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PACKAGES = [
  'fastapi',
  'uvicorn',
  'python-multipart',
  'face_recognition',
  'numpy',
  'opencv-python-headless',
  'pillow',
];

// Python কমান্ড খোঁজা: Windows এ 'python', Unix-এ 'python3'
function findPython() {
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const cmd of candidates) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) {
      return { cmd, version: (r.stdout || r.stderr || '').trim() };
    }
  }
  return null;
}

function run(cmd, args) {
  return spawnSync(cmd, args, { stdio: 'inherit' });
}

function main() {
  const faceServicePath = path.join(__dirname, '..', 'face_service.py');
  if (!fs.existsSync(faceServicePath)) {
    console.log('[python-deps] face_service.py পাওয়া যায়নি, Python প্যাকেজ ইনস্টল বাদ দেওয়া হলো।');
    return;
  }

  const py = findPython();
  if (!py) {
    console.warn('[python-deps] ⚠️  Python পাওয়া যায়নি। face_service চালাতে Python 3.8–3.10 ইনস্টল করুন।');
    return;
  }

  console.log(`[python-deps] Python পাওয়া গেছে: ${py.cmd} (${py.version})`);

  // pip আছে কিনা যাচাই
  const pipCheck = spawnSync(py.cmd, ['-m', 'pip', '--version'], { encoding: 'utf8' });
  if (pipCheck.status !== 0) {
    console.warn('[python-deps] ⚠️  pip পাওয়া যায়নি। Python ইনস্টলেশন ঠিকভাবে করতে হবে।');
    return;
  }

  // dlib আগে ইনস্টল করার চেষ্টা (face_recognition এর নির্ভরতা)
  console.log('[python-deps] dlib ইনস্টল করার চেষ্টা...');
  const dlibRes = run(py.cmd, ['-m', 'pip', 'install', 'dlib']);
  if (dlibRes.status !== 0) {
    console.warn(
      '[python-deps] ⚠️  dlib ইনস্টল ব্যর্থ হয়েছে। Windows-এ CMake + Visual Studio C++ Build Tools ' +
        'লাগবে, অথবা আপনার Python সংস্করণের সাথে মিলে এমন dlib এর .whl ফাইল ম্যানুয়ালি ইনস্টল করুন।'
    );
    console.warn('[python-deps] বাকি প্যাকেজ ইনস্টল চালিয়ে যাওয়া হচ্ছে...');
  }

  // বাকি প্যাকেজ একসাথে
  console.log('[python-deps] বাকি Python প্যাকেজ ইনস্টল করা হচ্ছে...');
  const res = run(py.cmd, ['-m', 'pip', 'install', ...PACKAGES]);
  if (res.status === 0) {
    console.log('[python-deps] ✅ Python প্যাকেজ ইনস্টল সম্পন্ন।');
  } else {
    console.warn(
      '[python-deps] ⚠️  কিছু Python প্যাকেজ ইনস্টল হয়নি। ' +
        'ম্যানুয়ালি চালান: pip install ' + PACKAGES.join(' ')
    );
  }
}

try {
  main();
} catch (err) {
  console.warn('[python-deps] ইনস্টলার চলাকালীন সমস্যা:', err.message);
}