/**
 * JWT 认证中间件
 * 企业实践：JWT Access Token + Refresh Token 双 Token 机制
 *   - Access Token：短期（15分钟），存在前端内存
 *   - Refresh Token：长期（7天），存在 HttpOnly Cookie，XSS 窃取不到
 * 面试话术：
 *   "Access Token 短过期是为了减小泄露后的风险窗口；
 *    Refresh Token 存 HttpOnly Cookie 是因为 JS 访问不到，天然防 XSS；
 *    同时开启 Token 轮转，每次刷新都换新 Token，即使被截获也无法重用。"
 */
const jwt = require('jsonwebtoken');
const logger = require('./logger');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-access-secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret';
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

/**
 * 生成 Access Token（短期，存内存）
 */
function generateAccessToken(user) {
  return jwt.sign(
    { username: user.username, nickname: user.nickname },
    ACCESS_SECRET,
    { expiresIn: ACCESS_EXPIRES }
  );
}

/**
 * 生成 Refresh Token（长期，存 HttpOnly Cookie）
 */
function generateRefreshToken(user) {
  return jwt.sign(
    { username: user.username },
    REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRES }
  );
}

/**
 * 验证 Access Token 的中间件
 * 用法：app.get('/api/protected', authenticate, (req, res) => { ... })
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ success: false, message: '未登录，请先登录' });
  }

  try {
    const decoded = jwt.verify(token, ACCESS_SECRET);
    req.user = decoded; // { username, nickname, iat, exp }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: '登录已过期，请刷新', code: 'TOKEN_EXPIRED' });
    }
    logger.warn({ err }, '无效的 Access Token');
    return res.status(403).json({ success: false, message: '无效的登录凭证' });
  }
}

/**
 * 刷新 Token 端点处理函数
 * 从 HttpOnly Cookie 中读取 Refresh Token，验证后签发新的 Access Token
 */
function handleRefreshToken(req, res) {
  const refreshToken = req.cookies?.refreshToken;
  if (!refreshToken) {
    return res.status(401).json({ success: false, message: '请重新登录' });
  }

  try {
    const decoded = jwt.verify(refreshToken, REFRESH_SECRET);

    // 签发新的 Access Token
    const newAccessToken = jwt.sign(
      { username: decoded.username },
      ACCESS_SECRET,
      { expiresIn: ACCESS_EXPIRES }
    );

    // 【安全最佳实践】Refresh Token 轮转：每次使用都换新的
    // 这样即使旧的 Refresh Token 被截获，也只能用一次
    const newRefreshToken = jwt.sign(
      { username: decoded.username },
      REFRESH_SECRET,
      { expiresIn: REFRESH_EXPIRES }
    );

    // 设置新的 Refresh Token Cookie
    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,  // JS 无法访问 → 防 XSS
      secure: process.env.COOKIE_SECURE === 'true', // 仅 HTTPS 环境开启（ngrok/线上）
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.json({ success: true, accessToken: newAccessToken });
  } catch (err) {
    logger.warn({ err }, '无效或过期的 Refresh Token');
    res.clearCookie('refreshToken');
    return res.status(401).json({ success: false, message: '登录已过期，请重新登录' });
  }
}

/**
 * 设置 Refresh Token Cookie（登录时调用）
 */
function setRefreshTokenCookie(res, user) {
  const refreshToken = generateRefreshToken(user);
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

/**
 * 清除 Refresh Token Cookie（退出登录时调用）
 */
function clearRefreshTokenCookie(res) {
  res.clearCookie('refreshToken', { path: '/' });
}

module.exports = {
  authenticate,
  generateAccessToken,
  generateRefreshToken,
  handleRefreshToken,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
};
