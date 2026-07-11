/**
 * 主聊天页面 — 与原版 app.js 功能完全对齐
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/AuthContext';
import { useWebSocket } from '../hooks/useWebSocket';
import { api } from '../api/client';
import PokerRoom from './PokerRoom';
import type {
  User, Friend, Conversation, Message, FriendRequest,
  PokerRoom as PokerRoomType, PokerCard,
  FriendListResponse, MessageListResponse, ConversationListResponse,
  SearchUsersResponse, FriendRequestsResponse, CountResponse,
} from '../types';

type Tab = 'messages' | 'contacts' | 'hall' | 'games' | 'me';

export default function ChatPage() {
  useEffect(() => { document.title = '朋友聊天室'; }, []);
  const { user, logout, updateUser, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const hallBodyRef = useRef<HTMLDivElement>(null);

  // ===== 核心状态 =====
  const [tab, setTab] = useState<Tab>('messages');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [hallMessages, setHallMessages] = useState<Message[]>([]);
  const [unreadHall, setUnreadHall] = useState(0);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  // ===== 聊天状态 =====
  const [chatPeer, setChatPeer] = useState<string | null>(null);
  const [chatType, setChatType] = useState<'private' | 'hall' | null>(null);
  const [chatTitle, setChatTitle] = useState('');
  const [privateMessages, setPrivateMessages] = useState<Message[]>([]);
  const [hallInput, setHallInput] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [uploadTarget, setUploadTarget] = useState<'hall' | 'private'>('hall');
  const [imgPreviewSrc, setImgPreviewSrc] = useState<string | null>(null);

  // ===== 好友操作弹窗 =====
  const [showFriendMenu, setShowFriendMenu] = useState(false);

  // ===== 修改资料弹窗 =====
  const [showEditName, setShowEditName] = useState(false);
  const [showEditPwd, setShowEditPwd] = useState(false);
  const [newNickname, setNewNickname] = useState('');
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');

  // ===== 扑克游戏 =====
  const [showPoker, setShowPoker] = useState(false);
  const [pokerRoom, setPokerRoom] = useState<PokerRoomType | null>(null);
  const [pokerHand, setPokerHand] = useState<PokerCard[]>([]);
  const [pokerDealInfo, setPokerDealInfo] = useState<Record<string,unknown> | null>(null);

  // ===== 搜索 =====
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [contactFilter, setContactFilter] = useState('');

  // ★ 用 ref 存最新值，WebSocket 回调通过 ref 读取（彻底解决闭包过期）
  const chatTypeRef = useRef(chatType);
  const chatPeerRef = useRef(chatPeer);
  useEffect(() => { chatTypeRef.current = chatType; }, [chatType]);
  useEffect(() => { chatPeerRef.current = chatPeer; }, [chatPeer]);

  // ===== WebSocket =====
  const { sendMessage, isConnected } = useWebSocket({
    username: user?.username || '',
    onMessage: useCallback((msg) => {
      const m = msg as Record<string, unknown>;
      switch (m.type) {
        case 'chat': {
          const chatMsg = m as unknown as Message;
          setHallMessages(prev => [...prev, chatMsg]);
          if (chatTypeRef.current !== 'hall') setUnreadHall(c => c + 1);
          break;
        }
        case 'private': {
          const peer = (m.from_user as string) === user?.username ? m.to_user as string : m.from_user as string;
          if (chatTypeRef.current === 'private' && chatPeerRef.current === peer) {
            setPrivateMessages(prev => [...prev, m as unknown as Message]);
            if (m.from_user !== user?.username) {
              api.post('/private/read', { username: user?.username, peer }).catch(() => {});
            }
          }
          loadConversations();
          break;
        }
        case 'friend_request': loadPendingCount(); break;
        case 'friend_accepted': loadFriends(); loadPendingCount(); break;
        case 'poker_room_update': {
          const room = (m as unknown as { room: PokerRoomType }).room;
          if (room) {
            setPokerRoom(room);
            const inRoom = room.players.some(p => p.username === user?.username);
            if (inRoom) setShowPoker(true);
          }
          break;
        }
        case 'poker_your_hand': {
          const cards = (m as unknown as { cards: PokerCard[] }).cards;
          if (Array.isArray(cards)) setPokerHand(cards);
          break;
        }
        case 'poker_deal_done': {
          setPokerDealInfo(m as unknown as Record<string,unknown>);
          break;
        }
        case 'poker_round_end': {
          setPokerHand([]);
          break;
        }
      }
    }, [user?.username]),
  });

  // ===== 初始加载 =====
  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate('/login');
    if (isAuthenticated) { loadFriends(); loadConversations(); loadHallMessages(); loadPendingCount(); }
  }, [isAuthenticated, isLoading]);

  // Tab 切换时刷新数据
  useEffect(() => {
    if (tab === 'messages') loadConversations();
    if (tab === 'contacts') loadFriends();
  }, [tab]);

  // ===== 数据加载 =====
  async function loadFriends() {
    const data = await api.get<FriendListResponse>(`/friend/list?username=${user?.username}`);
    if (data.success) setFriends(data.friends);
  }
  async function loadConversations() {
    const data = await api.get<ConversationListResponse>(`/conversations?username=${user?.username}`);
    if (data.success) setConversations(data.conversations);
  }
  async function loadHallMessages() {
    const data = await api.get<MessageListResponse>('/messages');
    if (data.success) setHallMessages(data.messages);
  }
  async function loadPendingCount() {
    const data = await api.get<CountResponse>(`/friend/requests/count?username=${user?.username}`);
    if (data.success) setPendingCount(data.count);
  }
  async function loadFriendRequests() {
    const data = await api.get<FriendRequestsResponse>(`/friend/requests?username=${user?.username}`);
    if (data.success) setFriendRequests(data.requests);
  }
  async function loadPrivateHistory(peer: string) {
    const data = await api.get<MessageListResponse>(`/private/history?userA=${user?.username}&userB=${peer}`);
    if (data.success) setPrivateMessages(data.messages);
    api.post('/private/read', { username: user?.username, peer }).catch(() => {});
    setTimeout(() => chatBodyRef.current?.scrollTo(0, chatBodyRef.current.scrollHeight), 100);
  }

  // ===== 聊天操作 =====
  function openPrivateChat(peer: string, title: string) {
    setChatType('private'); setChatPeer(peer); setChatTitle(title);
    setPrivateMessages([]); loadPrivateHistory(peer);
  }
  function openHallChat() { setChatType('hall'); setChatPeer(null); setChatTitle('聊天大厅'); setUnreadHall(0); }
  function closeChat() { setChatType(null); setChatPeer(null); setShowFriendMenu(false); loadConversations(); }
  function sendHallMessage() {
    if (!hallInput.trim()) return;
    sendMessage({ type: 'chat', username: user?.username, nickname: user?.nickname, content: hallInput.trim(), msg_type: 'text' });
    setHallInput('');
  }
  function sendPrivateMessage() {
    if (!chatInput.trim() || !chatPeer) return;
    sendMessage({ type: 'private', from_user: user?.username, to_user: chatPeer, nickname: user?.nickname, content: chatInput.trim(), msg_type: 'text', avatar: user?.avatar });
    setChatInput('');
  }

  // ===== 好友操作 =====
  async function doSearch() {
    if (!searchQ.trim()) return;
    const data = await api.get<SearchUsersResponse>(`/friend/search?q=${encodeURIComponent(searchQ.trim())}`);
    setSearchResults(data.success ? data.users.filter(u => u.username !== user?.username) : []);
  }
  async function addFriend(toUser: string) {
    const data = await api.post<{ success: boolean; message: string }>('/friend/add', { userA: user?.username, userB: toUser });
    alert(data.message || (data.success ? '已发送' : '失败'));
    if (data.success) { loadFriends(); setSearchQ(''); setSearchResults([]); }
  }
  async function acceptRequest(id: number) { await api.post('/friend/accept', { id, username: user?.username }); loadFriendRequests(); loadFriends(); loadPendingCount(); }
  async function rejectRequest(id: number) { if (!confirm('确定拒绝？')) return; await api.post('/friend/reject', { id, username: user?.username }); loadFriendRequests(); loadPendingCount(); }

  // ===== 好友备注/删除 =====
  function openFriendMenu() {
    if (chatType !== 'private' || !chatPeer) return;
    if (!friends.find(x => x.username === chatPeer)) return;
    setShowFriendMenu(true);
  }
  async function setRemark() {
    if (!chatPeer) return;
    const f = friends.find(x => x.username === chatPeer);
    const input = window.prompt('为 ' + (f?.nickname || chatPeer) + ' 设置备注（清空取消备注）：', f?.remark || '');
    if (input === null) return;
    const remark = input.trim().slice(0, 40);
    await api.post('/friend/remark', { owner: user?.username, target: chatPeer, remark });
    setShowFriendMenu(false); loadFriends();
    setChatTitle(remark || f?.nickname || chatPeer);
  }
  async function removeFriend() {
    if (!chatPeer) return;
    const f = friends.find(x => x.username === chatPeer);
    const name = f?.remark || f?.nickname || chatPeer;
    if (!confirm('确定删除好友「' + name + '」吗？\n\n删除后无法私聊，聊天记录保留。')) return;
    await api.post('/friend/remove', { userA: user?.username, userB: chatPeer });
    setShowFriendMenu(false); closeChat(); loadFriends();
  }

  // ===== 扑克操作 =====
  async function acceptPokerInvite(roomId: string) {
    const data = await api.post<{ success: boolean; room: PokerRoomType; message?: string }>('/game/poker/join', { roomId, username: user?.username });
    if (data.success && data.room) {
      closeChat();
      setPokerRoom(data.room);
      setShowPoker(true);
    } else { alert(data.message || '加入失败'); }
  }

  // ===== 图片 =====
  function selectImage(target: 'hall' | 'private') { setUploadTarget(target); fileInputRef.current?.click(); }
  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const fd = new FormData(); fd.append('image', file);
    const data = await api.upload<{ success: boolean; url: string }>('/upload/image', fd);
    if (data.success) {
      if (uploadTarget === 'hall') sendMessage({ type: 'chat', username: user?.username, nickname: user?.nickname, content: data.url, msg_type: 'image' });
      else if (chatPeer) sendMessage({ type: 'private', from_user: user?.username, to_user: chatPeer, nickname: user?.nickname, content: data.url, msg_type: 'image', avatar: user?.avatar });
    }
    e.target.value = '';
  }
  function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const fd = new FormData(); fd.append('avatar', file); fd.append('username', user?.username || '');
    api.upload<{ success: boolean; avatar: string }>('/user/avatar', fd).then(data => {
      if (data.success) { updateUser({ avatar: data.avatar }); alert('头像更新成功'); }
    });
    e.target.value = '';
  }

  // ===== 修改资料 =====
  async function saveNickname() {
    if (!newNickname.trim()) return;
    await api.post('/user/nickname', { username: user?.username, nickname: newNickname.trim() });
    updateUser({ nickname: newNickname.trim() }); setShowEditName(false); alert('修改成功');
  }
  async function savePassword() {
    if (!oldPwd || !newPwd) return;
    const data = await api.post<{ success: boolean; message: string }>('/user/password', { username: user?.username, oldPassword: oldPwd, newPassword: newPwd });
    alert(data.message);
    if (data.success) { setShowEditPwd(false); setOldPwd(''); setNewPwd(''); }
  }

  async function handleLogout() { await logout(); navigate('/login', { replace: true }); }

  // ===== 工具 =====
  function displayName(f: Friend) { return f.remark || f.nickname; }
  function msgSender(m: Message) { return m.nickname || (m as unknown as Record<string,string>).from_user || ''; }
  function msgIsOwn(m: Message) { return (m.username || (m as unknown as Record<string,string>).from_user) === user?.username; }
  function fmtTime(ts: string) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function renderMsgContent(m: Message) {
    if (m.msg_type === 'image')
      return <img className="msg-img" src={m.content} onClick={() => setImgPreviewSrc(m.content)} style={{maxWidth:200,maxHeight:200,borderRadius:6,cursor:'pointer'}} alt="" />;
    if (m.msg_type === 'poker_invite')
      return (
        <div className="poker-invite-card" onClick={() => acceptPokerInvite(m.content)}>
          <div className="poker-invite-icon">🃏</div>
          <div className="poker-invite-info">
            <div className="poker-invite-title">{msgIsOwn(m) ? '已发送扑克邀请' : '邀请你加入扑克房间'}</div>
            <div className="poker-invite-sub">点击进入 · {m.content.replace('poker_','').slice(0,6)}</div>
          </div>
        </div>
      );
    return <>{m.content}</>;
  }

  if (isLoading) return <div className="loading-screen">加载中...</div>;
  if (!user) return null;

  const fPeer = chatPeer ? friends.find(x => x.username === chatPeer) : null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>{['消息','通讯录','大厅','游戏','我'][['messages','contacts','hall','games','me'].indexOf(tab)]}</h1>
        <span className={`connection-dot ${isConnected ? 'online' : 'offline'}`} />
      </header>

      {/* 私聊/Hall 浮层 */}
      {chatType && (
        <div className="chat-overlay">
          <div className="chat-overlay-header">
            <button onClick={closeChat} className="back-btn">&lsaquo; 返回</button>
            <span onClick={openFriendMenu} style={{cursor:chatType==='private'?'pointer':'default',flex:1,textAlign:'center',fontWeight:500}}>{chatTitle}</span>
          </div>
          <div className="chat-overlay-body" ref={chatBodyRef}>
            {(chatType === 'hall' ? hallMessages : privateMessages).map((m, i) => (
              <div key={m.id || i} className={`msg-bubble ${msgIsOwn(m) ? 'own' : 'other'}`}>
                <div className="msg-sender">{msgSender(m)}</div>
                <div className="msg-text">{renderMsgContent(m)}</div>
                <div className="msg-time">{fmtTime(m.created_at)}</div>
              </div>
            ))}
          </div>
          <div className="chat-overlay-input">
            <button className="img-btn" onClick={() => selectImage(chatType === 'hall' ? 'hall' : 'private')}>+</button>
            <input value={chatType === 'hall' ? hallInput : chatInput}
              onChange={e => chatType === 'hall' ? setHallInput(e.target.value) : setChatInput(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && (chatType === 'hall' ? sendHallMessage() : sendPrivateMessage())}
              placeholder="输入消息..." maxLength={500} />
            <button onClick={chatType === 'hall' ? sendHallMessage : sendPrivateMessage}>发送</button>
          </div>
        </div>
      )}

      {/* 好友操作菜单 */}
      {showFriendMenu && fPeer && (
        <div className="modal-overlay" onClick={() => setShowFriendMenu(false)}>
          <div className="friend-menu-sheet" onClick={e => e.stopPropagation()}>
            <div className="friend-menu-title">
              <div className="friend-menu-name">{fPeer.remark || fPeer.nickname}</div>
              <div className="friend-menu-sub">昵称：{fPeer.nickname} · 账号：{fPeer.username}</div>
            </div>
            <button className="friend-menu-btn" onClick={setRemark}>设置备注</button>
            <button className="friend-menu-btn danger" onClick={removeFriend}>删除好友</button>
            <button className="friend-menu-btn cancel" onClick={() => setShowFriendMenu(false)}>取消</button>
          </div>
        </div>
      )}

      <main className="app-main">
        {/* 消息 Tab */}
        {tab === 'messages' && (
          <div className="tab-messages">
            <div className="conv-item" onClick={openHallChat}>
              <div className="conv-avatar hall-avatar">#</div>
              <div className="conv-body">
                <div className="conv-top">
                  <span className="conv-name">聊天大厅{unreadHall > 0 && <span className="badge">{unreadHall}</span>}</span>
                  <span className="conv-time">{hallMessages.length > 0 ? fmtTime(hallMessages[hallMessages.length-1].created_at) : ''}</span>
                </div>
                <div className="conv-preview">{hallMessages.length > 0 ? (hallMessages[hallMessages.length-1].msg_type==='image'?'[图片]':hallMessages[hallMessages.length-1].content) : '点击进入大厅聊天'}</div>
              </div>
            </div>
            {conversations.map(c => {
              const f = friends.find(x => x.username === c.peer);
              const title = f ? displayName(f) : c.peer;
              return (
                <div key={c.peer} className="conv-item" onClick={() => openPrivateChat(c.peer, title)}>
                  <div className="conv-avatar">{title[0]}</div>
                  <div className="conv-body">
                    <div className="conv-top">
                      <span className="conv-name">{title}{c.unreadCount > 0 && <span className="badge">{c.unreadCount}</span>}</span>
                      <span className="conv-time">{fmtTime(c.lastTime)}</span>
                    </div>
                    <div className="conv-preview">{c.lastMsgType==='image'?'[图片]':c.lastMsgType==='poker_invite'?'[扑克邀请]':c.lastContent}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 通讯录 Tab */}
        {tab === 'contacts' && (
          <div className="tab-contacts">
            <div className="contact-item special" onClick={async () => { await loadFriendRequests(); }}>
              <span>新朋友</span>
              {pendingCount > 0 && <span className="badge">{pendingCount}</span>}
            </div>
            {/* 搜索添加好友 */}
            <div className="search-section">
              <div className="search-bar">
                <input value={searchQ} onChange={e => setSearchQ(e.target.value)} onKeyPress={e => e.key==='Enter'&&doSearch()} placeholder="搜索用户" />
                <button onClick={doSearch}>搜索</button>
              </div>
              {searchResults.length > 0 && (
                <div className="search-results">
                  {searchResults.map(u => (
                    <div key={u.username} className="search-item">
                      <span>{u.nickname} (@{u.username})</span>
                      <button onClick={() => addFriend(u.username)}>添加</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* 好友筛选 */}
            <div className="search-bar">
              <input value={contactFilter} onChange={e => setContactFilter(e.target.value)} placeholder="搜索好友" />
            </div>
            {friends.filter(f => {
              if (!contactFilter.trim()) return true;
              const q = contactFilter.trim().toLowerCase();
              const dn = displayName(f).toLowerCase();
              return dn.includes(q) || f.nickname.toLowerCase().includes(q) || f.username.toLowerCase().includes(q);
            }).map(f => (
              <div key={f.username} className="contact-item" onClick={() => openPrivateChat(f.username, displayName(f))}>
                <div className="contact-avatar">{displayName(f)[0]}</div>
                <span>{displayName(f)}{f.remark&&f.remark!==f.nickname?<span className="contact-sub">(@{f.nickname})</span>:null}</span>
              </div>
            ))}
          </div>
        )}

        {/* 大厅 Tab */}
        {tab === 'hall' && (
          <div className="tab-hall">
            <div className="hall-messages" ref={hallBodyRef}>
              {hallMessages.map((m, i) => (
                <div key={m.id||i} className={`msg-bubble ${msgIsOwn(m)?'own':'other'}`}>
                  <div className="msg-sender">{msgSender(m)}</div>
                  <div className="msg-text">{renderMsgContent(m)}</div>
                  <div className="msg-time">{fmtTime(m.created_at)}</div>
                </div>
              ))}
            </div>
            <div className="hall-input-bar">
              <button className="img-btn" onClick={() => selectImage('hall')}>+</button>
              <input value={hallInput} onChange={e => setHallInput(e.target.value)} onKeyPress={e => e.key==='Enter'&&sendHallMessage()} placeholder="输入消息..." maxLength={500} />
              <button onClick={sendHallMessage}>发送</button>
            </div>
          </div>
        )}

        {/* 游戏 Tab */}
        {tab === 'games' && (
          <div className="tab-games">
            {!showPoker && (
              <div className="game-card" onClick={() => setShowPoker(true)}>
                <div className="game-icon">🃏</div>
                <div className="game-name">扑克牌</div>
                <div className="game-desc">经典四人扑克对战</div>
              </div>
            )}
          </div>
        )}

        {/* 扑克房间 */}
        {showPoker && (
          <PokerRoom
            sendMessage={sendMessage}
            initialRoom={pokerRoom}
            handCards={pokerHand}
            dealInfo={pokerDealInfo}
            onClose={() => { setShowPoker(false); setPokerRoom(null); setPokerHand([]); setPokerDealInfo(null); }}
          />
        )}

        {/* 我 Tab */}
        {tab === 'me' && (
          <div className="tab-me">
            <div className="profile-card" onClick={() => avatarInputRef.current?.click()}>
              <div className="profile-avatar">{user.nickname?.[0]||'?'}</div>
              <div className="profile-info">
                <div className="profile-name">{user.nickname}</div>
                <div className="profile-username">账号: {user.username}</div>
              </div>
              <span style={{marginLeft:'auto',color:'#999',fontSize:'12px'}}>点击换头像</span>
            </div>
            <div className="profile-menu">
              <div className="menu-item" onClick={() => { setNewNickname(user.nickname); setShowEditName(true); }}>修改昵称</div>
              <div className="menu-item" onClick={() => { setOldPwd(''); setNewPwd(''); setShowEditPwd(true); }}>修改密码</div>
              <div className="menu-item" onClick={handleLogout} style={{color:'var(--danger)'}}>退出登录</div>
            </div>
          </div>
        )}
      </main>

      <nav className="tab-bar">
        {(['messages','contacts','hall','games','me'] as Tab[]).map(t => (
          <button key={t} className={`tab-btn ${tab===t?'active':''}`} onClick={() => setTab(t)}>
            <span className="tab-icon">{{messages:'💬',contacts:'👤',hall:'🌐',games:'🎮',me:'⚙️'}[t]}</span>
            <span className="tab-label">{{messages:'消息',contacts:'通讯录',hall:'大厅',games:'游戏',me:'我'}[t]}</span>
          </button>
        ))}
      </nav>

      {/* 好友申请弹窗 */}
      {friendRequests.length > 0 && (
        <div className="modal-overlay" onClick={() => setFriendRequests([])}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>好友申请</h3>
            {friendRequests.map(r => (
              <div key={r.id} className="request-item">
                <span>{r.nickname||r.from_user} <small style={{color:'#999'}}>@{r.from_user}</small></span>
                {r.status==='pending' ? (
                  <div className="request-actions">
                    <button onClick={() => acceptRequest(r.id)}>同意</button>
                    <button onClick={() => rejectRequest(r.id)}>拒绝</button>
                  </div>
                ) : <span className="request-status">{r.status==='accepted'?'已同意':'已拒绝'}</span>}
              </div>
            ))}
            <button className="modal-close" onClick={() => setFriendRequests([])}>关闭</button>
          </div>
        </div>
      )}

      {/* 修改昵称 */}
      {showEditName && (
        <div className="modal-overlay" onClick={() => setShowEditName(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>修改昵称</h3>
            <div className="form-group"><input value={newNickname} onChange={e => setNewNickname(e.target.value)} placeholder="新昵称" /></div>
            <button className="btn btn-primary" onClick={saveNickname}>保存</button>
            <button className="modal-close" onClick={() => setShowEditName(false)}>取消</button>
          </div>
        </div>
      )}

      {/* 修改密码 */}
      {showEditPwd && (
        <div className="modal-overlay" onClick={() => setShowEditPwd(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>修改密码</h3>
            <div className="form-group"><input type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} placeholder="旧密码" /></div>
            <div className="form-group"><input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="新密码（6-100字符）" /></div>
            <button className="btn btn-primary" onClick={savePassword}>保存</button>
            <button className="modal-close" onClick={() => setShowEditPwd(false)}>取消</button>
          </div>
        </div>
      )}

      {/* 图片预览 */}
      {imgPreviewSrc && (
        <div className="img-preview-overlay" onClick={() => setImgPreviewSrc(null)}>
          <img src={imgPreviewSrc} alt="" />
        </div>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" style={{display:'none'}} onChange={onFileSelected} />
      <input ref={avatarInputRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleAvatarUpload} />
    </div>
  );
}
