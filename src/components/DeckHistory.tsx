import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getDeckHistory, deleteDeckHistory, DeckRecord } from '../services/firestoreService';
import { Layers, FileText, Loader2, Download, Search, Trash2, Calendar, ExternalLink, MoreVertical } from 'lucide-react';

export default function DeckHistory() {
  const { user } = useAuth();
  const [decks, setDecks] = useState<DeckRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      fetchDecks();
    } else {
      setDecks([]);
      setLoading(false);
    }
  }, [user]);

  const fetchDecks = async () => {
    if (!user) return;
    try {
      const data = await getDeckHistory(user.uid);
      setDecks(data);
    } catch (error) {
      console.error("Failed to fetch decks", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (deckId: string) => {
    if (!user || !window.confirm('Are you sure you want to delete this deck from your history?')) return;
    
    setDeletingId(deckId);
    try {
      await deleteDeckHistory(user.uid, deckId);
      setDecks(prev => prev.filter(d => d.id !== deckId));
    } catch (error) {
      console.error("Failed to delete deck", error);
      alert("Failed to delete deck. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  const filteredDecks = useMemo(() => {
    return decks.filter(deck => 
      deck.deckName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      deck.fileName.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [decks, searchQuery]);

  if (!user) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 24px', background: '#0f1420', borderRadius: '16px', border: '1px solid #1a2235' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#eef6ff', marginBottom: '12px' }}>Sign in to view history</h2>
        <p style={{ color: '#8899aa', fontSize: '14px' }}>Your generated decks will be saved here for easy access.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 0' }}>
        <Loader2 className="animate-spin text-[#7dd3fc]" size={32} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header & Search */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '280px' }}>
          <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#4a5568' }} />
          <input 
            type="text" 
            placeholder="Search decks by name or file..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ 
              width: '100%', background: '#0f1420', border: '1px solid #1a2235', borderRadius: '10px', 
              padding: '12px 16px 12px 42px', color: '#eef6ff', fontSize: '14px', outline: 'none'
            }}
            className="focus:border-[#7dd3fc]/50 transition-colors"
          />
        </div>
        <div style={{ fontSize: '13px', color: '#8899aa', fontWeight: 500 }}>
          {filteredDecks.length} {filteredDecks.length === 1 ? 'deck' : 'decks'} found
        </div>
      </div>

      {/* List View */}
      {filteredDecks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '64px 24px', background: '#0f1420', borderRadius: '16px', border: '1px solid #1a2235' }}>
          <Layers className="mx-auto mb-4 text-[#4a5568]" size={48} />
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#eef6ff', marginBottom: '8px' }}>
            {searchQuery ? 'No matches found' : 'No decks yet'}
          </h2>
          <p style={{ color: '#8899aa', fontSize: '14px' }}>
            {searchQuery ? 'Try a different search term.' : 'Generate your first deck to see it here.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredDecks.map((deck) => (
            <div 
              key={deck.id} 
              style={{ 
                background: '#0f1420', border: '1px solid #1a2235', borderRadius: '12px', 
                padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '20px',
                transition: 'all 0.2s ease',
                position: 'relative',
                overflow: 'hidden'
              }}
              className="hover:border-[#7dd3fc]/30 group"
            >
              {/* Icon */}
              <div style={{ 
                width: '44px', height: '44px', borderRadius: '10px', background: 'rgba(125,211,252,0.05)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7dd3fc', flexShrink: 0
              }}>
                <Layers size={22} />
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#eef6ff', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {deck.deckName}
                  </h3>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#8899aa' }}>
                    <FileText size={14} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '150px' }}>{deck.fileName}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#8899aa' }}>
                    <Layers size={14} />
                    <span>{deck.cardCount} cards</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#8899aa' }}>
                    <Calendar size={14} />
                    <span>{deck.createdAt?.toDate ? deck.createdAt.toDate().toLocaleDateString() : 'Just now'}</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {deck.downloadUrl ? (
                  <a 
                    href={deck.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ 
                      display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', 
                      background: 'rgba(125,211,252,0.1)', color: '#7dd3fc', borderRadius: '8px',
                      fontSize: '13px', fontWeight: 600, textDecoration: 'none', transition: 'all 0.2s ease'
                    }}
                    className="hover:bg-[#7dd3fc] hover:text-[#07090f]"
                  >
                    <Download size={16} />
                    Download
                  </a>
                ) : (
                  <div style={{ 
                    fontSize: '12px', color: '#4a5568', background: 'rgba(255,255,255,0.02)', 
                    padding: '8px 12px', borderRadius: '8px', border: '1px solid #1a2235'
                  }}>
                    Expired
                  </div>
                )}
                
                <button 
                  onClick={() => deck.id && handleDelete(deck.id)}
                  disabled={deletingId === deck.id}
                  style={{ 
                    padding: '8px', borderRadius: '8px', background: 'transparent', border: 'none',
                    color: '#4a5568', cursor: 'pointer', transition: 'all 0.2s ease'
                  }}
                  className="hover:bg-red-500/10 hover:text-red-400"
                  title="Delete from history"
                >
                  {deletingId === deck.id ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
