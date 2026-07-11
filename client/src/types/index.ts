/**
 * 全栈项目 — TypeScript 类型定义
 * 企业实践：所有 API 响应和业务实体都有明确的类型约束
 * 面试话术："TypeScript 的类型系统让前后端契约一目了然，
 *           新人接手项目看类型定义就知道数据结构，不需要翻文档。"
 */

// ===== 用户 =====
export interface User {
  username: string;
  nickname: string;
  avatar: string | null;
}

export interface UserProfile extends User {
  id: number;
  created_at: string;
}

// ===== 消息 =====
export type MessageType = 'text' | 'image' | 'poker_invite';

export interface Message {
  id: number;
  username: string;
  nickname: string;
  content: string;
  msg_type: MessageType;
  created_at: string;
  avatar?: string;
}

export interface PrivateMessage {
  id: number;
  from_user: string;
  to_user: string;
  nickname: string;
  content: string;
  msg_type: MessageType;
  created_at: string;
  avatar?: string;
  is_read: number;
}

// ===== 好友 =====
export interface Friend {
  username: string;
  nickname: string;
  avatar: string | null;
  remark: string | null;
}

export interface FriendRequest {
  id: number;
  from_user: string;
  to_user: string;
  status: 'pending' | 'accepted' | 'rejected';
  nickname: string;
  avatar: string | null;
  created_at: string;
  handled_at: string | null;
}

// ===== 对话列表 =====
export interface Conversation {
  peer: string;
  lastContent: string;
  lastMsgType: MessageType;
  lastTime: string;
  unreadCount: number;
}

// ===== API 通用响应 =====
export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  errors?: { field: string; message: string }[];
  // 泛型数据字段
  data?: T;
}

export interface LoginResponse {
  success: boolean;
  accessToken: string;
  user: User;
  message?: string;
}

export interface FriendListResponse {
  success: boolean;
  friends: Friend[];
}

export interface MessageListResponse {
  success: boolean;
  messages: Message[];
}

export interface ConversationListResponse {
  success: boolean;
  conversations: Conversation[];
}

export interface SearchUsersResponse {
  success: boolean;
  users: User[];
}

export interface FriendRequestsResponse {
  success: boolean;
  requests: FriendRequest[];
}

export interface CountResponse {
  success: boolean;
  count: number;
}

// ===== 扑克游戏 =====
export interface PokerCard {
  suit: string;
  rank: string;
  copy: number;
  id: string;
}

export interface PokerHand {
  type: 'single' | 'pair' | 'triple' | 'pairs' | 'plane' | 'bomb';
  rank: string;
  size?: number;
}

export interface PokerPlayer {
  username: string;
  nickname: string;
  avatar: string | null;
  seat: number;
  ready: boolean;
  online: boolean;
  handCount: number;
}

export interface CurrentTrick {
  username: string;
  cards: PokerCard[];
  hand: PokerHand;
}

export interface PokerRoom {
  id: string;
  ownerUsername: string;
  status: string;
  phase: string;
  magicN?: number;
  keyCard?: PokerCard;
  firstPlayerUsername?: string;
  teammateUsername?: string;
  turnUsername?: string;
  currentTrick: CurrentTrick | null;
  trickStarter: string | null;
  passCount: number;
  trickScore: number;
  scores: Record<string, number>;
  finishRank: string[];
  players: PokerPlayer[];
}

export interface PokerRoomResponse {
  success: boolean;
  room: PokerRoom;
  message?: string;
}

// ===== WebSocket 消息 =====
export type WSMessageType =
  | 'auth'
  | 'chat'
  | 'private'
  | 'friend_request'
  | 'friend_accepted'
  | 'poker_room_update'
  | 'poker_deal_done'
  | 'poker_your_hand'
  | 'poker_game_start'
  | 'poker_play'
  | 'poker_pass'
  | 'poker_trick_end'
  | 'poker_round_end';

export interface WSMessage {
  type: WSMessageType;
  [key: string]: unknown;
}

export interface WSChatMessage extends WSMessage {
  type: 'chat';
  username: string;
  nickname: string;
  content: string;
  msg_type: MessageType;
  avatar?: string;
  created_at: string;
}

export interface WSPrivateMessage extends WSMessage {
  type: 'private';
  from_user: string;
  to_user: string;
  nickname: string;
  content: string;
  msg_type: MessageType;
  avatar?: string;
  created_at: string;
}

export interface WSPokerRoomUpdate extends WSMessage {
  type: 'poker_room_update';
  room: PokerRoom;
}

export interface WSPokerYourHand extends WSMessage {
  type: 'poker_your_hand';
  roomId: string;
  cards: PokerCard[];
}

export interface WSPokerRoundEnd extends WSMessage {
  type: 'poker_round_end';
  finishRank: string[];
  scores: Record<string, number>;
}
