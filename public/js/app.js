const user = JSON.parse(localStorage.getItem('chatUser'));
if (!user) window.location.href = 'index.html';

// ===== JWT Token 管理 =====
// 企业实践：Access Token 存在内存变量中（不是 localStorage！）
// 页面刷新后通过 /api/refresh 从 HttpOnly Cookie 中获取新的 Access Token
// 面试话术："Token 存 localStorage 是常见的安全漏洞——XSS 可以直接窃取。
//           正确做法是 Access Token 存内存 + Refresh Token 存 HttpOnly Cookie。"
let accessToken = null;
let tokenRefreshTimer = null;

// 初始化：从 Cookie 刷新 Access Token
(async function initToken() {
  try {
    const res = await fetch('/api/refresh', { method: 'POST', credentials: 'same-origin' });
    const data = await res.json();
    if (data.success && data.accessToken) {
      accessToken = data.accessToken;
      // 提前 1 分钟自动刷新（Access Token 有效期 15 分钟）
      tokenRefreshTimer = setInterval(async () => {
        try {
          const r = await fetch('/api/refresh', { method: 'POST', credentials: 'same-origin' });
          const d = await r.json();
          if (d.success && d.accessToken) accessToken = d.accessToken;
        } catch (e) {}
      }, 14 * 60 * 1000); // 每 14 分钟刷新
    }
  } catch (e) { /* 未登录则停留在当前页 */ }
})();

// 封装的认证请求（自动附加 Authorization 头 + 过期处理）
async function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (accessToken) {
    headers['Authorization'] = 'Bearer ' + accessToken;
  }
  const res = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  if (res.status === 401) {
    const data = await res.json().catch(() => ({}));
    if (data.code === 'TOKEN_EXPIRED') {
      try {
        const r = await fetch('/api/refresh', { method: 'POST', credentials: 'same-origin' });
        const d = await r.json();
        if (d.success && d.accessToken) {
          accessToken = d.accessToken;
          headers['Authorization'] = 'Bearer ' + accessToken;
          return fetch(url, { ...options, headers, credentials: 'same-origin' });
        }
      } catch (e) {}
    }
    // 刷新失败 → 退出登录
    logout();
  }
  return res;
}

let ws = null, reconnectInterval = null;
let currentTab = 'messages', currentChatPeer = null, currentChatType = null;
let friends = [], uploadTarget = null;
let hallHistoryLoaded = false;

// ===== 扑克视角工具：模块级坐位→屏幕位置映射 =====
// 服务端出牌逆时针顺序: 0 → 3 → 2 → 1 → 0
// 屏幕位置号(逆时针): 0=bottom(自己) 1=right 2=top 3=left
const POKER_CCW_ORDER = [0, 3, 2, 1];
function pokerRankOfSeat(s) { return POKER_CCW_ORDER.indexOf(s); }
function pokerSeatToPos(seat, meSeat) {
  const r = pokerRankOfSeat(seat);
  const rMe = pokerRankOfSeat(meSeat);
  if (r < 0 || rMe < 0) return -1;
  return (r - rMe + 4) % 4;
}
// 根据屏幕位置给出 "我/上家/下家/队友" 标签
// pos: 0=自己 1=right(下家，CCW方向) 2=top(对家/队友) 3=left(上家)
function pokerRelationLabel(pos) {
  if (pos === 0) return '我';
  if (pos === 1) return '下家';
  if (pos === 2) return '队友';
  if (pos === 3) return '上家';
  return '';
}

function init() {
  document.getElementById('meNickname').textContent = user.nickname;
  document.getElementById('meUsername').textContent = '账号: ' + user.username;
  loadAvatar();
  connectWS();
  loadFriends();
  loadConversations();
  loadHallHistory();
  refreshFriendRequestCount();
}

function defaultAvatar(name) {
  const c = document.createElement('canvas');
  c.width = 80; c.height = 80;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#667eea';
  ctx.fillRect(0, 0, 80, 80);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((name || '?')[0], 40, 42);
  return c.toDataURL();
}

function loadAvatar() {
  const el = document.getElementById('meAvatar');
  el.src = user.avatar || defaultAvatar(user.nickname);
}

// ===== WebSocket =====
function connectWS() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${window.location.host}`);
  ws.onopen = () => {
    console.log('[WS] 已连接，发送 auth:', user.username);
    ws.send(JSON.stringify({ type: 'auth', username: user.username }));
    if (reconnectInterval) { clearInterval(reconnectInterval); reconnectInterval = null; }
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    console.log('[WS] 收到消息:', msg);
    if (msg.type === 'chat') {
      appendHallMsg(msg);
      const hallClosed = currentChatType !== 'hall' || document.getElementById('chatOverlay').classList.contains('hidden');
      if (hallClosed && msg.username !== user.username) {
        hallUnread += 1;
        refreshConversations();
      }
    }
    if (msg.type === 'private') {
      const peer = msg.from_user === user.username ? msg.to_user : msg.from_user;
      const isOwn = msg.from_user === user.username;
      const chatOpen = currentChatType === 'private' && currentChatPeer === peer && !document.getElementById('chatOverlay').classList.contains('hidden');
      if (chatOpen) {
        appendChatMsg(msg, isOwn);
        // 打开中的会话，自动标记已读
        if (!isOwn) {
          authFetch('/api/private/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user.username, peer })
          }).catch(() => {});
        }
      }
      // 刷新消息列表（会拉取最新未读数）
      refreshConversations();
    }
    if (msg.type === 'friend_request') {
      // 收到新的好友申请：更新红点、如果申请页开着就刷新
      refreshFriendRequestCount();
      if (!document.getElementById('friendRequestOverlay').classList.contains('hidden')) {
        loadFriendRequests();
      }
    }
    if (msg.type === 'friend_accepted') {
      // 你和 msg.peer 成为好友了，刷新通讯录
      loadFriends();
      refreshFriendRequestCount();
    }
    if (msg.type === 'poker_room_update') {
      handlePokerRoomUpdate(msg.room);
    }
    if (msg.type === 'poker_deal_done') {
      // 发牌完成：公布 magicN / keyCard / 先手 / 队友
      onPokerDealDone(msg);
    }
    if (msg.type === 'poker_your_hand') {
      // 我的手牌
      myHandCards = msg.cards || [];
      renderMyHand();
      // 手牌到达可能晚于 poker_room_update，这里需要再刷一次房间状态
      // 以便按钮（过/出牌）正确显示
      if (currentPokerRoom) renderPokerRoom(currentPokerRoom);
    }
    if (msg.type === 'poker_game_start') {
      // 游戏开始提示
      if (currentPokerRoom && msg.room && currentPokerRoom.id === msg.room.id) {
        console.log('[Poker] 游戏开始');
      }
    }
    if (msg.type === 'poker_play') {
      // 有人出牌了（currentTrick 通过 poker_room_update 同步，这里显示动画/提示即可）
      console.log(`[Poker] ${msg.username} 出了 ${msg.cards.length} 张牌`);
    }
    if (msg.type === 'poker_pass') {
      console.log(`[Poker] ${msg.username} 过牌`);
    }
    if (msg.type === 'poker_trick_end') {
      // 回合结束，winner 收分
      showToast(`${shortName(msg.winner)} 收 ${msg.gain} 分（累计 ${msg.totalScore}）`);
    }
    if (msg.type === 'poker_round_end') {
      // 本局结束
      showRoundEnd(msg.finishRank, msg.scores);
    }
  };
  ws.onclose = () => {
    console.log('[WS] 连接关闭，将尝试重连');
    if (!reconnectInterval) reconnectInterval = setInterval(connectWS, 3000);
  };
  ws.onerror = (e) => console.error('[WS] 错误:', e);
}

// ===== Tab =====
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  event.currentTarget.classList.add('active');
  document.getElementById('page-' + tab).classList.add('active');
  const titles = { messages: '消息', contacts: '通讯录', games: '游戏', hall: '大厅', me: '我' };
  document.getElementById('headerTitle').textContent = titles[tab];
  document.getElementById('headerAdd').classList.toggle('hidden', tab !== 'contacts');
  if (tab === 'contacts') loadFriends();
  if (tab === 'messages') loadConversations();
}

// ===== Games =====
function openGame(name) {
  if (name === 'poker') {
    document.getElementById('pokerOverlay').classList.remove('hidden');
  }
}

function closeGame() {
  document.getElementById('pokerOverlay').classList.add('hidden');
}

// ===== Poker Room =====
let currentPokerRoom = null;
let myHandCards = [];
let selectedCardIds = new Set(); // 被选中（抬起）的牌 id

// 统一处理来自服务端的 poker_room_update
// 1. 若本地没有 currentPokerRoom，但自己在 room.players 中，自动把房间页打开（浏览器刷新后自动回到房间）
// 2. 若已在 room 内，刷新 UI
// 3. 若消息的 room 不是自己当前房间（例如自己被踢出或房间被替换），忽略
function handlePokerRoomUpdate(room) {
  if (!room || !room.players) return;
  const iAmIn = room.players.some(p => p.username === user.username);
  if (!iAmIn) {
    // 我不在里面，忽略（这条消息不是发给我的，或者我已离开）
    return;
  }
  if (!currentPokerRoom || currentPokerRoom.id !== room.id) {
    // 自动进入房间（常见于浏览器刷新后，服务端在 auth 时推送的同步包）
    enterPokerRoom(room);
    return;
  }
  // 同房间更新
  currentPokerRoom = room;
  renderPokerRoom(room);
  // 如果邀请弹窗开着，顺便刷新"已在房间"状态
  const inviteOverlay = document.getElementById('pokerInviteOverlay');
  if (inviteOverlay && !inviteOverlay.classList.contains('hidden')) {
    showPokerInvite();
  }
}

function createPokerRoom() {
  authFetch('/api/game/poker/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user.username })
  }).then(r => r.json()).then(data => {
    if (data.success && data.room) {
      enterPokerRoom(data.room);
    } else {
      alert(data.message || '创建失败');
    }
  });
}

function enterPokerRoom(room) {
  currentPokerRoom = room;
  myHandCards = [];
  document.getElementById('pokerOverlay').classList.add('hidden');
  document.getElementById('pokerRoomOverlay').classList.remove('hidden');
  document.getElementById('pokerRoomTitle').textContent = '扑克房间 · ' + room.id.replace('poker_', '').slice(0, 6);
  // 进入新房间时，隐藏手牌区（发牌后才显示）
  const handEl = document.getElementById('pokerMyHand');
  if (handEl) handEl.classList.add('hidden');
  const infoEl = document.getElementById('pokerGameInfo');
  if (infoEl) infoEl.classList.add('hidden');
  renderPokerRoom(room);
}

// 确保中央 4 个按钮 + 指针都存在于 .poker-center-actions 容器内
// （防止旧 HTML 缓存缺少这些新增节点，导致按钮永远看不见）
function ensurePokerActionButtons() {
  const center = document.getElementById('pokerCenter');
  if (!center) return;
  let actions = center.querySelector('.poker-center-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'poker-center-actions';
    center.appendChild(actions);
  }
  // 指针
  if (!document.getElementById('pokerTurnPointer')) {
    const p = document.createElement('div');
    p.id = 'pokerTurnPointer';
    p.className = 'poker-turn-pointer hidden';
    center.appendChild(p);
  }
  // 4 个按钮
  const wants = [
    { id: 'pokerReadyBtn',  cls: 'poker-action-btn poker-ready-btn',         text: '准备',  onclick: 'togglePokerReady()' },
    { id: 'pokerInviteBtn', cls: 'poker-action-btn poker-invite-action-btn', text: '邀请',  onclick: 'showPokerInvite()' },
    { id: 'pokerPassBtn',   cls: 'poker-action-btn poker-pass-btn',          text: '过',    onclick: 'pokerPass()' },
    { id: 'pokerPlayBtn',   cls: 'poker-action-btn poker-play-btn',          text: '出牌',  onclick: 'pokerPlay()' },
  ];
  wants.forEach(w => {
    if (document.getElementById(w.id)) return;
    const btn = document.createElement('button');
    btn.id = w.id;
    btn.className = w.cls;
    btn.textContent = w.text;
    btn.setAttribute('onclick', w.onclick);
    actions.appendChild(btn);
  });
}

function renderPokerRoom(room) {
  const inGame = room.phase === 'playing';

  // --- 视角旋转：自己永远在屏幕下方 ---
  // 服务端的逆时针出牌顺序（真实 seat）: 0 -> 3 -> 2 -> 1 -> 0
  // 屏幕位置编号（逆时针）: 0=bottom 1=right 2=top 3=left
  const CCW_ORDER = [0, 3, 2, 1];
  const rankOfSeat = (s) => CCW_ORDER.indexOf(s);
  const me = room.players.find(p => p.username === user.username);
  const rMe = me ? rankOfSeat(me.seat) : 0;
  const seatToPos = (seat) => {
    const r = rankOfSeat(seat);
    if (r < 0) return -1;
    return (r - rMe + 4) % 4;
  };
  const POS_CLASS = ['seat-bottom', 'seat-right', 'seat-top', 'seat-left'];

  // 先把 4 个屏幕位置重置为"空位"样式
  for (let pos = 0; pos < 4; pos++) {
    const el = document.getElementById('poker-pos-' + pos);
    if (!el) continue;
    el.className = 'poker-seat ' + POS_CLASS[pos];
    el.innerHTML = `
      <div class="poker-seat-empty">+</div>
      <div class="poker-seat-name" style="opacity:0.6;">空位</div>
    `;
  }

  // 按玩家真实身份填到屏幕位置
  room.players.forEach(p => {
    const pos = seatToPos(p.seat);
    if (pos < 0) return;
    const el = document.getElementById('poker-pos-' + pos);
    if (!el) return;
    const isOwner = p.username === room.ownerUsername;
    const isFirst = inGame && p.username === room.firstPlayerUsername;
    const isTurn = inGame && p.username === room.turnUsername;
    const isTeammate = inGame && p.username === room.teammateUsername;
    const isOffline = p.online === false;
    let topBadge = '';
    if (isOffline) {
      topBadge = `<div class="poker-ready-badge offline">离线</div>`;
    } else if (inGame) {
      if (isFirst) topBadge = `<div class="poker-role-badge role-first">先手</div>`;
      else if (isTeammate) topBadge = `<div class="poker-role-badge role-teammate">先手队友</div>`;
    } else {
      const readyClass = p.ready ? 'ready' : 'not-ready';
      const readyLabel = p.ready ? '已准备' : '未准备';
      topBadge = `<div class="poker-ready-badge ${readyClass}">${readyLabel}</div>`;
    }
    const handCountHtml = inGame
      ? `<div class="poker-hand-count">🂠 ${p.handCount || 0}</div>`
      : '';
    let keyCardHtml = '';
    if (isFirst && room.keyCard) {
      keyCardHtml = `<div class="poker-key-card">${formatCardHtml(room.keyCard)}</div>`;
    }
    // 分数徽章（游戏中/结束后都显示）
    const score = room.scores ? (room.scores[p.username] || 0) : 0;
    const scoreBadgeHtml = (inGame || room.phase === 'finished')
      ? `<div class="poker-score-badge">分 ${score}</div>`
      : '';
    // 走完排名徽章
    const rankIdx = (room.finishRank || []).indexOf(p.username);
    const finishRankHtml = rankIdx >= 0
      ? `<div class="poker-finish-rank rank-${rankIdx + 1}">${rankIdx + 1}</div>`
      : '';
    el.className = 'poker-seat ' + POS_CLASS[pos]
      + (isTurn ? ' poker-seat-turn' : '')
      + (isOffline ? ' poker-seat-offline' : '');
    // 显示名：好友备注优先
    const displayPlayerName = pokerDisplayName(p.username, p.nickname);
    el.innerHTML = `
      ${topBadge}
      ${finishRankHtml}
      <img class="poker-avatar" src="${p.avatar || defaultAvatar(p.nickname)}">
      <div class="poker-seat-name ${isOwner ? 'poker-seat-owner' : ''}">${escapeHtml(displayPlayerName)}${isOwner ? ' 👑' : ''}</div>
      ${handCountHtml}
      ${scoreBadgeHtml}
      ${keyCardHtml}
    `;
  });

  // --- 中央 "N/4" 区显示切换 ---
  // 等待阶段：显示 人数 N/4
  // 游戏阶段：隐藏（本轮分数移到左上角徽章）
  const countEl = document.getElementById('pokerCount');
  if (countEl) {
    // 清理之前的 trick-score 样式（句子变小）
    countEl.classList.remove('trick-score-mode', 'has-score');
    if (inGame) {
      countEl.style.display = 'none';
      countEl.textContent = '';
    } else {
      countEl.style.display = '';
      countEl.textContent = room.players.length + ' / 4';
    }
  }

  // --- 左上角本轮分数徽章 ---
  const tsb = document.getElementById('pokerTrickScoreBadge');
  if (tsb) {
    if (inGame) {
      const tScore = room.trickScore || 0;
      tsb.textContent = '本轮 ' + tScore + ' 分';
      tsb.classList.remove('hidden');
      tsb.classList.toggle('has-score', tScore > 0);
    } else {
      tsb.classList.add('hidden');
      tsb.classList.remove('has-score');
    }
  }

  // --- 确保中央 4 个按钮都存在（防止老 HTML 缓存缺少节点）---
  ensurePokerActionButtons();
  ensurePokerFullscreenBtn();

  // --- 按钮显隐（中央位置 4 个按钮）---
  const readyBtn = document.getElementById('pokerReadyBtn');
  const inviteBtn = document.getElementById('pokerInviteBtn');
  const passBtn = document.getElementById('pokerPassBtn');
  const playBtn = document.getElementById('pokerPlayBtn');
  const itsMyTurn = inGame && me && room.turnUsername === user.username && myHandCards.length > 0;
  // 直接用 inline style 强制覆盖 .hidden 的 !important
  if (readyBtn) {
    if (!inGame) {
      readyBtn.style.display = '';
      readyBtn.classList.remove('hidden');
      readyBtn.textContent = (me && me.ready) ? '取消准备' : '准备';
      readyBtn.classList.toggle('ready', !!(me && me.ready));
    } else {
      readyBtn.style.display = 'none';
    }
  }
  if (inviteBtn) inviteBtn.style.display = inGame ? 'none' : '';
  if (passBtn) {
    passBtn.style.display = itsMyTurn ? '' : 'none';
    passBtn.classList.remove('hidden');
    passBtn.disabled = room.currentTrick === null;
  }
  if (playBtn) {
    playBtn.style.display = itsMyTurn ? '' : 'none';
    playBtn.classList.remove('hidden');
  }
  console.log('[Poker] renderPokerRoom phase=' + room.phase + ' turn=' + room.turnUsername + ' me=' + (me && me.username) + ' itsMyTurn=' + itsMyTurn + ' handLen=' + myHandCards.length);

  // --- 中央指针 ---
  const pointer = document.getElementById('pokerTurnPointer');
  if (pointer) {
    if (inGame && room.turnUsername) {
      const turnPlayer = room.players.find(p => p.username === room.turnUsername);
      if (turnPlayer) {
        const pos = seatToPos(turnPlayer.seat);
        // pos 0=bottom 1=right 2=top 3=left
        const arrowByPos = ['▼', '▶', '▲', '◀'];
        pointer.textContent = arrowByPos[pos] || '';
        pointer.className = 'poker-turn-pointer pointer-pos-' + pos;
      }
    } else {
      pointer.className = 'poker-turn-pointer hidden';
      pointer.textContent = '';
    }
  }

  // 中央当前回合牌
  renderCurrentTrick(room);
}

function renderCurrentTrick(room) {
  const el = document.getElementById('pokerCurrentTrick');
  if (!el) return;
  if (!room.currentTrick) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  const who = room.players.find(p => p.username === room.currentTrick.username);
  // 按视角标签: 我/上家/下家/队友 出
  const me = room.players.find(p => p.username === user.username);
  let label = '';
  if (who && me) {
    const pos = pokerSeatToPos(who.seat, me.seat);
    label = pokerRelationLabel(pos);
  }
  if (!label) {
    // fallback：不在房间里或找不到座位时用备注/昵称
    label = who ? pokerDisplayName(who.username, who.nickname) : (room.currentTrick.username || '');
  }
  const cardsHtml = room.currentTrick.cards.map(c => formatCardHtml(c)).join('');
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="trick-player">${escapeHtml(label)} 出</div>
    <div class="trick-cards">${cardsHtml}</div>
  `;
}

function seatClassFromIndex(i) {
  // 兼容保留（如果别处有调用），按屏幕位置返回
  return ['seat-bottom', 'seat-right', 'seat-top', 'seat-left'][i];
}

function formatCardHtml(card) {
  if (!card) return '';
  if (card.suit === 'JOKER') {
    const label = card.rank === 'big' ? '大王' : '小王';
    const col = card.rank === 'big' ? 'red' : 'black';
    return `<span class="poker-card ${col}">${label}</span>`;
  }
  const color = (card.suit === '♥' || card.suit === '♦') ? 'red' : 'black';
  return `<span class="poker-card ${color}"><span class="card-suit">${card.suit}</span><span class="card-rank">${card.rank}</span></span>`;
}

function onPokerDealDone(msg) {
  // 渲染顶部信息条
  const infoEl = document.getElementById('pokerGameInfo');
  if (infoEl) {
    const first = currentPokerRoom && currentPokerRoom.players.find(p => p.username === msg.firstPlayerUsername);
    const mate = currentPokerRoom && currentPokerRoom.players.find(p => p.username === msg.teammateUsername);
    const firstName = first ? pokerDisplayName(first.username, first.nickname) : '-';
    const mateName = mate ? pokerDisplayName(mate.username, mate.nickname) : '-';
    infoEl.innerHTML = `
      <span>随机数: <b>${msg.magicN}</b></span>
      <span>明牌: ${formatCardHtml(msg.keyCard)}</span>
      <span>先手: <b>${escapeHtml(firstName)}</b></span>
      <span>队友: <b>${escapeHtml(mateName)}</b></span>
      ${msg.swapped ? '<span style="color:#f5c542;">(已自动换座)</span>' : ''}
    `;
    infoEl.classList.remove('hidden');
  }
}

function renderMyHand() {
  const handEl = document.getElementById('pokerMyHand');
  if (!handEl) return;
  // 排序：大王 > 小王 > A > K > Q > J > 10..2，花色次序：♠♥♣♦
  const rankOrder = { 'big': 100, 'small': 99, 'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 };
  const suitOrder = { 'JOKER': 0, '♠': 1, '♥': 2, '♣': 3, '♦': 4 };
  const sorted = [...myHandCards].sort((a, b) => {
    const ra = rankOrder[a.rank] || 0, rb = rankOrder[b.rank] || 0;
    if (rb !== ra) return rb - ra;
    return (suitOrder[a.suit] || 0) - (suitOrder[b.suit] || 0);
  });
  // 清理已不在手牌里的 selected id（出牌后）
  const allIds = new Set(myHandCards.map(c => c.id));
  for (const id of Array.from(selectedCardIds)) {
    if (!allIds.has(id)) selectedCardIds.delete(id);
  }
  handEl.innerHTML = `
    <div class="poker-hand-inner">
      ${sorted.map(c => {
        const selected = selectedCardIds.has(c.id) ? ' selected' : '';
        return `<span class="poker-hand-card${selected}" data-id="${c.id}" onclick="toggleCardSelect('${c.id}')">${formatCardHtml(c)}</span>`;
      }).join('')}
    </div>
    <div class="poker-hand-label">我的手牌 · ${sorted.length} 张</div>
  `;
  handEl.classList.remove('hidden');
}

function toggleCardSelect(cardId) {
  // 先更新数据源（Set）
  const willSelect = !selectedCardIds.has(cardId);
  if (willSelect) selectedCardIds.add(cardId);
  else selectedCardIds.delete(cardId);
  // 再根据 Set 的最新状态强制同步 class（不用 toggle，避免 Set 与视觉不同步）
  const el = document.querySelector(`.poker-hand-card[data-id="${cardId}"]`);
  if (el) el.classList.toggle('selected', willSelect);
}

function pokerPlay() {
  if (!currentPokerRoom) return;
  if (currentPokerRoom.turnUsername !== user.username) {
    alert('还没轮到你出牌');
    return;
  }
  const cardIds = Array.from(selectedCardIds);
  if (cardIds.length === 0) {
    alert('请先选择要出的牌');
    return;
  }
  authFetch('/api/game/poker/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId: currentPokerRoom.id, username: user.username, cardIds })
  }).then(r => r.json()).then(data => {
    if (!data.success) {
      // 如果服务端给了详细的牌型诊断，一并显示
      let extra = '';
      if (data.myHand) extra += '\n你的牌型: ' + data.myHand;
      if (data.lastHand) extra += '\n当前牌型: ' + data.lastHand;
      alert((data.message || '出牌失败') + extra);
      return;
    }
    selectedCardIds.clear(); // 出牌成功清选中
  });
}

function pokerPass() {
  if (!currentPokerRoom) return;
  if (currentPokerRoom.turnUsername !== user.username) {
    alert('还没轮到你');
    return;
  }
  if (currentPokerRoom.currentTrick === null) {
    alert('自由出牌时不能过');
    return;
  }
  authFetch('/api/game/poker/pass', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId: currentPokerRoom.id, username: user.username })
  }).then(r => r.json()).then(data => {
    if (!data.success) alert(data.message || '过牌失败');
    else selectedCardIds.clear();
  });
}

// 简易 toast
function showToast(text) {
  const t = document.createElement('div');
  t.className = 'poker-toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => { t.classList.add('fade'); }, 50);
  setTimeout(() => { t.remove(); }, 2500);
}

function shortName(username) {
  if (!currentPokerRoom) return username;
  const p = currentPokerRoom.players.find(pp => pp.username === username);
  return p ? p.nickname : username;
}

function showRoundEnd(finishRank, scores) {
  // 0 分本局不弹结算弹窗，只提示 toast + 清手牌
  const totalScore = Object.values(scores || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  // 无论是否弹窗，都要清理当前局的 UI
  selectedCardIds.clear();
  myHandCards = [];
  const handEl = document.getElementById('pokerMyHand');
  if (handEl) handEl.classList.add('hidden');
  const passBtn = document.getElementById('pokerPassBtn');
  const playBtn = document.getElementById('pokerPlayBtn');
  if (passBtn) passBtn.classList.add('hidden');
  if (playBtn) playBtn.classList.add('hidden');

  if (totalScore === 0) {
    showToast('本局结束·本局未产生分数');
    return;
  }

  const el = document.getElementById('pokerRoundEndOverlay');
  const body = document.getElementById('pokerRoundEndBody');
  if (!el || !body) return;
  const rows = finishRank.map((u, i) => {
    const p = currentPokerRoom && currentPokerRoom.players.find(pp => pp.username === u);
    const name = pokerDisplayName(u, p ? p.nickname : null);
    return `<div class="round-end-row"><span class="rank-num rank-${i+1}">${i+1}</span><span class="rank-name">${escapeHtml(name)}</span><span class="rank-score">${scores[u] || 0} 分</span></div>`;
  }).join('');
  body.innerHTML = rows;
  el.classList.remove('hidden');
}

function closeRoundEndAndReady() {
  const el = document.getElementById('pokerRoundEndOverlay');
  if (el) el.classList.add('hidden');
  // 自动点一下"准备"
  togglePokerReady();
}

function togglePokerReady() {
  if (!currentPokerRoom) return;
  const me = currentPokerRoom.players.find(p => p.username === user.username);
  if (!me) return;
  const nextReady = !me.ready;
  authFetch('/api/game/poker/ready', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId: currentPokerRoom.id, username: user.username, ready: nextReady })
  }).then(r => r.json()).then(data => {
    if (!data.success) alert(data.message || '操作失败');
    // 无需手动更新，服务端会广播 poker_room_update
  });
}

function leavePokerRoom() {
  // 如果当前处于全屏，先退出全屏，避免浏览器残留全屏状态
  const doc = document;
  const inFs = doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement;
  if (inFs) {
    try { (doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen).call(doc); } catch (e) {}
  }
  const roomEl = document.getElementById('pokerRoomOverlay');
  if (roomEl && roomEl.classList.contains('pseudo-fullscreen')) {
    roomEl.classList.remove('pseudo-fullscreen');
    document.body.classList.remove('pseudo-fs-lock');
    if (screen.orientation && screen.orientation.unlock) {
      try { screen.orientation.unlock(); } catch (e) {}
    }
  }
  const doClose = () => {
    currentPokerRoom = null;
    document.getElementById('pokerRoomOverlay').classList.add('hidden');
  };
  if (!currentPokerRoom) { doClose(); return; }
  authFetch('/api/game/poker/leave', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId: currentPokerRoom.id, username: user.username })
  }).finally(doClose);
}

// 切换扑克房间全屏（系统浏览器有效；微信/部分 webview 无效）
function togglePokerFullscreen() {
  const el = document.getElementById('pokerRoomOverlay');
  if (!el) return;
  const doc = document;
  const isNativeFs = doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement;

  // 当前已处于原生全屏：退出
  if (isNativeFs) {
    (doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen).call(doc);
    return;
  }
  // 当前处于伪全屏：退出
  if (el.classList.contains('pseudo-fullscreen')) {
    el.classList.remove('pseudo-fullscreen');
    document.body.classList.remove('pseudo-fs-lock');
    if (screen.orientation && screen.orientation.unlock) {
      try { screen.orientation.unlock(); } catch (e) {}
    }
    return;
  }

  // 进入：先试原生 Fullscreen API
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (req) {
    let p;
    try { p = req.call(el); } catch (e) { applyPseudoFullscreen(el); return; }
    if (p && typeof p.then === 'function') {
      p.then(() => tryLockLandscape())
       .catch(() => applyPseudoFullscreen(el));
    } else {
      tryLockLandscape();
    }
  } else {
    applyPseudoFullscreen(el);
  }
}

function applyPseudoFullscreen(el) {
  el.classList.add('pseudo-fullscreen');
  document.body.classList.add('pseudo-fs-lock');
  tryLockLandscape();
  showToast('已进入网页全屏（浏览器自带栏请手动滑动隐藏，或用 Safari/Chrome 获得彻底沉浸）');
}

function tryLockLandscape() {
  if (screen.orientation && screen.orientation.lock) {
    try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) {}
  }
}

// 监听原生全屏状态变化，手动切换 .is-fullscreen class（CSS 兜底）
// 这样即使手机浏览器不认 :fullscreen/:-webkit-full-screen 伪类，也能正确显示工具条
(function installFullscreenChangeListener() {
  const events = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
  const handler = () => {
    const el = document.getElementById('pokerRoomOverlay');
    if (!el) return;
    const fs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
    if (fs && (fs === el || el.contains(fs))) {
      el.classList.add('is-fullscreen');
    } else {
      el.classList.remove('is-fullscreen');
    }
  };
  events.forEach(ev => document.addEventListener(ev, handler, false));
})();

// 确保扑克房间顶栏有全屏按钮（防旧 HTML 缓存导致按钮缺失）
function ensurePokerFullscreenBtn() {
  const header = document.querySelector('#pokerRoomOverlay .chat-header');
  if (header) {
    header.classList.add('poker-room-header');
    if (!document.getElementById('pokerFullscreenBtn')) {
      const btn = document.createElement('button');
      btn.id = 'pokerFullscreenBtn';
      btn.className = 'poker-fullscreen-btn';
      btn.title = '全屏';
      btn.textContent = '⛶';
      btn.setAttribute('onclick', 'togglePokerFullscreen()');
      header.appendChild(btn);
    }
  }
  // 全屏浮动工具条
  const roomEl = document.getElementById('pokerRoomOverlay');
  if (roomEl && !document.getElementById('pokerFsToolbar')) {
    const bar = document.createElement('div');
    bar.id = 'pokerFsToolbar';
    bar.className = 'poker-fs-toolbar';
    bar.innerHTML =
      '<button class="poker-fs-tool-btn" onclick="leavePokerRoom()" title="离开房间">‹ 离开</button>' +
      '<button class="poker-fs-tool-btn" onclick="showPokerInvite()" title="邀请好友">+ 邀请</button>' +
      '<button class="poker-fs-tool-btn" onclick="togglePokerFullscreen()" title="退出全屏">✕</button>';
    roomEl.appendChild(bar);
  }
  // 把 pokerInviteOverlay 搬进 pokerRoomOverlay（全屏时才能显示）
  const invite = document.getElementById('pokerInviteOverlay');
  if (invite && roomEl && invite.parentNode !== roomEl) {
    roomEl.appendChild(invite);
  }
}

function showPokerInvite() {
  if (!currentPokerRoom) return;
  document.getElementById('pokerInviteOverlay').classList.remove('hidden');
  authFetch('/api/friend/list?username=' + encodeURIComponent(user.username))
    .then(r => r.json()).then(data => {
      const list = document.getElementById('pokerInviteList');
      list.innerHTML = '';
      if (!data.success || !data.friends || data.friends.length === 0) {
        list.innerHTML = '<div style="text-align:center;color:#999;padding:40px 20px;">你还没有好友，去通讯录添加好友吧</div>';
        return;
      }
      // 剔除已在房间的
      const inRoom = new Set(currentPokerRoom.players.map(p => p.username));
      data.friends.forEach(f => {
        const already = inRoom.has(f.username);
        const div = document.createElement('div');
        div.className = 'search-item';
        div.innerHTML = `
          <img class="search-avatar" src="${f.avatar || defaultAvatar(f.nickname)}">
          <div class="search-info">
            <div>${escapeHtml(f.nickname)}</div>
            <div style="font-size:12px;color:#999;">${escapeHtml(f.username)}</div>
          </div>
          ${already
            ? '<span style="color:#07c160;font-size:13px;">已在房间</span>'
            : `<button class="btn btn-primary" style="width:auto;padding:6px 16px;font-size:13px;" onclick="sendPokerInvite('${f.username}')">邀请</button>`}
        `;
        list.appendChild(div);
      });
    });
}

function closePokerInvite() {
  document.getElementById('pokerInviteOverlay').classList.add('hidden');
}

function sendPokerInvite(peer) {
  if (!currentPokerRoom) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) { alert('连接已断开'); return; }
  ws.send(JSON.stringify({
    type: 'private',
    from_user: user.username,
    to_user: peer,
    nickname: user.nickname,
    content: currentPokerRoom.id,
    msg_type: 'poker_invite',
    avatar: user.avatar
  }));
  alert('邀请已发送给 ' + peer);
  closePokerInvite();
}

function acceptPokerInvite(roomId) {
  authFetch('/api/game/poker/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, username: user.username })
  }).then(r => r.json()).then(data => {
    if (data.success && data.room) {
      closeChat();
      // 如果扑克大厅没开，补打开一层方便返回
      document.getElementById('pokerOverlay').classList.remove('hidden');
      enterPokerRoom(data.room);
    } else {
      alert(data.message || '加入失败');
    }
  });
}

// ===== Conversations =====
let hallUnread = 0;

function loadConversations() {
  authFetch('/api/messages').then(r => r.json()).then(hallData => {
    authFetch('/api/conversations?username=' + encodeURIComponent(user.username)).then(r => r.json()).then(privData => {
      const list = document.getElementById('convList');
      list.innerHTML = '';
      // Hall
      const lastHall = hallData.messages && hallData.messages.length ? hallData.messages[hallData.messages.length - 1] : null;
      addConvItem(list, 'hall', '聊天大厅', lastHall ? (lastHall.msg_type === 'image' ? '[图片]' : lastHall.content) : '点击进入大厅聊天', lastHall ? lastHall.created_at : null, 'hall', hallUnread);
      // Private
      if (privData.success && privData.conversations) {
        privData.conversations.forEach(c => {
          let preview;
          if (c.lastMsgType === 'image') preview = '[图片]';
          else if (c.lastMsgType === 'poker_invite') preview = '[扑克房间邀请]';
          else preview = c.lastContent;
          // 本地备注优先，否则显示对方用户名
          const title = displayNameOfFriend(c.peer);
          addConvItem(list, c.peer, title, preview, c.lastTime, 'private', c.unreadCount || 0);
        });
      }
    });
  });
}

function addConvItem(list, peer, title, preview, time, type, unread) {
  const div = document.createElement('div');
  div.className = 'conv-item';
  div.dataset.peer = peer;
  div.dataset.type = type;
  div.onclick = () => openChat(type, peer, title);
  const t = time ? new Date(time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const unreadNum = unread && unread > 0 ? (unread > 99 ? '99+' : unread) : '';
  const dotClass = unreadNum ? 'conv-dot' : 'conv-dot hidden';
  div.innerHTML = `
    <img class="conv-avatar" src="${defaultAvatar(title)}">
    <div class="conv-body">
      <div class="conv-top"><span class="conv-name">${escapeHtml(title)}</span><span class="conv-time">${t}</span></div>
      <div class="conv-preview">${escapeHtml(preview || '')}</div>
    </div>
    <span class="${dotClass}" id="dot-${peer}">${unreadNum}</span>
  `;
  list.appendChild(div);
}

function updateConvDot(peer, show) {
  const dot = document.getElementById('dot-' + peer);
  if (!dot) return;
  if (show) {
    dot.classList.remove('hidden');
  } else {
    dot.classList.add('hidden');
    dot.textContent = '';
  }
}

function refreshConversations() {
  if (currentTab === 'messages') loadConversations();
}

// ===== Contacts =====
// 工具：返回某好友在本地的显示名（备注优先，否则回退原昵称）
function displayNameOfFriend(username) {
  const f = (friends || []).find(x => x.username === username);
  if (!f) return username;
  return (f.remark && f.remark.trim()) ? f.remark : (f.nickname || username);
}

// 扑克房间专用：优先使用好友备注，其次是传入的 fallbackNickname（等待开始前也可能还没加为好友，不能错）
function pokerDisplayName(username, fallbackNickname) {
  if (username === user.username) return user.nickname; // 自己用自己昵称
  const f = (friends || []).find(x => x.username === username);
  if (f && f.remark && f.remark.trim()) return f.remark;
  return fallbackNickname || (f && f.nickname) || username;
}

function loadFriends() {
  authFetch('/api/friend/list?username=' + encodeURIComponent(user.username))
    .then(r => r.json())
    .then(data => {
      friends = data.success ? data.friends : [];
      renderContacts();
      // 备注或好友关系变化后，也要刷新最近会话列表的名称显示
      if (typeof refreshConversations === 'function') refreshConversations();
      // 如果当前正在跟某个好友私聊，同步更新聊天标题
      if (currentChatType === 'private' && currentChatPeer) {
        const t = document.getElementById('chatTitle');
        if (t) t.textContent = displayNameOfFriend(currentChatPeer);
      }
    });
}

function renderContacts() {
  const list = document.getElementById('contactList');
  list.innerHTML = '<div class="contact-add" onclick="showSearch()">+ 添加好友</div>';
  const filter = (document.getElementById('contactSearch').value || '').trim().toLowerCase();
  friends.forEach(f => {
    const displayName = (f.remark && f.remark.trim()) ? f.remark : f.nickname;
    if (filter
        && !(displayName || '').toLowerCase().includes(filter)
        && !f.nickname.toLowerCase().includes(filter)
        && !f.username.toLowerCase().includes(filter)) return;
    const div = document.createElement('div');
    div.className = 'contact-item';
    // 如果有备注，在备注后面添加灰色原昵称提示
    const sub = (f.remark && f.remark.trim() && f.remark !== f.nickname)
      ? `<span class="contact-sub">(${escapeHtml(f.nickname)})</span>` : '';
    div.innerHTML = `<img class="contact-avatar" src="${f.avatar || defaultAvatar(f.nickname)}"><span>${escapeHtml(displayName)}${sub}</span>`;
    div.onclick = () => openChat('private', f.username, displayName);
    list.appendChild(div);
  });
}

function filterContacts() { renderContacts(); }

// ===== Chat =====
function openChat(type, peer, title) {
  currentChatType = type;
  currentChatPeer = peer;
  document.getElementById('chatTitle').textContent = title;
  document.getElementById('chatOverlay').classList.remove('hidden');
  document.getElementById('chatMessages').innerHTML = '';
  updateConvDot(peer, false);
  if (type === 'hall') {
    hallUnread = 0;
    loadHallHistoryInto(document.getElementById('chatMessages'));
  } else {
    // 标记私聊已读，然后刷新消息列表
    authFetch('/api/private/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, peer })
    }).then(() => refreshConversations()).catch(() => {});
    loadPrivateHistory(peer);
  }
}

function closeChat() {
  document.getElementById('chatOverlay').classList.add('hidden');
  currentChatType = null;
  currentChatPeer = null;
}

// ===== 好友操作菜单（备注 / 删除好友） =====
function onChatTitleClick() {
  // 只有私聊好友时才弹菜单，大厅不弹
  if (currentChatType !== 'private' || !currentChatPeer) return;
  const f = (friends || []).find(x => x.username === currentChatPeer);
  if (!f) return; // 不是好友（按理说私聊只会出现在好友间，此处作兼容）
  const titleEl = document.getElementById('friendActionTitle');
  const shown = (f.remark && f.remark.trim()) ? f.remark : f.nickname;
  titleEl.innerHTML = `<div class="friend-action-name">${escapeHtml(shown)}</div>` +
    `<div class="friend-action-sub">昵称：${escapeHtml(f.nickname)} · 账号：${escapeHtml(f.username)}</div>`;
  document.getElementById('friendActionOverlay').classList.remove('hidden');
}

function closeFriendActionMenu(e) {
  // 点蒙层关闭；按钮回调内部也调用，e 为 undefined
  if (e && e.target && e.target.id !== 'friendActionOverlay' && e.type === 'click') {
    // 如果不是点蒙层本身（而是子元素冒泡上来），不关闭
    if (e.target.id !== 'friendActionOverlay') return;
  }
  document.getElementById('friendActionOverlay').classList.add('hidden');
}

function promptFriendRemark() {
  if (!currentChatPeer) return closeFriendActionMenu();
  const f = (friends || []).find(x => x.username === currentChatPeer);
  if (!f) return closeFriendActionMenu();
  const cur = f.remark || '';
  // 用 prompt 最简洁，给个默认值方便编辑
  const input = window.prompt('为' + (f.nickname || f.username) + '设置备注（清空则取消备注）：', cur);
  if (input === null) return; // 用户取消
  const remark = input.trim().slice(0, 40);
  authFetch('/api/friend/remark', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner: user.username, target: currentChatPeer, remark })
  }).then(r => r.json()).then(data => {
    if (!data.success) { showToast(data.message || '设置备注失败'); return; }
    showToast(remark ? '已设置备注' : '已取消备注');
    closeFriendActionMenu();
    // 重新拉好友列表，loadFriends 内部会同步刷新私聊标题 + 最近会话
    loadFriends();
  }).catch(() => showToast('设置备注失败'));
}

function confirmRemoveFriend() {
  if (!currentChatPeer) return closeFriendActionMenu();
  const f = (friends || []).find(x => x.username === currentChatPeer);
  const name = f ? ((f.remark && f.remark.trim()) ? f.remark : f.nickname) : currentChatPeer;
  if (!confirm('确定删除好友「' + name + '」吗？\n\n删除后将无法继续私聊。聊天记录仍然保留。')) return;
  authFetch('/api/friend/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userA: user.username, userB: currentChatPeer })
  }).then(r => r.json()).then(data => {
    if (!data.success) { showToast(data.message || '删除失败'); return; }
    showToast('已删除好友');
    closeFriendActionMenu();
    closeChat();
    loadFriends();
  }).catch(() => showToast('删除失败'));
}

function loadHallHistoryInto(container) {
  fetch('/api/messages').then(r => r.json()).then(data => {
    if (!data.success || !data.messages) return;
    container.innerHTML = '';
    data.messages.forEach(m => appendMsgTo(container, m, m.username === user.username));
    scrollToBottom(container);
  }).catch(err => console.error('加载大厅历史失败:', err));
}

function loadHallHistory() {
  loadHallHistoryInto(document.getElementById('hallMessages'));
}

function appendHallMsg(msg) {
  const isOwn = msg.username === user.username;
  const hallContainer = document.getElementById('hallMessages');
  if (!document.getElementById('chatOverlay').classList.contains('hidden') && currentChatType === 'hall') {
    appendMsgTo(document.getElementById('chatMessages'), msg, isOwn);
    scrollToBottom(document.getElementById('chatMessages'));
  }
  appendMsgTo(hallContainer, msg, isOwn);
  scrollToBottom(hallContainer);
}

function loadPrivateHistory(peer) {
  authFetch(`/api/private/history?userA=${encodeURIComponent(user.username)}&userB=${encodeURIComponent(peer)}`)
    .then(r => r.json())
    .then(data => {
      const container = document.getElementById('chatMessages');
      container.innerHTML = '';
      if (data.success && data.messages) {
        data.messages.forEach(m => appendMsgTo(container, m, m.from_user === user.username));
      }
      scrollToBottom(container);
    });
}

function appendChatMsg(msg, isOwn) {
  appendMsgTo(document.getElementById('chatMessages'), msg, isOwn);
  scrollToBottom(document.getElementById('chatMessages'));
}

function appendMsgTo(container, msg, isOwn) {
  const sender = msg.username || msg.from_user || '';
  const div = document.createElement('div');
  div.className = `message ${isOwn ? 'own' : 'other'}`;
  const time = msg.created_at ? new Date(msg.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  let content;
  if (msg.msg_type === 'image') {
    content = `<img class="chat-img" src="${msg.content}" onclick="previewImage('${msg.content}')">`;
  } else if (msg.msg_type === 'poker_invite') {
    const rid = msg.content;
    const label = isOwn ? '已向对方发送扑克房间邀请' : '邀请你加入扑克房间';
    content = `
      <div class="poker-invite-card" onclick="acceptPokerInvite('${rid}')">
        <div class="poker-invite-icon">&#127136;</div>
        <div class="poker-invite-info">
          <div class="poker-invite-title">${label}</div>
          <div class="poker-invite-sub">点击进入房间 · ${rid.replace('poker_', '').slice(0, 6)}</div>
        </div>
      </div>
    `;
  } else {
    content = escapeHtml(msg.content);
  }
  div.innerHTML = `
    <div class="message-sender">${escapeHtml(msg.nickname || msg.from_user || '')}（${escapeHtml(sender)}）</div>
    <div class="message-bubble">${content}</div>
    <div class="message-time">${time}</div>
  `;
  container.appendChild(div);
}

function scrollToBottom(el) { el.scrollTop = el.scrollHeight; }

function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

// ===== Send =====
function sendHall() {
  const input = document.getElementById('hallInput');
  const content = input.value.trim();
  if (!content) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('[Send] WebSocket 未连接, readyState=', ws && ws.readyState);
    alert('连接断开');
    return;
  }
  const payload = { type: 'chat', username: user.username, nickname: user.nickname, content, msg_type: 'text' };
  console.log('[Send] 发送大厅消息:', payload);
  ws.send(JSON.stringify(payload));
  input.value = '';
}

function sendPrivate() {
  const input = document.getElementById('chatInput');
  const content = input.value.trim();
  if (!content) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) { alert('连接断开'); return; }
  if (currentChatType === 'hall') {
    ws.send(JSON.stringify({ type: 'chat', username: user.username, nickname: user.nickname, content, msg_type: 'text' }));
    input.value = '';
    return;
  }
  if (!currentChatPeer) return;
  ws.send(JSON.stringify({ type: 'private', from_user: user.username, to_user: currentChatPeer, nickname: user.nickname, content, msg_type: 'text', avatar: user.avatar }));
  input.value = '';
}

// ===== Image =====
function selectImage(target) {
  uploadTarget = target;
  document.getElementById('fileInput').click();
}

function onFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('image', file);
  authFetch('/api/upload/image', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(data => {
      if (!data.success) { alert('上传失败'); return; }
      const url = data.url;
      if (uploadTarget === 'hall') {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'chat', username: user.username, nickname: user.nickname, content: url, msg_type: 'image' }));
      } else if (uploadTarget === 'private' && currentChatPeer) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'private', from_user: user.username, to_user: currentChatPeer, nickname: user.nickname, content: url, msg_type: 'image', avatar: user.avatar }));
      }
      e.target.value = '';
    });
}

function previewImage(src) {
  document.getElementById('previewImg').src = src;
  document.getElementById('imgPreview').classList.remove('hidden');
}

// ===== Search / Add Friend =====
function showSearch() {
  document.getElementById('searchOverlay').classList.remove('hidden');
  document.getElementById('searchInput').value = '';
  document.getElementById('searchResults').innerHTML = '';
}

function closeSearch() {
  document.getElementById('searchOverlay').classList.add('hidden');
}

function doSearch() {
  const q = document.getElementById('searchInput').value.trim();
  if (!q) return;
  authFetch('/api/friend/search?q=' + encodeURIComponent(q))
    .then(r => r.json())
    .then(data => {
      const container = document.getElementById('searchResults');
      container.innerHTML = '';
      if (!data.success || !data.users || data.users.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">未找到用户</div>';
        return;
      }
      data.users.forEach(u => {
        if (u.username === user.username) return;
        const div = document.createElement('div');
        div.className = 'search-item';
        div.innerHTML = `
          <img class="search-avatar" src="${u.avatar || defaultAvatar(u.nickname)}">
          <div class="search-info">
            <div>${escapeHtml(u.nickname)}</div>
            <div style="font-size:12px;color:#999;">${u.username}</div>
          </div>
          <button class="btn btn-primary" style="width:auto;padding:6px 16px;font-size:13px;" onclick="addFriend('${u.username}')">申请添加</button>
        `;
        container.appendChild(div);
      });
    });
}

function addFriend(username) {
  authFetch('/api/friend/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userA: user.username, userB: username })
  }).then(r => r.json()).then(data => {
    alert(data.message);
    if (data.success) {
      loadFriends();
      closeSearch();
    }
  });
}

// ===== Friend Requests =====
function refreshFriendRequestCount() {
  authFetch('/api/friend/requests/count?username=' + encodeURIComponent(user.username))
    .then(r => r.json())
    .then(data => {
      const dot = document.getElementById('newFriendDot');
      if (!dot) return;
      if (data.success && data.count > 0) {
        dot.textContent = data.count > 99 ? '99+' : data.count;
        dot.classList.remove('hidden');
      } else {
        dot.classList.add('hidden');
        dot.textContent = '';
      }
    })
    .catch(() => {});
}

function showFriendRequests() {
  document.getElementById('friendRequestOverlay').classList.remove('hidden');
  loadFriendRequests();
}

function closeFriendRequests() {
  document.getElementById('friendRequestOverlay').classList.add('hidden');
  refreshFriendRequestCount();
}

function loadFriendRequests() {
  authFetch('/api/friend/requests?username=' + encodeURIComponent(user.username))
    .then(r => r.json())
    .then(data => {
      const container = document.getElementById('friendRequestList');
      container.innerHTML = '';
      if (!data.success || !data.requests || data.requests.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#999;padding:40px 20px;">暂无好友申请</div>';
        return;
      }
      data.requests.forEach(r => {
        const div = document.createElement('div');
        div.className = 'search-item';
        const time = r.created_at ? new Date(r.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        let actionHtml = '';
        if (r.status === 'pending') {
          actionHtml = `
            <button class="btn btn-primary" style="width:auto;padding:6px 14px;font-size:13px;margin-right:6px;" onclick="acceptFriendRequest(${r.id})">同意</button>
            <button class="btn btn-secondary" style="width:auto;padding:6px 14px;font-size:13px;" onclick="rejectFriendRequest(${r.id})">拒绝</button>
          `;
        } else if (r.status === 'accepted') {
          actionHtml = '<span style="color:#07c160;font-size:13px;">已同意</span>';
        } else {
          actionHtml = '<span style="color:#999;font-size:13px;">已拒绝</span>';
        }
        div.innerHTML = `
          <img class="search-avatar" src="${r.avatar || defaultAvatar(r.nickname || r.from_user)}">
          <div class="search-info">
            <div>${escapeHtml(r.nickname || r.from_user)}</div>
            <div style="font-size:12px;color:#999;">${escapeHtml(r.from_user)} · ${time}</div>
          </div>
          <div style="display:flex;align-items:center;">${actionHtml}</div>
        `;
        container.appendChild(div);
      });
    });
}

function acceptFriendRequest(id) {
  authFetch('/api/friend/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, username: user.username })
  }).then(r => r.json()).then(data => {
    if (data.success) {
      loadFriendRequests();
      loadFriends();
      refreshFriendRequestCount();
    } else {
      alert(data.message || '操作失败');
    }
  });
}

function rejectFriendRequest(id) {
  if (!confirm('确定拒绝这条好友申请？')) return;
  authFetch('/api/friend/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, username: user.username })
  }).then(r => r.json()).then(data => {
    if (data.success) {
      loadFriendRequests();
      refreshFriendRequestCount();
    } else {
      alert(data.message || '操作失败');
    }
  });
}

// ===== Me =====
function changeAvatar() {
  document.getElementById('avatarInput').click();
}

function onAvatarSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('avatar', file);
  fd.append('username', user.username);
  authFetch('/api/user/avatar', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        user.avatar = data.avatar;
        localStorage.setItem('chatUser', JSON.stringify(user));
        loadAvatar();
        alert('头像更新成功');
      }
      e.target.value = '';
    });
}

function showEditName() {
  document.getElementById('newNickname').value = user.nickname;
  document.getElementById('editNameOverlay').classList.remove('hidden');
}

function closeEditName() { document.getElementById('editNameOverlay').classList.add('hidden'); }

function saveNickname() {
  const name = document.getElementById('newNickname').value.trim();
  if (!name) return;
  authFetch('/api/user/nickname', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user.username, nickname: name })
  }).then(r => r.json()).then(data => {
    if (data.success) {
      user.nickname = name;
      localStorage.setItem('chatUser', JSON.stringify(user));
      document.getElementById('meNickname').textContent = name;
      closeEditName();
      alert('修改成功');
    }
  });
}

function showEditPwd() { document.getElementById('editPwdOverlay').classList.remove('hidden'); }
function closeEditPwd() { document.getElementById('editPwdOverlay').classList.add('hidden'); }

function savePassword() {
  const oldPwd = document.getElementById('oldPwd').value;
  const newPwd = document.getElementById('newPwd').value;
  if (!oldPwd || !newPwd) return;
  authFetch('/api/user/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user.username, oldPassword: oldPwd, newPassword: newPwd })
  }).then(r => r.json()).then(data => {
    alert(data.message);
    if (data.success) closeEditPwd();
  });
}

function logout() {
  if (tokenRefreshTimer) clearInterval(tokenRefreshTimer);
  accessToken = null;
  // 调用服务端退出（清除 Refresh Token Cookie）
  fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  localStorage.removeItem('chatUser');
  if (ws) ws.close();
  window.location.href = 'index.html';
}

window.addEventListener('DOMContentLoaded', init);
