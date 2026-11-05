// ইতিহাস (অডিট লগ): কার্ডের সাথে যা কিছু ঘটে সব এখানে জমা হয়
const db = require('./db');

// অ্যাকশনের বাংলা নাম (অ্যাপে দেখানোর সুবিধার জন্য)
const ACTION_LABELS = {
  created: 'কার্ড তৈরি হয়েছে',
  updated: 'তথ্য বদলানো হয়েছে',
  card_opened: 'কার্ড খোলা হয়েছে',
  card_saved: 'কার্ড গ্যালারিতে সেভ করা হয়েছে',
  verified: 'কিউআর কোড যাচাই করা হয়েছে',
  verify_revoked: 'বাতিল কার্ড যাচাইয়ের চেষ্টা হয়েছে',
  duplicate_submit: 'একই তথ্য আবার পাঠানো হয়েছে (নতুন কার্ড হয়নি)',
  deleted: 'কার্ড মুছে ফেলা হয়েছে',
  restored: 'কার্ড ফিরিয়ে আনা হয়েছে',
};

// অ্যাপ নিজে যে অ্যাকশনগুলো জানাতে পারবে (বাকিগুলো শুধু সার্ভার নিজে বসায়)
const CLIENT_ACTIONS = ['card_opened', 'card_saved'];

const insert = db.prepare(`
  INSERT INTO events (card_id, unique_code, action, actor_id, actor_name, details, ip)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// ইতিহাস লিখতে গিয়ে ত্রুটি হলেও মূল কাজ যেন আটকে না যায়, তাই try/catch
function logEvent({ cardId = null, uniqueCode, action, user = null, ip = null, details = null }) {
  try {
    insert.run(
      cardId,
      uniqueCode,
      action,
      user ? user.id : null,
      user ? user.username : null,
      details ? JSON.stringify(details) : null,
      ip
    );
  } catch (err) {
    console.error('Event log error:', err);
  }
}

function toEvent(row) {
  let details = null;
  if (row.details) {
    try {
      details = JSON.parse(row.details);
    } catch (e) {
      details = null;
    }
  }
  return {
    id: row.id,
    uniqueCode: row.unique_code,
    action: row.action,
    label: ACTION_LABELS[row.action] || row.action,
    actor: row.actor_name || null,
    details,
    ip: row.ip,
    at: row.created_at,
  };
}

module.exports = { logEvent, toEvent, ACTION_LABELS, CLIENT_ACTIONS };
