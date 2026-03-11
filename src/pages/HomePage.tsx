import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, X, Loader2, Download, CheckCircle, AlertCircle, Lock, Zap, ArrowRight, Image as ImageIcon, History, Link, Twitter, Github, Linkedin } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import LabelEditorStep, { Label } from '../components/LabelEditorStep';
import AuthButton from '../components/AuthButton';
import DeckHistory from '../components/DeckHistory';
import { useAuth } from '../contexts/AuthContext';
import { getUsage } from '../services/deckHistoryService';
import { saveDeckHistory } from '../services/firestoreService';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, googleProvider, db } from '../lib/firebase';

interface UploadedFile {
  file: File;
  id: string;
}

interface ExtractedImage {
  name: string;
  mimeType: string;
}

type Step = 'upload' | 'imagePicker' | 'labelEditor' | 'generating' | 'complete';
type Status = 'idle' | 'extracting' | 'detecting' | 'generating' | 'building' | 'error';

import { useNavigate } from 'react-router-dom';
import { PreviewSection } from '../components/PreviewSection';

const LoadingScreen = ({ status }: { status: Status }) => {
  const [loadingStep, setLoadingStep] = useState(0);
  const steps = [
    'Reading your lecture...',
    'Identifying key concepts...',
    'Generating flashcards...',
    'Almost done...'
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setLoadingStep(prev => Math.min(prev + 1, steps.length - 1));
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div key="generating" className="fade-in">
      <div className="text-center py-[80px]">
        <Loader2 className="animate-spin mx-auto mb-8 text-[var(--accent)]" size={56} />
        <h2 className="text-2xl font-bold mb-3 text-[#eef6ff] transition-all duration-500">
          {status === 'building' ? 'Building your .apkg file...' : 
           status === 'generating' ? steps[loadingStep] : 
           'Downloading your deck...'}
        </h2>
        <p className="text-[#8899aa] text-sm">
          {status === 'building' ? 'Adding media and formatting cards.' : 
           status === 'generating' ? 'This usually takes under 60 seconds.' : 
           'Almost ready to download.'}
        </p>
      </div>
      
      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 h-1 bg-[var(--accent)] transition-all duration-[60000ms] ease-linear w-full" style={{ width: '100%', transformOrigin: 'left', animation: 'progress 60s linear forwards' }} />
      <style>{`
        @keyframes progress {
          0% { transform: scaleX(0); }
          100% { transform: scaleX(1); }
        }
      `}</style>
    </div>
  );
};

export default function HomePage() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [deckName, setDeckName] = useState('');
  const [cardTypes, setCardTypes] = useState<string[]>(['basic']);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [cardCount, setCardCount] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sessionId, setSessionId] = useState<string>('');
  const [extractedImages, setExtractedImages] = useState<ExtractedImage[]>([]);
  const [selectedImageNames, setSelectedImageNames] = useState<string[]>([]);
  const [step, setStep] = useState<Step>('upload');
  const [detectedLabelsMap, setDetectedLabelsMap] = useState<Record<string, Label[]>>({});
  const [scrolled, setScrolled] = useState(false);
  const [showSignUpModal, setShowSignUpModal] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const { user, getIdToken, usage, setUsage, signInWithGoogle } = useAuth();
  const navigate = useNavigate();

  const plan = usage?.limit === 9999 ? 'Max' : (usage?.limit === 30 ? 'Pro' : 'Free');
  const fileLimit = plan === 'Max' ? 10 : (plan === 'Pro' ? 5 : 1);
  const isFree = plan === 'Free';

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // ── File handling ──────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newFiles = (Array.from(e.target.files) as File[])
      .filter((f: File) => f.name.endsWith('.pptx') || f.name.endsWith('.pdf'))
      .map((f: File) => ({ file: f, id: Math.random().toString(36).substring(7) }));
    setFiles(prev => [...prev, ...newFiles].slice(0, fileLimit));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const newFiles = (Array.from(e.dataTransfer.files) as File[])
      .filter((f: File) => f.name.endsWith('.pptx') || f.name.endsWith('.pdf'))
      .map((f: File) => ({ file: f, id: Math.random().toString(36).substring(7) }));
    setFiles(prev => [...prev, ...newFiles].slice(0, fileLimit));
  };

  const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));

  // ── Safe fetch — never crashes on HTML error responses ─────
  const safeFetch = async (url: string, options: RequestInit = {}) => {
    const token = await getIdToken();
    const headers = new Headers(options.headers || {});
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    } else {
      headers.set('x-guest-trial', 'true');
    }

    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        const err = new Error(json.error || json.details || `Server error ${response.status}`);
        (err as any).status = response.status;
        throw err;
      } catch (e) {
        if ((e as any).status) throw e;
        const err = new Error(`Server error ${response.status} — check Railway logs`);
        (err as any).status = response.status;
        throw err;
      }
    }
    return response;
  };

  // ── Step 1: Extract images (names only — no base64) ────────
  const handleExtractImages = async () => {
    if (!user && localStorage.getItem('guestDeckUsed') === 'true') {
      setShowSignUpModal(true);
      return;
    }

    if (user && usage && usage.used >= usage.limit) {
      setShowLimitModal(true);
      return;
    }

    if (!files.length || !deckName.trim() || !cardTypes.length) return;
    setStatus('extracting');
    setErrorMessage('');

    const formData = new FormData();
    files.forEach(f => formData.append('files', f.file));

    try {
      const response = await safeFetch('/api/extract-images', { method: 'POST', body: formData });
      const data = await response.json();

      setSessionId(data.sessionId);
      setExtractedImages(data.images || []);

      if (data.images && data.images.length > 0 && cardTypes.includes('image_occlusion')) {
        setStep('imagePicker');
        setStatus('idle');
      } else {
        await handleGenerate(data.sessionId, null);
      }
    } catch (error: any) {
      setStatus('error');
      if (error.status === 429) {
        setShowLimitModal(true);
      } else if (error.status === 401 && !user) {
        setShowSignUpModal(true);
        setErrorMessage('');
      } else {
        setErrorMessage(error.message);
      }
    }
  };

  // ── Step 2: Detect labels on selected images ─────────────────
  const handleDetectLabels = async () => {
    if (selectedImageNames.length === 0 || !sessionId) return;
    setStatus('detecting');
    setErrorMessage('');

    try {
      const allLabels: Record<string, Label[]> = {};
      for (const imageName of selectedImageNames) {
        const response = await safeFetch('/api/detect-labels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, imageName })
        });
        const data = await response.json();
        allLabels[imageName] = data.labels || [];
      }
      setDetectedLabelsMap(allLabels);
      setStep('labelEditor');
      setStatus('idle');
    } catch (error: any) {
      setStatus('error');
      if (error.status === 429) {
        setShowLimitModal(true);
      } else if (error.status === 401 && !user) {
        setShowSignUpModal(true);
        setErrorMessage('');
      } else {
        setErrorMessage(error.message);
      }
    }
  };

  // ── Step 3: Generate deck ────────────────────────────────────
  const handleGenerate = async (
    currentSessionId: string = sessionId,
    occlusionData: { imageName: string; labels: Label[] }[] | null = null
  ) => {
    if (!user && localStorage.getItem('guestDeckUsed') === 'true') {
      setShowSignUpModal(true);
      return;
    }

    setStep('generating');
    setStatus('generating');
    setErrorMessage('');

    const formData = new FormData();
    formData.append('sessionId', currentSessionId);
    formData.append('deck_name', deckName);
    formData.append('card_types', JSON.stringify(cardTypes));
    if (occlusionData) {
      formData.append('occlusionData', JSON.stringify(occlusionData));
    }

    const ticker = setInterval(() => {
      setStatus(prev => prev === 'generating' ? 'building' : prev);
    }, 6000);

    try {
      const response = await safeFetch('/api/generate', { method: 'POST', body: formData });
      clearInterval(ticker);
      setStatus('building'); // Show building status while reading blob

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      setDownloadUrl(url);

      const cd = response.headers.get('Content-Disposition');
      const cardCountStr = response.headers.get('X-Card-Count');
      const count = cardCountStr ? parseInt(cardCountStr, 10) : 0;
      setCardCount(count);

      const safeName = deckName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'My Deck';
      // Prioritize the user-provided deck name for the filename
      const name = `${safeName}.apkg`;
      setFileName(name);
      
      if (user) {
        // Optimistic update
        setUsage(prev => prev ? { ...prev, used: prev.used + 1 } : prev);
        
        // Delay background sync so Firestore has time to reflect the increment
        setTimeout(() => {
          getUsage(user.uid, true).then(setUsage).catch(console.error);
        }, 2000);
      } else {
        localStorage.setItem('guestDeckUsed', 'true');
      }

      setStep('complete');
      setStatus('idle');
    } catch (error: any) {
      clearInterval(ticker);
      setStatus('error');
      
      if (error.status === 429) {
        setShowLimitModal(true);
      } else if (error.status === 401 && !user) {
        setShowSignUpModal(true);
        setErrorMessage('');
      } else {
        setErrorMessage(error.message);
      }
      setStep('upload');
    }
  };

  const reset = () => {
    setFiles([]);
    setDeckName('');
    setCardTypes(['basic', 'cloze']);
    setStatus('idle');
    setDownloadUrl('');
    setErrorMessage('');
    setSessionId('');
    setExtractedImages([]);
    setSelectedImageNames([]);
    setDetectedLabelsMap({});
    setStep('upload');
  };

  return (
    <>
      <div className="orb orb1"></div>
      <div className="orb orb2"></div>

      <nav className={scrolled ? 'nav-scrolled' : ''}>
        <a href="/" className="logo" style={{ textDecoration: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '22px', fontWeight: 800, letterSpacing: '-0.5px', color: '#eef6ff' }}>
            <div style={{ position: 'relative', width: '30px', height: '24px', flexShrink: 0 }}>
              <div style={{ position: 'absolute', width: '24px', height: '16px', background: 'rgba(125,211,252,0.2)', border: '1px solid rgba(125,211,252,0.4)', borderRadius: '5px', top: 0, left: '6px' }} />
              <div style={{ position: 'absolute', width: '24px', height: '16px', background: '#131820', border: '1px solid rgba(125,211,252,0.6)', borderRadius: '5px', bottom: 0, left: 0 }}>
                <div style={{ position: 'absolute', top: '5px', left: '5px', right: '5px', height: '2px', borderRadius: '1px', background: 'rgba(125,211,252,0.5)' }} />
              </div>
            </div>
            Ankit
          </div>
        </a>
        <div className="nav-links flex items-center gap-6">
          <a href="#preview">Preview</a>
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          {!user && (
            <a href="/auth" className="text-[13px] font-medium text-[#8899aa] hover:text-[#eef6ff] transition-colors">
              Log in
            </a>
          )}
          <AuthButton />
        </div>
      </nav>

      <section className="hero">
        {step !== 'labelEditor' && (
          <>
            {step === 'upload' && (
              <>
                <h1>Turn your lectures into<br/><span className="icy">Anki flashcards</span></h1>
                <p className="hero-sub" style={{ marginBottom: '48px' }}>
                  Upload a PDF or PPTX and get a complete Anki deck in under a minute.
                </p>
              </>
            )}

            <div className="deck-card">
              {/* ── UPLOAD FORM ── */}
        {step === 'upload' && (
              <div key="upload" className="fade-in">
                  {files.map(f => (
                  <div key={f.id} className="file-row">
                    <div className="file-row-icon"><FileText size={16} /></div>
                    <div className="file-row-info">
                      <div className="file-row-name">{f.file.name}</div>
                      <div className="file-row-size">{(f.file.size / 1024 / 1024).toFixed(2)} MB</div>
                    </div>
                    <div className="file-row-x" onClick={() => removeFile(f.id)}><X size={16} /></div>
                  </div>
                ))}

                <input ref={fileInputRef} type="file" onChange={handleFileChange} className="hidden" multiple accept=".pptx,.pdf" />

                <div 
                  className="upload-zone"
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  style={{
                    transition: 'all 0.3s ease',
                    maxHeight: files.length === 0 ? '250px' : '0px',
                    opacity: files.length === 0 ? 1 : 0,
                    overflow: 'hidden',
                    padding: files.length === 0 ? '48px 20px' : '0px 20px',
                    borderWidth: files.length === 0 ? '1.5px' : '0px',
                    marginBottom: files.length === 0 ? '18px' : '0px'
                  }}
                >
                  <div className="upload-zone-icon">
                    <Upload size={22} />
                  </div>
                  <h3>Drag & drop your lecture or book here</h3>
                  <p>or click to upload</p>
                  <p style={{ fontSize: '12px', color: '#8899aa', marginTop: '8px' }}>Max file size: 50MB. Supports up to 100 pages.</p>
                </div>

                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    borderRadius: '12px',
                    borderStyle: 'dashed',
                    borderColor: 'rgba(125,211,252,0.25)',
                    background: 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    maxHeight: files.length > 0 ? '100px' : '0px',
                    opacity: files.length > 0 ? 1 : 0,
                    overflow: 'hidden',
                    padding: files.length > 0 ? '10px 14px' : '0px 14px',
                    marginBottom: files.length > 0 ? '10px' : '0px',
                    borderWidth: files.length > 0 ? '1px' : '0px',
                  }}
                >
                  <Upload size={14} style={{ color: '#7dd3fc', flexShrink: 0 }} />
                  <span style={{ fontSize: '13px', color: '#8899aa', whiteSpace: 'nowrap' }}>Add another file</span>
                </div>

                <div className="field">
                  <span className="field-label">Deck Name</span>
                  <input 
                    type="text" 
                    placeholder="e.g. Cardiology, Week 3" 
                    value={deckName}
                    onChange={e => setDeckName(e.target.value)}
                  />
                  <div style={{ fontSize: '12px', color: '#8899aa', marginTop: '6px' }}>
                    This will be the name of the deck inside Anki.
                  </div>
                </div>

                <div className="field">
                  <span className="field-label">Card Types</span>
                  <div className="types">
                    {[
                      { id: 'basic', label: 'Basic Q&A', locked: false },
                      { id: 'cloze', label: 'Cloze', locked: isFree },
                      { id: 'image_occlusion', label: 'Image Occlusion', locked: isFree },
                    ].map(({ id, label, locked }) => (
                      <button
                        key={id}
                        className={`type-btn ${cardTypes.includes(id) ? 'on' : ''} ${locked ? 'opacity-50 cursor-not-allowed' : ''}`}
                        onClick={() => {
                          if (locked) {
                            navigate('/#pricing');
                            return;
                          }
                          setCardTypes(prev => prev.includes(id) ? (prev.length > 1 ? prev.filter(t => t !== id) : prev) : [...prev, id]);
                        }}
                      >
                        {label}
                        {locked && <span className="ml-2 text-[10px] bg-white/10 px-1.5 py-0.5 rounded uppercase">Pro</span>}
                      </button>
                    ))}
                  </div>
                </div>

                {errorMessage && (
                  <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-200 text-sm flex items-center gap-2">
                    <AlertCircle size={16} /> {errorMessage}
                  </div>
                )}

                <button 
                  className="gen-btn"
                  onClick={handleExtractImages}
                  disabled={status === 'extracting' || !files.length || !deckName.trim() || !cardTypes.length}
                >
                  {status === 'extracting' ? (
                    <><Loader2 className="animate-spin" size={18} /> Extracting...</>
                  ) : !user && localStorage.getItem('guestDeckUsed') === 'true' ? (
                    <>Sign in to Generate <ArrowRight size={18} /></>
                  ) : (
                    <>Generate Anki Deck <ArrowRight size={18} /></>
                  )}
                </button>

                <div className="trust">
                  <div className="trust-item"><Lock size={12} /> Secure</div>
                  <div className="trust-item"><Zap size={12} /> Under 60s</div>
                  <div className="trust-item"><Download size={12} /> .apkg download</div>
                </div>
              </div>
            )}

            {/* ── IMAGE PICKER ── */}
            {step === 'imagePicker' && (
              <div key="imagePicker" className="fade-in">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="deck-card-title">Select Images</div>
                    <div className="deck-card-sub">Choose diagrams for occlusion cards</div>
                  </div>
                  <span className="text-xs font-semibold px-2 py-1 rounded-full bg-[rgba(125,211,252,0.1)] text-[#7dd3fc]">
                    {selectedImageNames.length} selected
                  </span>
                </div>

                <div 
                  className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6 max-h-[420px] overflow-y-auto p-4"
                  style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(125,211,252,0.2) transparent',
                    borderRadius: '24px',
                    background: 'var(--surface)',
                    border: '1px solid rgba(125,211,252,0.18)'
                  }}
                >
                  {extractedImages.map((img) => {
                    const isSelected = selectedImageNames.includes(img.name);
                    return (
                      <div
                        key={img.name}
                        onClick={() => setSelectedImageNames(prev => 
                          prev.includes(img.name) ? prev.filter(n => n !== img.name) : [...prev, img.name]
                        )}
                        className={`relative cursor-pointer rounded-xl overflow-hidden border-2 transition-all bg-[#131820]
                          ${isSelected
                            ? 'border-[#7dd3fc] shadow-[0_0_15px_rgba(125,211,252,0.15)]'
                            : 'border-[rgba(255,255,255,0.05)] hover:border-[rgba(125,211,252,0.3)]'}`}
                      >
                        <div className="aspect-video flex items-center justify-center">
                          <img
                            src={`/api/image/${sessionId}/${encodeURIComponent(img.name)}`}
                            alt={img.name}
                            className="w-full h-full object-contain"
                            loading="lazy"
                            decoding="async"
                          />
                        </div>
                        {isSelected && (
                          <div className="absolute top-2 right-2 bg-[#7dd3fc] text-[#07090f] rounded-full p-0.5">
                            <CheckCircle size={14} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {errorMessage && (
                  <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-200 text-sm flex items-center gap-2">
                    <AlertCircle size={16} /> {errorMessage}
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  <button
                    onClick={handleDetectLabels}
                    disabled={selectedImageNames.length === 0 || status === 'detecting'}
                    className="gen-btn"
                  >
                    {status === 'detecting' ? (
                      <><Loader2 className="animate-spin" size={18} /> Detecting Labels...</>
                    ) : (
                      <>Detect Labels with AI <Zap size={18} /></>
                    )}
                  </button>
                  <button
                    onClick={() => handleGenerate(sessionId, null)}
                    disabled={status === 'detecting'}
                    className="w-full py-3 rounded-xl font-medium text-[#8899aa] border border-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.03)] transition-all text-sm"
                  >
                    Skip Images & Generate Deck
                  </button>
                </div>
              </div>
            )}

            {/* ── GENERATING ── */}
            {step === 'generating' && (
              <LoadingScreen status={status} />
            )}

            {/* ── COMPLETE ── */}
            {step === 'complete' && (
              <div key="complete" className="fade-in">
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-[rgba(125,211,252,0.1)] text-[#7dd3fc] rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_20px_rgba(125,211,252,0.15)]">
                    <CheckCircle size={32} />
                  </div>
                  <h2 className="text-3xl font-bold mb-2 text-[#eef6ff]">Your deck is ready!</h2>
                  <p className="text-[#8899aa] mb-8 text-sm">Generated {fileName} · {cardCount} cards</p>
                  
                  <div className="flex flex-col gap-3 max-w-xs mx-auto mb-10">
                    <button
                      onClick={() => {
                        const link = document.createElement('a');
                        link.href = downloadUrl!;
                        link.download = fileName;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      }}
                      className="gen-btn"
                    >
                      <Download size={20} /> Download .apkg
                    </button>
                    <button
                      onClick={reset}
                      className="w-full py-3 rounded-xl font-medium text-[#8899aa] border border-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.03)] transition-all text-sm"
                    >
                      Create Another Deck
                    </button>
                  </div>

                  <div className="pt-6 border-t border-[rgba(255,255,255,0.05)]">
                    <p className="text-xs text-[#8899aa] mb-4 font-medium uppercase tracking-wider">Spread the word!</p>
                    <div className="flex flex-wrap gap-2 justify-center">
                      <button onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(`I just generated ${cardCount} Anki flashcards from my lecture using Ankit — try it free! ${window.location.origin}`)}`, '_blank')} className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#1da1f2]/10 text-[#1da1f2] hover:bg-[#1da1f2]/20 transition-colors text-xs font-medium">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                        Twitter/X
                      </button>
                      <button onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`I just generated ${cardCount} Anki flashcards from my lecture using Ankit — try it free! ${window.location.origin}`)}`, '_blank')} className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#25d366]/10 text-[#25d366] hover:bg-[#25d366]/20 transition-colors text-xs font-medium">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                        WhatsApp
                      </button>
                      <button onClick={() => window.open(`https://www.reddit.com/submit?url=${encodeURIComponent(window.location.origin)}&title=${encodeURIComponent(`I just generated ${cardCount} Anki flashcards from my lecture using Ankit — try it free!`)}`, '_blank')} className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#ff4500]/10 text-[#ff4500] hover:bg-[#ff4500]/20 transition-colors text-xs font-medium">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.688-.561-1.249-1.249-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>
                        Reddit
                      </button>
                      <button onClick={() => { navigator.clipboard.writeText(`I just generated ${cardCount} Anki flashcards from my lecture using Ankit — try it free! ${window.location.origin}`); alert('Copied to clipboard!'); }} className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/5 text-[#8899aa] hover:bg-white/10 hover:text-[#eef6ff] transition-colors text-xs font-medium">
                        <Link size={14} />
                        Copy Link
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

        </div>
              </>
            )}

            {/* Label Editor Overlay */}
            {step === 'labelEditor' && selectedImageNames.length > 0 && (
              <LabelEditorStep
                images={selectedImageNames.map(name => ({
                  name,
                  src: `/api/image/${sessionId}/${encodeURIComponent(name)}`,
                  initialLabels: detectedLabelsMap[name] || []
                }))}
                onSave={(allLabels) => { handleGenerate(sessionId, allLabels); }}
                onBack={() => { setStep('imagePicker'); setStatus('idle'); }}
              />
            )}
      </section>

      <div className="rule"></div>

      <PreviewSection />

      <div className="rule"></div>

      <section className="section" id="how">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
          <div className="section-tag">How it works</div>
          <div className="section-h">Three steps</div>
        </motion.div>
        <motion.div 
          className="steps"
          initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.1 }}
        >
          <div className="step">
            <span className="step-n">01</span>
            <div className="step-title">Upload your file</div>
            <div className="step-desc">PDF or PPTX. Upload multiple files at once. Text and images extracted automatically.</div>
          </div>
          <div className="step">
            <span className="step-n">02</span>
            <div className="step-title">Choose card types</div>
            <div className="step-desc">Basic, Cloze, or Image Occlusion. Pick what works for your content.</div>
          </div>
          <div className="step">
            <span className="step-n">03</span>
            <div className="step-title">Import to Anki</div>
            <div className="step-desc">Download the .apkg file and import directly into Anki desktop or mobile.</div>
          </div>
        </motion.div>
      </section>

      <div className="rule"></div>

      <section className="section" id="features">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
          <div className="section-tag">Features</div>
          <div className="section-h">Built for serious students</div>
        </motion.div>
        <motion.div 
          className="features"
          initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.1 }}
        >
          <div className="feat">
            <div className="feat-icon"><Zap size={18} /></div>
            <div className="feat-title">Understands your content</div>
            <div className="feat-desc">Generates cards that test mechanisms and understanding, not just definitions.</div>
          </div>
          <div className="feat">
            <div className="feat-icon"><ImageIcon size={18} /></div>
            <div className="feat-title">Image Occlusion</div>
            <div className="feat-desc">Detects every label on anatomy diagrams and creates one card per structure.</div>
          </div>
          <div className="feat">
            <div className="feat-icon"><FileText size={18} /></div>
            <div className="feat-title">Cloze Deletions</div>
            <div className="feat-desc">Proper Anki cloze syntax generated automatically. Only key terms are hidden.</div>
          </div>
          <div className="feat">
            <div className="feat-icon"><Download size={18} /></div>
            <div className="feat-title">Native .apkg export</div>
            <div className="feat-desc">A proper Anki package with all media included. One click to import.</div>
          </div>
          <div className="feat">
            <div className="feat-icon"><div className="w-3 h-3 rounded-full bg-current"></div></div>
            <div className="feat-title">Dark card theme</div>
            <div className="feat-desc">Cards come styled with a dark theme and color-coded key terms.</div>
          </div>
          <div className="feat">
            <div className="feat-icon"><Zap size={18} /></div>
            <div className="feat-title">Under 60 seconds</div>
            <div className="feat-desc">Full deck generation including text, images and occlusion in under a minute.</div>
          </div>
        </motion.div>
      </section>

      <div className="rule"></div>

      <section className="section" id="pricing">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
          <div className="section-tag">Pricing</div>
          <div className="section-h">Simple, transparent plans</div>
        </motion.div>
        
        <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {/* Free Plan */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="p-8 rounded-3xl bg-[var(--surface)] border border-[var(--border)] relative overflow-hidden group flex flex-col"
          >
            <div className="mb-6">
              <h3 className="text-xl font-bold mb-2">Free</h3>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-extrabold">$0</span>
                <span className="text-[#8899aa] text-sm">/month</span>
              </div>
            </div>
            <ul className="space-y-4 mb-8 flex-grow">
              <li className="flex items-center gap-3 text-sm text-[#8899aa]">
                <CheckCircle size={16} className="text-[var(--accent)]" /> 3 decks every week
              </li>
              <li className="flex items-center gap-3 text-sm text-[#8899aa]">
                <CheckCircle size={16} className="text-[var(--accent)]" /> Basic Q&A cards only
              </li>
              <li className="flex items-center gap-3 text-sm text-[#8899aa]">
                <CheckCircle size={16} className="text-[var(--accent)]" /> Max 1 file per upload
              </li>
              <li className="flex items-center gap-3 text-sm text-[#8899aa] opacity-50">
                <div className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px]">×</div> No deck history
              </li>
            </ul>
            <button className="w-full py-3 rounded-xl border border-[var(--border)] text-sm font-bold text-[#8899aa] cursor-default">
              Current Plan
            </button>
          </motion.div>

          {/* Pro Plan */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }}
            className="p-8 rounded-3xl bg-[var(--surface2)] border border-[var(--accent)]/30 relative overflow-hidden group flex flex-col"
          >
            <div className="absolute top-4 right-4 px-3 py-1 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] text-[10px] font-bold uppercase tracking-wider">
              Popular
            </div>
            <div className="mb-6">
              <h3 className="text-xl font-bold mb-2">Pro</h3>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-extrabold">$5</span>
                <span className="text-[#8899aa] text-sm">/month</span>
              </div>
            </div>
            <ul className="space-y-4 mb-8 flex-grow">
              <li className="flex items-center gap-3 text-sm text-[#eef6ff]">
                <CheckCircle size={16} className="text-[var(--accent)]" /> 30 decks every month
              </li>
              <li className="flex items-center gap-3 text-sm text-[#eef6ff]">
                <CheckCircle size={16} className="text-[var(--accent)]" /> Basic + Cloze + Occlusion
              </li>
              <li className="flex items-center gap-3 text-sm text-[#eef6ff]">
                <CheckCircle size={16} className="text-[var(--accent)]" /> Up to 5 files per upload
              </li>
              <li className="flex items-center gap-3 text-sm text-[#eef6ff]">
                <CheckCircle size={16} className="text-[var(--accent)]" /> Deck history + re-download
              </li>
            </ul>
            <button className="w-full py-3 rounded-xl bg-[var(--accent)] text-[#07090f] text-sm font-extrabold hover:opacity-90 transition-all shadow-[0_8px_20px_rgba(56,189,248,0.2)]">
              Upgrade to Pro
            </button>
          </motion.div>

          {/* Max Plan */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }}
            className="p-8 rounded-3xl bg-[var(--surface)] border border-white/10 relative overflow-hidden group flex flex-col"
          >
            <div className="mb-6">
              <h3 className="text-xl font-bold mb-2">Max</h3>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-extrabold">$13</span>
                <span className="text-[#8899aa] text-sm">/month</span>
              </div>
            </div>
            <ul className="space-y-4 mb-8 flex-grow">
              <li className="flex items-center gap-3 text-sm text-[#eef6ff]">
                <CheckCircle size={16} className="text-white" /> Everything in Pro
              </li>
              <li className="flex items-center gap-3 text-sm text-[#eef6ff]">
                <CheckCircle size={16} className="text-white" /> Unlimited decks
              </li>
              <li className="flex items-center gap-3 text-sm text-[#eef6ff]">
                <CheckCircle size={16} className="text-white" /> Up to 10 files per upload
              </li>
              <li className="flex items-center gap-3 text-sm text-[#eef6ff]">
                <CheckCircle size={16} className="text-white" /> Priority processing
              </li>
              <li className="flex items-center gap-3 text-sm text-[#eef6ff]">
                <CheckCircle size={16} className="text-white" /> Early access to features
              </li>
            </ul>
            <button className="w-full py-3 rounded-xl bg-white text-[#07090f] text-sm font-extrabold hover:opacity-90 transition-all">
              Go Max
            </button>
          </motion.div>
        </div>
      </section>

      <footer className="bg-[#05060a] pt-20 pb-10 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-12 mb-16">
            {/* Logo & Slogan Column */}
            <div className="lg:col-span-2">
              <a href="/" className="logo mb-6 block" style={{ fontSize: '24px', textDecoration: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 800, letterSpacing: '-0.5px', color: '#eef6ff' }}>
                  <div style={{ position: 'relative', width: '30px', height: '22px', flexShrink: 0 }}>
                    <div style={{ position: 'absolute', width: '22px', height: '15px', background: 'rgba(125,211,252,0.2)', border: '1px solid rgba(125,211,252,0.4)', borderRadius: '4px', top: 0, left: '7px' }} />
                    <div style={{ position: 'absolute', width: '22px', height: '15px', background: '#131820', border: '1px solid rgba(125,211,252,0.6)', borderRadius: '4px', bottom: 0, left: 0 }}>
                      <div style={{ position: 'absolute', top: '4px', left: '4px', right: '4px', height: '2px', borderRadius: '1px', background: 'rgba(125,211,252,0.5)' }} />
                    </div>
                  </div>
                  Ankit
                </div>
              </a>
              <p className="text-[#8899aa] text-[11px] font-bold uppercase tracking-[0.2em] leading-relaxed max-w-xs">
                AI-Powered Flashcards for Serious Students
              </p>
            </div>

            {/* Links Columns */}
            <div>
              <h4 className="text-[#eef6ff] text-[11px] font-bold uppercase tracking-[0.2em] mb-6">Product</h4>
              <ul className="space-y-4">
                <li><a href="#features" className="text-[#8899aa] hover:text-sky-400 text-[11px] uppercase tracking-wider transition-colors">Features</a></li>
                <li><a href="#pricing" className="text-[#8899aa] hover:text-sky-400 text-[11px] uppercase tracking-wider transition-colors">Pricing</a></li>
                <li><a href="#faq" className="text-[#8899aa] hover:text-sky-400 text-[11px] uppercase tracking-wider transition-colors">FAQ</a></li>
              </ul>
            </div>

            <div>
              <h4 className="text-[#eef6ff] text-[11px] font-bold uppercase tracking-[0.2em] mb-6">Legal</h4>
              <ul className="space-y-4">
                <li><a href="/terms" className="text-[#8899aa] hover:text-sky-400 text-[11px] uppercase tracking-wider transition-colors">Terms of Service</a></li>
                <li><a href="/privacy" className="text-[#8899aa] hover:text-sky-400 text-[11px] uppercase tracking-wider transition-colors">Privacy Policy</a></li>
              </ul>
            </div>

            <div>
              <h4 className="text-[#eef6ff] text-[11px] font-bold uppercase tracking-[0.2em] mb-6">Support</h4>
              <ul className="space-y-4">
                <li><a href="mailto:support@ankit.study" className="text-[#8899aa] hover:text-sky-400 text-[11px] uppercase tracking-wider transition-colors">Contact Us</a></li>
                <li><a href="/#faq" className="text-[#8899aa] hover:text-sky-400 text-[11px] uppercase tracking-wider transition-colors">Help Center</a></li>
              </ul>
            </div>
          </div>

          <div className="h-px bg-white/5 w-full mb-12"></div>

          <div className="flex flex-col items-center">
            <div className="flex gap-4 mb-8">
              {[Twitter, Github, Linkedin].map((Icon, i) => (
                <a 
                  key={i} 
                  href="#" 
                  className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center text-[#8899aa] hover:border-sky-400 hover:text-sky-400 transition-all"
                >
                  <Icon size={18} />
                </a>
              ))}
            </div>
            <p className="text-[11px] text-[#8899aa]/50 uppercase tracking-[0.2em]">© 2026 Ankit. All rights reserved.</p>
          </div>
        </div>
      </footer>

      <AnimatePresence>
        {showSignUpModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: '20px'
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              style={{
                background: 'var(--surface)',
                border: '1px solid rgba(125,211,252,0.18)',
                borderRadius: '24px',
                padding: '36px',
                width: '100%',
                maxWidth: '400px',
                position: 'relative'
              }}
            >
              <button 
                onClick={() => setShowSignUpModal(false)}
                style={{ position: 'absolute', top: '20px', right: '20px', color: 'var(--muted2)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
              
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text)', marginBottom: '8px' }}>You're 1 deck in</h2>
                <p style={{ color: 'var(--muted2)', fontSize: '14px' }}>Sign up free to get 3 decks every week</p>
              </div>

              <button 
                onClick={async () => {
                  try {
                    await signInWithGoogle();
                    setShowSignUpModal(false);
                  } catch (err: any) {
                    setAuthError(err.message);
                  }
                }}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: 'white',
                  color: 'black',
                  borderRadius: '12px',
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  marginBottom: '20px'
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                Continue with Google
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
                <span style={{ color: 'var(--muted2)', fontSize: '12px' }}>or</span>
                <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
              </div>

              <form onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const cred = await createUserWithEmailAndPassword(auth, email, password);
                  if (name) {
                    await updateProfile(cred.user, { displayName: name });
                    await cred.user.reload();
                  }
                  
                  // Create user document in Firestore
                  const userRef = doc(db, 'users', cred.user.uid);
                  const docSnap = await getDoc(userRef);
                  
                  if (!docSnap.exists()) {
                    await setDoc(userRef, {
                      email: cred.user.email,
                      displayName: name || cred.user.displayName,
                      isAdmin: false,
                      decksUsedThisMonth: 0,
                      createdAt: serverTimestamp(),
                      lastLogin: serverTimestamp(),
                      periodStart: serverTimestamp()
                    });
                    // Update local usage state for new user
                    const now = new Date();
                    const nextMonday = new Date(now);
                    nextMonday.setDate(now.getDate() + (1 + 7 - now.getDay()) % 7 || 7);
                    nextMonday.setHours(0, 0, 0, 0);
                    setUsage({ used: 0, limit: 3, resetsOn: nextMonday });
                  }
                  
                  setShowSignUpModal(false);
                } catch (err: any) {
                  setAuthError(err.message);
                }
              }}>
                <div className="field" style={{ marginBottom: '12px' }}>
                  <input 
                    type="text" 
                    placeholder="Full name (optional)" 
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                </div>
                <div className="field" style={{ marginBottom: '12px' }}>
                  <input 
                    type="email" 
                    placeholder="Email address" 
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="field" style={{ marginBottom: '20px' }}>
                  <input 
                    type="password" 
                    placeholder="Password" 
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                  />
                </div>
                {authError && <div style={{ color: '#ef4444', fontSize: '12px', marginBottom: '12px' }}>{authError}</div>}
                <button type="submit" className="gen-btn" style={{ width: '100%' }}>
                  Sign up
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
        {showLimitModal && (
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
            onClick={() => setShowLimitModal(false)}
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
              <div style={{ 
                padding: '16px 24px', 
                background: 'rgba(255,255,255,0.02)', 
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <span style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--muted2)' }}>
                  Limit Reached
                </span>
                <button onClick={() => setShowLimitModal(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>
                  <X size={16} />
                </button>
              </div>

              <div style={{ padding: '32px', textAlign: 'center' }}>
                <div style={{ 
                  width: '56px', height: '56px', borderRadius: '16px', background: 'rgba(125, 211, 252, 0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', color: 'var(--accent)'
                }}>
                  <Zap size={28} />
                </div>
                
                <h2 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text)', marginBottom: '12px', letterSpacing: '-0.5px' }}>
                  You've used your free decks
                </h2>
                <p style={{ color: 'var(--muted2)', fontSize: '14px', lineHeight: '1.6', marginBottom: '32px', fontWeight: 500 }}>
                  You've reached your weekly limit of 3 decks. Upgrade to Pro for unlimited generation and priority processing.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <button 
                    onClick={() => {
                      setShowLimitModal(false);
                      document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    style={{
                      width: '100%', padding: '14px', background: 'var(--accent)', color: '#07090f',
                      borderRadius: '12px', fontWeight: 800, border: 'none', cursor: 'pointer', fontSize: '14px',
                      boxShadow: '0 8px 20px rgba(56, 189, 248, 0.2)'
                    }}
                  >
                    View Pricing Plans
                  </button>
                  <button 
                    onClick={() => setShowLimitModal(false)}
                    style={{
                      width: '100%', padding: '12px', background: 'transparent', color: 'var(--muted2)',
                      borderRadius: '12px', fontWeight: 600, border: '1px solid var(--border)', cursor: 'pointer', fontSize: '13px'
                    }}
                  >
                    Maybe later
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
