import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, X, Loader2, Download, CheckCircle, AlertCircle, Lock, Zap, ArrowRight, Image as ImageIcon, History } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import LabelEditorStep, { Label } from '../components/LabelEditorStep';
import AuthButton from '../components/AuthButton';
import DeckHistory from '../components/DeckHistory';
import { useAuth } from '../contexts/AuthContext';
import { saveDeckHistory } from '../services/firestoreService';
import { getUsage } from '../services/deckHistoryService';
import { signInWithPopup, createUserWithEmailAndPassword } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';

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

const LoadingScreen = () => {
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
    <div key="generating" className="text-center py-12 fade-in">
      <Loader2 className="animate-spin mx-auto mb-8 text-[var(--accent)]" size={56} />
      <h2 className="text-2xl font-bold mb-3 text-[#eef6ff] transition-all duration-500">
        {steps[loadingStep]}
      </h2>
      <p className="text-[#8899aa] text-sm">This usually takes under 60 seconds.</p>
      
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
  const [cardTypes, setCardTypes] = useState<string[]>(['basic', 'cloze']);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sessionId, setSessionId] = useState<string>('');
  const [extractedImages, setExtractedImages] = useState<ExtractedImage[]>([]);
  const [selectedImageNames, setSelectedImageNames] = useState<string[]>([]);
  const [step, setStep] = useState<Step>('upload');
  const [detectedLabelsMap, setDetectedLabelsMap] = useState<Record<string, Label[]>>({});
  const [showHistory, setShowHistory] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [showSignUpModal, setShowSignUpModal] = useState(false);
  const [usage, setUsage] = useState<{ used: number, limit: number, resetsOn: Date } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const { user, getIdToken } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      getUsage(user.uid).then(setUsage).catch(console.error);
    } else {
      setUsage(null);
    }
  }, [user]);

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
    setFiles(prev => [...prev, ...newFiles].slice(0, 5));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const newFiles = (Array.from(e.dataTransfer.files) as File[])
      .filter((f: File) => f.name.endsWith('.pptx') || f.name.endsWith('.pdf'))
      .map((f: File) => ({ file: f, id: Math.random().toString(36).substring(7) }));
    setFiles(prev => [...prev, ...newFiles].slice(0, 5));
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
        setErrorMessage(`You've used all 10 free decks this month. Resets on ${usage?.resetsOn ? new Date(usage.resetsOn).toLocaleDateString() : 'the 1st of next month'}.`);
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
        setErrorMessage(`You've used all 10 free decks this month. Resets on ${usage?.resetsOn ? new Date(usage.resetsOn).toLocaleDateString() : 'the 1st of next month'}.`);
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

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      setDownloadUrl(url);

      const cd = response.headers.get('Content-Disposition');
      const cardCountStr = response.headers.get('X-Card-Count');
      const cardCount = cardCountStr ? parseInt(cardCountStr, 10) : 0;

      const safeName = deckName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'My Deck';
      let name = `${safeName}.apkg`;
      if (cd) {
        const match = cd.match(/filename="?([^"]+)"?/);
        if (match?.[1]) name = match[1];
      }
      setFileName(name);
      
      if (user) {
        await saveDeckHistory(user.uid, {
          deckName: safeName,
          cardCount,
          fileName: name
        });
        getUsage(user.uid).then(setUsage).catch(console.error);
      } else {
        localStorage.setItem('guestDeckUsed', 'true');
      }

      setStep('complete');
      setStatus('idle');
    } catch (error: any) {
      clearInterval(ticker);
      setStatus('error');
      
      if (error.status === 429) {
        setErrorMessage(`You've used all 10 free decks this month. Resets on ${usage?.resetsOn ? new Date(usage.resetsOn).toLocaleDateString() : 'the 1st of next month'}.`);
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '18px', fontWeight: 800, letterSpacing: '-0.5px', color: '#eef6ff' }}>
            <div style={{ position: 'relative', width: '26px', height: '20px', flexShrink: 0 }}>
              <div style={{ position: 'absolute', width: '20px', height: '14px', background: 'rgba(125,211,252,0.2)', border: '1px solid rgba(125,211,252,0.4)', borderRadius: '4px', top: 0, left: '6px' }} />
              <div style={{ position: 'absolute', width: '20px', height: '14px', background: '#131820', border: '1px solid rgba(125,211,252,0.6)', borderRadius: '4px', bottom: 0, left: 0 }}>
                <div style={{ position: 'absolute', top: '4px', left: '4px', right: '4px', height: '2px', borderRadius: '1px', background: 'rgba(125,211,252,0.5)' }} />
              </div>
            </div>
            Card it
          </div>
        </a>
        <div className="nav-links flex items-center gap-6">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          {user && (
            <button 
              onClick={() => setShowHistory(!showHistory)} 
              className={`flex items-center gap-2 text-sm font-medium transition-colors ${showHistory ? 'text-[#7dd3fc]' : 'text-[#8899aa] hover:text-[#eef6ff]'}`}
            >
              <History size={16} /> History
            </button>
          )}
          {!user && (
            <a href="/auth" className="text-[13px] font-medium text-[#8899aa] hover:text-[#eef6ff] transition-colors">
              Log in
            </a>
          )}
          <AuthButton />
        </div>
      </nav>

      {showHistory ? (
        <section className="max-w-6xl mx-auto px-6 py-12">
          <DeckHistory />
        </section>
      ) : (
        <>
          <section className="hero">
            {step !== 'labelEditor' && (
              <>
                <h1>Turn your lectures into<br/><span className="icy">Anki flashcards</span></h1>
                <p className="hero-sub">Upload a PDF or PPTX and get a complete Anki deck in under a minute.</p>

                <div className="deck-card">
                  {/* ── UPLOAD FORM ── */}
            {step === 'upload' && (
              <div key="upload" className="fade-in">
                <div className="deck-card-title">Create your deck</div>
                <div className="deck-card-sub">Upload your lecture and we'll do the rest</div>

                <div 
                  className="upload-zone"
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                >
                  <input ref={fileInputRef} type="file" onChange={handleFileChange} className="hidden" multiple accept=".pptx,.pdf" />
                  <div className="upload-zone-icon">
                    <Upload size={22} />
                  </div>
                  <h3>Select your lecture file</h3>
                  <p>or drag and drop — <span>PDF</span> or <span>PPTX</span></p>
                </div>

                {files.map(f => (
                  <div key={f.id} className="file-row">
                    <div className="file-row-icon">
                      <FileText size={16} />
                    </div>
                    <div className="file-row-info">
                      <div className="file-row-name">{f.file.name}</div>
                      <div className="file-row-size">{(f.file.size / 1024 / 1024).toFixed(2)} MB</div>
                    </div>
                    <div className="file-row-x" onClick={() => removeFile(f.id)}>
                      <X size={16} />
                    </div>
                  </div>
                ))}

                <div className="field">
                  <span className="field-label">Deck Name</span>
                  <input 
                    type="text" 
                    placeholder="e.g. Cardiology, Week 3" 
                    value={deckName}
                    onChange={e => setDeckName(e.target.value)}
                  />
                </div>

                <div className="field">
                  <span className="field-label">Card Types</span>
                  <div className="types">
                    {[
                      { id: 'basic', label: 'Basic Q&A' },
                      { id: 'cloze', label: 'Cloze' },
                      { id: 'image_occlusion', label: 'Image Occlusion' },
                    ].map(({ id, label }) => (
                      <button
                        key={id}
                        className={`type-btn ${cardTypes.includes(id) ? 'on' : ''}`}
                        onClick={() => setCardTypes(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])}
                      >
                        {label}
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
                  disabled={status === 'extracting' || !files.length || !deckName.trim() || !cardTypes.length || (user && usage?.used !== undefined && usage.used >= usage.limit)}
                >
                  {status === 'extracting' ? (
                    <><Loader2 className="animate-spin" size={18} /> Extracting...</>
                  ) : !user && localStorage.getItem('guestDeckUsed') === 'true' ? (
                    <>Sign in to Generate <ArrowRight size={18} /></>
                  ) : (
                    <>Generate My Deck <ArrowRight size={18} /></>
                  )}
                </button>
                {user && usage && usage.used >= usage.limit ? (
                  <div style={{ color: 'var(--muted2)', fontSize: '12px', textAlign: 'center', marginTop: '8px' }}>
                    You've used all {usage.limit} free decks this month. Resets on {new Date(usage.resetsOn).toLocaleDateString()}.
                  </div>
                ) : user && usage ? (
                  <div style={{ color: 'var(--muted2)', fontSize: '12px', textAlign: 'center', marginTop: '8px' }}>
                    {usage.used} of {usage.limit} decks used this month
                  </div>
                ) : null}

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
              <LoadingScreen />
            )}

            {/* ── COMPLETE ── */}
            {step === 'complete' && (
              <div key="complete" className="text-center py-4 fade-in">
                <div className="w-16 h-16 bg-[rgba(125,211,252,0.1)] text-[#7dd3fc] rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_20px_rgba(125,211,252,0.15)]">
                  <CheckCircle size={32} />
                </div>
                <h2 className="text-2xl font-bold mb-2 text-[#eef6ff]">Deck Ready!</h2>
                <p className="text-[#8899aa] mb-8">Generated "{fileName}"</p>
                <div className="flex flex-col gap-3">
                  <a
                    href={downloadUrl}
                    download={fileName}
                    className="gen-btn"
                  >
                    <Download size={20} /> Download .apkg
                  </a>
                  <button
                    onClick={reset}
                    className="w-full py-3 rounded-xl font-medium text-[#8899aa] border border-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.03)] transition-all text-sm"
                  >
                    Create Another Deck
                  </button>
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
            <div className="step-desc">PDF or PPTX. Up to 5 files. Text and images extracted automatically.</div>
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

      <footer>
        <a href="/" className="logo" style={{ fontSize: '15px', textDecoration: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontWeight: 800, letterSpacing: '-0.5px', color: '#eef6ff' }}>
            <div style={{ position: 'relative', width: '22px', height: '16px', flexShrink: 0 }}>
              <div style={{ position: 'absolute', width: '16px', height: '11px', background: 'rgba(125,211,252,0.2)', border: '1px solid rgba(125,211,252,0.4)', borderRadius: '3px', top: 0, left: '5px' }} />
              <div style={{ position: 'absolute', width: '16px', height: '11px', background: '#131820', border: '1px solid rgba(125,211,252,0.6)', borderRadius: '3px', bottom: 0, left: 0 }}>
                <div style={{ position: 'absolute', top: '3px', left: '3px', right: '3px', height: '2px', borderRadius: '1px', background: 'rgba(125,211,252,0.5)' }} />
              </div>
            </div>
            Card it
          </div>
        </a>
        <p>Made for students who take studying seriously.</p>
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
                <p style={{ color: 'var(--muted2)', fontSize: '14px' }}>Sign up free to get 10 decks every month</p>
              </div>

              <button 
                onClick={async () => {
                  try {
                    await signInWithPopup(auth, googleProvider);
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
                  await createUserWithEmailAndPassword(auth, email, password);
                  setShowSignUpModal(false);
                } catch (err: any) {
                  setAuthError(err.message);
                }
              }}>
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
      </AnimatePresence>
        </>
      )}
    </>
  );
}
