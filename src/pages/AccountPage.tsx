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

  const planName = usage?.limit === 9999 ? 'Unlimited' : (usage?.limit && usage.limit > 10 ? 'Pro' : 'Free');

  const navItems = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'history', label: 'Deck History', icon: Clock },
    { id: 'billing', label: 'Plan & Billing', icon: CreditCard },
    { id: 'danger', label: 'Danger Zone', icon: Trash2 },
  ];

  return (
    <div style={{ 
      display: 'grid', 
      gridTemplateColumns: '260px 1fr', 
      minHeight: '100vh', 
      background: '#07090f', 
      color: '#eef6ff', 
      fontFamily: 'Inter, sans-serif' 
    }}>
      {/* Sidebar Navigation */}
      <aside style={{ 
        background: '#0f1420', 
        borderRight: '1px solid #1a2235',
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        height: '100vh',
        zIndex: 50,
        flexShrink: 0
      }}>
        <div style={{ padding: '32px 24px', display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Back Button */}
          <button 
            onClick={() => navigate('/')}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              color: '#8899aa', 
              background: 'none', 
              border: 'none', 
              padding: '0',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
              marginBottom: '32px',
              textAlign: 'left'
            }}
            className="hover:text-[#eef6ff] transition-colors"
          >
            <ArrowLeft size={18} />
            Back to home
          </button>

          <div style={{ fontSize: '24px', fontWeight: 700, color: '#eef6ff', marginBottom: '24px' }}>Settings</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id as Tab);
                    setSearchParams({ tab: item.id });
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: '14px',
                    fontWeight: 500,
                    transition: 'all 0.2s ease',
                    background: isActive ? 'rgba(125, 211, 252, 0.1)' : 'transparent',
                    color: isActive ? '#7dd3fc' : '#8899aa',
                    width: '100%'
                  }}
                  className={!isActive ? "hover:bg-white/5 hover:text-[#eef6ff]" : ""}
                >
                  <item.icon size={18} />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 'auto', paddingTop: '24px', borderTop: '1px solid #1a2235' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ 
                width: '32px', height: '32px', borderRadius: '50%', 
                background: 'rgba(125,211,252,0.1)', border: '1px solid rgba(125,211,252,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#7dd3fc', fontWeight: 600, fontSize: '12px'
              }}>
                {getInitials()}
              </div>
              <div style={{ overflow: 'hidden' }}>
                <p style={{ fontSize: '13px', fontWeight: 600, color: '#eef6ff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: 0 }}>
                  {user.displayName || 'User'}
                </p>
                <p style={{ fontSize: '11px', color: '#8899aa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: 0 }}>
                  {user.email}
                </p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main style={{ overflowY: 'auto', background: '#07090f' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '64px 40px' }}>
          {activeTab === 'profile' && (
            <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
              <h2 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '32px', color: '#eef6ff' }}>Profile</h2>
              
              <div style={{ background: '#0f1420', border: '1px solid #1a2235', borderRadius: '16px', padding: '40px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginBottom: '40px' }}>
                  <div style={{ 
                    width: '80px', height: '80px', borderRadius: '50%', 
                    background: 'rgba(125,211,252,0.1)', border: '1px solid rgba(125,211,252,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#7dd3fc', fontWeight: 700, fontSize: '28px'
                  }}>
                    {getInitials()}
                  </div>
                  <div>
                    <h3 style={{ fontSize: '20px', fontWeight: 600, color: '#eef6ff', margin: 0 }}>{user.displayName || 'User'}</h3>
                    <p style={{ fontSize: '14px', color: '#8899aa', margin: '4px 0 0 0' }}>Your personal account profile</p>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', alignItems: 'center', gap: '24px' }}>
                    <label style={{ fontSize: '14px', fontWeight: 500, color: '#8899aa' }}>Display name</label>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <input 
                        type="text" 
                        value={displayName} 
                        onChange={(e) => setDisplayName(e.target.value)}
                        style={{ 
                          flex: 1, background: '#07090f', border: '1px solid #1a2235', borderRadius: '8px', 
                          padding: '12px 16px', color: '#eef6ff', fontSize: '14px', outline: 'none'
                        }}
                        className="focus:border-[#7dd3fc]/50 transition-colors"
                      />
                      <button 
                        onClick={handleSaveName}
                        disabled={isSavingName || displayName === user.displayName || !displayName.trim()}
                        style={{ 
                          background: nameSaved ? 'rgba(34,197,94,0.1)' : '#1a2235', 
                          color: nameSaved ? '#4ade80' : '#eef6ff',
                          border: 'none', borderRadius: '8px', padding: '0 24px', fontSize: '14px', fontWeight: 600,
                          cursor: (isSavingName || displayName === user.displayName || !displayName.trim()) ? 'not-allowed' : 'pointer',
                          display: 'flex', alignItems: 'center', gap: '8px',
                          transition: 'all 0.2s ease'
                        }}
                        className="hover:bg-[#1f2937]"
                      >
                        {isSavingName ? <Loader2 size={16} className="animate-spin" /> : (nameSaved ? <Check size={16} /> : 'Save')}
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', alignItems: 'center', gap: '24px' }}>
                    <label style={{ fontSize: '14px', fontWeight: 500, color: '#8899aa' }}>Email address</label>
                    <div style={{ color: '#eef6ff', fontSize: '14px', fontWeight: 500 }}>
                      {user.email}
                    </div>
                  </div>

                  <div style={{ height: '1px', background: '#1a2235' }}></div>

                  <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', alignItems: 'flex-start', gap: '24px' }}>
                    <label style={{ fontSize: '14px', fontWeight: 500, color: '#8899aa' }}>Password</label>
                    <div>
                      <p style={{ fontSize: '14px', color: '#8899aa', marginBottom: '12px', lineHeight: 1.5, margin: '0 0 12px 0' }}>
                        Update your password by receiving a reset link via email.
                      </p>
                      <button 
                        onClick={handleResetPassword}
                        disabled={isSendingReset || resetSent}
                        style={{ 
                          background: 'none', border: 'none', color: '#7dd3fc', fontSize: '14px', fontWeight: 600,
                          cursor: (isSendingReset || resetSent) ? 'not-allowed' : 'pointer',
                          padding: 0,
                          transition: 'color 0.2s ease'
                        }}
                        className="hover:text-[#38bdf8]"
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
              <h2 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '32px', color: '#eef6ff' }}>Deck History</h2>
              <DeckHistory />
            </div>
          )}

          {activeTab === 'billing' && (
            <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
              <h2 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '32px', color: '#eef6ff' }}>Plan & Billing</h2>
              
              <div style={{ background: '#0f1420', border: '1px solid #1a2235', borderRadius: '16px', padding: '40px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '40px' }}>
                  <div>
                    <p style={{ fontSize: '14px', color: '#8899aa', marginBottom: '4px', margin: '0 0 4px 0' }}>Current Plan</p>
                    <div style={{ fontSize: '20px', fontWeight: 600, color: '#eef6ff' }}>{planName}</div>
                  </div>
                  <span style={{ 
                    fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700,
                    padding: '6px 16px', borderRadius: '9999px', background: 'rgba(125,211,252,0.1)', color: '#7dd3fc',
                    border: '1px solid rgba(125,211,252,0.2)'
                  }}>
                    {planName}
                  </span>
                </div>

                {usage && (
                  <div style={{ marginBottom: '40px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '12px' }}>
                      <span style={{ color: '#8899aa', fontWeight: 500 }}>Usage</span>
                      <span style={{ color: '#eef6ff', fontWeight: 600 }}>{usage.used} / {usage.limit === 9999 ? '∞' : usage.limit} decks</span>
                    </div>
                    <div style={{ height: '10px', background: 'rgba(125,211,252,0.05)', borderRadius: '9999px', overflow: 'hidden', marginBottom: '12px', border: '1px solid #1a2235' }}>
                      <div style={{ 
                        height: '100%', background: 'linear-gradient(90deg, #7dd3fc 0%, #38bdf8 100%)', borderRadius: '9999px',
                        width: `${Math.min((usage.used / usage.limit) * 100, 100)}%`,
                        transition: 'width 1s ease-out'
                      }}></div>
                    </div>
                    <p style={{ fontSize: '13px', color: '#8899aa', margin: 0 }}>
                      Usage resets on {new Date(usage.resetsOn).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                )}

                <div style={{ height: '1px', background: '#1a2235', margin: '40px 0' }}></div>

                <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '20px', color: '#eef6ff', margin: '0 0 20px 0' }}>Available Plans</h3>
                <div style={{ display: 'grid', gap: '16px' }}>
                  {[
                    { name: 'Pro', price: '$9/mo', desc: '50 decks per month' },
                    { name: 'Unlimited', price: '$19/mo', desc: 'Unlimited deck generation' }
                  ].map((plan) => (
                    <div key={plan.name} style={{ 
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                      padding: '20px 24px', border: '1px solid #1a2235', borderRadius: '12px',
                      background: '#07090f'
                    }}>
                      <div>
                        <div style={{ fontSize: '16px', fontWeight: 600, color: '#eef6ff' }}>{plan.name}</div>
                        <div style={{ fontSize: '14px', color: '#8899aa' }}>{plan.price} • {plan.desc}</div>
                      </div>
                      <button 
                        onClick={() => navigate('/#pricing')}
                        style={{ 
                          background: '#1a2235', color: '#eef6ff', border: 'none', borderRadius: '8px', 
                          padding: '10px 24px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                        className="hover:bg-[#7dd3fc] hover:text-[#07090f]"
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
              <h2 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '32px', color: '#eef6ff' }}>Danger Zone</h2>
              
              <div style={{ background: '#0f1420', border: '1px solid #ef444433', borderRadius: '16px', padding: '40px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '32px' }}>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#ef4444', marginBottom: '8px', margin: '0 0 8px 0' }}>Delete account</h3>
                    <p style={{ fontSize: '14px', color: '#8899aa', lineHeight: 1.6, margin: 0 }}>
                      Permanently delete your account and all associated data. This action is irreversible and you will lose access to all your generated content.
                    </p>
                  </div>
                  <button 
                    onClick={() => setShowDeleteModal(true)}
                    style={{ 
                      background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', 
                      color: '#ef4444', fontSize: '14px', fontWeight: 600, 
                      cursor: 'pointer', padding: '12px 24px', borderRadius: '8px',
                      transition: 'all 0.2s ease'
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
          background: 'rgba(7,9,15,0.9)', backdropFilter: 'blur(12px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '24px'
        }}>
          <div style={{ 
            background: '#0f1420', border: '1px solid #1a2235', borderRadius: '24px', 
            padding: '40px', maxWidth: '440px', width: '100%', textAlign: 'center',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }}>
            <div style={{ 
              width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444',
              margin: '0 auto 24px'
            }}>
              <AlertTriangle size={32} />
            </div>
            <h3 style={{ fontSize: '24px', fontWeight: 700, color: '#eef6ff', marginBottom: '16px', margin: '0 0 16px 0' }}>Are you absolutely sure?</h3>
            <p style={{ fontSize: '15px', color: '#8899aa', marginBottom: '40px', lineHeight: 1.6, margin: '0 0 40px 0' }}>
              This action is permanent and will delete all your data. You will lose access to all generated decks.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button 
                onClick={handleDeleteAccount}
                disabled={isDeleting}
                style={{ 
                  width: '100%', background: '#ef4444', color: '#ffffff', border: 'none', borderRadius: '12px', 
                  padding: '16px', fontSize: '16px', fontWeight: 600, cursor: isDeleting ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  transition: 'background 0.2s ease'
                }}
                className="hover:bg-[#dc2626]"
              >
                {isDeleting ? <Loader2 size={20} className="animate-spin" /> : 'Yes, Delete Account'}
              </button>
              <button 
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                style={{ 
                  width: '100%', background: 'transparent', color: '#8899aa', border: 'none', borderRadius: '12px', 
                  padding: '14px', fontSize: '15px', fontWeight: 500, cursor: isDeleting ? 'not-allowed' : 'pointer',
                  transition: 'color 0.2s ease'
                }}
                className="hover:text-[#eef6ff]"
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
      `}</style>
    </div>
  );
}


