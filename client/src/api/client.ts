/**
 * API 客户端 — 统一管理所有 HTTP 请求
 * 企业实践：
 *   1. 封装 fetch，自动附加 Authorization 头
 *   2. Token 过期自动刷新（无感刷新）
 *   3. 统一错误处理
 *   4. 所有请求走 credentials: 'same-origin'（携带 Refresh Token Cookie）
 * 面试话术：
 *   "我封装了一个 API client，所有请求自动带 Token、过期自动刷新，
 *    业务代码不需要关心认证细节。这是前端工程化的基本素养。"
 */

const API_BASE = '/api';

// Access Token 存在内存（不是 localStorage！）
let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * 静默刷新 Access Token（使用 HttpOnly Cookie 中的 Refresh Token）
 * 防并发：多个请求同时触发刷新时，共享同一个 Promise
 */
async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (data.success && data.accessToken) {
        accessToken = data.accessToken;
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * 核心请求函数 — 自动处理 Token + 过期刷新
 */
export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  // 非 GET 请求默认 JSON
  if (!headers['Content-Type'] && options.method && options.method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }

  let res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
    credentials: 'same-origin',
  });

  // Token 过期 → 静默刷新后重试
  if (res.status === 401) {
    const data = await res.json().catch(() => ({}));
    if (data.code === 'TOKEN_EXPIRED') {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${accessToken}`;
        res = await fetch(`${API_BASE}${url}`, {
          ...options,
          headers,
          credentials: 'same-origin',
        });
      }
    }
  }

  return res.json();
}

// ===== 便捷方法 =====
export const api = {
  get: <T = unknown>(url: string) => apiFetch<T>(url),

  post: <T = unknown>(url: string, body?: unknown) =>
    apiFetch<T>(url, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),

  upload: <T = unknown>(url: string, formData: FormData) =>
    apiFetch<T>(url, {
      method: 'POST',
      headers: {}, // 让浏览器自动设置 Content-Type: multipart/form-data
      body: formData,
    }),
};
