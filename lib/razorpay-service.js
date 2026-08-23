const crypto = require('crypto');
const Razorpay = require('razorpay');
const { safeEqualHex } = require('./security');

const keyId = String(process.env.RAZORPAY_KEY_ID || '').trim();
const keySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
const webhookSecret = String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
const client = keyId && keySecret ? new Razorpay({ key_id: keyId, key_secret: keySecret }) : null;

function isConfigured() {
  return Boolean(client && webhookSecret);
}

function checkoutConfigured() {
  return Boolean(client);
}

function hmac(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  if (!keySecret) return false;
  return safeEqualHex(hmac(`${orderId}|${paymentId}`, keySecret), signature);
}

function verifyWebhookSignature(rawBody, signature) {
  if (!webhookSecret || !Buffer.isBuffer(rawBody)) return false;
  return safeEqualHex(hmac(rawBody, webhookSecret), signature);
}

async function createOrder({ amount, currency, receipt, userId }) {
  if (!client) throw new Error('Razorpay is not configured.');
  return client.orders.create({
    amount,
    currency,
    receipt,
    notes: { plan: 'host_30_days', user_id: userId }
  });
}

async function fetchPayment(paymentId) {
  if (!client) throw new Error('Razorpay is not configured.');
  return client.payments.fetch(paymentId);
}

module.exports = {
  keyId,
  isConfigured,
  checkoutConfigured,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  createOrder,
  fetchPayment,
  hmac
};
