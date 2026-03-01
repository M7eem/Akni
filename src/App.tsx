import React, { useState, useRef } from 'react';
import { Upload, FileText, X, Loader2, Download, CheckCircle, AlertCircle, Image as ImageIcon, CheckSquare, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import LabelEditorStep, { Label } from './components/LabelEditorStep';

interface UploadedFile {
  file: File;
  id: string;
}

type Status = 'idle' | 'uploading' | 'extracting' | 'processing' | 'generating' | 'building' | 'complete' | 'error' | 'detecting';

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
  const [extractedImages, setExtractedImages] = useState<{name: string, data: string, mimeType: string}[]>([]);
  const [selectedImageName, setSelectedImageName] = useState<string | null>(null);
  const [step, setStep] = useState<'upload' | 'imagePicker' | 'labelEditor' | 'generating' | 'complete'>('upload');
  const [detectedLabels, setDetectedLabels] = useState<Label[]>([]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map((file: File) => ({
        file,
        id: Math.random().toString(36).substring(7)
      }));
      
      // Filter for valid types
      const validFiles = newFiles.filter((f: UploadedFile) => 
        f.file.name.endsWith('.pptx') || f.file.name.endsWith('.pdf')
      );
      
      if (validFiles.length < newFiles.length) {
        alert('Only .pptx and .pdf files are supported.');
      }

      setFiles(prev => [...prev, ...validFiles].slice(0, 5)); // Limit to 5
    }
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      const newFiles = Array.from(e.dataTransfer.files).map((file: any) => ({
        file: file as File,
        id: Math.random().toString(36).substring(7)
      }));
      
      const validFiles = newFiles.filter((f: UploadedFile) => 
        f.file.name.endsWith('.pptx') || f.file.name.endsWith('.pdf')
      );
      
      if (validFiles.length < newFiles.length) {
        alert('Only .pptx and .pdf files are supported.');
      }

      setFiles(prev => [...prev, ...validFiles].slice(0, 5));
    }
  };

  const handleExtractImages = async () => {
    if (files.length === 0 || !deckName.trim()) return;

    setStatus('extracting');
    setErrorMessage('');
    
    const formData = new FormData();
    files.forEach(f => formData.append('files', f.file));

    try {
      const response = await fetch('/api/extract-images', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to extract images');
      }

      const data = await response.json();
      setSessionId(data.sessionId);
      setExtractedImages(data.images || []);
      
      if (data.images && data.images.length > 0) {
        setStep('imagePicker');
        setStatus('idle');
      } else {
        // No images found, skip selection step
        await handleGenerate(data.sessionId, null);
      }
    } catch (error) {
      console.error(error);
      setStatus('error');
      setErrorMessage((error as Error).message);
    }
  };

  const handleDetectLabels = async () => {
    if (!selectedImageName) return;
    const selectedImage = extractedImages.find(img => img.name === selectedImageName);
    if (!selectedImage) return;

    setStatus('detecting');
    setErrorMessage('');

    try {
      const response = await fetch('/api/detect-labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: selectedImage.data,
          imageName: selectedImage.name
        })
      });

      if (!response.ok) {
        throw new Error('Failed to detect labels');
      }

      const data = await response.json();
      setDetectedLabels(data.labels || []);
      setStep('labelEditor');
      setStatus('idle');
    } catch (error) {
      console.error(error);
      setStatus('error');
      setErrorMessage((error as Error).message);
    }
  };

  const handleGenerate = async (currentSessionId: string = sessionId, occlusionData: { imageName: string, labels: Label[] } | null = null) => {
    setStatus('generating');
    setErrorMessage('');
    
    const formData = new FormData();
    formData.append('sessionId', currentSessionId);
    formData.append('deck_name', deckName);
    formData.append('card_types', JSON.stringify(cardTypes));
    if (occlusionData) {
      formData.append('occlusionData', JSON.stringify(occlusionData));
    }

    try {
      const progressInterval = setInterval(() => {
        setStatus(prev => {
          if (prev === 'generating') return 'building';
          return prev;
        });
      }, 5000);

      const response = await fetch('/api/generate', {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate flashcards');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      setDownloadUrl(url);
      
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `${deckName.replace(/[^a-z0-9]/gi, '_')}.apkg`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];
      }
      setFileName(filename);
      
      setStatus('complete');
      setStep('complete');
    } catch (error) {
      console.error(error);
      setStatus('error');
      setErrorMessage((error as Error).message);
    }
  };

  const toggleImageSelection = (imageName: string) => {
    setSelectedImageName(prev => prev === imageName ? null : imageName);
  };

  const reset = () => {
    setFiles([]);
    setDeckName('');
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
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
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
            className="text-4xl font-bold tracking-tight text-neutral-900 mb-3"
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

        {/* Main Content */}
        <main className="space-y-8">
          
          <AnimatePresence mode="wait">
            {status === 'complete' ? (
              <motion.div 
                key="success"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
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
                    className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors shadow-sm shadow-indigo-200"
                  >
                    <Download className="mr-2" size={20} />
                    Download .apkg
                  </a>
                  <button 
                    onClick={reset}
                    className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-white border border-neutral-200 text-neutral-700 font-medium hover:bg-neutral-50 transition-colors"
                  >
                    Create Another Deck
                  </button>
                </div>
              </motion.div>
            ) : step === 'upload' ? (
              <motion.div 
                key="form"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-8"
              >
                {/* Upload Zone */}
                <div 
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`
                    relative group cursor-pointer rounded-2xl border-2 border-dashed p-10 transition-all duration-200
                    ${files.length > 0 ? 'border-indigo-200 bg-indigo-50/30' : 'border-neutral-300 hover:border-indigo-400 hover:bg-neutral-50'}
                  `}
                >
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileChange} 
                    className="hidden" 
                    multiple 
                    accept=".pptx,.pdf"
                  />
                  
                  <div className="text-center">
                    <div className={`
                      w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4 transition-colors
                      ${files.length > 0 ? 'bg-indigo-100 text-indigo-600' : 'bg-neutral-100 text-neutral-400 group-hover:bg-indigo-50 group-hover:text-indigo-500'}
                    `}>
                      <Upload size={24} />
                    </div>
                    <h3 className="text-lg font-medium text-neutral-900 mb-1">
                      {files.length > 0 ? 'Add more files' : 'Upload lecture files'}
                    </h3>
                    <p className="text-sm text-neutral-500">
                      Drag & drop or click to select PPTX or PDF files (Max 50MB)
                    </p>
                  </div>
                </div>

                {/* File List */}
                {files.length > 0 && (
                  <div className="space-y-3">
                    {files.map((file) => (
                      <motion.div 
                        key={file.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        className="flex items-center justify-between p-4 bg-white rounded-xl border border-neutral-200 shadow-sm"
                      >
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0 text-indigo-600">
                            <FileText size={20} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-neutral-900 truncate">{file.file.name}</p>
                            <p className="text-xs text-neutral-500">{(file.file.size / 1024 / 1024).toFixed(2)} MB</p>
                          </div>
                        </div>
                        <button 
                          onClick={(e) => { e.stopPropagation(); removeFile(file.id); }}
                          className="p-2 text-neutral-400 hover:text-red-500 transition-colors"
                        >
                          <X size={20} />
                        </button>
                      </motion.div>
                    ))}
                  </div>
                )}

                {/* Deck Name */}
                <div className="space-y-2">
                  <label htmlFor="deckName" className="block text-sm font-medium text-neutral-700">
                    Deck Name
                  </label>
                  <input
                    type="text"
                    id="deckName"
                    value={deckName}
                    onChange={(e) => setDeckName(e.target.value)}
                    placeholder="e.g. Neuroanatomy — Basal Ganglia"
                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all"
                  />
                </div>

                {/* Card Type Selection */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-neutral-700">
                    Card Types (Select multiple)
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {['basic', 'cloze', 'image_occlusion'].map((type) => {
                      const isSelected = cardTypes.includes(type);
                      return (
                        <button
                          key={type}
                          onClick={() => {
                            setCardTypes(prev => 
                              isSelected 
                                ? prev.filter(t => t !== type) 
                                : [...prev, type]
                            );
                          }}
                          className={`
                            px-4 py-3 rounded-xl border text-left transition-all relative
                            ${isSelected 
                              ? 'border-indigo-500 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-200' 
                              : 'border-neutral-200 hover:border-indigo-300 hover:bg-neutral-50'}
                          `}
                        >
                          {isSelected && (
                            <div className="absolute top-2 right-2 text-indigo-600">
                              <CheckCircle size={16} />
                            </div>
                          )}
                          <div className="font-semibold mb-1 capitalize">
                            {type === 'image_occlusion' ? 'Image Focus' : type}
                          </div>
                          <div className="text-xs opacity-80">
                            {type === 'basic' && 'Standard Q&A flashcards'}
                            {type === 'cloze' && 'Fill-in-the-blank style'}
                            {type === 'image_occlusion' && 'Visual identification cards'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {cardTypes.length === 0 && (
                    <p className="text-sm text-red-500 mt-1">Please select at least one card type.</p>
                  )}
                </div>

                {/* Error Message */}
                {status === 'error' && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 rounded-xl bg-red-50 text-red-700 border border-red-100 flex items-start gap-3"
                  >
                    <AlertCircle className="flex-shrink-0 mt-0.5" size={20} />
                    <div>
                      <p className="font-medium">Generation Failed</p>
                      <p className="text-sm opacity-90">{errorMessage}</p>
                    </div>
                  </motion.div>
                )}

                {/* Next Button */}
                <button
                  onClick={handleExtractImages}
                  disabled={files.length === 0 || !deckName.trim() || cardTypes.length === 0 || (status !== 'idle' && status !== 'error')}
                  className={`
                    w-full py-4 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-indigo-100
                    flex items-center justify-center gap-3
                    ${files.length === 0 || !deckName.trim() || cardTypes.length === 0 || (status !== 'idle' && status !== 'error')
                      ? 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-indigo-200 hover:-translate-y-0.5 active:translate-y-0'}
                  `}
                >
                  {status === 'idle' || status === 'error' ? (
                    <>
                      <span>Next: Choose Images →</span>
                    </>
                  ) : (
                    <>
                      <Loader2 className="animate-spin" size={24} />
                      <span>
                        {status === 'extracting' && 'Extracting images...'}
                      </span>
                    </>
                  )}
                </button>
              </motion.div>
            ) : step === 'imagePicker' ? (
              <motion.div 
                key="imagePicker"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-8"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <button onClick={() => setStep('upload')} className="text-sm font-medium text-neutral-500 hover:text-neutral-900 mb-2">
                      ← Back to Flashcards
                    </button>
                    <h2 className="text-2xl font-bold text-neutral-900">Choose Images</h2>
                    <p className="text-neutral-500 mt-1">Found {extractedImages.length}.</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-white bg-orange-500 px-3 py-1 rounded-full">
                      Selected: {selectedImageName ? '1' : '0'}/1
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {extractedImages.map((img) => {
                    const isSelected = selectedImageName === img.name;
                    return (
                      <div 
                        key={img.name}
                        onClick={() => toggleImageSelection(img.name)}
                        className={`
                          relative group cursor-pointer rounded-xl overflow-hidden border-2 transition-all bg-white
                          ${isSelected ? 'border-teal-500 ring-4 ring-teal-500/20 scale-[1.02]' : 'border-neutral-200 hover:border-teal-300'}
                        `}
                      >
                        <div className="aspect-video bg-white relative">
                          <img 
                            src={`data:${img.mimeType};base64,${img.data}`} 
                            alt={img.name}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="text-white text-sm font-medium px-2 py-1 bg-black/50 rounded truncate max-w-[90%]">
                            {img.name}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Error Message */}
                {status === 'error' && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 rounded-xl bg-red-50 text-red-700 border border-red-100 flex items-start gap-3"
                  >
                    <AlertCircle className="flex-shrink-0 mt-0.5" size={20} />
                    <div>
                      <p className="font-medium">Detection Failed</p>
                      <p className="text-sm opacity-90">{errorMessage}</p>
                    </div>
                  </motion.div>
                )}

                <div className="pt-4 border-t border-neutral-200">
                  <button
                    onClick={handleDetectLabels}
                    disabled={!selectedImageName || (status !== 'idle' && status !== 'error')}
                    className={`
                      w-full py-4 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-teal-100
                      flex items-center justify-center gap-3
                      ${!selectedImageName || (status !== 'idle' && status !== 'error')
                        ? 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
                        : 'bg-teal-500 text-white hover:bg-teal-600 hover:shadow-teal-200 hover:-translate-y-0.5 active:translate-y-0'}
                    `}
                  >
                    {status === 'idle' || status === 'error' ? (
                      <>
                        <span>Cover Text with AI ✨</span>
                      </>
                    ) : (
                      <>
                        <Loader2 className="animate-spin" size={24} />
                        <span>
                          {status === 'detecting' && 'Detecting labels...'}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            ) : step === 'labelEditor' && selectedImageName ? (
              <LabelEditorStep
                image={extractedImages.find(img => img.name === selectedImageName)!}
                initialLabels={detectedLabels}
                onSave={(labels) => handleGenerate(sessionId, { imageName: selectedImageName, labels })}
                onBack={() => setStep('imagePicker')}
              />
            ) : null}
          </AnimatePresence>

        </main>
      </div>
    </div>
  );
}
