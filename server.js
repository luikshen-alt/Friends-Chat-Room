/**
 * local-chat-app — 主服务入口
 * ========================================
 * 企业级改造记录（对照差距分析报告 S0-S2）：
 *   S0-1  ✅ 删除密码明文回退逻辑
 *   S0-2  ✅ helmet 安全响应头
 *   S0-3  ✅ CORS 白名单
 *   S0-4  ✅ express-rate-limit 限流
 *   S0-5  ✅ 请求体大小限制
 *   S0-6  ✅ express-validator 输入校验
 *   S0-7  ✅ 全局错误处理中间件
 *   S0-8  ✅ .env 环境变量管理
 *   S1-1  ✅ JWT Access + Refresh Token
 *   S1-2  ✅ HttpOnly Cookie 存储 Token
 *   S1-3  ✅ 认证中间件
 *   S2-1  ✅ pino 结构化日志
 *   S2-2  ✅ morgan HTTP 请求日志
 *   S2-4  ✅ 进程异常兜底
 *   S2-7  ✅ /health /ready 健康检查
 */

// ===== 环境变量（最先加载） =====
require('dotenv').config();

const express = require('express');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

// ===== 安全与工程化中间件 =====
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const WebSocket = require('ws');
const multer = require('multer');

// ===== 自定义模块 =====
const db = require('./database');
const pokerRules = require('./pokerRules');
const logger = require('./middleware/logger');
const { requestContextMiddleware } = require('./middleware/requestContext');
const { AppError, notFoundHandler, globalErrorHandler } = require('./middleware/errorHandler');
const {
  authenticate, handleRefreshToken,
  generateAccessToken, setRefreshTokenCookie, clearRefreshTokenCookie,
} = require('./middleware/auth');
const { validate, registerRules, loginRules, nicknameRules, passwordRules,
  friendActionRules, friendRequestIdRules, remarkRules,
  privateMessageRules, privateHistoryRules, readRules,
  searchRules, pokerCreateRules, pokerJoinRules, pokerPlayRules,
  deleteUserRules,
} = require('./middleware/validators');

// ===== 环境变量 =====
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
// CORS 白名单：Express 端口(3000) + Vite 开发服务器(5173)
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173').split(',').map(s => s.trim());

// ===== Express 应用初始化 =====
const app = express();
const server = http.createServer(app);

// ===== 全局中间件（按顺序执行） =====
// 1. 信任代理（获取真实客户端 IP，配合 rate-limit）
app.set('trust proxy', 1);

// 2. 请求上下文（AsyncLocalStorage，为每个请求注入 requestId）
app.use(requestContextMiddleware);

// 3. HTTP 请求日志（morgan → pino 流）
app.use(morgan('combined', {
  stream: { write: (message) => logger.info({ component: 'http' }, message.trim()) },
}));

// 4. 安全响应头（helmet）
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // 项目中内联脚本较多，生产环境建议抽离
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
    },
  },
  crossOriginEmbedderPolicy: false, // 允许加载上传的图片
}));

// 5. CORS 跨域控制
app.use(cors({
  origin: (origin, callback) => {
    // 允许无 origin 的请求（如同源、Postman、移动端、ngrok 访问）
    // ngrok 等隧道工具会改变域名，这里放行所有来源（个人工具场景）
    if (!origin || CORS_ORIGINS.includes(origin) ||
        origin.includes('ngrok') || origin.includes('127.0.0.1')) {
      callback(null, true);
    } else {
      logger.warn({ origin }, 'CORS 拒绝未知来源');
      callback(new Error('不允许的跨域请求来源'));
    }
  },
  credentials: true,
}));

// 6. 响应压缩（gzip）
app.use(compression({ threshold: 512 })); // 大于 512 字节才压缩

// 7. 请求体解析 + 大小限制（防内存耗尽）
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// 8. Cookie 解析（Refresh Token 存储在 HttpOnly Cookie）
app.use(cookieParser());

// 9. 静态文件服务
// 生产环境：如果 client/dist 存在（React 构建产物），优先使用
// 开发环境：使用 public/ 目录下的原生 HTML
const reactDistPath = path.join(__dirname, 'client', 'dist');
const fs = require('fs');
if (fs.existsSync(reactDistPath)) {
  app.use(express.static(reactDistPath));
  logger.info('使用 React 生产构建 (client/dist)');
} else {
  app.use(express.static(path.join(__dirname, 'public')));
  logger.info('使用原生 HTML 前端 (public/)');
}

// ===== 速率限制（防暴力破解/DDoS） =====
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 分钟
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100, // 最多 100 次请求
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '请求过于频繁，请稍后再试' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX) || 5, // 登录接口 5 次
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '登录尝试过多，请 15 分钟后再试' },
});

// ===== 文件上传配置 =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const isAvatar = req.url.includes('avatar');
    cb(null, path.join(__dirname, 'public', 'uploads', isAvatar ? 'avatars' : ''));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
  },
});

// 文件类型白名单（安全：防止上传恶意文件）
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError('只允许上传 JPG/PNG/GIF/WebP 格式的图片', 400));
    }
  },
});

// ===== 健康检查端点 =====
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.get('/ready', (req, res) => {
  // 可以在这里检查数据库连接等依赖
  res.json({ status: 'ready' });
});

// ===================================================================
//                          API 路由
// ===================================================================

// ===== 认证相关 =====
// 注册
app.post('/api/register', registerRules, validate, (req, res, next) => {
  const { username, password, nickname, invitationCode } = req.body;
  db.getValidInvitationCode(invitationCode, (err, codeRow) => {
    if (err) return next(new AppError('验证码校验失败', 500));
    if (!codeRow) return next(new AppError('验证码无效或已过期', 400));
    db.getUserByUsername(username, async (err2, userRow) => {
      if (err2) return next(new AppError('服务器错误', 500));
      if (userRow) return next(new AppError('账号已存在', 400));
      // 密码哈希存储（bcrypt）
      const hashedPassword = await bcrypt.hash(password, 10);
      db.createUser(username, hashedPassword, nickname, (err3) => {
        if (err3) return next(new AppError('注册失败', 500));
        db.markInvitationCodeUsed(invitationCode, () => {});
        logger.info({ username }, '新用户注册成功');
        res.json({ success: true, message: '注册成功' });
      });
    });
  });
});

// 登录
app.post('/api/login', loginLimiter, loginRules, validate, (req, res, next) => {
  const { username, password } = req.body;
  db.getUserByUsername(username, async (err, user) => {
    if (err || !user) return next(new AppError('账号或密码错误', 400));
    const valid = await bcrypt.compare(password, user.password);
    // 🔴 已删除明文回退逻辑！只接受 bcrypt 验证
    if (!valid) {
      logger.warn({ username }, '登录失败：密码错误');
      return next(new AppError('账号或密码错误', 400));
    }
    const userData = { username: user.username, nickname: user.nickname, avatar: user.avatar };
    // 签发 Access Token + 设置 Refresh Token Cookie
    const accessToken = generateAccessToken(userData);
    setRefreshTokenCookie(res, userData);
    logger.info({ username }, '用户登录成功');
    res.json({ success: true, accessToken, user: userData });
  });
});

// 刷新 Token
app.post('/api/refresh', handleRefreshToken);

// 退出登录
app.post('/api/logout', (req, res) => {
  clearRefreshTokenCookie(res);
  res.json({ success: true, message: '已退出登录' });
});

// ===== 用户资料 =====
app.get('/api/user/profile', authenticate, (req, res, next) => {
  const { username } = req.query;
  if (!username) return next(new AppError('缺少用户名', 400));
  db.getUserByUsername(username, (err, user) => {
    if (err || !user) return next(new AppError('用户不存在', 404));
    res.json({ success: true, user: { username: user.username, nickname: user.nickname, avatar: user.avatar } });
  });
});

app.post('/api/user/nickname', authenticate, nicknameRules, validate, (req, res, next) => {
  const { username, nickname } = req.body;
  db.updateUserNickname(username, nickname, (err) => {
    if (err) return next(new AppError('修改失败', 500));
    logger.info({ username }, '昵称修改成功');
    res.json({ success: true, message: '修改成功' });
  });
});

app.post('/api/user/password', authenticate, passwordRules, validate, (req, res, next) => {
  const { username, oldPassword, newPassword } = req.body;
  db.getUserByUsername(username, async (err, user) => {
    if (err || !user) return next(new AppError('用户不存在', 400));
    const valid = await bcrypt.compare(oldPassword, user.password);
    if (!valid) return next(new AppError('旧密码错误', 400));
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    db.updateUserPassword(username, hashedPassword, (err2) => {
      if (err2) return next(new AppError('修改失败', 500));
      logger.info({ username }, '密码修改成功');
      res.json({ success: true, message: '密码修改成功' });
    });
  });
});

app.post('/api/user/avatar', authenticate, upload.single('avatar'), (req, res, next) => {
  const { username } = req.body;
  if (!username || !req.file) return next(new AppError('缺少参数', 400));
  const avatarUrl = '/uploads/avatars/' + req.file.filename;
  db.updateUserAvatar(username, avatarUrl, (err) => {
    if (err) return next(new AppError('上传失败', 500));
    res.json({ success: true, avatar: avatarUrl });
  });
});

// ===== 图片上传 =====
app.post('/api/upload/image', authenticate, upload.single('image'), (req, res, next) => {
  if (!req.file) return next(new AppError('没有文件', 400));
  const url = '/uploads/' + req.file.filename;
  res.json({ success: true, url });
});

// ===== 好友相关 =====
app.get('/api/friend/search', authenticate, searchRules, validate, (req, res, next) => {
  const { q } = req.query;
  db.searchUsers(q, (err, users) => {
    if (err) return next(new AppError('搜索失败', 500));
    res.json({ success: true, users });
  });
});

app.post('/api/friend/add', authenticate, friendActionRules, validate, (req, res, next) => {
  const { userA, userB } = req.body;
  db.createFriendRequest(userA, userB, (err, result) => {
    if (err) return next(new AppError('申请失败', 500));
    if (result.action === 'already_friend') {
      return res.json({ success: false, message: '你们已经是好友' });
    }
    if (result.action === 'duplicate') {
      return res.json({ success: false, message: '已发送过申请，等待对方处理' });
    }
    if (result.action === 'auto_accept') {
      notifyUser(userA, { type: 'friend_accepted', peer: userB });
      notifyUser(userB, { type: 'friend_accepted', peer: userA });
      return res.json({ success: true, message: '对方之前已向你申请，已自动成为好友' });
    }
    db.getUserByUsername(userA, (e, fromU) => {
      notifyUser(userB, {
        type: 'friend_request',
        from_user: userA,
        nickname: fromU ? fromU.nickname : userA,
        avatar: fromU ? fromU.avatar : null,
      });
    });
    res.json({ success: true, message: '好友申请已发送，等待对方同意' });
  });
});

app.get('/api/friend/requests', authenticate, (req, res, next) => {
  const { username } = req.query;
  if (!username) return next(new AppError('缺少用户名', 400));
  db.getFriendRequests(username, (err, requests) => {
    if (err) return next(new AppError('获取失败', 500));
    res.json({ success: true, requests: requests || [] });
  });
});

app.get('/api/friend/requests/count', authenticate, (req, res, next) => {
  const { username } = req.query;
  if (!username) return next(new AppError('缺少用户名', 400));
  db.countPendingRequests(username, (err, count) => {
    if (err) return next(new AppError('获取失败', 500));
    res.json({ success: true, count });
  });
});

app.post('/api/friend/accept', authenticate, friendRequestIdRules, validate, (req, res, next) => {
  const { id, username } = req.body;
  db.getFriendRequestById(id, (err, reqRow) => {
    if (err || !reqRow) return next(new AppError('申请不存在', 404));
    if (reqRow.to_user !== username) return next(new AppError('无权处理此申请', 403));
    db.acceptFriendRequest(id, (err2) => {
      if (err2) return next(new AppError(err2.message || '操作失败', 500));
      notifyUser(reqRow.from_user, { type: 'friend_accepted', peer: reqRow.to_user });
      notifyUser(reqRow.to_user, { type: 'friend_accepted', peer: reqRow.from_user });
      res.json({ success: true, message: '已同意好友申请' });
    });
  });
});

app.post('/api/friend/reject', authenticate, friendRequestIdRules, validate, (req, res, next) => {
  const { id, username } = req.body;
  db.getFriendRequestById(id, (err, reqRow) => {
    if (err || !reqRow) return next(new AppError('申请不存在', 404));
    if (reqRow.to_user !== username) return next(new AppError('无权处理此申请', 403));
    db.rejectFriendRequest(id, (err2) => {
      if (err2) return next(new AppError(err2.message || '操作失败', 500));
      res.json({ success: true, message: '已拒绝' });
    });
  });
});

app.post('/api/friend/remove', authenticate, friendActionRules, validate, (req, res, next) => {
  const { userA, userB } = req.body;
  db.removeFriend(userA, userB, (err) => {
    if (err) return next(new AppError('删除失败', 500));
    res.json({ success: true, message: '删除成功' });
  });
});

app.get('/api/friend/list', authenticate, (req, res, next) => {
  const { username } = req.query;
  if (!username) return next(new AppError('缺少用户名', 400));
  db.getFriendList(username, (err, friends) => {
    if (err) return next(new AppError('获取失败', 500));
    res.json({ success: true, friends });
  });
});

app.post('/api/friend/remark', authenticate, remarkRules, validate, (req, res, next) => {
  const { owner, target, remark } = req.body;
  const rem = (remark == null ? '' : String(remark)).slice(0, 40);
  db.setFriendRemark(owner, target, rem, (err) => {
    if (err) return next(new AppError('设置失败', 500));
    res.json({ success: true, remark: rem });
  });
});

// ===== 私聊 =====
app.get('/api/private/history', authenticate, privateHistoryRules, validate, (req, res, next) => {
  const { userA, userB } = req.query;
  db.getPrivateHistory(userA, userB, 200, (err, messages) => {
    if (err) return next(new AppError('获取失败', 500));
    res.json({ success: true, messages });
  });
});

app.get('/api/conversations', authenticate, (req, res, next) => {
  const { username } = req.query;
  if (!username) return next(new AppError('缺少用户名', 400));
  db.getConversations(username, (err, conversations) => {
    if (err) return next(new AppError('获取失败', 500));
    res.json({ success: true, conversations });
  });
});

app.post('/api/private/read', authenticate, readRules, validate, (req, res, next) => {
  const { username, peer } = req.body;
  db.markPrivateRead(username, peer, (err, changes) => {
    if (err) return next(new AppError('标记失败', 500));
    res.json({ success: true, changes });
  });
});

// ===== 大厅消息 =====
app.get('/api/messages', apiLimiter, (req, res, next) => {
  db.getMessages(200, (err, messages) => {
    if (err) return next(new AppError('获取消息失败', 500));
    res.json({ success: true, messages });
  });
});

// ===== 管理后台 =====
// 管理员登录（独立的密码认证，不依赖用户系统）
app.post('/api/admin/login', (req, res, next) => {
  const { password } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
  if (!password || password !== ADMIN_PASSWORD) {
    return next(new AppError('管理员密码错误', 403));
  }
  // 签发一个短期管理 Token
  const jwt = require('jsonwebtoken');
  const token = jwt.sign(
    { role: 'admin' },
    process.env.JWT_ACCESS_SECRET || 'dev-secret',
    { expiresIn: '2h' }
  );
  logger.info('管理员登录成功');
  res.json({ success: true, token, message: '管理员登录成功' });
});

app.post('/api/generate-code', (req, res, next) => {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  db.createInvitationCode(code, (err) => {
    if (err) return next(new AppError('生成验证码失败', 500));
    res.json({ success: true, code });
  });
});

app.get('/api/admin/users', (req, res, next) => {
  db.getAllUsers((err, users) => {
    if (err) return next(new AppError('获取用户失败', 500));
    res.json({ success: true, users });
  });
});

app.get('/api/admin/codes', (req, res, next) => {
  db.getAllCodes((err, codes) => {
    if (err) return next(new AppError('获取验证码失败', 500));
    const now = Date.now();
    const result = codes.map(c => {
      const created = new Date(c.created_at + 'Z').getTime();
      const expired = now - created > 2 * 60 * 1000;
      return { ...c, expired, expiredText: expired ? '已过期' : (c.used ? '已使用' : '有效') };
    });
    res.json({ success: true, codes: result });
  });
});

app.post('/api/admin/delete-user', deleteUserRules, validate, (req, res, next) => {
  const { username } = req.body;
  db.deleteUser(username, (err) => {
    if (err) return next(new AppError('删除失败', 500));
    res.json({ success: true, message: '删除成功' });
  });
});

app.post('/api/admin/delete-code', (req, res, next) => {
  const { id } = req.body;
  if (!id) return next(new AppError('缺少ID', 400));
  db.deleteCodeById(id, (err) => {
    if (err) return next(new AppError('删除失败', 500));
    res.json({ success: true, message: '删除成功' });
  });
});

// ===== ngrok 隧道管理 =====
let ngrokProcess = null;

function startNgrokProcess() {
  if (ngrokProcess) return { success: false, message: 'ngrok 已经在运行' };
  const ngrokPath = process.env.NGROK_PATH || 'ngrok';
  ngrokProcess = spawn(ngrokPath, ['http', String(PORT)], { detached: false, windowsHide: true });
  ngrokProcess.on('exit', () => { ngrokProcess = null; });
  return { success: true, message: 'ngrok 启动中，请等待几秒后刷新状态' };
}

function stopNgrokProcess() {
  if (!ngrokProcess) return { success: false, message: 'ngrok 未运行' };
  ngrokProcess.kill();
  ngrokProcess = null;
  return { success: true, message: 'ngrok 已停止' };
}

async function getNgrokStatus() {
  try {
    const response = await fetch('http://127.0.0.1:4040/api/tunnels');
    const data = await response.json();
    const tunnel = data.tunnels.find(t => t.proto === 'https');
    return { success: true, running: true, url: tunnel ? tunnel.public_url : null };
  } catch {
    return { success: true, running: false, url: null };
  }
}

app.post('/api/admin/ngrok-start', (req, res) => { res.json(startNgrokProcess()); });
app.post('/api/admin/ngrok-stop', (req, res) => { res.json(stopNgrokProcess()); });
app.get('/api/admin/ngrok-status', async (req, res) => { res.json(await getNgrokStatus()); });

// ===== 扑克游戏 =====
app.post('/api/game/poker/create', authenticate, pokerCreateRules, validate, (req, res, next) => {
  const { username } = req.body;
  removeUserFromAllRooms(username);
  db.getUserByUsername(username, (err, u) => {
    const nick = u ? u.nickname : username;
    const avatar = u ? u.avatar : null;
    const roomId = generateRoomId();
    const room = {
      id: roomId, ownerUsername: username,
      players: [{ username, nickname: nick, avatar, seat: 0, ready: false }],
      status: 'waiting', createdAt: Date.now(),
    };
    gameRooms.set(roomId, room);
    logger.info({ roomId, username }, '扑克房间已创建');
    res.json({ success: true, room: publicRoomView(room) });
  });
});

app.get('/api/game/poker/room', authenticate, (req, res, next) => {
  const { roomId } = req.query;
  if (!roomId) return next(new AppError('缺少房间号', 400));
  const room = gameRooms.get(roomId);
  if (!room) return next(new AppError('房间不存在或已解散', 404));
  res.json({ success: true, room: publicRoomView(room) });
});

app.post('/api/game/poker/join', authenticate, pokerJoinRules, validate, (req, res, next) => {
  const { roomId, username } = req.body;
  const room = gameRooms.get(roomId);
  if (!room) return next(new AppError('房间不存在或已解散', 404));
  const exist = room.players.find(p => p.username === username);
  if (exist) {
    broadcastRoom(roomId, { type: 'poker_room_update', room: publicRoomView(room) });
    return res.json({ success: true, room: publicRoomView(room) });
  }
  if (room.players.length >= 4) return next(new AppError('房间已满 (4/4)', 400));
  removeUserFromAllRooms(username);
  const fresh = gameRooms.get(roomId);
  if (!fresh) return next(new AppError('房间已解散', 404));
  db.getUserByUsername(username, (err, u) => {
    const nick = u ? u.nickname : username;
    const avatar = u ? u.avatar : null;
    const seatsTaken = new Set(fresh.players.map(p => p.seat));
    let seat = 0;
    while (seatsTaken.has(seat) && seat < 4) seat++;
    fresh.players.push({ username, nickname: nick, avatar, seat, ready: false });
    logger.info({ roomId, username }, '玩家加入扑克房间');
    broadcastRoom(roomId, { type: 'poker_room_update', room: publicRoomView(fresh) });
    res.json({ success: true, room: publicRoomView(fresh) });
  });
});

app.post('/api/game/poker/leave', authenticate, pokerJoinRules, validate, (req, res, next) => {
  const { roomId, username } = req.body;
  const room = gameRooms.get(roomId);
  if (!room) return res.json({ success: true });
  room.players = room.players.filter(p => p.username !== username);
  if (room.players.length === 0) {
    gameRooms.delete(roomId);
    logger.info({ roomId }, '扑克房间已销毁（最后一人离开）');
  } else {
    broadcastRoom(roomId, { type: 'poker_room_update', room: publicRoomView(room) });
  }
  res.json({ success: true });
});

app.post('/api/game/poker/ready', authenticate, pokerJoinRules, validate, (req, res, next) => {
  const { roomId, username, ready } = req.body;
  const room = gameRooms.get(roomId);
  if (!room) return next(new AppError('房间不存在或已解散', 404));
  const player = room.players.find(p => p.username === username);
  if (!player) return next(new AppError('你不在此房间中', 404));
  if (room.status === 'started') return next(new AppError('游戏已开始，无法修改准备状态', 400));
  player.ready = !!ready;
  if (room.players.length === 4 && room.players.every(p => p.ready)) {
    room.status = 'started';
    broadcastRoom(roomId, { type: 'poker_room_update', room: publicRoomView(room) });
    broadcastRoom(roomId, { type: 'poker_game_start', room: publicRoomView(room) });
    startPokerDeal(room);
  } else {
    broadcastRoom(roomId, { type: 'poker_room_update', room: publicRoomView(room) });
  }
  res.json({ success: true, room: publicRoomView(room) });
});

app.post('/api/game/poker/play', authenticate, pokerPlayRules, validate, (req, res, next) => {
  const { roomId, username, cardIds } = req.body;
  const room = gameRooms.get(roomId);
  if (!room) return next(new AppError('房间不存在', 404));
  if (room.phase !== 'playing') return next(new AppError('当前不是游戏阶段', 400));
  if (room.turnUsername !== username) return next(new AppError('还没轮到你出牌', 400));

  const myHand = room.hands[username] || [];
  const selected = [], remaining = [];
  const idSet = new Set(cardIds);
  myHand.forEach(c => {
    if (idSet.has(c.id)) selected.push(c);
    else remaining.push(c);
  });
  if (selected.length !== cardIds.length) {
    return next(new AppError('选中的牌在手牌中找不到', 400));
  }

  const hand = pokerRules.identify(selected);
  if (!hand) {
    const desc = selected.map(c => c.suit === 'JOKER' ? (c.rank === 'big' ? '大王' : '小王') : (c.suit + c.rank)).join(' ');
    return next(new AppError(`不是合法牌型 (${desc})`, 400));
  }

  const isTrickStart = room.currentTrick === null;
  if (!isTrickStart && !pokerRules.canBeat(hand, room.currentTrick.hand)) {
    return next(new AppError('压不过当前牌', 400));
  }

  room.hands[username] = remaining;
  room.trickScore += pokerRules.scoreOf(selected);
  room.currentTrick = { username, cards: selected, hand };
  room.passCount = 0;
  room.playedLog.push({ username, cards: selected, hand, ts: Date.now() });

  if (remaining.length === 0 && !room.finishRank.includes(username)) {
    room.finishRank.push(username);
  }

  const nextUser = getNextTurnUsername(room, username);
  if (nextUser === null || room.finishRank.length >= 3) {
    finishRound(room, username);
    return res.json({ success: true, room: publicRoomView(room) });
  }
  room.turnUsername = nextUser;
  broadcastRoom(roomId, { type: 'poker_room_update', room: publicRoomView(room) });
  broadcastRoom(roomId, { type: 'poker_play', username, cards: selected, hand, nextTurn: nextUser, trickScore: room.trickScore });
  notifyUser(username, { type: 'poker_your_hand', roomId: room.id, cards: room.hands[username] || [] });
  res.json({ success: true, room: publicRoomView(room) });
});

app.post('/api/game/poker/pass', authenticate, pokerJoinRules, validate, (req, res, next) => {
  const { roomId, username } = req.body;
  const room = gameRooms.get(roomId);
  if (!room) return next(new AppError('房间不存在', 404));
  if (room.phase !== 'playing') return next(new AppError('当前不是游戏阶段', 400));
  if (room.turnUsername !== username) return next(new AppError('还没轮到你', 400));
  if (room.currentTrick === null) return next(new AppError('自由出牌时不能过', 400));

  room.passCount += 1;
  const stillPlayingCount = room.players.filter(p => (room.hands[p.username] || []).length > 0).length;

  if (room.passCount >= stillPlayingCount - 1) {
    const winner = room.currentTrick.username;
    const gain = room.trickScore;
    room.scores[winner] = (room.scores[winner] || 0) + gain;
    broadcastRoom(roomId, { type: 'poker_trick_end', winner, gain, totalScore: room.scores[winner] });
    let nextFree = winner;
    if ((room.hands[winner] || []).length === 0) nextFree = getNextTurnUsername(room, winner);
    room.currentTrick = null;
    room.trickStarter = nextFree;
    room.turnUsername = nextFree;
    room.trickScore = 0;
    room.passCount = 0;
    if (room.finishRank.length >= 3 || nextFree === null) {
      finishRound(room, winner);
      return res.json({ success: true, room: publicRoomView(room) });
    }
    broadcastRoom(roomId, { type: 'poker_room_update', room: publicRoomView(room) });
    return res.json({ success: true, room: publicRoomView(room) });
  }

  const nextUser = getNextTurnUsername(room, username);
  if (nextUser === null) {
    finishRound(room, username);
    return res.json({ success: true, room: publicRoomView(room) });
  }
  room.turnUsername = nextUser;
  broadcastRoom(roomId, { type: 'poker_room_update', room: publicRoomView(room) });
  broadcastRoom(roomId, { type: 'poker_pass', username, nextTurn: nextUser });
  res.json({ success: true, room: publicRoomView(room) });
});

// ===== SPA 路由回退 =====
// React Router 使用客户端路由，直接访问 /admin 等路径时
// 后端需要返回 index.html，让前端路由接管
const reactIndexPath = path.join(__dirname, 'client', 'dist', 'index.html');
if (fs.existsSync(reactIndexPath)) {
  // 非 /api/ 路径全部返回 React index.html
  app.get(/^(?!\/api\/).*/, (req, res, next) => {
    // 跳过静态文件（已在上面 express.static 处理过的不会到这里）
    if (req.path.includes('.')) return next();
    res.sendFile(reactIndexPath);
  });
}

// ===== 404 处理（仅 API 路由） =====
app.use('/api', notFoundHandler);

// ===== 全局错误处理（必须放在最后） =====
app.use(globalErrorHandler);

// ===================================================================
//                          WebSocket
// ===================================================================
const wss = new WebSocket.Server({ server });
const clients = new Map();

// WebSocket 心跳检测配置
const HEARTBEAT_INTERVAL = 30000; // 30 秒
const HEARTBEAT_TIMEOUT = 10000;  // 10 秒无响应视为断线

function heartbeat() {
  this.isAlive = true;
}

const heartbeatTimer = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      logger.warn({ username: ws._username }, 'WebSocket 心跳超时，终止连接');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => clearInterval(heartbeatTimer));

function notifyUser(username, payload) {
  const client = clients.get(username);
  if (client && client.readyState === WebSocket.OPEN) {
    try { client.send(JSON.stringify(payload)); } catch (e) {
      logger.error({ err: e, username }, '推送消息失败');
    }
  }
}

// ===== 扑克游戏房间（内存存储） =====
const gameRooms = new Map();
const CCW_ORDER = [0, 3, 2, 1];

function generateRoomId() {
  return 'poker_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function buildTwoDecks() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  for (let copy = 0; copy < 2; copy++) {
    suits.forEach(s => ranks.forEach(r => deck.push({ suit: s, rank: r, copy, id: `${s}_${r}_${copy}` })));
    deck.push({ suit: 'JOKER', rank: 'small', copy, id: `JOKER_small_${copy}` });
    deck.push({ suit: 'JOKER', rank: 'big', copy, id: `JOKER_big_${copy}` });
  }
  return deck;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// （以下扑克游戏逻辑与原有代码保持一致，此处省略重复的函数定义）
// 包含: startPokerDeal, publicRoomView, broadcastRoom, removeUserFromAllRooms,
//       getNextTurnUsername, finishRound

function publicRoomView(room) {
  return {
    id: room.id, ownerUsername: room.ownerUsername,
    status: room.status, phase: room.phase,
    magicN: room.magicN, keyCard: room.keyCard,
    firstPlayerUsername: room.firstPlayerUsername,
    teammateUsername: room.teammateUsername,
    turnUsername: room.turnUsername,
    currentTrick: room.currentTrick ? {
      username: room.currentTrick.username,
      cards: room.currentTrick.cards,
      hand: room.currentTrick.hand,
    } : null,
    trickStarter: room.trickStarter || null,
    passCount: room.passCount || 0,
    trickScore: room.trickScore || 0,
    scores: room.scores || {},
    finishRank: room.finishRank || [],
    players: room.players.map(p => ({
      username: p.username, nickname: p.nickname, avatar: p.avatar,
      seat: p.seat, ready: p.ready,
      online: clients.has(p.username),
      handCount: room.hands ? (room.hands[p.username] || []).length : 0,
    })),
  };
}

function broadcastRoom(roomId, payload) {
  const room = gameRooms.get(roomId);
  if (!room) return;
  room.players.forEach(p => notifyUser(p.username, payload));
}

function removeUserFromAllRooms(username) {
  for (const [roomId, room] of gameRooms.entries()) {
    const idx = room.players.findIndex(p => p.username === username);
    if (idx < 0) continue;
    room.players.splice(idx, 1);
    if (room.players.length === 0) {
      gameRooms.delete(roomId);
    } else {
      broadcastRoom(roomId, { type: 'poker_room_update', room: publicRoomView(room) });
    }
  }
}

function getNextTurnUsername(room, currentUsername) {
  const cur = room.players.find(p => p.username === currentUsername);
  if (!cur) return null;
  let idx = CCW_ORDER.indexOf(cur.seat);
  for (let step = 1; step <= 4; step++) {
    const nextSeat = CCW_ORDER[(idx + step) % 4];
    const nextPlayer = room.players.find(p => p.seat === nextSeat);
    if (!nextPlayer) continue;
    if ((room.hands[nextPlayer.username] || []).length > 0) return nextPlayer.username;
  }
  return null;
}

function startPokerDeal(room) {
  const deck = shuffleInPlace(buildTwoDecks());
  const hands = { 0: [], 1: [], 2: [], 3: [] };
  const magicN = Math.floor(Math.random() * deck.length) + 1;
  let keyCard = null, firstPlayerSeat = null;
  for (let i = 0; i < deck.length; i++) {
    const seat = CCW_ORDER[i % 4];
    hands[seat].push(deck[i]);
    if (i + 1 === magicN) { keyCard = deck[i]; firstPlayerSeat = seat; }
  }
  let teammateSeat = null;
  for (let s = 0; s < 4; s++) {
    if (s === firstPlayerSeat) continue;
    const found = hands[s].some(c => c.suit === keyCard.suit && c.rank === keyCard.rank && c.id !== keyCard.id);
    if (found) { teammateSeat = s; break; }
  }
  const oppositeSeat = (firstPlayerSeat + 2) % 4;
  let swapped = null;
  if (teammateSeat !== null && teammateSeat !== oppositeSeat) {
    const teammatePlayer = room.players.find(p => p.seat === teammateSeat);
    const opposingPlayer = room.players.find(p => p.seat === oppositeSeat);
    if (teammatePlayer && opposingPlayer) {
      teammatePlayer.seat = oppositeSeat;
      opposingPlayer.seat = teammateSeat;
      const tmp = hands[teammateSeat];
      hands[teammateSeat] = hands[oppositeSeat];
      hands[oppositeSeat] = tmp;
      swapped = { from: teammateSeat, to: oppositeSeat, teammate: teammatePlayer.username, opposing: opposingPlayer.username };
      teammateSeat = oppositeSeat;
    }
  }
  room.hands = {};
  room.players.forEach(p => { room.hands[p.username] = hands[p.seat]; });
  room.phase = 'playing';
  room.magicN = magicN;
  room.keyCard = keyCard;
  const firstPlayer = room.players.find(p => p.seat === firstPlayerSeat);
  const teammate = teammateSeat !== null ? room.players.find(p => p.seat === teammateSeat) : null;
  room.firstPlayerUsername = firstPlayer ? firstPlayer.username : null;
  room.teammateUsername = teammate ? teammate.username : null;
  room.turnUsername = room.firstPlayerUsername;
  room.currentTrick = null;
  room.trickStarter = room.firstPlayerUsername;
  room.passCount = 0;
  room.trickScore = 0;
  room.playedLog = [];
  room.scores = {};
  room.finishRank = [];
  room.players.forEach(p => { room.scores[p.username] = 0; });
  logger.info({ roomId: room.id, magicN, keyCard: `${keyCard.suit}${keyCard.rank}` }, '扑克发牌完成');
  broadcastRoom(room.id, { type: 'poker_room_update', room: publicRoomView(room) });
  broadcastRoom(room.id, { type: 'poker_deal_done', magicN, keyCard, firstPlayerUsername: room.firstPlayerUsername, teammateUsername: room.teammateUsername, swapped });
  room.players.forEach(p => {
    notifyUser(p.username, { type: 'poker_your_hand', roomId: room.id, cards: room.hands[p.username] || [] });
  });
}

function finishRound(room, lastActor) {
  room.players.forEach(p => {
    if (!room.finishRank.includes(p.username)) room.finishRank.push(p.username);
  });
  room.phase = 'finished';
  room.players.forEach(p => { p.ready = false; });
  room.status = 'waiting';
  logger.info({ roomId: room.id, finishRank: room.finishRank, scores: room.scores }, '扑克本局结束');
  broadcastRoom(room.id, { type: 'poker_round_end', finishRank: room.finishRank, scores: room.scores });
  broadcastRoom(room.id, { type: 'poker_room_update', room: publicRoomView(room) });
}

// ===== WebSocket 连接处理 =====
wss.on('connection', (ws) => {
  ws._username = null;
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'auth') {
        ws._username = msg.username;
        clients.set(msg.username, ws);
        logger.info({ username: msg.username, onlineCount: clients.size }, 'WebSocket 客户端认证');
        // 断线重连同步
        for (const [roomId, room] of gameRooms.entries()) {
          if (room.players.some(p => p.username === msg.username)) {
            broadcastRoom(roomId, { type: 'poker_room_update', room: publicRoomView(room) });
            if (room.hands && room.hands[msg.username]) {
              notifyUser(msg.username, { type: 'poker_your_hand', roomId: room.id, cards: room.hands[msg.username] });
            }
            break;
          }
        }
        return;
      }

      if (msg.type === 'chat') {
        const { username, nickname, content, msg_type } = msg;
        if (!username || !nickname || !content) return;
        db.createMessage(username, nickname, content, msg_type || 'text', (err) => {
          if (err) { logger.error({ err }, '聊天消息写入失败'); return; }
          const broadcast = JSON.stringify({
            type: 'chat', username, nickname, content,
            msg_type: msg_type || 'text', avatar: msg.avatar,
            created_at: new Date().toISOString(),
          });
          let count = 0;
          clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              try { client.send(broadcast); count++; } catch (e) {}
            }
          });
        });
        return;
      }

      if (msg.type === 'private') {
        const { from_user, to_user, nickname, content, msg_type, avatar } = msg;
        if (!from_user || !to_user || !content) return;
        db.createPrivateMessage(from_user, to_user, content, msg_type || 'text', (err) => {
          if (err) return;
          const payload = JSON.stringify({
            type: 'private', from_user, to_user, nickname, content,
            msg_type: msg_type || 'text', avatar, created_at: new Date().toISOString(),
          });
          const target = clients.get(to_user);
          if (target && target.readyState === WebSocket.OPEN) {
            try { target.send(payload); } catch (e) {}
          }
          if (ws.readyState === WebSocket.OPEN) {
            try { ws.send(payload); } catch (e) {}
          }
        });
        return;
      }
    } catch (e) {
      logger.error({ err: e }, 'WebSocket 消息解析失败');
    }
  });

  ws.on('close', () => {
    if (ws._username) {
      clients.delete(ws._username);
      logger.info({ username: ws._username, onlineCount: clients.size }, 'WebSocket 客户端断开');
      for (const [roomId, room] of gameRooms.entries()) {
        const idx = room.players.findIndex(p => p.username === ws._username);
        if (idx < 0) continue;
        if (room.players.length === 1) {
          gameRooms.delete(roomId);
        } else {
          broadcastRoom(roomId, { type: 'poker_room_update', room: publicRoomView(room) });
        }
      }
    }
  });
});

// ===== 邀请码定时清理 =====
setInterval(() => {
  db.cleanExpiredCodes(() => {});
}, 60000);

// ===== 进程异常兜底（防止静默崩溃） =====
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, '未捕获异常 (uncaughtException)，进程即将退出');
  // 给 PM2 几秒钟记录日志后自动重启
  setTimeout(() => { process.exit(1); }, 3000);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, '未处理的 Promise 拒绝 (unhandledRejection)');
});

// ===== 优雅关闭（Graceful Shutdown） =====
function gracefulShutdown(signal) {
  logger.info({ signal }, '收到关闭信号，开始优雅关闭...');
  // 关闭 WebSocket 服务器
  wss.close(() => {
    logger.info('WebSocket 服务器已关闭');
    // 关闭 HTTP 服务器
    server.close(() => {
      logger.info('HTTP 服务器已关闭');
      // 关闭数据库连接
      db.close ? db.close(() => process.exit(0)) : process.exit(0);
    });
  });
  // 强制超时退出
  setTimeout(() => {
    logger.error('优雅关闭超时，强制退出');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ===== 启动服务器 =====
server.listen(PORT, () => {
  logger.info({ port: PORT, env: NODE_ENV }, '聊天服务器已启动');
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        logger.info({ address: iface.address, port: PORT }, '局域网访问地址');
      }
    }
  }
  logger.info({ url: `http://localhost:${PORT}` }, '本机访问地址');
  logger.info({ url: `http://localhost:${PORT}/health` }, '健康检查端点');
});
