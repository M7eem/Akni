import React, { useState, useRef } from 'react';
import { Upload, FileText, X, Loader2, Download, CheckCircle, AlertCircle, Lock, Zap, ArrowRight, Image as ImageIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import LabelEditorStep, { Label } from './components/LabelEditorStep';

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

export default function App() {
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
  const safeFetch = async (url: string, options: RequestInit) => {
    const response = await fetch(url, options);
    if (!response.ok) {
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        throw new Error(json.error || json.details || `Server error ${response.status}`);
      } catch {
        throw new Error(`Server error ${response.status} — check Railway logs`);
      }
    }
    return response;
  };

  // ── Step 1: Extract images (names only — no base64) ────────
  const handleExtractImages = async () => {
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
    } catch (error) {
      setStatus('error');
      setErrorMessage((error as Error).message);
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
    } catch (error) {
      setStatus('error');
      setErrorMessage((error as Error).message);
    }
  };

  // ── Step 3: Generate deck ────────────────────────────────────
  const handleGenerate = async (
    currentSessionId: string = sessionId,
    occlusionData: { imageName: string; labels: Label[] }[] | null = null
  ) => {
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
      let name = `${deckName.replace(/[^a-z0-9]/gi, '_')}.apkg`;
      if (cd) {
        const match = cd.match(/filename="?([^"]+)"?/);
        if (match?.[1]) name = match[1];
      }
      setFileName(name);
      setStep('complete');
      setStatus('idle');
    } catch (error) {
      clearInterval(ticker);
      setStatus('error');
      setErrorMessage((error as Error).message);
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

      <nav>
        <a href="/" className="logo"><div className="logo-dot"></div>iLoveAnki</a>
        <div className="nav-links">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-label">Flashcard Generator</div>
        <h1>Turn your lectures into<br/><span className="icy">Anki flashcards</span></h1>
        <p className="hero-sub">Upload a PDF or PPTX and get a complete Anki deck in under a minute.</p>

        <div className="deck-card" style={{ maxWidth: step === 'imagePicker' ? '800px' : '520px', transition: 'max-width 0.3s' }}>
          <AnimatePresence mode="wait">
            
            {/* ── UPLOAD FORM ── */}
            {step === 'upload' && (
              <motion.div key="upload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
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
                    placeholder="e.g. Basal Ganglia, Week 4" 
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
                  disabled={!files.length || !deckName.trim() || !cardTypes.length || status === 'extracting'}
                >
                  {status === 'extracting' ? (
                    <><Loader2 className="animate-spin" size={18} /> Extracting...</>
                  ) : (
                    <>Generate My Deck <ArrowRight size={18} /></>
                  )}
                </button>

                <div className="trust">
                  <div className="trust-item"><Lock size={12} /> Secure</div>
                  <div className="trust-item"><Zap size={12} /> Under 60s</div>
                  <div className="trust-item"><Download size={12} /> .apkg download</div>
                </div>
              </motion.div>
            )}

            {/* ── IMAGE PICKER ── */}
            {step === 'imagePicker' && (
              <motion.div key="imagePicker" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="deck-card-title">Select Images</div>
                    <div className="deck-card-sub">Choose diagrams for occlusion cards</div>
                  </div>
                  <span className="text-xs font-semibold px-2 py-1 rounded-full bg-[rgba(125,211,252,0.1)] text-[#7dd3fc]">
                    {selectedImageNames.length} selected
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
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
              </motion.div>
            )}

            {/* ── GENERATING ── */}
            {step === 'generating' && (
              <motion.div key="generating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center py-8">
                <Loader2 className="animate-spin mx-auto mb-6 text-[#7dd3fc]" size={48} />
                <h2 className="text-xl font-bold mb-2 text-[#eef6ff]">
                  {status === 'generating' ? 'Generating flashcards...' : 'Building .apkg file...'}
                </h2>
                <p className="text-[#8899aa]">This usually takes under 60 seconds.</p>
              </motion.div>
            )}

            {/* ── COMPLETE ── */}
            {step === 'complete' && (
              <motion.div key="complete" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center py-4">
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
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </section>

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
        <a href="/" className="logo" style={{ fontSize: '15px' }}><div className="logo-dot"></div>iLoveAnki</a>
        <p>Made for students who take studying seriously.</p>
      </footer>
    </>
  );
}
