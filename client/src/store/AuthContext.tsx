/**
 * 认证上下文 — 全局管理用户登录状态
 * 企业实践：
 *   1. React Context + useReducer 管理全局认证状态
 *   2. 页面刷新时从 Refresh Token Cookie 恢复 Access Token
 *   3. 提前 1 分钟自动刷新 Token（Access Token 有效期 15 分钟）
 * 面试话术：
 *   "AuthContext 是全局唯一的认证状态源，任何组件都能通过 useAuth 获取用户信息和 Token。
 *    页面刷新时自动从 HttpOnly Cookie 恢复登录态，用户无感知。"
 */

import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { api, setAccessToken } from '../api/client';
import type { User, LoginResponse } from '../types';

// ===== State =====
interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean; // 初始化中（页面刷新后验证 Token）
}

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: true,
};

// ===== Actions =====
type AuthAction =
  | { type: 'LOGIN'; payload: User }
  | { type: 'LOGOUT' }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'UPDATE_USER'; payload: Partial<User> };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'LOGIN':
      return { user: action.payload, isAuthenticated: true, isLoading: false };
    case 'LOGOUT':
      return { user: null, isAuthenticated: false, isLoading: false };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'UPDATE_USER':
      return state.user
        ? { ...state, user: { ...state.user, ...action.payload } }
        : state;
    default:
      return state;
  }
}

// ===== Context =====
interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<{ success: boolean; message?: string }>;
  register: (data: { username: string; password: string; nickname: string; invitationCode: string }) => Promise<{ success: boolean; message?: string; errors?: { field: string; message: string }[] }>;
  logout: () => Promise<void>;
  updateUser: (data: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // 页面初始化：尝试从 Refresh Token Cookie 恢复登录态
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.post<{ success: boolean; accessToken: string }>('/refresh');
        if (!cancelled && data.success && data.accessToken) {
          setAccessToken(data.accessToken);
          // 从 localStorage 恢复用户展示信息（不是 Token！）
          const stored = localStorage.getItem('chatUser');
          if (stored) {
            dispatch({ type: 'LOGIN', payload: JSON.parse(stored) });
          }
        } else {
          dispatch({ type: 'SET_LOADING', payload: false });
        }
      } catch {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 每 14 分钟自动刷新 Token（提前 1 分钟，Token 有效期 15 分钟）
  useEffect(() => {
    if (!state.isAuthenticated) return;
    const timer = setInterval(async () => {
      try {
        const data = await api.post<{ success: boolean; accessToken: string }>('/refresh');
        if (data.success && data.accessToken) {
          setAccessToken(data.accessToken);
        }
      } catch { /* 静默失败 */ }
    }, 14 * 60 * 1000);
    return () => clearInterval(timer);
  }, [state.isAuthenticated]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await api.post<LoginResponse>('/login', { username, password });
    if (data.success) {
      setAccessToken(data.accessToken);
      localStorage.setItem('chatUser', JSON.stringify(data.user));
      dispatch({ type: 'LOGIN', payload: data.user });
      return { success: true };
    }
    return { success: false, message: data.message };
  }, []);

  const register = useCallback(async (formData: {
    username: string; password: string; nickname: string; invitationCode: string;
  }) => {
    const data = await api.post<{ success: boolean; message: string; errors?: { field: string; message: string }[] }>('/register', formData);
    return { success: data.success, message: data.message, errors: data.errors };
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/logout'); } catch { /* ignore */ }
    setAccessToken(null);
    localStorage.removeItem('chatUser');
    dispatch({ type: 'LOGOUT' });
  }, []);

  const updateUser = useCallback((data: Partial<User>) => {
    dispatch({ type: 'UPDATE_USER', payload: data });
    const stored = localStorage.getItem('chatUser');
    if (stored) {
      const user = { ...JSON.parse(stored), ...data };
      localStorage.setItem('chatUser', JSON.stringify(user));
    }
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * useAuth Hook — 在任何组件中获取认证状态
 */
export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
