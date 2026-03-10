import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { updateProfile, sendPasswordResetEmail, deleteUser } from 'firebase/auth';
import { doc, deleteDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { ArrowLeft, Loader2, Pencil, Check, X, AlertTriangle } from 'lucide-react';

export default function AccountPage() {
  const { user, usage } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [isEditingName, setIsEditingName] = useState(false);
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
    if (!displayName.trim() || displayName === user.displayName) {
      setIsEditingName(false);
      return;
    }
    setIsSavingName(true);
    try {
      await updateProfile(user, { displayName });
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2000);
      setIsEditingName(false);
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
  
  // Circular Progress Calculations
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const usagePercent = usage ? Math.min((usage.used / usage.limit) * 100, 100) : 0;
  const offset = circumference - (usagePercent / 100) * circumference;

  const getDaysUntilReset = () => {
    if (!usage?.resetsOn) return 0;
    const resetDate = new Date(usage.resetsOn);
    const now = new Date();
    const diffTime = resetDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  };

  return (
    <div style={{ minHeight: '100vh', background: '#07090f', color: '#eef6ff' }}>
      {/* HEADER */}
      <header style={{ 
        width: '100%', 
        padding: '1.25rem 1.5rem', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        position: 'relative',
        borderBottom: '1px solid #1a2235',
        background: 'rgba(15, 20, 32, 0.5)',
        backdropFilter: 'blur(10px)',
        zIndex: 50
      }}>
        <button 
          onClick={() => navigate('/')}
          style={{ 
            position: 'absolute', 
            left: '1.5rem',
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            width: '40px',
            height: '40px',
            borderRadius: '12px',
            background: '#1a2235',
            color: '#eef6ff',
            border: 'none',
            cursor: 'pointer'
          }}
          className="hover:bg-[#2a3655] transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 style={{ fontSize: '18px', fontWeight: 600, letterSpacing: '-0.01em' }}>Account Settings</h1>
      </header>

      <main style={{ maxWidth: '480px', margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>
        {/* PROFILE CARD */}
        <div style={{ 
          background: '#0f1420', 
          border: '1px solid #1a2235', 
          borderRadius: '24px', 
          padding: '32px 24px', 
          marginBottom: '1.5rem',
          textAlign: 'center',
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{ 
            width: '96px', height: '96px', borderRadius: '50%', 
            background: 'linear-gradient(135deg, #7dd3fc 0%, #38bdf8 100%)',
            margin: '0 auto 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#07090f', fontWeight: 700, fontSize: '32px',
            boxShadow: '0 8px 24px rgba(56, 189, 248, 0.2)'
          }}>
            {getInitials()}
          </div>

          <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            {isEditingName ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', maxWidth: '280px' }}>
                <input 
                  type="text" 
                  value={displayName} 
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                  style={{ 
                    flex: 1, background: '#07090f', border: '1px solid #38bdf8', borderRadius: '8px', 
                    padding: '6px 12px', color: '#eef6ff', fontSize: '20px', fontWeight: 600, textAlign: 'center', outline: 'none'
                  }}
                />
                <button 
                  onClick={handleSaveName}
                  style={{ color: '#4ade80', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                >
                  <Check size={20} />
                </button>
                <button 
                  onClick={() => { setDisplayName(user.displayName || ''); setIsEditingName(false); }}
                  style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                >
                  <X size={20} />
                </button>
              </div>
            ) : (
              <>
                <h2 style={{ fontSize: '24px', fontWeight: 700, color: '#eef6ff' }}>{user.displayName || 'User'}</h2>
                <button 
                  onClick={() => setIsEditingName(true)}
                  style={{ color: '#8899aa', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                  className="hover:text-[#7dd3fc] transition-colors"
                >
                  <Pencil size={16} />
                </button>
              </>
            )}
          </div>
          
          <p style={{ fontSize: '14px', color: '#8899aa', marginBottom: '24px' }}>{user.email}</p>

          <button 
            onClick={handleResetPassword}
            disabled={isSendingReset || resetSent}
            style={{ 
              background: 'none', border: 'none', color: '#7dd3fc', fontSize: '13px', fontWeight: 500,
              cursor: (isSendingReset || resetSent) ? 'not-allowed' : 'pointer',
              textDecoration: 'underline', textUnderlineOffset: '4px'
            }}
            className="hover:text-[#38bdf8] transition-colors"
          >
            {isSendingReset ? 'Sending...' : (resetSent ? 'Reset link sent!' : 'Change Password')}
          </button>
        </div>

        {/* PLAN CARD */}
        <div style={{ 
          background: '#0f1420', 
          border: '1px solid #1a2235', 
          borderRadius: '24px', 
          padding: '24px', 
          marginBottom: '1.5rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Current Plan</h3>
            <span style={{ 
              fontSize: '12px', padding: '4px 12px', borderRadius: '9999px',
              background: planName === 'Free' ? 'rgba(136, 153, 170, 0.1)' : 'rgba(56, 189, 248, 0.15)',
              color: planName === 'Free' ? '#8899aa' : '#7dd3fc',
              fontWeight: 600, border: `1px solid ${planName === 'Free' ? 'rgba(136, 153, 170, 0.2)' : 'rgba(56, 189, 248, 0.3)'}`
            }}>
              {planName}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', marginBottom: '32px' }}>
            <div style={{ position: 'relative', width: '100px', height: '100px' }}>
              <svg width="100" height="100" viewBox="0 0 100 100">
                <circle 
                  cx="50" cy="50" r={radius} 
                  fill="none" stroke="#1a2235" strokeWidth="8" 
                />
                <circle 
                  cx="50" cy="50" r={radius} 
                  fill="none" stroke="#38bdf8" strokeWidth="8" 
                  strokeDasharray={circumference}
                  strokeDashoffset={offset}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                  transform="rotate(-90 50 50)"
                />
              </svg>
              <div style={{ 
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
              }}>
                <span style={{ fontSize: '18px', fontWeight: 700 }}>{usage?.used || 0}</span>
                <span style={{ fontSize: '10px', color: '#8899aa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>/ {usage?.limit === 9999 ? '∞' : usage?.limit || 10}</span>
              </div>
            </div>
            <p style={{ fontSize: '13px', color: '#8899aa' }}>
              Resets in <span style={{ color: '#eef6ff', fontWeight: 600 }}>{getDaysUntilReset()} days</span>
            </p>
          </div>

          {planName === 'Free' && (
            <button 
              onClick={() => navigate('/#pricing')}
              style={{ 
                width: '100%', padding: '14px', background: '#38bdf8', color: '#07090f', 
                borderRadius: '14px', fontWeight: 600, fontSize: '15px', border: 'none', cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(56, 189, 248, 0.2)'
              }}
              className="hover:bg-[#7dd3fc] transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              Upgrade to Pro
            </button>
          )}
        </div>

        {/* DANGER ZONE */}
        <div style={{ marginTop: '3rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444', marginBottom: '12px' }}>
            <AlertTriangle size={18} />
            <h3 style={{ fontSize: '14px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Danger Zone</h3>
          </div>
          
          <div style={{ 
            background: 'rgba(239, 68, 68, 0.03)', 
            border: '1px solid rgba(239, 68, 68, 0.1)', 
            borderRadius: '20px', 
            padding: '20px' 
          }}>
            <p style={{ fontSize: '13px', color: '#8899aa', marginBottom: '20px', lineHeight: 1.5 }}>
              Deleting your account is permanent. All your deck history, usage data, and settings will be wiped instantly. This action cannot be undone.
            </p>
            
            <button 
              onClick={() => setShowDeleteModal(true)}
              style={{ 
                width: '100%', background: 'none', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: '12px', 
                padding: '12px', color: '#ef4444', fontSize: '14px', fontWeight: 600, cursor: 'pointer'
              }}
              className="hover:bg-[#ef4444] hover:text-white transition-all"
            >
              Delete My Account
            </button>
          </div>
        </div>
      </main>

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

