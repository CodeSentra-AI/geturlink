import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Eye, MousePointerClick, ShoppingBag, DollarSign, ArrowUpRight, TrendingUp, Zap, ShieldCheck, AlertTriangle } from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5050';

export default function Dashboard({ token, user, setUser, showNotification }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const handleStripeConnect = async () => {
    try {
      const response = await fetch(`${API_URL}/api/stripe/connect`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        const resData = await response.json();
        if (resData.url) {
          window.location.href = resData.url;
        }
      } else {
        const errData = await response.json();
        showNotification('Stripe Connect link generation failed: ' + (errData.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      console.error(err);
      showNotification('Stripe Connect error', 'error');
    }
  };

  const handleStripeDisconnectClick = () => {
    setShowConfirmModal(true);
  };

  const confirmDisconnect = async () => {
    try {
      const response = await fetch(`${API_URL}/api/stripe/disconnect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        setUser(prev => ({ ...prev, stripeConnectId: null }));
        showNotification('Stripe account disconnected successfully.', 'success');
      } else {
        showNotification('Failed to disconnect Stripe account.', 'error');
      }
    } catch (err) {
      console.error(err);
      showNotification('An error occurred while disconnecting.', 'error');
    } finally {
      setShowConfirmModal(false);
    }
  };

  const handleSubscribe = async () => {
    try {
      const response = await fetch(`${API_URL}/api/stripe/create-subscription`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        }
      });
      if (response.ok) {
        const resData = await response.json();
        if (resData.url) {
          window.location.href = resData.url;
        }
      } else {
        const errData = await response.json();
        showNotification('Billing upgrade failed: ' + (errData.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      console.error(err);
      showNotification('Billing redirect error', 'error');
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setShowConfirmModal(false);
      }
    };
    if (showConfirmModal) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showConfirmModal]);

  useEffect(() => {
    fetchAnalytics();
  }, [token]);

  const fetchAnalytics = async () => {
    try {
      const response = await fetch(`${API_URL}/api/analytics`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch analytics');
      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '4rem' }}>Loading analytics dashboard...</div>;
  if (error) return <div style={{ color: 'var(--accent-danger)', textAlign: 'center', marginTop: '4rem' }}>Error: {error}</div>;

  const totals = data?.totals || { views: 0, clicks: 0, sales: 0, revenue: 0 };
  const referralBreakdown = data?.referrals || [];
  const recentTransactions = data?.recentTransactions || [];

  // CTR (Click Through Rate) Calculation
  const ctr = totals.views > 0 ? ((totals.clicks / totals.views) * 100).toFixed(1) : 0;

  // Chart 1 Data: Views vs Clicks
  const days = Array.from(new Set([
    ...(data?.timeSeries?.views?.map(v => v.date_str) || []),
    ...(data?.timeSeries?.clicks?.map(c => c.date_str) || [])
  ])).sort();

  const viewsMap = Object.fromEntries(data?.timeSeries?.views?.map(v => [v.date_str, v.count]) || []);
  const clicksMap = Object.fromEntries(data?.timeSeries?.clicks?.map(c => [c.date_str, c.count]) || []);

  const trafficChartData = {
    labels: days.map(d => {
      const parts = d.split('-');
      return `${parts[1]}/${parts[2]}`; // MM/DD
    }),
    datasets: [
      {
        label: 'Page Views',
        data: days.map(d => viewsMap[d] || 0),
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
      },
      {
        label: 'Link Clicks',
        data: days.map(d => clicksMap[d] || 0),
        borderColor: '#d946ef',
        backgroundColor: 'rgba(217, 70, 239, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
      }
    ]
  };

  // Chart 2 Data: Revenue over time
  const saleDays = data?.timeSeries?.sales?.map(s => s.date_str) || [];
  const earningsMap = Object.fromEntries(data?.timeSeries?.sales?.map(s => [s.date_str, s.earnings]) || []);

  const revenueChartData = {
    labels: saleDays.map(d => {
      const parts = d.split('-');
      return `${parts[1]}/${parts[2]}`;
    }),
    datasets: [
      {
        label: 'Earnings ($)',
        data: saleDays.map(d => earningsMap[d] || 0),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        fill: true,
        tension: 0.2,
        pointRadius: 5,
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: '#94a3b8', font: { family: 'Outfit' } }
      },
      tooltip: {
        titleFont: { family: 'Outfit' },
        bodyFont: { family: 'Outfit' }
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.03)' },
        ticks: { color: '#94a3b8', font: { family: 'Outfit' } }
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.03)' },
        ticks: { color: '#94a3b8', font: { family: 'Outfit' } }
      }
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Welcome Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: '800', letterSpacing: '-0.025em' }}>Analytics Overview</h1>
          <p style={{ color: 'var(--text-muted)' }}>Real-time updates on your link traffic and storefront sales.</p>
        </div>
        <button 
          onClick={fetchAnalytics}
          className="btn-secondary"
          style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}
        >
          Refresh Data
        </button>
      </div>

      {/* Metric Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem' }}>
        
        {/* Page Views Card */}
        <div className="glass-panel glass-panel-hover" style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(99, 102, 241, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)' }}>
            <Eye size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>Page Views</div>
            <div style={{ fontSize: '1.75rem', fontWeight: '800', marginTop: '0.1rem' }}>{totals.views}</div>
          </div>
        </div>

        {/* Link Clicks Card */}
        <div className="glass-panel glass-panel-hover" style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(217, 70, 239, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d946ef' }}>
            <MousePointerClick size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>Link Clicks</div>
            <div style={{ fontSize: '1.75rem', fontWeight: '800', marginTop: '0.1rem' }}>{totals.clicks} <span style={{ fontSize: '0.85rem', fontWeight: '500', color: '#d946ef' }}>({ctr}%)</span></div>
          </div>
        </div>

        {/* Sales Card */}
        <div className="glass-panel glass-panel-hover" style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-success)' }}>
            <ShoppingBag size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>Sales</div>
            <div style={{ fontSize: '1.75rem', fontWeight: '800', marginTop: '0.1rem' }}>{totals.sales}</div>
          </div>
        </div>

        {/* Earnings Card */}
        <div className="glass-panel glass-panel-hover" style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-success)' }}>
            <DollarSign size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>Earnings</div>
            <div style={{ fontSize: '1.75rem', fontWeight: '800', marginTop: '0.1rem' }}>${totals.revenue.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* Creator SaaS Portal (Stripe Connect & Billing) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '2rem' }}>
        
        {/* Stripe Connect Card */}
        <div className="glass-panel" style={{ borderLeft: '4px solid var(--accent-success)', display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <DollarSign size={20} color="var(--accent-success)" />
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>Seller Payouts (Stripe Connect)</h3>
            </div>
            
            {user?.stripeConnectId ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', background: 'rgba(16, 185, 129, 0.15)', color: 'var(--accent-success)', padding: '0.25rem 0.5rem', borderRadius: '6px', fontWeight: '700', alignSelf: 'flex-start' }}>
                  Connected Account
                </span>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                  Your Stripe Connect ID is <strong style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{user.stripeConnectId}</strong>.
                  All sales of your digital products are split instantly. Platform fee: <strong style={{ color: 'var(--text-primary)' }}>{user.isPremium ? '0%' : '5%'}</strong>.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', background: 'rgba(239, 68, 68, 0.15)', color: 'var(--accent-danger)', padding: '0.25rem 0.5rem', borderRadius: '6px', fontWeight: '700', alignSelf: 'flex-start' }}>
                  Payouts Disconnected
                </span>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                  Link your Stripe account to receive customer payments for wallpapers, presets, and PDFs. Payouts are routed directly to your bank account.
                </p>
              </div>
            )}
          </div>

          <div>
            {user?.stripeConnectId ? (
              <button onClick={handleStripeDisconnectClick} className="btn-danger" style={{ width: '100%', justifyContent: 'center' }}>
                Disconnect Stripe Account
              </button>
            ) : (
              <button onClick={handleStripeConnect} className="btn-primary" style={{ width: '100%', justifyContent: 'center', background: 'linear-gradient(135deg, #635bff, #00d4ff)', border: 'none' }}>
                Connect Stripe Payouts
              </button>
            )}
          </div>
        </div>

        {/* Stripe Billing Card */}
        <div className="glass-panel" style={{ borderLeft: '4px solid var(--accent-primary)', display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <Zap size={20} color="var(--accent-primary)" />
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>Premium Billing Portal</h3>
            </div>

            {user?.isPremium ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', background: 'rgba(99, 102, 241, 0.15)', color: 'var(--accent-primary)', padding: '0.25rem 0.5rem', borderRadius: '6px', fontWeight: '700', alignSelf: 'flex-start' }}>
                  Premium Active
                </span>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                  You have access to unlimited custom CSS styling, custom domain mapping (yourname.com), and enjoy a <strong style={{ color: 'var(--text-primary)' }}>0% platform commission fee</strong> on product sales.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-muted)', padding: '0.25rem 0.5rem', borderRadius: '6px', fontWeight: '700', alignSelf: 'flex-start' }}>
                  Free Tier (5% Sales Cut)
                </span>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                  Upgrade to premium to unlock custom domains, advanced custom themes, CSS overrides, and reduce platform sales commission from 5% to <strong style={{ color: 'var(--accent-success)' }}>0%</strong>.
                </p>
              </div>
            )}
          </div>

          <div>
            {!user?.isPremium && (
              <button onClick={handleSubscribe} className="btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                Upgrade to Premium ($9/mo)
              </button>
            )}
            {user?.isPremium && (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', padding: '0.5rem' }}>
                ✓ Premium perks active (0% platform cut)
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Analytics Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '2rem' }}>
        
        {/* Traffic Chart */}
        <div className="glass-panel" style={{ height: '340px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <TrendingUp size={18} color="var(--accent-primary)" />
            <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>Traffic & CTR Breakdown</h3>
          </div>
          <div style={{ flex: '1', minHeight: '0' }}>
            {days.length > 0 ? (
              <Line data={trafficChartData} options={chartOptions} />
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>No traffic history recorded yet.</div>
            )}
          </div>
        </div>

        {/* Revenue Chart */}
        <div className="glass-panel" style={{ height: '340px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <TrendingUp size={18} color="var(--accent-success)" />
            <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>Sales Volume ($ USD)</h3>
          </div>
          <div style={{ flex: '1', minHeight: '0' }}>
            {saleDays.length > 0 ? (
              <Bar data={revenueChartData} options={chartOptions} />
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>No product sales recorded yet.</div>
            )}
          </div>
        </div>
      </div>

      {/* Referrals & Transactions Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '2rem' }}>
        
        {/* Referral Channels Table */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>Referrer Sources</h3>
          <div className="table-container">
            {referralBreakdown.length > 0 ? (
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Hits</th>
                  </tr>
                </thead>
                <tbody>
                  {referralBreakdown.map((r, i) => (
                    <tr key={i}>
                      <td style={{ textTransform: 'capitalize', fontWeight: '600' }}>{r.referrer}</td>
                      <td>{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem 0' }}>No referral traffic yet.</div>
            )}
          </div>
        </div>

        {/* Recent Transactions Table */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>Recent Checkout Sales</h3>
          <div className="table-container">
            {recentTransactions.length > 0 ? (
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Product</th>
                    <th>Price</th>
                    <th>Date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTransactions.map((tx) => (
                    <tr key={tx.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{tx.customer_email}</td>
                      <td style={{ fontWeight: '600' }}>{tx.product_title}</td>
                      <td style={{ color: 'var(--accent-success)', fontWeight: '700' }}>${tx.amount.toFixed(2)}</td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {new Date(tx.timestamp).toLocaleDateString()}
                      </td>
                      <td>
                        <span style={{ 
                          background: 'rgba(16, 185, 129, 0.15)', 
                          color: 'var(--accent-success)', 
                          padding: '0.2rem 0.5rem', 
                          borderRadius: '6px', 
                          fontSize: '0.75rem',
                          fontWeight: '700'
                        }}>
                          {tx.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem 0' }}>No purchases logged.</div>
            )}
          </div>
        </div>
      </div>

      {/* Custom Confirmation Modal */}
      {createPortal(
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowConfirmModal(false);
          }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(5, 8, 15, 0.85)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
            opacity: showConfirmModal ? 1 : 0,
            pointerEvents: showConfirmModal ? 'auto' : 'none',
            transition: 'opacity 0.3s ease-out'
          }}
        >
          <div 
            className="glass-panel"
            style={{
              maxWidth: '480px',
              width: '100%',
              background: '#0f172a',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '24px',
              padding: '2rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.5rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
              transform: showConfirmModal ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(15px)',
              transition: 'transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div 
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--accent-danger)'
                }}
              >
                <AlertTriangle size={24} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                  Disconnect Stripe Account
                </h3>
              </div>
            </div>

            <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>
              Are you sure you want to disconnect your Stripe account? You won't be able to receive direct payouts for digital products until you reconnect.
            </p>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
              <button 
                onClick={() => setShowConfirmModal(false)} 
                className="btn-secondary" 
                style={{ flex: 1, padding: '0.85rem 1rem', borderRadius: '12px' }}
              >
                Cancel
              </button>
              <button 
                onClick={confirmDisconnect} 
                className="btn-primary" 
                style={{ 
                  flex: 1, 
                  background: 'var(--accent-danger)', 
                  padding: '0.85rem 1rem', 
                  borderRadius: '12px',
                  color: 'white',
                  border: 'none',
                  fontWeight: '600'
                }}
              >
                Yes, Disconnect
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
