import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { updateProfile, sendPasswordResetEmail, deleteUser } from 'firebase/auth';
import { doc, deleteDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { ArrowLeft, Loader2, User, CreditCard, Trash2, AlertTriangle, Check, Clock } from 'lucide-react';
import DeckHistory from '../components/DeckHistory';

type Tab = 'profile' | 'history' | 'billing' | 'danger';

export default function AccountPage() {
  const { user, usage } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  
  const initialTab = (searchParams.get('tab') as Tab) || 'profile';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);

  const [isSendingReset, setIsSendingReset] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/');
    }
  }, [user, navigate]);

  if (!user) return null;

  const getInitials = () => {
    if (user.displayName) {
      const parts = user.displayName.split(' ');
      if (parts.length > 1) {
        return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
      }
      return user.displayName.charAt(0).toUpperCase();
    }
    if (user.email) {
      return user.email.charAt(0).toUpperCase();
    }
    return '?';
  };

  const handleSaveName = async () => {
    if (!displayName.trim() || displayName === user.displayName) return;
    setIsSavingName(true);
    try {
      await updateProfile(user, { displayName });
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2000);
    } catch (error) {
      console.error('Error updating profile', error);
    } finally {
      setIsSavingName(false);
    }
  };

  const handleResetPassword = async () => {
    if (!user.email) return;
    setIsSendingReset(true);
    try {
      await sendPasswordResetEmail(auth, user.email);
      setResetSent(true);
      setTimeout(() => setResetSent(false), 3000);
    } catch (error) {
      console.error('Error sending reset email', error);
    } finally {
      setIsSendingReset(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      const uid = user.uid;
      await deleteUser(user);
      await deleteDoc(doc(db, 'users', uid));
      navigate('/');
    } catch (error) {
      console.error('Error deleting account', error);
      setIsDeleting(false);
      setShowDeleteModal(false);
      alert("Failed to delete account. You may need to sign out and sign back in to perform this action.");
    }
  };

  const planName = usage?.limit === 9999 ? 'Max' : (usage?.limit === 30 ? 'Pro' : 'Free');

  const isFree = planName === 'Free';

  const navItems = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'history', label: 'Deck History', icon: Clock, locked: isFree },
    { id: 'billing', label: 'Plan & Billing', icon: CreditCard },
    { id: 'danger', label: 'Danger Zone', icon: Trash2 },
  ];

  return (
    <div className="settings-layout" style={{ 
      display: 'grid', 
      gridTemplateColumns: '280px 1fr', 
      minHeight: '100vh', 
      background: 'var(--bg)', 
      color: 'var(--text)', 
      fontFamily: '"Bricolage Grotesque", sans-serif' 
    }}>
      {/* Sidebar Navigation */}
      <aside className="settings-sidebar" style={{ 
        background: 'var(--surface)', 
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        height: '100vh',
        zIndex: 50,
        flexShrink: 0
      }}>
        <div style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Back Button */}
          <button 
            onClick={() => navigate('/')}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              color: 'var(--muted2)', 
              background: 'none', 
              border: 'none', 
              padding: '0',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 600,
              marginBottom: '40px',
              textAlign: 'left',
              fontFamily: 'inherit'
            }}
            className="hover:text-[var(--text)] transition-colors"
          >
            <ArrowLeft size={18} />
            Back to home
          </button>

          <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text)', marginBottom: '32px', letterSpacing: '-0.5px' }}>Settings</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.locked) {
                      setActiveTab('billing');
                      setSearchParams({ tab: 'billing' });
                      return;
                    }
                    setActiveTab(item.id as Tab);
                    setSearchParams({ tab: item.id });
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: '14px',
                    fontWeight: 600,
                    transition: 'all 0.2s ease',
                    background: isActive ? 'rgba(125, 211, 252, 0.1)' : 'transparent',
                    color: isActive ? 'var(--accent)' : 'var(--muted2)',
                    width: '100%',
                    fontFamily: 'inherit',
                    opacity: item.locked ? 0.5 : 1
                  }}
                  className={!isActive ? "hover:bg-white/5 hover:text-[var(--text)]" : ""}
                >
                  <item.icon size={18} />
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.locked && <span style={{ fontSize: '10px', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', color: 'var(--muted2)' }}>PRO</span>}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 'auto', paddingTop: '24px', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ 
                width: '36px', height: '36px', borderRadius: '10px', 
                background: 'rgba(125,211,252,0.1)', border: '1px solid var(--border2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--accent)', fontWeight: 700, fontSize: '13px'
              }}>
                {getInitials()}
              </div>
              <div style={{ overflow: 'hidden' }}>
                <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: 0 }}>
                  {user.displayName || 'User'}
                </p>
                <p style={{ fontSize: '12px', color: 'var(--muted2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: 0 }}>
                  {user.email}
                </p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main style={{ overflowY: 'auto', background: 'var(--bg)', position: 'relative' }}>
        {/* Background Orbs */}
        <div className="orb orb1" style={{ opacity: 0.5 }}></div>
        
        <div className="settings-main" style={{ maxWidth: '900px', margin: '0 auto', padding: '80px 48px', position: 'relative', zIndex: 1 }}>
          {activeTab === 'profile' && (
            <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
              <h2 style={{ fontSize: '32px', fontWeight: 800, marginBottom: '40px', color: 'var(--text)', letterSpacing: '-1px' }}>Profile</h2>
              
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '24px', padding: '48px', boxShadow: '0 32px 80px rgba(0, 0, 0, 0.4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginBottom: '48px' }}>
                  <div style={{ 
                    width: '88px', height: '88px', borderRadius: '20px', 
                    background: 'rgba(125,211,252,0.1)', border: '1px solid var(--border2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--accent)', fontWeight: 800, fontSize: '32px'
                  }}>
                    {getInitials()}
                  </div>
                  <div>
                    <h3 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.5px' }}>{user.displayName || 'User'}</h3>
                    <p style={{ fontSize: '14px', color: 'var(--muted2)', margin: '6px 0 0 0' }}>Your personal account profile</p>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
                  <div className="settings-grid" style={{ display: 'grid', gridTemplateColumns: '200px 1fr', alignItems: 'center', gap: '24px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Display name</label>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <input 
                        type="text" 
                        value={displayName} 
                        onChange={(e) => setDisplayName(e.target.value)}
                        style={{ 
                          flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '12px', 
                          padding: '12px 16px', color: 'var(--text)', fontSize: '14px', outline: 'none',
                          fontFamily: 'inherit'
                        }}
                        className="focus:border-[var(--accent)]/50 transition-colors"
                      />
                      <button 
                        onClick={handleSaveName}
                        disabled={isSavingName || displayName === user.displayName || !displayName.trim()}
                        style={{ 
                          background: nameSaved ? 'rgba(34,197,94,0.1)' : 'var(--accent)', 
                          color: nameSaved ? '#4ade80' : '#07090f',
                          border: 'none', borderRadius: '10px', padding: '0 24px', fontSize: '14px', fontWeight: 800,
                          cursor: (isSavingName || displayName === user.displayName || !displayName.trim()) ? 'not-allowed' : 'pointer',
                          display: 'flex', alignItems: 'center', gap: '8px',
                          transition: 'all 0.2s ease',
                          fontFamily: 'inherit'
                        }}
                        className="hover:opacity-90 disabled:opacity-50"
                      >
                        {isSavingName ? <Loader2 size={16} className="animate-spin" /> : (nameSaved ? <Check size={16} /> : 'Save')}
                      </button>
                    </div>
                  </div>

                  <div className="settings-grid" style={{ display: 'grid', gridTemplateColumns: '200px 1fr', alignItems: 'center', gap: '24px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Email address</label>
                    <div style={{ color: 'var(--text)', fontSize: '15px', fontWeight: 600 }}>
                      {user.email}
                    </div>
                  </div>

                  <div style={{ height: '1px', background: 'var(--border)' }}></div>

                  <div className="settings-grid" style={{ display: 'grid', gridTemplateColumns: '200px 1fr', alignItems: 'flex-start', gap: '24px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Password</label>
                    <div>
                      <p style={{ fontSize: '14px', color: 'var(--muted2)', marginBottom: '16px', lineHeight: 1.6, margin: '0 0 16px 0' }}>
                        Update your password by receiving a reset link via email.
                      </p>
                      <button 
                        onClick={handleResetPassword}
                        disabled={isSendingReset || resetSent}
                        style={{ 
                          background: 'rgba(125, 211, 252, 0.1)', border: '1px solid var(--border2)', color: 'var(--accent)', fontSize: '13px', fontWeight: 700,
                          cursor: (isSendingReset || resetSent) ? 'not-allowed' : 'pointer',
                          padding: '10px 20px',
                          borderRadius: '100px',
                          transition: 'all 0.2s ease',
                          fontFamily: 'inherit'
                        }}
                        className="hover:bg-[var(--accent)] hover:text-[#07090f]"
                      >
                        {isSendingReset ? 'Sending...' : (resetSent ? 'Reset link sent' : 'Send reset link')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
              <h2 style={{ fontSize: '32px', fontWeight: 800, marginBottom: '40px', color: 'var(--text)', letterSpacing: '-1px' }}>Deck History</h2>
              <DeckHistory />
            </div>
          )}

          {activeTab === 'billing' && (
            <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
              <h2 style={{ fontSize: '32px', fontWeight: 800, marginBottom: '40px', color: 'var(--text)', letterSpacing: '-1px' }}>Plan & Billing</h2>
              
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '24px', padding: '48px', boxShadow: '0 32px 80px rgba(0, 0, 0, 0.4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '48px' }}>
                  <div>
                    <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', margin: '0 0 8px 0' }}>Current Plan</p>
                    <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.5px' }}>{planName}</div>
                  </div>
                  <span style={{ 
                    fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 800,
                    padding: '8px 20px', borderRadius: '9999px', background: 'rgba(125,211,252,0.1)', color: 'var(--accent)',
                    border: '1px solid var(--border2)'
                  }}>
                    {planName}
                  </span>
                </div>

                {usage && (
                  <div style={{ marginBottom: '48px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '14px' }}>
                      <span style={{ color: 'var(--muted2)', fontWeight: 600 }}>Usage</span>
                      <span style={{ color: 'var(--text)', fontWeight: 800 }}>{usage.used} / {usage.limit === 9999 ? '∞' : usage.limit} decks</span>
                    </div>
                    <div style={{ height: '12px', background: 'var(--surface2)', borderRadius: '9999px', overflow: 'hidden', marginBottom: '14px', border: '1px solid var(--border)' }}>
                      <div style={{ 
                        height: '100%', background: 'linear-gradient(90deg, var(--accent) 0%, var(--accent2) 100%)', borderRadius: '9999px',
                        width: `${Math.min((usage.used / usage.limit) * 100, 100)}%`,
                        transition: 'width 1s cubic-bezier(0.4, 0, 0.2, 1)'
                      }}></div>
                    </div>
                    <p style={{ fontSize: '13px', color: 'var(--muted2)', margin: 0, fontWeight: 500 }}>
                      Usage resets on {new Date(usage.resetsOn).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                )}

                <div style={{ height: '1px', background: 'var(--border)', margin: '48px 0' }}></div>

                <h3 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '24px', color: 'var(--text)', margin: '0 0 24px 0', letterSpacing: '-0.5px' }}>Available Plans</h3>
                <div style={{ display: 'grid', gap: '16px' }}>
                  {[
                    { name: 'Pro', price: '$5/mo', desc: '30 decks per month' },
                    { name: 'Max', price: '$13/mo', desc: 'Unlimited deck generation' }
                  ].map((plan) => (
                    <div key={plan.name} style={{ 
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                      padding: '24px', border: '1px solid var(--border)', borderRadius: '16px',
                      background: 'var(--surface2)',
                      transition: 'border-color 0.2s ease'
                    }} className="hover:border-[var(--accent)]/20">
                      <div>
                        <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text)' }}>{plan.name}</div>
                        <div style={{ fontSize: '13px', color: 'var(--muted2)', marginTop: '4px', fontWeight: 500 }}>{plan.price} • {plan.desc}</div>
                      </div>
                      <button 
                        onClick={() => navigate('/#pricing')}
                        style={{ 
                          background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '10px', 
                          padding: '10px 24px', fontSize: '14px', fontWeight: 700, cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          fontFamily: 'inherit'
                        }}
                        className="hover:bg-[var(--accent)] hover:text-[#07090f] hover:border-[var(--accent)]"
                      >
                        Upgrade
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'danger' && (
            <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
              <h2 style={{ fontSize: '32px', fontWeight: 800, marginBottom: '40px', color: 'var(--text)', letterSpacing: '-1px' }}>Danger Zone</h2>
              
              <div style={{ background: 'var(--surface)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '24px', padding: '48px', boxShadow: '0 32px 80px rgba(0, 0, 0, 0.4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '32px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '300px' }}>
                    <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#ef4444', marginBottom: '12px', margin: '0 0 12px 0', letterSpacing: '-0.5px' }}>Delete account</h3>
                    <p style={{ fontSize: '14px', color: 'var(--muted2)', lineHeight: 1.6, margin: 0, fontWeight: 500 }}>
                      Permanently delete your account and all associated data. This action is irreversible and you will lose access to all your generated content.
                    </p>
                  </div>
                  <button 
                    onClick={() => setShowDeleteModal(true)}
                    style={{ 
                      background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', 
                      color: '#ef4444', fontSize: '14px', fontWeight: 700, 
                      cursor: 'pointer', padding: '14px 28px', borderRadius: '12px',
                      transition: 'all 0.2s ease',
                      fontFamily: 'inherit'
                    }}
                    className="hover:bg-[#ef4444] hover:text-white"
                  >
                    Delete Account
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div style={{ 
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          background: 'rgba(7,9,15,0.92)', backdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '24px'
        }}>
          <div style={{ 
            background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '32px', 
            padding: '48px', maxWidth: '480px', width: '100%', textAlign: 'center',
            boxShadow: '0 40px 100px -20px rgba(0, 0, 0, 0.8)'
          }}>
            <div style={{ 
              width: '72px', height: '72px', borderRadius: '20px', background: 'rgba(239, 68, 68, 0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444',
              margin: '0 auto 28px'
            }}>
              <AlertTriangle size={36} />
            </div>
            <h3 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--text)', marginBottom: '16px', margin: '0 0 16px 0', letterSpacing: '-1px' }}>Are you absolutely sure?</h3>
            <p style={{ fontSize: '15px', color: 'var(--muted2)', marginBottom: '40px', lineHeight: 1.7, margin: '0 0 40px 0', fontWeight: 500 }}>
              This action is permanent and will delete all your data. You will lose access to all generated decks.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <button 
                onClick={handleDeleteAccount}
                disabled={isDeleting}
                style={{ 
                  width: '100%', background: '#ef4444', color: '#ffffff', border: 'none', borderRadius: '14px', 
                  padding: '18px', fontSize: '16px', fontWeight: 700, cursor: isDeleting ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                  transition: 'all 0.2s ease',
                  fontFamily: 'inherit'
                }}
                className="hover:opacity-90"
              >
                {isDeleting ? <Loader2 size={20} className="animate-spin" /> : 'Yes, Delete Account'}
              </button>
              <button 
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                style={{ 
                  width: '100%', background: 'transparent', color: 'var(--muted2)', border: 'none', borderRadius: '14px', 
                  padding: '14px', fontSize: '15px', fontWeight: 600, cursor: isDeleting ? 'not-allowed' : 'pointer',
                  transition: 'color 0.2s ease',
                  fontFamily: 'inherit'
                }}
                className="hover:text-[var(--text)]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 768px) {
          .settings-layout {
            grid-template-columns: 1fr !important;
          }
          .settings-sidebar {
            position: relative !important;
            height: auto !important;
            border-right: none !important;
            border-bottom: 1px solid var(--border) !important;
          }
          .settings-main {
            padding: 40px 20px !important;
          }
          .settings-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}


