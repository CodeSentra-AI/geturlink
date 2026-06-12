import React, { useState } from 'react';
import { Eye, EyeOff, Lock, Mail, User, ShieldCheck } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5050';

export default function Auth({ onAuthSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const payload = isLogin 
      ? { loginIdentifier: username || email, password }
      : { username, email, password };

    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Something went wrong');
      }

      onAuthSuccess(data.user, data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Pre-fill default test credentials for quick sandbox evaluation
  const fillTestCredentials = () => {
    setUsername('alice');
    setPassword('password123');
  };

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 40px)', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
      <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '440px', display: 'flex', flexDirection: 'column', gap: '1.5rem', boxShadow: '0 25px 50px -12px rgba(99, 102, 241, 0.25)' }}>
        
        {/* Header */}
        <div style={{ textSelf: 'center', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', width: '48px', height: '48px', borderRadius: '12px', background: 'var(--accent-primary)', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '1.75rem', color: '#white', marginBottom: '0.75rem', boxShadow: '0 0 20px var(--accent-primary-glow)' }}>
            G
          </div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: '800', letterSpacing: '-0.025em' }}>
            {isLogin ? 'Welcome Back' : 'Create Creator Account'}
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            {isLogin ? 'Access your links and storefront dashboard.' : 'Start selling digital products in minutes.'}
          </p>
        </div>

        {error && (
          <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: 'var(--accent-danger)', padding: '0.75rem 1rem', borderRadius: '10px', fontSize: '0.875rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {!isLogin && (
            <div>
              <label className="label-text">Username</label>
              <div style={{ position: 'relative' }}>
                <input 
                  type="text" 
                  className="input-field" 
                  style={{ paddingLeft: '2.5rem' }} 
                  placeholder="e.g. creativealice"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
                <User size={16} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              </div>
            </div>
          )}

          <div>
            <label className="label-text">{isLogin ? 'Username or Email' : 'Email Address'}</label>
            <div style={{ position: 'relative' }}>
              <input 
                type="text" 
                className="input-field" 
                style={{ paddingLeft: '2.5rem' }} 
                placeholder={isLogin ? "alice or alice@creative.co" : "yourname@creative.co"}
                value={isLogin ? username : email}
                onChange={(e) => isLogin ? setUsername(e.target.value) : setEmail(e.target.value)}
                required
              />
              <Mail size={16} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            </div>
          </div>

          <div>
            <label className="label-text">Password</label>
            <div style={{ position: 'relative' }}>
              <input 
                type={showPassword ? 'text' : 'password'} 
                className="input-field" 
                style={{ paddingLeft: '2.5rem', paddingRight: '2.5rem' }} 
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Lock size={16} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <button 
                type="button" 
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button 
            type="submit" 
            className="btn-primary" 
            style={{ width: '100%', marginTop: '0.5rem', height: '46px' }}
            disabled={loading}
          >
            {loading ? 'Authenticating...' : isLogin ? 'Log In' : 'Get Started'}
          </button>
        </form>

        {isLogin && import.meta.env.DEV && (
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '0.75rem', textAlign: 'center' }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Want to skip registration and test immediately?
            </p>
            <button 
              onClick={fillTestCredentials}
              className="btn-secondary"
              style={{ width: '100%', padding: '0.4rem', marginTop: '0.4rem', fontSize: '0.8rem', borderColor: 'var(--accent-primary)' }}
            >
              Autofill SeedTest User (alice)
            </button>
          </div>
        )}

        <div style={{ textAlign: 'center', fontSize: '0.9rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>
            {isLogin ? "Don't have an account? " : "Already have an account? "}
          </span>
          <button 
            onClick={() => { setIsLogin(!isLogin); setError(''); }}
            style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {isLogin ? 'Sign Up' : 'Log In'}
          </button>
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          <ShieldCheck size={14} color="#10b981" /> Sandbox Environment Encrypted & Online
        </div>
      </div>
    </div>
  );
}
