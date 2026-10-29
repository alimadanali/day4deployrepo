import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getUser } from './db.js';

const secret = () => {
  if (!process.env.JWT_SECRET) {
    const err = new Error('JWT_SECRET is not set');
    err.status = 500;
    throw err;
  }
  return process.env.JWT_SECRET;
};

export const hashPassword = (password) => bcrypt.hash(password, 10);
// For an unknown user (no hash) compare against a dummy hash, so login timing doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);
export const verifyPassword = (password, hash) => bcrypt.compare(password, hash ?? DUMMY_HASH);

export function signToken(user) {
  return jwt.sign({ role: user.role }, secret(), {
    algorithm: 'HS256',
    subject: String(user.user_id),
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });
}

/** Sets req.user = { user_id, role } from the bearer token, or responds 401. */
export function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, secret(), { algorithms: ['HS256'] });
    req.user = { user_id: Number(payload.sub), role: payload.role };
    next();
  } catch (e) {
    if (e.status) return next(e);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** After requireAuth: only sales users (admins own no customers). */
export function requireSales(req, res, next) {
  if (req.user.role !== 'sales') return res.status(403).json({ error: 'Sales access required' });
  next();
}

/** After requireAuth: only admins. The role is re-checked in the database, so a demoted or deleted admin loses access at once. */
export async function requireAdmin(req, res, next) {
  try {
    const user = await getUser(req.user.user_id);
    if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
  } catch (e) {
    next(e);
  }
}
