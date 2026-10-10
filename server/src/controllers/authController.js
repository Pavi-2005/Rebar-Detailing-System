import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { getJwtSecret } from '../utils/jwtSecret.js';

const JWT_EXPIRES_IN = '7d';

function createToken(user, secret) {
  return jwt.sign({ id: String(user._id), email: user.email, name: user.name }, secret, { expiresIn: JWT_EXPIRES_IN });
}

export async function signup(req, res) {
  try {
    const secret = getJwtSecret();
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required.' });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Email is already registered.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash });
    const token = createToken(user, secret);

    res.status(201).json({ user: { name: user.name, email: user.email }, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function login(req, res) {
  try {
    const secret = getJwtSecret();
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = createToken(user, secret);
    res.json({ user: { name: user.name, email: user.email }, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export function currentUser(req, res) {
  return res.json({ user: { name: req.user.name, email: req.user.email } });
}
