import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDanger?: boolean;
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  isDanger = false
}: ConfirmModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(7, 9, 15, 0.85)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '20px'
          }}
          onClick={onCancel}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border2)',
              borderRadius: '24px',
              width: '100%',
              maxWidth: '420px',
              position: 'relative',
              boxShadow: '0 32px 80px rgba(0, 0, 0, 0.6), 0 0 60px rgba(56, 189, 248, 0.06)',
              overflow: 'hidden',
              fontFamily: '"Bricolage Grotesque", sans-serif'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Branded Header */}
            <div style={{ 
              padding: '16px 24px', 
              background: 'rgba(255,255,255,0.02)', 
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span style={{ 
                fontSize: '11px', 
                fontWeight: 800, 
                letterSpacing: '1px', 
                textTransform: 'uppercase', 
                color: 'var(--muted2)' 
              }}>
                Ankit says
              </span>
              <button 
                onClick={onCancel}
                style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', display: 'flex' }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: '32px' }}>
              <div style={{ display: 'flex', gap: '20px', marginBottom: '24px' }}>
                <div style={{ 
                  width: '48px', 
                  height: '48px', 
                  borderRadius: '12px', 
                  background: isDanger ? 'rgba(239, 68, 68, 0.1)' : 'rgba(125, 211, 252, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  color: isDanger ? '#ef4444' : 'var(--accent)'
                }}>
                  <AlertTriangle size={24} />
                </div>
                <div>
                  <h3 style={{ 
                    fontSize: '18px', 
                    fontWeight: 800, 
                    color: 'var(--text)', 
                    marginBottom: '8px',
                    letterSpacing: '-0.5px'
                  }}>
                    {title}
                  </h3>
                  <p style={{ 
                    fontSize: '14px', 
                    lineHeight: '1.6', 
                    color: 'var(--muted2)',
                    fontWeight: 500
                  }}>
                    {message}
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                  onClick={onCancel}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '10px',
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    color: 'var(--muted2)',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    fontFamily: 'inherit'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                    e.currentTarget.style.color = 'var(--text)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--muted2)';
                  }}
                >
                  {cancelText}
                </button>
                <button
                  onClick={onConfirm}
                  style={{
                    padding: '10px 24px',
                    borderRadius: '10px',
                    background: isDanger ? '#ef4444' : 'var(--accent)',
                    border: 'none',
                    color: isDanger ? 'white' : '#07090f',
                    fontWeight: 800,
                    fontSize: '13px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    fontFamily: 'inherit',
                    boxShadow: isDanger ? '0 8px 20px rgba(239, 68, 68, 0.2)' : '0 8px 20px rgba(56, 189, 248, 0.2)'
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.opacity = '0.85')}
                  onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
                >
                  {confirmText}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
