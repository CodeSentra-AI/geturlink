import React, { useState, useEffect } from 'react';
import Auth from './components/Auth';
import Navbar from './components/Navbar';
import Dashboard from './components/Dashboard';
import Editor from './components/Editor';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5050';

function App() {
  const [token, setToken] = useState(localStorage.getItem('gul_token') || '');
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState(null); // { message: string, type: 'success' | 'info' }
  const [lastNotification, setLastNotification] = useState(null);

  const showNotification = (message, type = 'success') => {
    const newNotif = { message, type };
    setNotification(newNotif);
    setLastNotification(newNotif);
    setTimeout(() => {
      setNotification(null);
    }, 5000);
  };

  useEffect(() => {
    if (token) {
      validateSession();
    } else {
      setLoading(false);
    }

    // Capture and handle Stripe callback URL parameters
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe_connected') === 'true') {
      window.history.replaceState({}, document.title, window.location.pathname);
      showNotification('Success! Your Stripe payout account has been connected.', 'success');
      if (token) validateSession();
    } else if (params.get('premium_success') === 'true') {
      window.history.replaceState({}, document.title, window.location.pathname);
      showNotification('Subscription upgraded! You are now a Premium Creator.', 'success');
      if (token) validateSession();
    } else if (params.get('premium_cancel') === 'true') {
      window.history.replaceState({}, document.title, window.location.pathname);
      showNotification('Premium checkout subscription cancelled.', 'info');
    }
  }, [token]);

  const validateSession = async () => {
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setUser({
          username: data.username,
          email: data.email,
          isPremium: data.is_premium,
          stripeConnectId: data.stripe_connect_id
        });
      } else {
        handleLogout();
      }
    } catch (err) {
      console.error(err);
      handleLogout();
    } finally {
      setLoading(false);
    }
  };

  const handleAuthSuccess = (userData, jwtToken) => {
    localStorage.setItem('gul_token', jwtToken);
    setToken(jwtToken);
    setUser({
      username: userData.username,
      email: userData.email,
      isPremium: userData.isPremium,
      stripeConnectId: userData.stripeConnectId || null
    });
    setActiveTab('dashboard');
  };

  const handleLogout = () => {
    localStorage.removeItem('gul_token');
    setToken('');
    setUser(null);
  };

  const handleTogglePremium = async () => {
    if (!token) return;
    try {
      const response = await fetch(`${API_URL}/api/profile/toggle-premium`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setUser(prev => ({
          ...prev,
          isPremium: data.isPremium
        }));
      }
    } catch (err) {
      console.error('Failed to toggle premium tier:', err);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', width: '100vw', alignItems: 'center', justifyContent: 'center', background: '#090d16', color: 'var(--text-muted)' }}>
        Loading GetUrLink sandbox...
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Premium custom notification toast */}
      {/* Premium custom notification toast */}
      <div 
        style={{
          position: 'fixed',
          top: '2rem',
          left: '50%',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '1rem 1.5rem',
          borderLeft: `4px solid ${
            lastNotification
              ? lastNotification.type === 'success' 
                ? 'var(--accent-success)' 
                : (lastNotification.type === 'error' || lastNotification.type === 'danger')
                  ? 'var(--accent-danger)'
                  : 'var(--accent-primary)'
              : 'transparent'
          }`,
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          borderRight: '1px solid rgba(255, 255, 255, 0.08)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          background: '#0b0f19',
          boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
          borderRadius: '12px',
          opacity: notification ? 1 : 0,
          transform: notification ? 'translate(-50%, 0) scale(1)' : 'translate(-50%, -20px) scale(0.95)',
          pointerEvents: notification ? 'auto' : 'none',
          transition: 'opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1), transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.35s ease',
          whiteSpace: 'nowrap'
        }}
      >
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: 
            lastNotification
              ? lastNotification.type === 'success' 
                ? 'var(--accent-success)' 
                : (lastNotification.type === 'error' || lastNotification.type === 'danger')
                  ? 'var(--accent-danger)'
                  : 'var(--accent-primary)'
              : 'transparent',
          transition: 'background 0.4s ease'
        }}></div>
        <span style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
          {lastNotification?.message || ''}
        </span>
      </div>

      {token && user ? (
        <>
          <Navbar 
            activeTab={activeTab} 
            setActiveTab={setActiveTab} 
            user={user} 
            onLogout={handleLogout}
            onTogglePremium={handleTogglePremium}
          />
          <main style={{ flex: '1', padding: '0 2rem 2rem 2rem', maxWidth: '1280px', width: '100%', margin: '0 auto' }}>
            {activeTab === 'dashboard' ? (
              <Dashboard token={token} user={user} setUser={setUser} showNotification={showNotification} />
            ) : (
              <Editor token={token} username={user.username} user={user} />
            )}
          </main>
        </>
      ) : (
        <Auth onAuthSuccess={handleAuthSuccess} />
      )}
    </div>
  );
}

export default App;
