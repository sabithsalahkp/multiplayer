const crypto = require('crypto');

const SESSION_COOKIE = 'playverse_session';
const SESSION_DAYS = 30;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase().slice(0, 254);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
}

function cleanDisplayName(value) {
  return String(value || '').replace(/[<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, 30);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function newSession() {
  const token = crypto.randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  };
}

function subscriptionInfo(user) {
  const expiresAt = user?.subscriptionExpiresAt || null;
  const active = Boolean(expiresAt && Date.parse(expiresAt) > Date.now());
  return { active, expiresAt };
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    subscription: subscriptionInfo(user)
  };
}

function safeEqualHex(expected, supplied) {
  const a = Buffer.from(String(expected || ''), 'utf8');
  const b = Buffer.from(String(supplied || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  SESSION_COOKIE,
  SESSION_DAYS,
  normalizeEmail,
  validEmail,
  cleanDisplayName,
  hashToken,
  newSession,
  subscriptionInfo,
  publicUser,
  safeEqualHex
};
