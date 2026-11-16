// মুখের ছবি থেকে ভেক্টর বানানো ও মেলানো — সম্পূর্ণ Node.js এ, face_service.py (Python) লাগে না।
//
// ইনস্টল (server ফোল্ডারে):
//   npm install @vladmandic/face-api @tensorflow/tfjs-node
//
// মডেলের ফাইল @vladmandic/face-api প্যাকেজের ভেতরেই আছে, আলাদা করে নামাতে হয় না।
// এটি cards.js এর ব্যবহার করা ইন্টারফেসই দেয়: extractFace, toBlob, fromBlob, distance, MATCH_DISTANCE, MODEL_NAME
//
// ভেক্টর: ১২৮ সংখ্যা (dlib-ধাঁচের ResNet), মাপ: ইউক্লিডিয়ান দূরত্ব (যত কম তত বেশি মিল)।

const path = require('path');

const MODEL_NAME = 'face-api-128-v1'; // মডেল বদলালে এই নামও বদলান, cards.js তখন পুরোনো ভেক্টর ধরে ফেলবে
const MATCH_DISTANCE = Number(process.env.FACE_MATCH_DISTANCE || 0.5); // এর কম হলে "একই ব্যক্তি" (face-api এর ডিফল্ট ০.৬, পরিচয়ের কাজে ০.৫ নিরাপদ)
const MIN_DET_SCORE = 0.6; // মুখ শনাক্তের সর্বনিম্ন নিশ্চয়তা
const MIN_FACE_SIZE = 80; // মুখের বক্সের সর্বনিম্ন পিক্সেল (ছোট দিক)
const MAX_SIDE = 1280; // এর চেয়ে বড় ছবি ছোট করে নেওয়া হয় (মেমরি বাঁচাতে)

let tf = null;
let faceapi = null;
let loading = null;

function codedError(code, message, cause) {
  const err = new Error(message);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

// মডেল একবারই লোড হয় (প্রথম অনুরোধে)
function loadEngine() {
  if (!loading) {
    loading = (async () => {
      try {
        tf = require('@tensorflow/tfjs-node');
        faceapi = require('@vladmandic/face-api');
        const modelDir =
          process.env.FACE_MODEL_DIR ||
          path.join(path.dirname(require.resolve('@vladmandic/face-api')), '..', 'model');
        await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelDir);
        await faceapi.nets.faceLandmark68Net.loadFromDisk(modelDir);
        await faceapi.nets.faceRecognitionNet.loadFromDisk(modelDir);
      } catch (e) {
        loading = null; // পরের অনুরোধে আবার চেষ্টা হবে
        console.error('Face engine load error:', e);
        throw codedError('FACE_ENGINE_UNAVAILABLE', 'Face engine unavailable', e);
      }
    })();
  }
  return loading;
}

function decode(buffer) {
  try {
    let img = tf.node.decodeImage(buffer, 3, 'int32', false); // JPG / PNG / BMP
    const [h, w] = img.shape;
    const big = Math.max(h, w);
    if (big > MAX_SIDE) {
      const k = MAX_SIDE / big;
      const small = tf.tidy(() =>
        tf.image.resizeBilinear(img, [Math.round(h * k), Math.round(w * k)]).cast('int32')
      );
      img.dispose();
      img = small;
    }
    return img;
  } catch (e) {
    throw codedError('UNSUPPORTED_IMAGE', 'Unsupported image', e);
  }
}

// ছবিতে ঠিক একটি স্পষ্ট মুখ আছে কিনা দেখে; থাকলে তার ভেক্টর দেয়।
// ফেরত: { valid, message, descriptor? (Float32Array, ১২৮) }
async function extractFace(imageBuffer) {
  await loadEngine();
  const input = decode(imageBuffer);

  try {
    const results = await faceapi
      .detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5, maxResults: 5 }))
      .withFaceLandmarks()
      .withFaceDescriptors();

    if (results.length === 0) {
      return { valid: false, message: 'ছবিতে কোনো মুখ পাওয়া যায়নি, আবার তুলুন।' };
    }
    if (results.length > 1) {
      return { valid: false, message: 'ছবিতে একাধিক মুখ আছে, শুধু একজনের ছবি দিন।' };
    }

    const { detection, descriptor } = results[0];
    if (detection.score < MIN_DET_SCORE) {
      return { valid: false, message: 'মুখ স্পষ্ট নয়, ভালো আলোয় সামনে থেকে তুলুন।' };
    }
    if (Math.min(detection.box.width, detection.box.height) < MIN_FACE_SIZE) {
      return { valid: false, message: 'মুখ ছোট দেখাচ্ছে, ক্যামেরার আরেকটু কাছ থেকে তুলুন।' };
    }

    return { valid: true, message: '', descriptor };
  } finally {
    input.dispose();
  }
}

// ডেটাবেসে রাখার জন্য: Float32Array → Buffer (১২৮ × ৪ = ৫১২ বাইট)
function toBlob(descriptor) {
  const f32 = Float32Array.from(descriptor);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

// Buffer → Float32Array (কপি করে নেওয়া হয়, যাতে বাইট-সীমা নিয়ে সমস্যা না হয়)
function fromBlob(buf) {
  const copy = Buffer.from(buf); // নতুন, আলাদা মেমরি
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

// দুটি ভেক্টরের ইউক্লিডিয়ান দূরত্ব
function distance(a, b) {
  if (a.length !== b.length || a.length === 0) throw new Error('ভেক্টরের মাপ মেলেনি');
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// সার্ভার চালুর সময় মডেল আগেভাগে লোড করে রাখতে (প্রথম ছবির অপেক্ষা কমে)
function warmUp() {
  return loadEngine();
}

module.exports = { extractFace, toBlob, fromBlob, distance, warmUp, MATCH_DISTANCE, MODEL_NAME };
