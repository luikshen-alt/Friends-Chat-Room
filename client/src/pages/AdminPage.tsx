/**
 * 管理后台 — 独立的管理员登录 + 邀请码/用户/隧道管理
 * 企业实践：管理员入口与普通用户完全隔离，独立认证
 */
import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { setAccessToken } from '../api/client';

interface Code {
  id: number; code: string; created_at: string;
  used: number; expired: boolean; expiredText: string;
}
interface AdminUser {
  id: number; username: string; nickname: string; created_at: string;
}
interface NgrokStatus { success: boolean; running: boolean; url: string | null; }

export default function AdminPage() {
  useEffect(() => { document.title = '管理后台'; }, []);
  const [authenticated, setAuthenticated] = useState(false);
  const [adminPwd, setAdminPwd] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [codes, setCodes] = useState<Code[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [ngrok, setNgrok] = useState<NgrokStatus | null>(null);
  const [genLoading, setGenLoading] = useState(false);

  // ===== 管理员登录 =====
  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!adminPwd) { setLoginError('请输入管理员密码'); return; }
    setLoginLoading(true);
    setLoginError('');
    try {
      const data = await api.post<{ success: boolean; token: string; message: string }>(
        '/admin/login', { password: adminPwd }
      );
      if (data.success && data.token) {
        setAccessToken(data.token);
        setAuthenticated(true);
      } else {
        setLoginError(data.message || '密码错误');
      }
    } catch {
      setLoginError('登录失败，请检查服务器');
    }
    setLoginLoading(false);
  }

  // ===== 数据加载 =====
  useEffect(() => {
    if (!authenticated) return;
    loadAll();
  }, [authenticated]);

  async function loadAll() {
    const [codesRes, usersRes, ngrokRes] = await Promise.all([
      api.get<{ success: boolean; codes: Code[] }>('/admin/codes'),
      api.get<{ success: boolean; users: AdminUser[] }>('/admin/users'),
      api.get<NgrokStatus>('/admin/ngrok-status'),
    ]);
    if (codesRes.success) setCodes(codesRes.codes);
    if (usersRes.success) setUsers(usersRes.users);
    if (ngrokRes.success) setNgrok(ngrokRes);
  }

  async function generateCode() {
    setGenLoading(true);
    await api.post('/generate-code');
    await loadAll();
    setGenLoading(false);
  }

  async function deleteCode(id: number) { await api.post('/admin/delete-code', { id }); loadAll(); }
  async function deleteUser(username: string) {
    if (!confirm('确定删除用户 ' + username + ' 吗？此操作不可恢复。')) return;
    await api.post('/admin/delete-user', { username });
    loadAll();
  }

  async function toggleNgrok() {
    await api.post(ngrok?.running ? '/admin/ngrok-stop' : '/admin/ngrok-start');
    setTimeout(loadAll, 2000);
  }

  function handleLogout() {
    setAccessToken(null);
    setAuthenticated(false);
    setAdminPwd('');
  }

  // ===== 未登录 → 显示管理员登录表单 =====
  if (!authenticated) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h2 className="auth-title">🔐 管理后台</h2>
          <p style={{ textAlign: 'center', color: '#999', fontSize: '13px', marginBottom: '20px' }}>
            此入口仅限管理员使用
          </p>
          <form onSubmit={handleAdminLogin}>
            <div className="form-group">
              <label>管理员密码</label>
              <input
                type="password"
                value={adminPwd}
                onChange={e => setAdminPwd(e.target.value)}
                placeholder="请输入管理员密码"
                disabled={loginLoading}
                autoFocus
              />
            </div>
            {loginError && <div className="error-msg">{loginError}</div>}
            <button type="submit" className="btn btn-primary" disabled={loginLoading}>
              {loginLoading ? '验证中...' : '登 录'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ===== 已登录 → 显示管理面板 =====
  return (
    <div className="admin-dashboard">
      <header className="admin-dash-header">
        <h1>管理后台</h1>
        <div className="admin-header-actions">
          <button className="btn-small" onClick={loadAll}>刷新</button>
          <button className="btn-small danger" onClick={handleLogout}>退出</button>
        </div>
      </header>

      <div className="admin-grid">
        {/* 邀请码 */}
        <section className="admin-panel">
          <h2>📨 邀请码管理</h2>
          <p className="panel-desc">注册需要邀请码，每个码有效期 2 分钟</p>
          <button className="btn btn-primary" onClick={generateCode} disabled={genLoading}
            style={{ width: 'auto', padding: '10px 20px', marginBottom: '16px' }}>
            {genLoading ? '生成中...' : '＋ 生成邀请码'}
          </button>
          <div className="panel-list">
            {codes.length === 0 && <p className="empty-hint">暂无邀请码</p>}
            {codes.map(c => (
              <div key={c.id} className="panel-row">
                <code className="code-val">{c.code}</code>
                <span className={`tag ${c.expired ? 'tag-red' : c.used ? 'tag-gray' : 'tag-green'}`}>
                  {c.expiredText}
                </span>
                <span className="time-text">{new Date(c.created_at + 'Z').toLocaleTimeString('zh-CN')}</span>
                <button className="btn-tiny danger" onClick={() => deleteCode(c.id)}>×</button>
              </div>
            ))}
          </div>
        </section>

        {/* 用户管理 */}
        <section className="admin-panel">
          <h2>👥 用户管理 ({users.length})</h2>
          <div className="panel-list">
            {users.length === 0 && <p className="empty-hint">暂无用户</p>}
            {users.map(u => (
              <div key={u.id} className="panel-row">
                <span className="user-name">{u.nickname}</span>
                <span className="user-id">@{u.username}</span>
                <span className="time-text">{new Date(u.created_at + 'Z').toLocaleDateString('zh-CN')}</span>
                <button className="btn-tiny danger" onClick={() => deleteUser(u.username)}>删除</button>
              </div>
            ))}
          </div>
        </section>

        {/* ngrok 隧道 */}
        <section className="admin-panel">
          <h2>🌐 公网隧道</h2>
          <div className="ngrok-info">
            <span className={`status-dot ${ngrok?.running ? 'online' : 'offline'}`} />
            <span>{ngrok?.running ? '运行中' : '未启动'}</span>
            {ngrok?.url && <code className="ngrok-url">{ngrok.url}</code>}
          </div>
          <button
            className={`btn ${ngrok?.running ? 'btn-secondary' : 'btn-primary'}`}
            onClick={toggleNgrok}
            style={{ width: 'auto', padding: '8px 20px', marginTop: '12px' }}>
            {ngrok?.running ? '停止隧道' : '启动隧道'}
          </button>
        </section>
      </div>
    </div>
  );
}
