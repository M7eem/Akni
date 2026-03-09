import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, User as UserIcon, History, BarChart3, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function AuthButton() {
  const { user, signOut, signInWithGoogle, usage } = useAuth();
  const navigate = useNavigate();

  if (user) {
    return (
      <div className="relative group z-50">
        <button className="flex items-center gap-3 focus:outline-none">
          <div className="flex items-center gap-2 bg-[#131820] border border-[rgba(255,255,255,0.05)] rounded-full pl-1 pr-3 py-1 group-hover:border-[rgba(125,211,252,0.3)] transition-colors relative">
            <div className="w-6 h-6 rounded-full bg-[#7dd3fc]/20 text-[#7dd3fc] flex items-center justify-center">
              <UserIcon size={14} />
            </div>
            <span className="text-sm font-medium text-[#eef6ff] max-w-[100px] truncate">
              {user.displayName || user.email}
            </span>
          </div>
        </button>

        {/* Dropdown Menu */}
        <div className="absolute right-0 top-full mt-2 w-64 bg-[#131820] border border-[rgba(255,255,255,0.1)] rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 transform origin-top-right p-4">
          
          {/* Usage Stats */}
          <div className="mb-4 pb-4 border-b border-[rgba(255,255,255,0.05)]">
            <div className="flex justify-between items-center text-xs text-[#8899aa] mb-2">
              <span className="flex items-center gap-1.5 font-medium"><BarChart3 size={12} /> Monthly Usage</span>
              {usage ? (
                <span className={usage.used >= usage.limit ? 'text-red-400 font-bold' : 'text-[#eef6ff]'}>
                  {usage.used} / {usage.limit} decks
                </span>
              ) : (
                <div className="h-3 w-12 bg-white/10 rounded animate-pulse" />
              )}
            </div>
            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
              {usage ? (
                <div 
                  className={`h-full rounded-full transition-all duration-500 ${usage.used >= usage.limit ? 'bg-red-500' : 'bg-[#7dd3fc]'}`} 
                  style={{ width: `${Math.min((usage.used / usage.limit) * 100, 100)}%` }} 
                />
              ) : (
                <div className="h-full w-1/3 bg-white/10 rounded-full animate-pulse" />
              )}
            </div>
            {usage && usage.used >= usage.limit && (
              <div className="text-[11px] text-red-400 mt-2 text-center bg-red-500/10 py-1 rounded border border-red-500/20">
                Limit reached. Resets {new Date(usage.resetsOn).toLocaleDateString()}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <button
              onClick={() => navigate('/account')}
              className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium text-[#8899aa] hover:text-[#eef6ff] hover:bg-white/5 transition-colors"
            >
              <Settings size={16} />
              Account
            </button>

            <button
              onClick={() => navigate('/history')}
              className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium text-[#8899aa] hover:text-[#eef6ff] hover:bg-white/5 transition-colors"
            >
              <History size={16} />
              Deck History
            </button>
            
            <button
              onClick={() => signOut()}
              className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium text-[#8899aa] hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <LogOut size={16} />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={signInWithGoogle}
      className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[#07090f] bg-[#7dd3fc] rounded-full hover:opacity-90 transition-opacity shadow-[0_0_15px_rgba(125,211,252,0.2)]"
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </svg>
      Sign in with Google
    </button>
  );
}
