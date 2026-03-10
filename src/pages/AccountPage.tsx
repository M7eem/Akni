import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { updateProfile, sendPasswordResetEmail, deleteUser } from 'firebase/auth';
import { doc, deleteDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { ArrowLeft, Loader2, User, CreditCard, Trash2, AlertTriangle, Check } from 'lucide-react';

type Tab = 'profile' | 'billing' | 'danger';

export default function AccountPage() {
  const { user, usage } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<Tab>('profile');
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

  const planName = usage?.limit === 9999 ? 'Unlimited' : (usage?.limit && usage.limit > 10 ? 'Pro' : 'Free');

  const navItems = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'billing', label: 'Plan & Billing', icon: CreditCard },
    { id: 'danger', label: 'Danger Zone', icon: Trash2 },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#07090f', color: '#eef6ff' }}>
      {/* Header with Back Button */}
      <header style={{ 
        padding: '1rem 2rem', 
        borderBottom: '1px solid #1a2235', 
        display: 'flex', 
        alignItems: 'center',
        gap: '1rem',
        background: '#0f1420'
      }}>
        <button 
          onClick={() => navigate('/')}
          style={{ 
            background: 'none', border: 'none', color: '#8899aa', cursor: 'pointer', 
            display: 'flex', alignItems: 'center', gap: '0.5rem' 
          }}
          className="hover:text-[#eef6ff] transition-colors"
        >
          <ArrowLeft size={20} />
          <span style={{ fontSize: '14px', fontWeight: 500 }}>Back</span>
        </button>
      </header>

      <div style={{ 
        maxWidth: '1000px', 
        margin: '0 auto', 
        display: 'flex', 
        flexDirection: 'row',
        padding: '2rem',
        gap: '3rem'
      }} className="flex-col md:flex-row">
        
        {/* Sidebar */}
        <aside style={{ width: '240px', flexShrink: 0 }} className="w-full md:w-[240px]">
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '1.5rem', color: '#eef6ff' }}>Settings</h1>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }} className="flex-row md:flex-col overflow-x-auto md:overflow-visible">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as Tab)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  borderRadius: '12px',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '14px',
                  fontWeight: 500,
                  transition: 'all 0.2s ease',
                  background: activeTab === item.id ? 'rgba(125, 211, 252, 0.08)' : 'transparent',
                  color: activeTab === item.id ? '#7dd3fc' : '#8899aa',
                  whiteSpace: 'nowrap'
                }}
                className="hover:bg-[rgba(125,211,252,0.04)]"
              >
                <item.icon size={18} />
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content Area */}
        <main style={{ flex: 1 }}>
          {activeTab === 'profile' && (
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '2rem' }}>Profile</h2>
              
              <div style={{ background: '#0f1420', border: '1px solid #1a2235', borderRadius: '16px', padding: '24px' }}>
                {/* Avatar Section */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '2.5rem' }}>
                  <div style={{ 
                    width: '72px', height: '72px', borderRadius: '50%', 
                    background: 'rgba(125,211,252,0.15)', border: '1px solid rgba(125,211,252,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#7dd3fc', fontWeight: 700, fontSize: '24px'
                  }}>
                    {getInitials()}
                  </div>
                  <div>
                    <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#eef6ff' }}>{user.displayName || 'User'}</h3>
                    <p style={{ fontSize: '14px', color: '#8899aa' }}>Your personal account profile</p>
                  </div>
                </div>

                {/* Rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                  {/* Display Name Row */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2rem' }} className="flex-col sm:flex-row sm:items-center">
                    <label style={{ fontSize: '14px', fontWeight: 500, color: '#8899aa', width: '140px' }}>Display name</label>
                    <div style={{ flex: 1, display: 'flex', gap: '0.75rem', width: '100%' }}>
                      <input 
                        type="text" 
                        value={displayName} 
                        onChange={(e) => setDisplayName(e.target.value)}
                        style={{ 
                          flex: 1, background: '#07090f', border: '1px solid #1a2235', borderRadius: '8px', 
                          padding: '10px 14px', color: '#eef6ff', fontSize: '14px', outline: 'none'
                        }}
                        className="focus:border-[#7dd3fc]/50 transition-colors"
                      />
                      <button 
                        onClick={handleSaveName}
                        disabled={isSavingName || displayName === user.displayName || !displayName.trim()}
                        style={{ 
                          background: nameSaved ? 'rgba(34,197,94,0.1)' : '#1a2235', 
                          color: nameSaved ? '#4ade80' : '#eef6ff',
                          border: 'none', borderRadius: '8px', padding: '0 1.5rem', fontSize: '14px', fontWeight: 500,
                          cursor: (isSavingName || displayName === user.displayName || !displayName.trim()) ? 'not-allowed' : 'pointer',
                          display: 'flex', alignItems: 'center', gap: '0.5rem'
                        }}
                        className="hover:bg-[#1f2937] transition-colors"
                      >
                        {isSavingName ? <Loader2 size={16} className="animate-spin" /> : (nameSaved ? <Check size={16} /> : 'Save')}
                      </button>
                    </div>
                  </div>

                  {/* Email Row */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2rem' }} className="flex-col sm:flex-row sm:items-center">
                    <label style={{ fontSize: '14px', fontWeight: 500, color: '#8899aa', width: '140px' }}>Email address</label>
                    <div style={{ flex: 1, color: '#eef6ff', fontSize: '14px', fontWeight: 500 }}>
                      {user.email}
                    </div>
                  </div>

                  <div style={{ height: '1px', background: '#1a2235' }}></div>

                  {/* Password Row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '2rem' }} className="flex-col sm:flex-row">
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, color: '#eef6ff', marginBottom: '4px' }}>Password</label>
                      <p style={{ fontSize: '13px', color: '#8899aa' }}>Update your password by receiving a reset link via email.</p>
                    </div>
                    <button 
                      onClick={handleResetPassword}
                      disabled={isSendingReset || resetSent}
                      style={{ 
                        background: 'none', border: 'none', color: '#7dd3fc', fontSize: '14px', fontWeight: 500,
                        cursor: (isSendingReset || resetSent) ? 'not-allowed' : 'pointer',
                        padding: 0
                      }}
                      className="hover:text-[#38bdf8] transition-colors"
                    >
                      {isSendingReset ? 'Sending...' : (resetSent ? 'Reset link sent' : 'Send reset link')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'billing' && (
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '2rem' }}>Plan & Billing</h2>
              
              <div style={{ background: '#0f1420', border: '1px solid #1a2235', borderRadius: '16px', padding: '24px' }}>
                {/* Current Plan */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
                  <div style={{ fontSize: '16px', fontWeight: 500 }}>You are on the <span style={{ color: '#7dd3fc' }}>{planName}</span> plan</div>
                  <span style={{ 
                    fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700,
                    padding: '4px 10px', borderRadius: '9999px', background: 'rgba(125,211,252,0.1)', color: '#7dd3fc'
                  }}>
                    {planName}
                  </span>
                </div>

                {/* Usage */}
                {usage && (
                  <div style={{ marginBottom: '2.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '0.75rem' }}>
                      <span style={{ color: '#8899aa' }}>Usage</span>
                      <span style={{ color: '#eef6ff', fontWeight: 500 }}>{usage.used} of {usage.limit === 9999 ? '∞' : usage.limit} decks used this month</span>
                    </div>
                    <div style={{ height: '8px', background: 'rgba(125,211,252,0.1)', borderRadius: '9999px', overflow: 'hidden', marginBottom: '0.75rem' }}>
                      <div style={{ 
                        height: '100%', background: '#7dd3fc', borderRadius: '9999px',
                        width: `${Math.min((usage.used / usage.limit) * 100, 100)}%`
                      }}></div>
                    </div>
                    <div style={{ fontSize: '13px', color: '#8899aa' }}>
                      Resets on {new Date(usage.resetsOn).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </div>
                  </div>
                )}

                <div style={{ height: '1px', background: '#1a2235', margin: '2rem 0' }}></div>

                {/* Upgrade Section */}
                <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '1.5rem' }}>Available Plans</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ 
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                    padding: '1rem', border: '1px solid #1a2235', borderRadius: '12px'
                  }}>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 600 }}>Pro</div>
                      <div style={{ fontSize: '13px', color: '#8899aa' }}>$9/month • 50 decks/mo</div>
                    </div>
                    <button 
                      onClick={() => navigate('/#pricing')}
                      style={{ 
                        background: '#1a2235', color: '#eef6ff', border: 'none', borderRadius: '8px', 
                        padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer'
                      }}
                      className="hover:bg-[#1f2937] transition-colors"
                    >
                      Upgrade
                    </button>
                  </div>

                  <div style={{ 
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                    padding: '1rem', border: '1px solid #1a2235', borderRadius: '12px'
                  }}>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 600 }}>Unlimited</div>
                      <div style={{ fontSize: '13px', color: '#8899aa' }}>$19/month • Unlimited decks</div>
                    </div>
                    <button 
                      onClick={() => navigate('/#pricing')}
                      style={{ 
                        background: '#1a2235', color: '#eef6ff', border: 'none', borderRadius: '8px', 
                        padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer'
                      }}
                      className="hover:bg-[#1f2937] transition-colors"
                    >
                      Upgrade
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'danger' && (
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '2rem' }}>Danger Zone</h2>
              
              <div style={{ background: '#0f1420', border: '1px solid #1a2235', borderRadius: '16px', padding: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '2rem' }} className="flex-col sm:flex-row">
                  <div style={{ flex: 1 }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#ef4444', marginBottom: '0.5rem' }}>Delete account</h3>
                    <p style={{ fontSize: '14px', color: '#8899aa', lineHeight: 1.5 }}>
                      Permanently delete your account and all associated data. This action cannot be undone.
                    </p>
                  </div>
                  <button 
                    onClick={() => setShowDeleteModal(true)}
                    style={{ 
                      background: 'none', border: 'none', color: '#ef4444', fontSize: '14px', fontWeight: 600, 
                      cursor: 'pointer', padding: 0, whiteSpace: 'nowrap'
                    }}
                    className="hover:underline"
                  >
                    I want to delete my account
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div style={{ 
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          background: 'rgba(7,9,15,0.85)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1.5rem'
        }}>
          <div style={{ 
            background: '#0f1420', border: '1px solid #1a2235', borderRadius: '24px', 
            padding: '32px', maxWidth: '400px', width: '100%', textAlign: 'center'
          }}>
            <div style={{ 
              width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444',
              margin: '0 auto 20px'
            }}>
              <AlertTriangle size={28} />
            </div>
            <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#eef6ff', marginBottom: '12px' }}>Are you absolutely sure?</h3>
            <p style={{ fontSize: '14px', color: '#8899aa', marginBottom: '32px', lineHeight: 1.6 }}>
              This action is permanent and will delete all your data. You will lose access to all generated decks.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button 
                onClick={handleDeleteAccount}
                disabled={isDeleting}
                style={{ 
                  width: '100%', background: '#ef4444', color: '#ffffff', border: 'none', borderRadius: '12px', 
                  padding: '14px', fontSize: '15px', fontWeight: 600, cursor: isDeleting ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                }}
                className="hover:bg-[#dc2626] transition-colors"
              >
                {isDeleting ? <Loader2 size={18} className="animate-spin" /> : 'Yes, Delete Account'}
              </button>
              <button 
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                style={{ 
                  width: '100%', background: 'none', color: '#8899aa', border: 'none', borderRadius: '12px', 
                  padding: '12px', fontSize: '14px', fontWeight: 500, cursor: isDeleting ? 'not-allowed' : 'pointer'
                }}
                className="hover:text-[#eef6ff] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


