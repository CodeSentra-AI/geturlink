import React from 'react';
import { LogOut, LayoutDashboard, Edit3, ExternalLink, ShieldCheck, Zap } from 'lucide-react';

export default function Navbar({ activeTab, setActiveTab, user, onLogout, onTogglePremium }) {
  const publicProfileUrl = `http://localhost:5000/p/${user.username}`;

  return (
    <nav className="glass-panel" style={{ borderRadius: '0 0 20px 20px', padding: '1rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem', borderTop: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '1.25rem', color: '#white', boxShadow: '0 0 15px var(--accent-primary-glow)' }}>
            G
          </div>
          <span style={{ fontSize: '1.25rem', fontWeight: '800', letterSpacing: '-0.02em' }}>GetUrLink</span>
        </div>

        {/* Tab Selection */}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`btn-secondary ${activeTab === 'dashboard' ? 'active' : ''}`}
            style={{ 
              padding: '0.5rem 1rem', 
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              background: activeTab === 'dashboard' ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
              borderColor: activeTab === 'dashboard' ? 'var(--accent-primary)' : 'transparent',
            }}
          >
            <LayoutDashboard size={16} /> Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('editor')}
            className={`btn-secondary ${activeTab === 'editor' ? 'active' : ''}`}
            style={{ 
              padding: '0.5rem 1rem', 
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              background: activeTab === 'editor' ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
              borderColor: activeTab === 'editor' ? 'var(--accent-primary)' : 'transparent',
            }}
          >
            <Edit3 size={16} /> Bio Editor
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        {/* Toggle Premium Simulation */}
        <button 
          onClick={onTogglePremium}
          className="btn-secondary"
          style={{ 
            padding: '0.5rem 1rem', 
            fontSize: '0.85rem',
            borderColor: user.isPremium ? 'var(--accent-success)' : 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem'
          }}
        >
          {user.isPremium ? (
            <>
              <ShieldCheck size={16} color="#10b981" />
              <span style={{ color: '#10b981', fontWeight: '700' }}>Premium Tier (0% Fee)</span>
            </>
          ) : (
            <>
              <Zap size={16} color="#fdba74" />
              <span style={{ color: '#fdba74' }}>Go Premium ($9/mo)</span>
            </>
          )}
        </button>

        {/* View Profile */}
        <a 
          href={publicProfileUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          className="btn-primary"
          style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
        >
          My Bio Page <ExternalLink size={14} />
        </a>

        {/* User Info / Logout */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '1rem' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: '600' }}>@{user.username}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{user.email}</div>
          </div>
          <button 
            onClick={onLogout}
            className="btn-danger"
            style={{ padding: '0.4rem', borderRadius: '8px' }}
            title="Log Out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </nav>
  );
}
