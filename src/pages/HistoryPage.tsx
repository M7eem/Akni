import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import DeckHistory from '../components/DeckHistory';
import AuthButton from '../components/AuthButton';

export default function HistoryPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#07090f] text-[#eef6ff]">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-[rgba(255,255,255,0.05)] bg-[#07090f]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/')}
            className="flex items-center justify-center w-10 h-10 rounded-full bg-[#131820] border border-[rgba(255,255,255,0.05)] hover:border-[rgba(125,211,252,0.3)] hover:text-[#7dd3fc] transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="text-lg font-bold tracking-tight">Card it</div>
        </div>
        <AuthButton />
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <DeckHistory />
      </main>
    </div>
  );
}
