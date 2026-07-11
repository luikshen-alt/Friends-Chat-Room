/**
 * 登录页面
 * 企业实践：表单状态管理、错误提示、Enter 键提交、加载态
 */
import { useState, useEffect, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/AuthContext';

export default function LoginPage() {
  useEffect(() => { document.title = '登录 - 朋友聊天室'; }, []);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('请填写账号和密码');
      return;
    }
    setLoading(true);
    setError('');
    const result = await login(username.trim(), password);
    setLoading(false);
    if (result.success) {
      navigate('/chat', { replace: true });
    } else {
      setError(result.message || '登录失败');
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2 className="auth-title">朋友聊天室</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>账号</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="请输入账号"
              autoComplete="username"
              disabled={loading}
            />
          </div>
          <div className="form-group">
            <label>密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="请输入密码"
              autoComplete="current-password"
              disabled={loading}
            />
          </div>
          {error && <div className="error-msg">{error}</div>}
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? '登录中...' : '登 录'}
          </button>
        </form>
        <Link to="/register" className="auth-link">还没有账号？去注册</Link>
      </div>
    </div>
  );
}
