/**
 * WebSocket Hook — 修复版
 * 核心修复：用 ref 存储最新的 onMessage 回调，避免闭包过期
 * 问题根因：connect() 在已连接时 return 跳过，导致 onmessage 永远用的是旧回调
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import type { WSMessage } from '../types';

interface UseWebSocketOptions {
  username: string;
  onMessage: (msg: WSMessage) => void;
  reconnectInterval?: number;
  maxReconnectInterval?: number;
}

interface UseWebSocketReturn {
  sendMessage: (msg: Record<string, unknown>) => void;
  isConnected: boolean;
}

export function useWebSocket({
  username,
  onMessage,
  reconnectInterval = 3000,
  maxReconnectInterval = 30000,
}: UseWebSocketOptions): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef(0);
  const [isConnected, setIsConnected] = useState(false);

  // ★ 关键修复：用 ref 存最新回调，WebSocket 永远调用最新版本
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  // 用 ref 存 username，避免 connect 依赖变化导致重连
  const usernameRef = useRef(username);
  usernameRef.current = username;

  // 停止重连定时器
  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  // 停止心跳
  const clearHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    clearReconnectTimer();
    retryCountRef.current += 1;
    // 指数退避：3s → 6s → 12s → 24s → 30s(上限)
    const delay = Math.min(reconnectInterval * Math.pow(2, retryCountRef.current - 1), maxReconnectInterval);
    reconnectTimerRef.current = setTimeout(() => {
      doConnect();
    }, delay);
  }, [reconnectInterval, maxReconnectInterval, clearReconnectTimer]);

  const doConnect = useCallback(() => {
    // 如果已有活跃连接，不重复连接
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
      setIsConnected(true);
      retryCountRef.current = 0; // 连接成功重置退避计数
      clearReconnectTimer();
      ws.send(JSON.stringify({ type: 'auth', username: usernameRef.current }));

      // 心跳
      clearHeartbeat();
      heartbeatTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);
    };

    // ★ 始终调用最新的 onMessage 回调
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as WSMessage;
        onMessageRef.current(msg);
      } catch {
        // 忽略非 JSON 消息
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      clearHeartbeat();
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close(); // 触发 onclose → 重连
    };

    wsRef.current = ws;
  }, [clearReconnectTimer, clearHeartbeat, scheduleReconnect]);

  const sendMessage = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // 仅在组件挂载和 username 真正变化时重连
  useEffect(() => {
    doConnect();
    return () => {
      clearReconnectTimer();
      clearHeartbeat();
      wsRef.current?.close();
    };
  }, [username]); // 只依赖 username，不依赖 onMessage！

  return { sendMessage, isConnected };
}
