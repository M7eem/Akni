import React, { useState, useRef } from 'react';
import { Upload, FileText, X, Loader2, Download, CheckCircle, AlertCircle } from 'lucide-react';
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
  const [cardTypes, setCardTypes] = useState<string[]>(['basic']);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sessionId, setSessionId] = useState<string>('');
  const [extractedImages, setExtractedImages] = useState<ExtractedImage[]>([]);
  const [selectedImageName, setSelectedImageName] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('upload');
  const [detectedLabels, setDetectedLabels] = useState<Label[]>([]);

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

      if (data.images && data.images.length > 0) {
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

  // ── Step 2: Detect labels on selected image ─────────────────
  const handleDetectLabels = async () => {
    if (!selectedImageName || !sessionId) return;
    setStatus('detecting');
    setErrorMessage('');

    try {
      const response = await safeFetch('/api/detect-labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, imageName: selectedImageName })
      });
      const data = await response.json();
      setDetectedLabels(data.labels || []);
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
    occlusionData: { imageName: string; labels: Label[] } | null = null
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
    setCardTypes(['basic']);
    setStatus('idle');
    setDownloadUrl('');
    setErrorMessage('');
    setSessionId('');
    setExtractedImages([]);
    setSelectedImageName(null);
    setDetectedLabels([]);
    setStep('upload');
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans">
      <div className="max-w-3xl mx-auto px-6 py-12">

        {/* Header */}
        <header className="mb-12 text-center">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 text-white mb-6 shadow-lg shadow-indigo-200"
          >
            <FileText size={32} />
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl font-bold tracking-tight mb-3"
          >
            Anki Flashcard Generator
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-lg text-neutral-500 max-w-lg mx-auto"
          >
            Turn your lecture slides and PDFs into high-quality Anki flashcards instantly using AI.
          </motion.p>
        </header>

        <main>
          <AnimatePresence mode="wait">

            {/* ── COMPLETE ── */}
            {step === 'complete' && (
              <motion.div
                key="complete"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-8 text-center"
              >
                <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle size={32} />
                </div>
                <h2 className="text-2xl font-semibold mb-2">Your Deck is Ready!</h2>
                <p className="text-neutral-500 mb-8">Generated flashcards for "{deckName}"</p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <a
                    href={downloadUrl}
                    download={fileName}
                    className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
                  >
                    <Download className="mr-2" size={20} />
                    Download .apkg
                  </a>
                  <button
                    onClick={reset}
                    className="inline-flex items-center justify-center px-6 py-3 rounded-xl border border-neutral-200 text-neutral-700 font-medium hover:bg-neutral-50 transition-colors"
                  >
                    Create Another Deck
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── GENERATING ── */}
            {step === 'generating' && (
              <motion.div
                key="generating"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-8 text-center"
              >
                <Loader2 className="animate-spin mx-auto mb-6 text-indigo-600" size={48} />
                <h2 className="text-xl font-semibold mb-2">
                  {status === 'generating' ? 'Generating flashcards with AI...' : 'Building your .apkg file...'}
                </h2>
                <p className="text-neutral-500">This may take 20–60 seconds depending on file size.</p>
              </motion.div>
            )}

            {/* ── LABEL EDITOR ── */}
            {step === 'labelEditor' && selectedImageName && (
              <LabelEditorStep
                image={{
                  name: selectedImageName,
                  // Load image via endpoint using session — no base64 needed
                  src: `/api/image/${sessionId}/${encodeURIComponent(selectedImageName)}`
                }}
                initialLabels={detectedLabels}
                onSave={(labels) => { handleGenerate(sessionId, { imageName: selectedImageName, labels }); }}
                onBack={() => { setStep('imagePicker'); setStatus('idle'); }}
              />
            )}

            {/* ── IMAGE PICKER ── */}
            {step === 'imagePicker' && (
              <motion.div
                key="imagePicker"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <button
                      onClick={() => { setStep('upload'); setStatus('idle'); }}
                      className="text-sm text-neutral-500 hover:text-neutral-900 mb-1 block"
                    >
                      ← Back
                    </button>
                    <h2 className="text-2xl font-bold">Choose Images</h2>
                    <p className="text-neutral-500 text-sm">Found {extractedImages.length}. Select one for image occlusion.</p>
                  </div>
                  <span className={`text-sm font-semibold px-3 py-1 rounded-full ${selectedImageName ? 'bg-orange-500 text-white' : 'bg-neutral-200 text-neutral-600'}`}>
                    Selected: {selectedImageName ? '1' : '0'}/1
                  </span>
                </div>

                {/* Image grid — loads each image via /api/image endpoint */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {extractedImages.map((img) => {
                    const isSelected = selectedImageName === img.name;
                    return (
                      <div
                        key={img.name}
                        onClick={() => setSelectedImageName(prev => prev === img.name ? null : img.name)}
                        className={`relative cursor-pointer rounded-xl overflow-hidden border-2 transition-all bg-white
                          ${isSelected
                            ? 'border-teal-500 ring-4 ring-teal-500/20 scale-[1.02]'
                            : 'border-neutral-200 hover:border-teal-300'}`}
                      >
                        <div className="aspect-video bg-neutral-100 flex items-center justify-center">
                          <img
                            src={`/api/image/${sessionId}/${encodeURIComponent(img.name)}`}
                            alt={img.name}
                            className="w-full h-full object-contain bg-white"
                            loading="lazy"
                          />
                        </div>
                        {isSelected && (
                          <div className="absolute top-2 right-2 bg-teal-500 text-white rounded-full p-0.5">
                            <CheckCircle size={16} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {status === 'error' && (
                  <div className="p-4 rounded-xl bg-red-50 text-red-700 border border-red-100 flex items-start gap-3">
                    <AlertCircle className="flex-shrink-0 mt-0.5" size={20} />
                    <div>
                      <p className="font-medium">Error</p>
                      <p className="text-sm">{errorMessage}</p>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-3 pt-2">
                  <button
                    onClick={handleDetectLabels}
                    disabled={!selectedImageName || status === 'detecting'}
                    className={`w-full py-4 rounded-xl font-semibold text-lg flex items-center justify-center gap-3 transition-all
                      ${!selectedImageName || status === 'detecting'
                        ? 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
                        : 'bg-teal-500 text-white hover:bg-teal-600 hover:-translate-y-0.5'}`}
                  >
                    {status === 'detecting'
                      ? <><Loader2 className="animate-spin" size={20} /> Detecting labels...</>
                      : 'Cover Text with AI ✨'}
                  </button>
                  <button
                    onClick={() => handleGenerate(sessionId, null)}
                    disabled={status === 'detecting'}
                    className="w-full py-3 rounded-xl font-medium text-neutral-600 border border-neutral-200 hover:bg-neutral-50 transition-all"
                  >
                    Skip — Generate Without Occlusion
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── UPLOAD FORM ── */}
            {step === 'upload' && (
              <motion.div
                key="upload"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                <div
                  onDragOver={e => e.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-all
                    ${files.length > 0 ? 'border-indigo-200 bg-indigo-50/30' : 'border-neutral-300 hover:border-indigo-400 hover:bg-neutral-50'}`}
                >
                  <input ref={fileInputRef} type="file" onChange={handleFileChange} className="hidden" multiple accept=".pptx,.pdf" />
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4
                    ${files.length > 0 ? 'bg-indigo-100 text-indigo-600' : 'bg-neutral-100 text-neutral-400'}`}>
                    <Upload size={24} />
                  </div>
                  <h3 className="text-lg font-medium mb-1">{files.length > 0 ? 'Add more files' : 'Upload lecture files'}</h3>
                  <p className="text-sm text-neutral-500">Drag & drop or click — PPTX or PDF (max 5 files)</p>
                </div>

                {files.length > 0 && (
                  <div className="space-y-2">
                    {files.map(f => (
                      <div key={f.id} className="flex items-center justify-between p-4 bg-white rounded-xl border border-neutral-200">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 flex-shrink-0">
                            <FileText size={20} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{f.file.name}</p>
                            <p className="text-xs text-neutral-500">{(f.file.size / 1024 / 1024).toFixed(2)} MB</p>
                          </div>
                        </div>
                        <button onClick={() => removeFile(f.id)} className="p-2 text-neutral-400 hover:text-red-500">
                          <X size={20} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-1">
                  <label className="block text-sm font-medium text-neutral-700">Deck Name</label>
                  <input
                    type="text"
                    value={deckName}
                    onChange={e => setDeckName(e.target.value)}
                    placeholder="e.g. Neuroanatomy — Basal Ganglia"
                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-neutral-700">Card Types</label>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { id: 'basic', label: 'Basic', desc: 'Standard Q&A' },
                      { id: 'cloze', label: 'Cloze', desc: 'Fill-in-the-blank' },
                      { id: 'image_occlusion', label: 'Image Focus', desc: 'Visual ID cards' },
                    ].map(({ id, label, desc }) => {
                      const selected = cardTypes.includes(id);
                      return (
                        <button
                          key={id}
                          onClick={() => setCardTypes(prev => selected ? prev.filter(t => t !== id) : [...prev, id])}
                          className={`px-4 py-3 rounded-xl border text-left transition-all relative
                            ${selected ? 'border-indigo-500 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-200' : 'border-neutral-200 hover:border-indigo-300'}`}
                        >
                          {selected && <CheckCircle size={14} className="absolute top-2 right-2 text-indigo-600" />}
                          <div className="font-semibold text-sm mb-0.5">{label}</div>
                          <div className="text-xs opacity-70">{desc}</div>
                        </button>
                      );
                    })}
                  </div>
                  {cardTypes.length === 0 && <p className="text-xs text-red-500">Select at least one card type.</p>}
                </div>

                {status === 'error' && (
                  <div className="p-4 rounded-xl bg-red-50 text-red-700 border border-red-100 flex items-start gap-3">
                    <AlertCircle className="flex-shrink-0 mt-0.5" size={20} />
                    <div>
                      <p className="font-medium">Failed</p>
                      <p className="text-sm">{errorMessage}</p>
                    </div>
                  </div>
                )}

                <button
                  onClick={handleExtractImages}
                  disabled={!files.length || !deckName.trim() || !cardTypes.length || status === 'extracting'}
                  className={`w-full py-4 rounded-xl font-semibold text-lg flex items-center justify-center gap-3 transition-all shadow-lg
                    ${!files.length || !deckName.trim() || !cardTypes.length || status === 'extracting'
                      ? 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:-translate-y-0.5 shadow-indigo-100'}`}
                >
                  {status === 'extracting'
                    ? <><Loader2 className="animate-spin" size={24} /> Extracting images...</>
                    : 'Next: Choose Images →'}
                </button>
              </motion.div>
            )}

          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}