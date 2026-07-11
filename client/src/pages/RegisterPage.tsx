/**
 * 注册页面 — 带字段级错误提示
 * 企业实践：后端校验结果精确映射到对应输入框，帮助用户快速修正
 */
import { useState, useEffect, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/AuthContext';

// 字段错误类型
interface FieldError {
  field: string;
  message: string;
}

export default function RegisterPage() {
  useEffect(() => { document.title = '注册 - 朋友聊天室'; }, []);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  // 获取指定字段的错误信息
  function fieldError(field: string): string {
    return errors.find(e => e.field === field)?.message || '';
  }

  // 获取字段的 CSS class
  function fieldClass(field: string): string {
    return fieldError(field) ? 'form-group has-error' : 'form-group';
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors([]);

    // 前端初步校验
    if (!username.trim() || !password || !nickname.trim() || !invitationCode.trim()) {
      setErrors([{ field: '_general', message: '请填写所有字段' }]);
      return;
    }

    setLoading(true);
    const result = await register({
      username: username.trim(),
      password,
      nickname: nickname.trim(),
      invitationCode: invitationCode.trim(),
    });
    setLoading(false);

    if (result.success) {
      alert('注册成功，请登录');
      navigate('/login', { replace: true });
    } else if (result.errors && result.errors.length > 0) {
      // 显示字段级错误
      setErrors(result.errors);
    } else {
      // 通用错误（如"验证码无效或已过期"）
      setErrors([{ field: '_general', message: result.message || '注册失败' }]);
    }
  }

  const generalError = fieldError('_general');

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2 className="auth-title">注册账号</h2>
        <form onSubmit={handleSubmit}>
          <div className={fieldClass('username')}>
            <label>账号</label>
            <input
              type="text"
              value={username}
              onChange={e => { setUsername(e.target.value); setErrors([]); }}
              placeholder="2-20个字符，字母/数字/下划线"
              disabled={loading}
            />
            {fieldError('username') && <span className="field-error">{fieldError('username')}</span>}
          </div>

          <div className={fieldClass('nickname')}>
            <label>昵称</label>
            <input
              type="text"
              value={nickname}
              onChange={e => { setNickname(e.target.value); setErrors([]); }}
              placeholder="1-20个字符"
              disabled={loading}
            />
            {fieldError('nickname') && <span className="field-error">{fieldError('nickname')}</span>}
          </div>

          <div className={fieldClass('password')}>
            <label>密码</label>
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setErrors([]); }}
              placeholder="6-100个字符"
              disabled={loading}
            />
            {fieldError('password') && <span className="field-error">{fieldError('password')}</span>}
          </div>

          <div className={fieldClass('invitationCode')}>
            <label>邀请码</label>
            <input
              type="text"
              value={invitationCode}
              onChange={e => { setInvitationCode(e.target.value); setErrors([]); }}
              placeholder="6位数字邀请码（找管理员获取）"
              maxLength={6}
              disabled={loading}
            />
            {fieldError('invitationCode') && <span className="field-error">{fieldError('invitationCode')}</span>}
          </div>

          {generalError && <div className="error-msg">{generalError}</div>}
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? '注册中...' : '注 册'}
          </button>
        </form>
        <Link to="/login" className="auth-link">已有账号？去登录</Link>
      </div>
    </div>
  );
}
