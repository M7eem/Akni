import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { updateProfile, sendPasswordResetEmail, deleteUser } from 'firebase/auth';
import { doc, deleteDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { ArrowLeft, Loader2 } from 'lucide-react';

export default function AccountPage() {
  const { user, usage, signOut } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);

  const [isSendingReset, setIsSendingReset] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  if (!user) {
    navigate('/');
    return null;
  }

  const getInitials = () => {
    if (user.displayName) {
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

  return (
    <div style={{ minHeight: '100vh', background: '#07090f', color: '#eef6ff', padding: '2rem 1rem' }}>
      <div className="orb orb1"></div>
      <div className="orb orb2"></div>

      <div style={{ maxWidth: '480px', margin: '0 auto', position: 'relative', zIndex: 10 }}>
        {/* Back Button */}
        <button 
          onClick={() => navigate('/')}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#8899aa', background: 'none', border: 'none', cursor: 'pointer', marginBottom: '2rem', fontSize: '14px', fontWeight: 500 }}
          className="hover:text-[#eef6ff] transition-colors"
        >
          <ArrowLeft size={16} />
          Back to home
        </button>

        <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '2rem' }}>Account Settings</h1>

        {/* PROFILE SECTION */}
        <div style={{ background: '#0f1420', border: '1px solid #1a2235', borderRadius: '16px', padding: '24px', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: '#8899aa', marginBottom: '16px', fontWeight: 600 }}>Profile</h2>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div style={{ 
                width: '72px', height: '72px', borderRadius: '50%', 
                background: 'rgba(125,211,252,0.15)', border: '1px solid rgba(125,211,252,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#7dd3fc', fontWeight: 700, fontSize: '24px'
              }}>
                {getInitials()}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#8899aa', marginBottom: '8px', fontWeight: 500 }}>Display Name</label>
              <div style={{ display: 'flex', gap: '12px' }}>
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
                    border: 'none', borderRadius: '8px', padding: '0 16px', fontSize: '14px', fontWeight: 500,
                    cursor: (isSavingName || displayName === user.displayName || !displayName.trim()) ? 'not-allowed' : 'pointer',
                    opacity: (isSavingName || displayName === user.displayName || !displayName.trim()) && !nameSaved ? 0.5 : 1,
                    display: 'flex', alignItems: 'center', gap: '8px'
                  }}
                  className={!nameSaved ? "hover:bg-[#2a3655] transition-colors" : "transition-colors"}
                >
                  {isSavingName ? <Loader2 size={16} className="animate-spin" /> : (nameSaved ? 'Saved!' : 'Save')}
                </button>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#8899aa', marginBottom: '8px', fontWeight: 500 }}>Email Address</label>
              <input 
                type="email" 
                value={user.email || ''} 
                readOnly
                style={{ 
                  width: '100%', background: '#07090f', border: '1px solid #1a2235', borderRadius: '8px', 
                  padding: '10px 14px', color: '#8899aa', fontSize: '14px', outline: 'none', cursor: 'not-allowed'
                }}
              />
            </div>

            <div>
              <button 
                onClick={handleResetPassword}
                disabled={isSendingReset || resetSent}
                style={{ 
                  background: 'none', border: '1px solid #1a2235', borderRadius: '8px', 
                  padding: '10px 16px', color: '#eef6ff', fontSize: '14px', fontWeight: 500,
                  cursor: (isSendingReset || resetSent) ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: '8px', width: '100%', justifyContent: 'center'
                }}
                className="hover:bg-[#1a2235] transition-colors"
              >
                {isSendingReset ? <Loader2 size={16} className="animate-spin" /> : (resetSent ? 'Reset link sent to your email' : 'Change Password')}
              </button>
            </div>
          </div>
        </div>

        {/* PLAN & USAGE SECTION */}
        <div style={{ background: '#0f1420', border: '1px solid #1a2235', borderRadius: '16px', padding: '24px', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: '#8899aa', marginBottom: '16px', fontWeight: 600 }}>Plan & Usage</h2>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', color: '#eef6ff', fontWeight: 500 }}>Current Plan</span>
              <span style={{ 
                fontSize: '12px', padding: '4px 10px', borderRadius: '9999px',
                background: planName === 'Free' ? 'rgba(255,255,255,0.05)' : (planName === 'Unlimited' ? 'rgba(125,211,252,0.2)' : 'rgba(125,211,252,0.1)'),
                color: planName === 'Free' ? '#8899aa' : '#7dd3fc',
                fontWeight: planName === 'Unlimited' ? 700 : 500
              }}>
                {planName}
              </span>
            </div>

            {usage && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' }}>
                  <span style={{ color: '#8899aa' }}>{usage.used} of {usage.limit} decks used this month</span>
                </div>
                <div style={{ height: '8px', background: 'rgba(125,211,252,0.1)', borderRadius: '9999px', overflow: 'hidden', marginBottom: '8px' }}>
                  <div style={{ 
                    height: '100%', background: '#7dd3fc', borderRadius: '9999px',
                    width: `${Math.min((usage.used / usage.limit) * 100, 100)}%`
                  }}></div>
                </div>
                <div style={{ fontSize: '12px', color: '#8899aa', textAlign: 'right' }}>
                  Resets on {new Date(usage.resetsOn).toLocaleDateString()}
                </div>
              </div>
            )}

            {planName === 'Free' && (
              <button 
                onClick={() => navigate('/#pricing')}
                className="gen-btn"
                style={{ width: '100%', marginTop: '8px' }}
              >
                Upgrade Plan
              </button>
            )}
          </div>
        </div>

        {/* DANGER ZONE SECTION */}
        <div style={{ background: '#0f1420', border: '1px solid #1a2235', borderRadius: '16px', padding: '24px' }}>
          <h2 style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: '#ef4444', marginBottom: '16px', fontWeight: 600 }}>Danger Zone</h2>
          
          <button 
            onClick={() => setShowDeleteModal(true)}
            style={{ 
              width: '100%', background: 'none', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', 
              padding: '12px', color: '#ef4444', fontSize: '14px', fontWeight: 500, cursor: 'pointer'
            }}
            className="hover:bg-[rgba(239,68,68,0.1)] transition-colors"
          >
            Delete Account
          </button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div style={{ 
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          background: 'rgba(7,9,15,0.8)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem'
        }}>
          <div style={{ 
            background: '#0f1420', border: '1px solid #1a2235', borderRadius: '16px', 
            padding: '24px', maxWidth: '400px', width: '100%' 
          }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#eef6ff', marginBottom: '12px' }}>Delete Account?</h3>
            <p style={{ fontSize: '14px', color: '#8899aa', marginBottom: '24px', lineHeight: 1.5 }}>
              This will permanently delete your account and all your deck history. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                style={{ 
                  flex: 1, background: '#1a2235', color: '#eef6ff', border: 'none', borderRadius: '8px', 
                  padding: '10px', fontSize: '14px', fontWeight: 500, cursor: isDeleting ? 'not-allowed' : 'pointer'
                }}
                className="hover:bg-[#2a3655] transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleDeleteAccount}
                disabled={isDeleting}
                style={{ 
                  flex: 1, background: '#ef4444', color: '#ffffff', border: 'none', borderRadius: '8px', 
                  padding: '10px', fontSize: '14px', fontWeight: 500, cursor: isDeleting ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                }}
                className="hover:bg-[#dc2626] transition-colors"
              >
                {isDeleting ? <Loader2 size={16} className="animate-spin" /> : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
