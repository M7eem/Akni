import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getDeckHistory, DeckRecord } from '../services/firestoreService';
import { Clock, Layers, FileText, Loader2, Download } from 'lucide-react';

export default function DeckHistory() {
  const { user } = useAuth();
  const [decks, setDecks] = useState<DeckRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      getDeckHistory(user.uid).then(data => {
        setDecks(data);
        setLoading(false);
      });
    } else {
      setDecks([]);
      setLoading(false);
    }
  }, [user]);

  if (!user) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold text-[#eef6ff] mb-4">Sign in to view history</h2>
        <p className="text-[#8899aa]">Your generated decks will be saved here.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-[#7dd3fc]" size={32} />
      </div>
    );
  }

  if (decks.length === 0) {
    return (
      <div className="text-center py-12 bg-[#131820] rounded-xl border border-[rgba(255,255,255,0.05)]">
        <Layers className="mx-auto mb-4 text-[#8899aa]" size={48} />
        <h2 className="text-xl font-bold text-[#eef6ff] mb-2">No decks yet</h2>
        <p className="text-[#8899aa]">Generate your first deck to see it here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-[#eef6ff] flex items-center gap-2">
        <Clock className="text-[#7dd3fc]" /> Your Deck History
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {decks.map((deck) => (
          <div key={deck.id} className="bg-[#131820] p-5 rounded-xl border border-[rgba(255,255,255,0.05)] hover:border-[rgba(125,211,252,0.3)] transition-colors flex flex-col">
            <h3 className="font-bold text-[#eef6ff] text-lg mb-2 truncate" title={deck.deckName}>
              {deck.deckName}
            </h3>
            <div className="flex items-center gap-4 text-sm text-[#8899aa] mb-4">
              <span className="flex items-center gap-1"><Layers size={14} /> {deck.cardCount} cards</span>
              <span className="flex items-center gap-1"><FileText size={14} /> {deck.fileName}</span>
            </div>
            <div className="mt-auto flex items-center justify-between pt-4 border-t border-[rgba(255,255,255,0.05)]">
              <div className="text-xs text-[#556677]">
                {deck.createdAt?.toDate ? deck.createdAt.toDate().toLocaleDateString() : 'Just now'}
              </div>
              {deck.downloadUrl && (
                <a 
                  href={deck.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-medium text-[#7dd3fc] hover:text-[#38bdf8] transition-colors bg-[rgba(125,211,252,0.1)] hover:bg-[rgba(125,211,252,0.2)] px-3 py-1.5 rounded-md"
                >
                  <Download size={14} />
                  Download
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
