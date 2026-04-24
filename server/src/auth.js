import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const COOKIE = 'qa_lite_session';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
const COOKIE_SAMESITE = process.env.COOKIE_SAMESITE || 'lax';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;

export function issueSession(res, user) {
  const token = jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: COOKIE_SAMESITE,
    secure: COOKIE_SECURE,
    domain: COOKIE_DOMAIN,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE);
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: 'Oturum gerekli' });
  try {
    req.session = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Oturum geçersiz' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.session?.role !== 'Admin') return res.status(403).json({ error: 'Admin yetkisi gerekli' });
  next();
}
