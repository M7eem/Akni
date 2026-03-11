import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getDeckHistory, deleteDeckHistory, DeckRecord } from '../services/firestoreService';
import { ref, getBlob } from 'firebase/storage';
import { storage } from '../lib/firebase';
import { Layers, FileText, Loader2, Download, Search, Trash2, Calendar, ExternalLink, MoreVertical } from 'lucide-react';
import ConfirmModal from './ConfirmModal';

export default function DeckHistory() {
  const { user } = useAuth();
  const [decks, setDecks] = useState<DeckRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [deckToDelete, setDeckToDelete] = useState<{ id: string, storagePath?: string } | null>(null);

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

  const handleDelete = async (deckId: string, storagePath?: string) => {
    if (!user) return;
    setDeckToDelete({ id: deckId, storagePath });
    setShowConfirmDelete(true);
  };

  const confirmDelete = async () => {
    if (!user || !deckToDelete) return;
    
    const { id: deckId, storagePath } = deckToDelete;
    setShowConfirmDelete(false);
    setDeletingId(deckId);
    try {
      await deleteDeckHistory(user.uid, deckId, storagePath);
      setDecks(prev => prev.filter(d => d.id !== deckId));
    } catch (error) {
      console.error("Failed to delete deck", error);
      alert("Failed to delete deck. Please try again.");
    } finally {
      setDeletingId(null);
      setDeckToDelete(null);
    }
  };

  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownload = async (deck: DeckRecord) => {
    if (!deck.id || !deck.downloadUrl) return;
    
    setDownloadingId(deck.id);
    try {
      let blob: Blob;
      
      // If we have a storage path, use the SDK (more reliable for CORS)
      if (deck.storagePath) {
        const storageRef = ref(storage, deck.storagePath);
        blob = await getBlob(storageRef);
      } else {
        // Fallback to fetch if no storage path (shouldn't happen for new decks)
        const cacheBuster = `?cb=${Date.now()}`;
        const downloadUrl = deck.downloadUrl.includes('?') 
          ? `${deck.downloadUrl}&cb=${Date.now()}` 
          : `${deck.downloadUrl}${cacheBuster}`;
        
        const response = await fetch(downloadUrl);
        if (!response.ok) throw new Error('Network response was not ok');
        blob = await response.blob();
      }

      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = deck.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Download failed", error);
      // Last resort fallback - append filename hint to URL if possible
      const fallbackUrl = deck.downloadUrl.includes('content-disposition') 
        ? deck.downloadUrl 
        : `${deck.downloadUrl}${deck.downloadUrl.includes('?') ? '&' : '?'}${'content-disposition'}=attachment%3B%20filename%3D%22${encodeURIComponent(deck.fileName)}%22`;
      window.open(fallbackUrl, '_blank');
    } finally {
      setDownloadingId(null);
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
      <div style={{ textAlign: 'center', padding: '64px 24px', background: 'var(--surface)', borderRadius: '24px', border: '1px solid var(--border2)' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)', marginBottom: '12px', letterSpacing: '-0.5px' }}>Sign in to view history</h2>
        <p style={{ color: 'var(--muted2)', fontSize: '14px', fontWeight: 500 }}>Your generated decks will be saved here for easy access.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <Loader2 className="animate-spin text-[var(--accent)]" size={40} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <ConfirmModal 
        isOpen={showConfirmDelete}
        title="Delete Deck?"
        message="Are you sure you want to delete this deck? This action cannot be undone and the file will be removed from storage."
        confirmText="Delete"
        cancelText="Keep Deck"
        isDanger={true}
        onConfirm={confirmDelete}
        onCancel={() => {
          setShowConfirmDelete(false);
          setDeckToDelete(null);
        }}
      />
      {/* Header & Search */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '280px' }}>
          <Search size={18} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input 
            type="text" 
            placeholder="Search decks by name or file..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ 
              width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '12px', 
              padding: '14px 16px 14px 48px', color: 'var(--text)', fontSize: '14px', outline: 'none',
              fontFamily: 'inherit'
            }}
            className="focus:border-[var(--accent)]/50 transition-colors"
          />
        </div>
        <div style={{ fontSize: '13px', color: 'var(--muted2)', fontWeight: 600 }}>
          {filteredDecks.length} {filteredDecks.length === 1 ? 'deck' : 'decks'} found
        </div>
      </div>

      {/* List View */}
      {filteredDecks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px 24px', background: 'var(--surface)', borderRadius: '24px', border: '1px solid var(--border2)' }}>
          <Layers className="mx-auto mb-6 text-[var(--muted)]" size={56} />
          <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)', marginBottom: '8px', letterSpacing: '-0.5px' }}>
            {searchQuery ? 'No matches found' : 'No decks yet'}
          </h2>
          <p style={{ color: 'var(--muted2)', fontSize: '14px', fontWeight: 500 }}>
            {searchQuery ? 'Try a different search term.' : 'Generate your first deck to see it here.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredDecks.map((deck) => (
            <div 
              key={deck.id} 
              style={{ 
                background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '16px', 
                padding: '20px 24px', display: 'flex', alignItems: 'center', gap: '20px',
                transition: 'all 0.2s ease',
                position: 'relative',
                overflow: 'hidden'
              }}
              className="hover:border-[var(--accent)]/30 group"
            >
              {/* Icon */}
              <div style={{ 
                width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(125,211,252,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flexShrink: 0
              }}>
                <Layers size={24} />
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '-0.3px' }}>
                    {deck.deckName}
                  </h3>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--muted2)', fontWeight: 500 }}>
                    <FileText size={14} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' }}>{deck.fileName}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--muted2)', fontWeight: 500 }}>
                    <Layers size={14} />
                    <span>{deck.cardCount} cards</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--muted2)', fontWeight: 500 }}>
                    <Calendar size={14} />
                    <span>
                      {deck.createdAt?.toDate 
                        ? deck.createdAt.toDate().toLocaleString('en-US', { 
                            month: 'short', 
                            day: 'numeric', 
                            year: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                          }) 
                        : 'Just now'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {deck.downloadUrl ? (
                  <button 
                    onClick={() => handleDownload(deck)}
                    disabled={downloadingId === deck.id}
                    style={{ 
                      display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', 
                      background: 'rgba(125,211,252,0.1)', color: 'var(--accent)', borderRadius: '10px',
                      fontSize: '13px', fontWeight: 700, border: 'none', cursor: 'pointer', transition: 'all 0.2s ease',
                      fontFamily: 'inherit'
                    }}
                    className="hover:bg-[var(--accent)] hover:text-[#07090f] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {downloadingId === deck.id ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Download size={16} />
                    )}
                    {downloadingId === deck.id ? 'Downloading...' : 'Download'}
                  </button>
                ) : (
                  <div style={{ 
                    fontSize: '12px', color: 'var(--muted)', background: 'rgba(255,255,255,0.02)', 
                    padding: '10px 16px', borderRadius: '10px', border: '1px solid var(--border)',
                    fontWeight: 600
                  }}>
                    Expired
                  </div>
                )}
                
                <button 
                  onClick={() => deck.id && handleDelete(deck.id, deck.storagePath)}
                  disabled={deletingId === deck.id}
                  style={{ 
                    padding: '10px', borderRadius: '10px', background: 'transparent', border: 'none',
                    color: 'var(--muted)', cursor: 'pointer', transition: 'all 0.2s ease'
                  }}
                  className="hover:bg-red-500/10 hover:text-red-400"
                  title="Delete from history"
                >
                  {deletingId === deck.id ? <Loader2 size={20} className="animate-spin" /> : <Trash2 size={20} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
