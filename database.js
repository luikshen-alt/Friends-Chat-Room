const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'chat.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    nickname TEXT NOT NULL,
    avatar TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    nickname TEXT NOT NULL,
    content TEXT NOT NULL,
    msg_type TEXT DEFAULT 'text',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS invitation_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    used INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a TEXT NOT NULL,
    user_b TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_a, user_b)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS private_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user TEXT NOT NULL,
    to_user TEXT NOT NULL,
    content TEXT NOT NULL,
    msg_type TEXT DEFAULT 'text',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user TEXT NOT NULL,
    to_user TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    handled_at DATETIME
  )`);

  // 好友本地备注：owner 给 target 起的备注（单向，仅 owner 能看到）
  db.run(`CREATE TABLE IF NOT EXISTS friend_remarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    target TEXT NOT NULL,
    remark TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner, target)
  )`);

  db.run(`ALTER TABLE users ADD COLUMN avatar TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('添加 avatar 字段失败:', err.message);
    }
  });

  db.run(`ALTER TABLE messages ADD COLUMN msg_type TEXT DEFAULT 'text'`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('添加 msg_type 字段失败:', err.message);
    } else if (!err) {
      console.log('已为 messages 表添加 msg_type 字段');
    }
  });

  db.run(`ALTER TABLE private_messages ADD COLUMN is_read INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('添加 is_read 字段失败:', err.message);
    } else if (!err) {
      console.log('已为 private_messages 表添加 is_read 字段');
    }
  });
});

function createUser(username, password, nickname, callback) {
  db.run(
    'INSERT INTO users (username, password, nickname) VALUES (?, ?, ?)',
    [username, password, nickname],
    function (err) {
      callback(err, this.lastID);
    }
  );
}

function getUserByUsername(username, callback) {
  db.get('SELECT * FROM users WHERE username = ?', [username], callback);
}

function updateUserAvatar(username, avatar, callback) {
  db.run('UPDATE users SET avatar = ? WHERE username = ?', [avatar, username], callback);
}

function updateUserNickname(username, nickname, callback) {
  db.run('UPDATE users SET nickname = ? WHERE username = ?', [nickname, username], callback);
}

function updateUserPassword(username, password, callback) {
  db.run('UPDATE users SET password = ? WHERE username = ?', [password, username], callback);
}

function createMessage(username, nickname, content, msgType, callback) {
  db.run(
    'INSERT INTO messages (username, nickname, content, msg_type) VALUES (?, ?, ?, ?)',
    [username, nickname, content, msgType || 'text'],
    function (err) {
      callback(err, this.lastID);
    }
  );
}

function getMessages(limit, callback) {
  db.all(
    'SELECT * FROM messages ORDER BY created_at ASC LIMIT ?',
    [limit || 200],
    callback
  );
}

function createInvitationCode(code, callback) {
  db.run('INSERT INTO invitation_codes (code) VALUES (?)', [code], function (err) {
    callback(err, this.lastID);
  });
}

function toSQLiteDatetime(date) {
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function getValidInvitationCode(code, callback) {
  const twoMinutesAgo = toSQLiteDatetime(new Date(Date.now() - 2 * 60 * 1000));
  db.get(
    'SELECT * FROM invitation_codes WHERE code = ? AND used = 0 AND created_at > ?',
    [code, twoMinutesAgo],
    callback
  );
}

function markInvitationCodeUsed(code, callback) {
  db.run('UPDATE invitation_codes SET used = 1 WHERE code = ?', [code], callback);
}

function cleanExpiredCodes(callback) {
  const twoMinutesAgo = toSQLiteDatetime(new Date(Date.now() - 2 * 60 * 1000));
  db.run('DELETE FROM invitation_codes WHERE created_at <= ?', [twoMinutesAgo], callback);
}

function getAllUsers(callback) {
  db.all('SELECT id, username, password, nickname, avatar, created_at FROM users ORDER BY created_at DESC', [], callback);
}

function deleteUser(username, callback) {
  db.run('DELETE FROM users WHERE username = ?', [username], callback);
}

function getAllCodes(callback) {
  db.all('SELECT * FROM invitation_codes ORDER BY created_at DESC', [], callback);
}

function deleteCodeById(id, callback) {
  db.run('DELETE FROM invitation_codes WHERE id = ?', [id], callback);
}

function searchUsers(query, callback) {
  const like = `%${query}%`;
  db.all(
    'SELECT username, nickname, avatar FROM users WHERE username LIKE ? OR nickname LIKE ? LIMIT 20',
    [like, like],
    callback
  );
}

function addFriend(userA, userB, callback) {
  const a = userA < userB ? userA : userB;
  const b = userA < userB ? userB : userA;
  db.run(
    'INSERT OR IGNORE INTO friendships (user_a, user_b) VALUES (?, ?)',
    [a, b],
    callback
  );
}

function removeFriend(userA, userB, callback) {
  const a = userA < userB ? userA : userB;
  const b = userA < userB ? userB : userA;
  db.run(
    'DELETE FROM friendships WHERE user_a = ? AND user_b = ?',
    [a, b],
    callback
  );
}

function getFriendList(username, callback) {
  db.all(
    `SELECT 
      CASE WHEN user_a = ? THEN user_b ELSE user_a END as username
    FROM friendships WHERE user_a = ? OR user_b = ?`,
    [username, username, username],
    (err, rows) => {
      if (err) return callback(err);
      const usernames = rows.map(r => r.username);
      if (usernames.length === 0) return callback(null, []);
      const placeholders = usernames.map(() => '?').join(',');
      db.all(
        `SELECT username, nickname, avatar FROM users WHERE username IN (${placeholders})`,
        usernames,
        (err2, users) => {
          if (err2) return callback(err2);
          // 再查备注
          db.all(
            `SELECT target, remark FROM friend_remarks WHERE owner = ?`,
            [username],
            (err3, rems) => {
              if (err3) return callback(err3);
              const remarkMap = {};
              (rems || []).forEach(r => { remarkMap[r.target] = r.remark; });
              users.forEach(u => { u.remark = remarkMap[u.username] || null; });
              callback(null, users);
            }
          );
        }
      );
    }
  );
}

// 设置 / 更新 / 清除 好友备注（remark 为空字符串 则删除）
function setFriendRemark(owner, target, remark, callback) {
  const r = (remark || '').trim();
  if (!r) {
    db.run('DELETE FROM friend_remarks WHERE owner = ? AND target = ?', [owner, target], callback);
  } else {
    db.run(
      `INSERT INTO friend_remarks (owner, target, remark, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(owner, target) DO UPDATE SET remark = excluded.remark, updated_at = CURRENT_TIMESTAMP`,
      [owner, target, r],
      callback
    );
  }
}

function isFriend(userA, userB, callback) {
  const a = userA < userB ? userA : userB;
  const b = userA < userB ? userB : userA;
  db.get(
    'SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ?',
    [a, b],
    (err, row) => callback(err, !!row)
  );
}

function createPrivateMessage(fromUser, toUser, content, msgType, callback) {
  db.run(
    'INSERT INTO private_messages (from_user, to_user, content, msg_type) VALUES (?, ?, ?, ?)',
    [fromUser, toUser, content, msgType || 'text'],
    function (err) {
      callback(err, this.lastID);
    }
  );
}

function getPrivateHistory(userA, userB, limit, callback) {
  db.all(
    `SELECT * FROM private_messages 
     WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)
     ORDER BY created_at ASC LIMIT ?`,
    [userA, userB, userB, userA, limit || 200],
    callback
  );
}

function getConversations(username, callback) {
  db.all(
    `SELECT from_user, to_user, content, msg_type, created_at, is_read
     FROM private_messages 
     WHERE from_user = ? OR to_user = ?
     ORDER BY created_at DESC`,
    [username, username],
    (err, rows) => {
      if (err) return callback(err);
      const conversations = {};
      rows.forEach(row => {
        const peer = row.from_user === username ? row.to_user : row.from_user;
        if (!conversations[peer]) {
          conversations[peer] = {
            peer,
            lastContent: row.content,
            lastMsgType: row.msg_type,
            lastTime: row.created_at,
            unreadCount: 0
          };
        }
        // 只有收到的、未读的才累加
        if (row.to_user === username && !row.is_read) {
          conversations[peer].unreadCount += 1;
        }
      });
      callback(null, Object.values(conversations));
    }
  );
}

// 标记与 peer 的私聊全部已读
function markPrivateRead(myUser, peer, callback) {
  db.run(
    `UPDATE private_messages SET is_read = 1 WHERE to_user = ? AND from_user = ? AND is_read = 0`,
    [myUser, peer],
    function (err) {
      callback(err, this ? this.changes : 0);
    }
  );
}

// ===== 好友申请 =====
// 创建好友申请。返回 { action: 'already_friend' | 'auto_accept' | 'duplicate' | 'created', requestId? }
function createFriendRequest(fromUser, toUser, callback) {
  // 1. 是否已是好友
  isFriend(fromUser, toUser, (err, already) => {
    if (err) return callback(err);
    if (already) return callback(null, { action: 'already_friend' });
    // 2. 对方是否已发给自己 pending 申请 → 自动接受
    db.get(
      `SELECT id FROM friend_requests WHERE from_user = ? AND to_user = ? AND status = 'pending'`,
      [toUser, fromUser],
      (err2, row) => {
        if (err2) return callback(err2);
        if (row) {
          // 对方已申请，直接接受
          return acceptFriendRequest(row.id, (e) => {
            if (e) return callback(e);
            callback(null, { action: 'auto_accept' });
          });
        }
        // 3. 自己是否已有 pending 申请
        db.get(
          `SELECT id FROM friend_requests WHERE from_user = ? AND to_user = ? AND status = 'pending'`,
          [fromUser, toUser],
          (err3, existRow) => {
            if (err3) return callback(err3);
            if (existRow) return callback(null, { action: 'duplicate', requestId: existRow.id });
            // 4. 创建新申请
            db.run(
              `INSERT INTO friend_requests (from_user, to_user, status) VALUES (?, ?, 'pending')`,
              [fromUser, toUser],
              function (err4) {
                if (err4) return callback(err4);
                callback(null, { action: 'created', requestId: this.lastID });
              }
            );
          }
        );
      }
    );
  });
}

// 获取 username 收到的申请列表（含申请人信息），默认只列 pending
function getFriendRequests(username, callback) {
  db.all(
    `SELECT fr.id, fr.from_user, fr.to_user, fr.status, fr.created_at, fr.handled_at,
            u.nickname, u.avatar
     FROM friend_requests fr
     LEFT JOIN users u ON u.username = fr.from_user
     WHERE fr.to_user = ?
     ORDER BY fr.created_at DESC`,
    [username],
    callback
  );
}

function countPendingRequests(username, callback) {
  db.get(
    `SELECT COUNT(*) AS cnt FROM friend_requests WHERE to_user = ? AND status = 'pending'`,
    [username],
    (err, row) => callback(err, row ? row.cnt : 0)
  );
}

function getFriendRequestById(id, callback) {
  db.get(`SELECT * FROM friend_requests WHERE id = ?`, [id], callback);
}

// 接受申请：更新状态 + 写入 friendships
function acceptFriendRequest(id, callback) {
  getFriendRequestById(id, (err, req) => {
    if (err) return callback(err);
    if (!req) return callback(new Error('申请不存在'));
    if (req.status !== 'pending') return callback(new Error('申请已处理'));
    db.run(
      `UPDATE friend_requests SET status = 'accepted', handled_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id],
      (err2) => {
        if (err2) return callback(err2);
        addFriend(req.from_user, req.to_user, (err3) => callback(err3, req));
      }
    );
  });
}

function rejectFriendRequest(id, callback) {
  getFriendRequestById(id, (err, req) => {
    if (err) return callback(err);
    if (!req) return callback(new Error('申请不存在'));
    if (req.status !== 'pending') return callback(new Error('申请已处理'));
    db.run(
      `UPDATE friend_requests SET status = 'rejected', handled_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id],
      (err2) => callback(err2, req)
    );
  });
}

module.exports = {
  createUser,
  getUserByUsername,
  updateUserAvatar,
  updateUserNickname,
  updateUserPassword,
  createMessage,
  getMessages,
  createInvitationCode,
  getValidInvitationCode,
  markInvitationCodeUsed,
  cleanExpiredCodes,
  getAllUsers,
  deleteUser,
  getAllCodes,
  deleteCodeById,
  searchUsers,
  addFriend,
  removeFriend,
  getFriendList,
  setFriendRemark,
  isFriend,
  createPrivateMessage,
  getPrivateHistory,
  getConversations,
  markPrivateRead,
  createFriendRequest,
  getFriendRequests,
  countPendingRequests,
  getFriendRequestById,
  acceptFriendRequest,
  rejectFriendRequest,
};
