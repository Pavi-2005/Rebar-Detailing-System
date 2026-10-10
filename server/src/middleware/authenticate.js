import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { getJwtSecret } from '../utils/jwtSecret.js';

export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication token missing' });
  }

  let secret;
  try {
    secret = getJwtSecret();
  } catch (error) {
    return next(error);
  }

  let decoded;
  try {
    decoded = jwt.verify(token, secret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (!mongoose.isValidObjectId(decoded?.id)) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'Account no longer exists.' });
    }

    req.user = { id: String(user._id), email: user.email, name: user.name };
    return next();
  } catch (error) {
    return next(error);
  }
}
