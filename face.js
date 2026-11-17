// সার্ভারে কোনো মডেল বা Python লাগবে না। ভেক্টর মেলানোর কাজ শুধু এখানে হবে।

const MATCH_DISTANCE = Number(process.env.FACE_MATCH_DISTANCE || 0.5);
const DESCRIPTOR_DIM = 128;

// অ্যাপ থেকে পাঠানো অ্যারে (Array) থেকে Buffer বানানো
function toBlob(descriptorArray) {
  if (!Array.isArray(descriptorArray) || descriptorArray.length !== DESCRIPTOR_DIM) {
    throw new Error('ভেক্টরের মাপ ১২৮ হতে হবে');
  }
  const f32 = Float32Array.from(descriptorArray);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

// ডাটাবেসের Buffer থেকে অ্যারে বানানো
function fromBlob(buf) {
  const copy = Buffer.from(buf);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

// দুটি ভেক্টরের দূরত্ব মাপা
function distance(a, b) {
  if (a.length !== b.length || a.length === 0) throw new Error('ভেক্টরের মাপ মেলেনি');
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

module.exports = {
  toBlob,
  fromBlob,
  distance,
  MATCH_DISTANCE,
  DESCRIPTOR_DIM,
};