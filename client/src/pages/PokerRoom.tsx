/**
 * 扑克房间 — 完整四人牌桌
 * 通过 props 接收房间状态和手牌（不再使用 window hack）
 */
import { useState, useEffect } from 'react';
import { useAuth } from '../store/AuthContext';
import { api } from '../api/client';
import type { PokerRoom as PokerRoomType, PokerCard, Friend, FriendListResponse } from '../types';

interface Props {
  sendMessage: (msg: Record<string, unknown>) => void;
  onClose: () => void;
  initialRoom: PokerRoomType | null;
  handCards: PokerCard[];
  dealInfo: Record<string, unknown> | null;
}

const RANK_ORDER: Record<string, number> = { big:100, small:99, A:14, K:13, Q:12, J:11, '10':10, '9':9, '8':8, '7':7, '6':6, '5':5, '4':4, '3':3, '2':2 };
const SUIT_ORDER: Record<string, number> = { JOKER:0, '♠':1, '♥':2, '♣':3, '♦':4 };
const CCW = [0, 3, 2, 1];

function sortCards(cards: PokerCard[]): PokerCard[] {
  return [...cards].sort((a, b) => {
    const ra = RANK_ORDER[a.rank] || 0, rb = RANK_ORDER[b.rank] || 0;
    if (rb !== ra) return rb - ra;
    return (SUIT_ORDER[a.suit] || 0) - (SUIT_ORDER[b.suit] || 0);
  });
}

function formatCard(c: PokerCard) {
  if (!c) return null;
  if (c.suit === 'JOKER') {
    return <span key={c.id} className={`pc ${c.rank==='big'?'red':'black'}`}>{c.rank==='big'?'🃏':'🃏'}</span>;
  }
  const color = c.suit === '♥' || c.suit === '♦' ? 'red' : 'black';
  return <span key={c.id} className={`pc ${color}`}><span className="cs">{c.suit}</span><span className="cr">{c.rank}</span></span>;
}

export default function PokerRoom({ sendMessage, onClose, initialRoom, handCards, dealInfo }: Props) {
  const { user } = useAuth();
  // ★ 关键修复：props 传递的房间状态优先使用（来自 WebSocket 广播，最权威）
  // 本地状态只在创建/加入房间的 API 响应时临时使用（此时 props 还未更新）
  const [localRoom, setLocalRoom] = useState<PokerRoomType | null>(null);
  const room = initialRoom || localRoom;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showInvite, setShowInvite] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 全屏事件监听
  useEffect(() => {
    const h = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  if (!user) return null;

  const me = room?.players.find(p => p.username === user.username);
  const inGame = room?.phase === 'playing';
  const myTurn = !!(inGame && me && room?.turnUsername === user.username);
  const sortedHand = sortCards(handCards);

  function rankOfSeat(s: number) { return CCW.indexOf(s); }
  function seatToPos(seat: number) {
    if (!me) return -1;
    return ((rankOfSeat(seat) - rankOfSeat(me.seat) + 4) % 4);
  }
  // pos 0=我自己(下方) 1=下家(右) 2=对家(上) 3=上家(左)
  function relationLabel(pos: number) { return ['我','下家','队友','上家'][pos]; }

  // ===== 操作 =====
  async function createRoom() {
    const data = await api.post<{ success: boolean; room: PokerRoomType; message?: string }>('/game/poker/create', { username: user?.username });
    if (data.success) setLocalRoom(data.room); else alert(data.message);
  }
  async function joinRoom(roomId: string) {
    const data = await api.post<{ success: boolean; room: PokerRoomType; message?: string }>('/game/poker/join', { roomId, username: user?.username });
    if (data.success) setLocalRoom(data.room); else alert(data.message);
  }
  async function leaveRoom() {
    if (room) await api.post('/game/poker/leave', { roomId: room.id, username: user?.username });
    onClose();
  }
  async function toggleReady() {
    if (!room || !me) return;
    await api.post('/game/poker/ready', { roomId: room.id, username: user?.username, ready: !me.ready });
  }
  async function playCards() {
    if (!room || !myTurn) return;
    const cardIds = Array.from(selectedIds);
    if (cardIds.length === 0) { alert('请先选择要出的牌'); return; }
    const data = await api.post<{ success: boolean; message?: string; myHand?: string; lastHand?: string }>(
      '/game/poker/play', { roomId: room.id, username: user?.username, cardIds }
    );
    if (!data.success) {
      alert((data.message||'出牌失败') + (data.lastHand ? '\n当前牌型: '+data.lastHand : ''));
    } else { setSelectedIds(new Set()); }
  }
  async function passCards() {
    if (!room) return;
    const data = await api.post<{ success: boolean; message?: string }>('/game/poker/pass', { roomId: room.id, username: user?.username });
    if (!data.success) alert(data.message); else setSelectedIds(new Set());
  }
  async function showInviteList() {
    const data = await api.get<FriendListResponse>(`/friend/list?username=${user?.username}`);
    if (data.success) setFriends(data.friends);
    setShowInvite(true);
  }
  function inviteFriend(fu: string) {
    if (!room) return;
    sendMessage({ type: 'private', from_user: user?.username, to_user: fu, nickname: user?.nickname, content: room.id, msg_type: 'poker_invite', avatar: user?.avatar });
    alert('邀请已发送');
    setShowInvite(false);
  }
  function toggleFullscreen() {
    if (!isFullscreen) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  }

  // ===== 大厅 =====
  if (!room) {
    return (
      <div className="poker-lobby">
        <div className="poker-lobby-icon">🃏</div>
        <div className="poker-lobby-title">四人扑克</div>
        <div className="poker-lobby-desc">创建房间，邀请 3 位好友一起对战</div>
        <div style={{display:'flex',flexDirection:'column',gap:12,alignItems:'center'}}>
          <button className="btn btn-primary" style={{width:200}} onClick={createRoom}>创建房间</button>
          <div style={{color:'#fff'}}>或输入房间号加入</div>
          <JoinRoomInput onJoin={joinRoom} />
          <button className="btn btn-secondary" style={{width:200}} onClick={onClose}>返回</button>
        </div>
      </div>
    );
  }

  const inRoomSet = new Set(room.players.map(p => p.username));

  return (
    <div className={`poker-room-wrap ${isFullscreen ? 'fullscreen' : ''}`}>
      <div className="poker-room-topbar">
        <button onClick={leaveRoom} className="back-btn">&lsaquo; 离开</button>
        <span>房间 {room.id.replace('poker_','').slice(0,6)} · {room.players.length}/4</span>
        <button onClick={toggleFullscreen} className="btn-small" style={{background:'rgba(255,255,255,0.2)',color:'#fff',border:'none'}}>⛶</button>
      </div>

      {/* 发牌信息 */}
      {dealInfo && (
        <div className="poker-info-bar">
          <span>随机数: <b>{String(dealInfo.magicN)}</b></span>
          {!!dealInfo.keyCard && <span>明牌: {formatCard(dealInfo.keyCard as PokerCard)}</span>}
          <span>先手: <b>{String(dealInfo.firstPlayerUsername)}</b></span>
          <span>队友: <b>{String(dealInfo.teammateUsername)}</b></span>
          {!!dealInfo.swapped && <span style={{color:'#f5c542'}}>(已自动换座)</span>}
        </div>
      )}

      <div className="poker-table-area">
        {/* 4个座位 */}
        {[0, 1, 2, 3].map(pos => {
          const player = room.players.find(p => seatToPos(p.seat) === pos);
          const isTurn = player && room.turnUsername === player.username;
          const isFirst = player && room.firstPlayerUsername === player.username;
          const isTeammate = player && room.teammateUsername === player.username;
          const posClass = ['bottom','right','top','left'][pos];
          return (
            <div key={pos} className={`poker-seat seat-${posClass} ${isTurn?'turn':''}`}>
              {player ? (
                <>
                  {inGame ? (
                    <div className={`seat-badge ${isFirst?'role-first':isTeammate?'role-teammate':''}`} style={isFirst?{background:'#f5c542',color:'#333'}:isTeammate?{background:'#5b9bd5',color:'#fff'}:{}}>
                      {isFirst?'先手':isTeammate?'队友':''}
                    </div>
                  ) : (
                    <div className={`seat-badge ${player.ready?'ready':player.online===false?'offline':'not-ready'}`}>
                      {player.online===false?'离线':player.ready?'已准备':'未准备'}
                    </div>
                  )}
                  {room.finishRank && room.finishRank.indexOf(player.username) >= 0 && (
                    <div className={`rank-badge2 rank-${room.finishRank.indexOf(player.username)+1}`}>
                      {room.finishRank.indexOf(player.username)+1}
                    </div>
                  )}
                  <div className="seat-avatar">{player.nickname[0]}</div>
                  <div className="seat-name">{player.nickname}{player.username===room.ownerUsername?' 👑':''}</div>
                  {inGame && <div className="seat-count">🂠 {player.handCount}</div>}
                  {(room.scores?.[player.username] || 0) > 0 && <div className="seat-score">{room.scores[player.username]}分</div>}
                </>
              ) : (
                <div className="seat-empty">+</div>
              )}
            </div>
          );
        })}

        {/* 中央区 */}
        <div className="poker-center-area">
          {/* ★ 回合指针：箭头指向当前出牌玩家 */}
          {inGame && room.turnUsername && (() => {
            const tp = room.players.find(p => p.username === room.turnUsername);
            if (tp && me) {
              const pos = seatToPos(tp.seat);
              const arrows = ['▼','▶','▲','◀'];
              return <div className={`turn-pointer turn-pos-${pos}`}>{arrows[pos]}</div>;
            }
            return null;
          })()}
          {!inGame ? (
            <div className="center-actions">
              <div className="poker-center-count">{room.players.length} / 4</div>
              <button className="btn btn-primary" style={{width:'auto',padding:'10px 30px'}} onClick={toggleReady}>
                {me?.ready ? '取消准备' : '准备'}
              </button>
              <button className="btn btn-secondary" style={{width:'auto',padding:'10px 20px'}} onClick={showInviteList}>邀请好友</button>
            </div>
          ) : (
            <div className="center-actions">
              {room.currentTrick && (
                <div className="current-trick">
                  <div className="trick-player">
                    {(() => { const who = room.players.find(p => p.username === room.currentTrick!.username); return who ? (relationLabel(seatToPos(who.seat)) + ' 出') : ''; })()}
                  </div>
                  <div className="trick-cards">{room.currentTrick.cards.map(c => formatCard(c))}</div>
                </div>
              )}
              <div className="poker-center-count trick-score">{room.trickScore > 0 ? `本轮 ${room.trickScore} 分` : ''}</div>
              {myTurn && (
                <div className="turn-actions">
                  <button className="btn btn-primary" style={{width:'auto',padding:'8px 24px'}} onClick={playCards} disabled={selectedIds.size===0}>
                    出牌 ({selectedIds.size})
                  </button>
                  {room.currentTrick && (
                    <button className="btn btn-secondary" style={{width:'auto',padding:'8px 24px'}} onClick={passCards}>过</button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 手牌区 */}
      {inGame && handCards.length > 0 && (
        <div className="poker-my-hand">
          <div className="hand-label">我的手牌 · {handCards.length} 张</div>
          <div className="hand-cards">
            {sortedHand.map(c => {
              const sel = selectedIds.has(c.id);
              return (
                <div key={c.id} className={`hand-card ${sel?'selected':''}`}
                  onClick={() => {
                    const next = new Set(selectedIds);
                    sel ? next.delete(c.id) : next.add(c.id);
                    setSelectedIds(next);
                  }}>
                  {formatCard(c)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 本局结束 */}
      {room.phase === 'finished' && room.finishRank && room.finishRank.length > 0 && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>本局结束</h3>
            {room.finishRank.map((u, i) => {
              const p = room.players.find(pp => pp.username === u);
              return (
                <div key={u} className="round-end-row">
                  <span className={`rank-badge rank-${i+1}`}>{i+1}</span>
                  <span>{p?.nickname || u}</span>
                  <span>{room.scores?.[u] || 0} 分</span>
                </div>
              );
            })}
            <button className="btn btn-primary" style={{marginTop:12}} onClick={toggleReady}>准备下一把</button>
          </div>
        </div>
      )}

      {/* 邀请弹窗 */}
      {showInvite && (
        <div className="modal-overlay" onClick={() => setShowInvite(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxHeight:'70vh',overflow:'auto'}}>
            <h3>邀请好友</h3>
            {friends.length === 0 && <p style={{textAlign:'center',color:'#999',padding:20}}>暂无好友</p>}
            {friends.filter(f => !inRoomSet.has(f.username)).map(f => (
              <div key={f.username} className="search-item">
                <span>{f.remark || f.nickname}</span>
                <button onClick={() => inviteFriend(f.username)}>邀请</button>
              </div>
            ))}
            {friends.filter(f => !inRoomSet.has(f.username)).length===0 && friends.length>0 && (
              <p style={{textAlign:'center',color:'#999',padding:20}}>所有好友已在房间中</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function JoinRoomInput({ onJoin }: { onJoin: (id: string) => void }) {
  const [id, setId] = useState('');
  return (
    <div style={{display:'flex',gap:8}}>
      <input value={id} onChange={e => setId(e.target.value)} placeholder="房间号" style={{padding:'8px 12px',borderRadius:8,border:'none',width:150}} />
      <button className="btn btn-secondary" style={{width:'auto',padding:'8px 16px'}} onClick={() => id && onJoin(id)}>加入</button>
    </div>
  );
}
