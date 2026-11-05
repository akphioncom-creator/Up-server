// প্রথম ইউজার (admin) তৈরি করার স্ক্রিপ্ট
// ব্যবহার:  node seed.js <ইউজারনেম> <পাসওয়ার্ড> [admin|operator]
const bcrypt = require('bcryptjs');
const db = require('./db');

const [username, password, role = 'admin'] = process.argv.slice(2);

if (!username || !password) {
  console.log('ব্যবহার: node seed.js <ইউজারনেম> <পাসওয়ার্ড> [admin|operator]');
  process.exit(1);
}
if (password.length < 8) {
  console.log('পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।');
  process.exit(1);
}
if (!['admin', 'operator'].includes(role)) {
  console.log('role হবে admin অথবা operator।');
  process.exit(1);
}

try {
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
    username.trim(),
    bcrypt.hashSync(password, 10),
    role
  );
  console.log(`ইউজার তৈরি হয়েছে: ${username} (${role})`);
} catch (err) {
  if (String(err.message).includes('UNIQUE')) {
    console.log('এই ইউজারনেম আগেই আছে।');
  } else {
    console.error(err);
  }
  process.exit(1);
}
