const crypto = require('crypto');
const { Pool } = require('pg');

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const memory = {
  users: new Map(),
  usersByEmail: new Map(),
  sessions: new Map(),
  payments: new Map(),
  paymentsByPaymentId: new Map()
};

let pool = null;
let persistent = false;

function clone(value) {
  return value ? structuredClone(value) : null;
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    subscriptionExpiresAt: row.subscription_expires_at ? new Date(row.subscription_expires_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
  };
}

function mapPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    paymentId: row.payment_id,
    userId: row.user_id,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    receipt: row.receipt,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : null
  };
}

async function init() {
  if (!databaseUrl) {
    console.warn('[database] DATABASE_URL is missing. Accounts are temporary and live payments are disabled.');
    return { persistent: false };
  }

  pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: Number(process.env.DATABASE_POOL_SIZE || 8),
    idleTimeoutMillis: 30_000
  });

  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      subscription_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id)`,
    `CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at)`,
    `CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      order_id TEXT UNIQUE NOT NULL,
      payment_id TEXT UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      receipt TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      verified_at TIMESTAMPTZ
    )`,
    `CREATE INDEX IF NOT EXISTS payments_user_id_idx ON payments(user_id)`,
    `CREATE INDEX IF NOT EXISTS payments_status_idx ON payments(status)`
  ];

  for (const sql of statements) await pool.query(sql);
  await pool.query('DELETE FROM sessions WHERE expires_at <= NOW()');
  persistent = true;
  console.log('[database] PostgreSQL connected.');
  return { persistent: true };
}

function isPersistent() {
  return persistent;
}

async function createUser({ email, passwordHash, displayName }) {
  const id = crypto.randomUUID();
  if (pool) {
    const result = await pool.query(
      `INSERT INTO users (id, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, email, passwordHash, displayName]
    );
    return mapUser(result.rows[0]);
  }

  if (memory.usersByEmail.has(email)) {
    const error = new Error('Email already registered.');
    error.code = '23505';
    throw error;
  }
  const now = new Date().toISOString();
  const user = { id, email, passwordHash, displayName, subscriptionExpiresAt: null, createdAt: now };
  memory.users.set(id, user);
  memory.usersByEmail.set(email, id);
  return clone(user);
}

async function getUserByEmail(email) {
  if (pool) {
    const result = await pool.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
    return mapUser(result.rows[0]);
  }
  return clone(memory.users.get(memory.usersByEmail.get(email)));
}

async function getUserById(id) {
  if (pool) {
    const result = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    return mapUser(result.rows[0]);
  }
  return clone(memory.users.get(id));
}

async function createSession({ tokenHash, userId, expiresAt }) {
  if (pool) {
    await pool.query(
      'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [tokenHash, userId, expiresAt]
    );
    return;
  }
  memory.sessions.set(tokenHash, { userId, expiresAt: new Date(expiresAt).toISOString() });
}

async function getUserBySession(tokenHash) {
  if (!tokenHash) return null;
  if (pool) {
    const result = await pool.query(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    );
    return mapUser(result.rows[0]);
  }
  const session = memory.sessions.get(tokenHash);
  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    memory.sessions.delete(tokenHash);
    return null;
  }
  return clone(memory.users.get(session.userId));
}

async function deleteSession(tokenHash) {
  if (!tokenHash) return;
  if (pool) {
    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    return;
  }
  memory.sessions.delete(tokenHash);
}

async function deleteUser(userId) {
  if (pool) {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    return;
  }
  const user = memory.users.get(userId);
  if (!user) return;
  memory.users.delete(userId);
  memory.usersByEmail.delete(user.email);
  for (const [key, session] of memory.sessions) if (session.userId === userId) memory.sessions.delete(key);
  for (const [key, payment] of memory.payments) {
    if (payment.userId === userId) {
      memory.payments.delete(key);
      if (payment.paymentId) memory.paymentsByPaymentId.delete(payment.paymentId);
    }
  }
}

async function createPendingPayment({ orderId, userId, amount, currency, receipt }) {
  const id = crypto.randomUUID();
  if (pool) {
    const result = await pool.query(
      `INSERT INTO payments (id, order_id, user_id, amount, currency, status, receipt)
       VALUES ($1, $2, $3, $4, $5, 'created', $6)
       RETURNING *`,
      [id, orderId, userId, amount, currency, receipt]
    );
    return mapPayment(result.rows[0]);
  }
  const payment = { id, orderId, paymentId: null, userId, amount, currency, status: 'created', receipt, createdAt: new Date().toISOString(), verifiedAt: null };
  memory.payments.set(orderId, payment);
  return clone(payment);
}

async function getPaymentByOrderId(orderId) {
  if (pool) {
    const result = await pool.query('SELECT * FROM payments WHERE order_id = $1 LIMIT 1', [orderId]);
    return mapPayment(result.rows[0]);
  }
  return clone(memory.payments.get(orderId));
}

async function activateSubscription({ orderId, paymentId }) {
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const paymentResult = await client.query('SELECT * FROM payments WHERE order_id = $1 FOR UPDATE', [orderId]);
      const payment = paymentResult.rows[0];
      if (!payment) throw new Error('Payment order not found.');

      if (payment.status !== 'paid') {
        await client.query(
          `UPDATE payments
           SET status = 'paid', payment_id = $1, verified_at = NOW()
           WHERE order_id = $2`,
          [paymentId, orderId]
        );
        await client.query(
          `UPDATE users
           SET subscription_expires_at =
             CASE
               WHEN subscription_expires_at > NOW() THEN subscription_expires_at + INTERVAL '30 days'
               ELSE NOW() + INTERVAL '30 days'
             END,
             updated_at = NOW()
           WHERE id = $1`,
          [payment.user_id]
        );
      }

      const userResult = await client.query('SELECT * FROM users WHERE id = $1', [payment.user_id]);
      await client.query('COMMIT');
      return { user: mapUser(userResult.rows[0]), alreadyActivated: payment.status === 'paid' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const payment = memory.payments.get(orderId);
  if (!payment) throw new Error('Payment order not found.');
  const user = memory.users.get(payment.userId);
  if (!user) throw new Error('User not found.');
  const alreadyActivated = payment.status === 'paid';
  if (!alreadyActivated) {
    payment.status = 'paid';
    payment.paymentId = paymentId;
    payment.verifiedAt = new Date().toISOString();
    memory.paymentsByPaymentId.set(paymentId, orderId);
    const current = user.subscriptionExpiresAt ? Date.parse(user.subscriptionExpiresAt) : 0;
    user.subscriptionExpiresAt = new Date(Math.max(Date.now(), current) + 30 * 24 * 60 * 60 * 1000).toISOString();
  }
  return { user: clone(user), alreadyActivated };
}

async function markPaymentFailed(orderId) {
  if (pool) {
    await pool.query("UPDATE payments SET status = 'failed' WHERE order_id = $1 AND status <> 'paid'", [orderId]);
    return;
  }
  const payment = memory.payments.get(orderId);
  if (payment && payment.status !== 'paid') payment.status = 'failed';
}

async function close() {
  if (pool) await pool.end();
}

module.exports = {
  init,
  isPersistent,
  createUser,
  getUserByEmail,
  getUserById,
  createSession,
  getUserBySession,
  deleteSession,
  deleteUser,
  createPendingPayment,
  getPaymentByOrderId,
  activateSubscription,
  markPaymentFailed,
  close
};
