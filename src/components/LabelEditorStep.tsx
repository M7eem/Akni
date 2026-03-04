import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Plus, Trash2, Undo, Redo, Check } from 'lucide-react';

export interface Label {
  id: string;
  text: string;
  x: number; // fraction 0-1
  y: number;
  w: number;
  h: number;
}

interface Props {
  images: {
    name: string;
    src: string;
    initialLabels: Label[];
  }[];
  onSave: (allLabels: { imageName: string; labels: Label[] }[]) => void;
  onBack: () => void;
}

export default function LabelEditorStep({ images, onSave, onBack }: Props) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const currentImage = images[currentImageIndex];

  // State for all images
  const [allLabels, setAllLabels] = useState<Record<string, Label[]>>(() => {
    const initial: Record<string, Label[]> = {};
    images.forEach(img => {
      initial[img.name] = img.initialLabels.map(l => {
        const newX = Math.max(0, l.x - 0.008);
        const newY = Math.max(0, l.y - 0.008);
        const newW = Math.min(1 - newX, l.w + 0.016);
        const newH = Math.min(1 - newY, l.h + 0.016);
        return { ...l, x: newX, y: newY, w: newW, h: newH };
      });
    });
    return initial;
  });

  const labels = allLabels[currentImage.name] || [];
  const setLabels = (newLabels: Label[]) => {
    setAllLabels(prev => ({ ...prev, [currentImage.name]: newLabels }));
  };

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; handle: string; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // History per image
  const [historyMap, setHistoryMap] = useState<Record<string, Label[][]>>(() => {
    const initial: Record<string, Label[][]> = {};
    images.forEach(img => {
      const paddedLabels = img.initialLabels.map(l => {
        const newX = Math.max(0, l.x - 0.008);
        const newY = Math.max(0, l.y - 0.008);
        const newW = Math.min(1 - newX, l.w + 0.016);
        const newH = Math.min(1 - newY, l.h + 0.016);
        return { ...l, x: newX, y: newY, w: newW, h: newH };
      });
      initial[img.name] = [paddedLabels];
    });
    return initial;
  });
  const [historyIndexMap, setHistoryIndexMap] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    images.forEach(img => {
      initial[img.name] = 0;
    });
    return initial;
  });

  const history = historyMap[currentImage.name] || [];
  const historyIndex = historyIndexMap[currentImage.name] || 0;

  const containerRef = useRef<HTMLDivElement>(null);

  const saveToHistory = (newLabels: Label[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newLabels);
    setHistoryMap(prev => ({ ...prev, [currentImage.name]: newHistory }));
    setHistoryIndexMap(prev => ({ ...prev, [currentImage.name]: newHistory.length - 1 }));
    setLabels(newLabels);
  };

  const undo = () => {
    if (historyIndex > 0) {
      setHistoryIndexMap(prev => ({ ...prev, [currentImage.name]: historyIndex - 1 }));
      setLabels(history[historyIndex - 1]);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndexMap(prev => ({ ...prev, [currentImage.name]: historyIndex + 1 }));
      setLabels(history[historyIndex + 1]);
    }
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    if (adding && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const newLabel: Label = {
        id: Date.now().toString(),
        text: 'New Label',
        x,
        y,
        w: 120 / rect.width,
        h: 30 / rect.height
      };
      saveToHistory([...labels, newLabel]);
      setAdding(false);
      setSelectedIds(new Set([newLabel.id]));
      setEditingId(newLabel.id);
    } else if (e.target === containerRef.current || (e.target as HTMLElement).tagName === 'IMG') {
      setSelectedIds(new Set());
      setEditingId(null);
    }
  };

  const handleLabelMouseDown = (e: React.MouseEvent, id: string) => {
    if (adding || editingId === id) return;
    e.stopPropagation();
    if (e.shiftKey) {
      const newSelected = new Set(selectedIds);
      if (newSelected.has(id)) newSelected.delete(id);
      else newSelected.add(id);
      setSelectedIds(newSelected);
    } else {
      setSelectedIds(new Set([id]));
    }
    setDragging({
      id,
      startX: e.clientX,
      startY: e.clientY,
      origX: labels.find(l => l.id === id)!.x,
      origY: labels.find(l => l.id === id)!.y
    });
  };

  const handleResizeMouseDown = (e: React.MouseEvent, id: string, handle: string) => {
    e.stopPropagation();
    const label = labels.find(l => l.id === id)!;
    setResizing({ id, handle, startX: e.clientX, startY: e.clientY, origX: label.x, origY: label.y, origW: label.w, origH: label.h });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (dragging) {
        const dx = (e.clientX - dragging.startX) / rect.width;
        const dy = (e.clientY - dragging.startY) / rect.height;
        setLabels(labels.map(l =>
          l.id === dragging.id
            ? { ...l, x: Math.max(0, Math.min(1 - l.w, dragging.origX + dx)), y: Math.max(0, Math.min(1 - l.h, dragging.origY + dy)) }
            : l
        ));
      } else if (resizing) {
        const dx = (e.clientX - resizing.startX) / rect.width;
        const dy = (e.clientY - resizing.startY) / rect.height;
        setLabels(labels.map(l => {
          if (l.id !== resizing.id) return l;
          let newX = resizing.origX, newY = resizing.origY, newW = resizing.origW, newH = resizing.origH;
          if (resizing.handle.includes('e')) newW = Math.max(0.01, resizing.origW + dx);
          if (resizing.handle.includes('s')) newH = Math.max(0.01, resizing.origH + dy);
          if (resizing.handle.includes('w')) { const d = Math.min(dx, resizing.origW - 0.01); newX = resizing.origX + d; newW = resizing.origW - d; }
          if (resizing.handle.includes('n')) { const d = Math.min(dy, resizing.origH - 0.01); newY = resizing.origY + d; newH = resizing.origH - d; }
          return { ...l, x: newX, y: newY, w: newW, h: newH };
        }));
      }
    };

    const handleMouseUp = () => {
      if (dragging || resizing) {
        saveToHistory(labels);
        setDragging(null);
        setResizing(null);
      }
    };

    if (dragging || resizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, resizing, labels, historyIndex]);

  const deleteSelected = () => {
    if (selectedIds.size > 0) {
      saveToHistory(labels.filter(l => !selectedIds.has(l.id)));
      setSelectedIds(new Set());
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !editingId) deleteSelected();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, labels, editingId]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-4"
    >
      <div>
        <button onClick={onBack} className="text-sm font-medium text-[#8899aa] hover:text-[#eef6ff] mb-2">
          ← Back
        </button>
        <h2 className="text-2xl font-bold text-[#eef6ff]">Edit Occlusion Labels</h2>
        <p className="text-[#8899aa] mt-1 text-sm">
          <b>{labels.length}</b> label{labels.length !== 1 ? 's' : ''} detected. Drag to reposition, resize handles to adjust, double-click to rename, Delete key to remove.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 p-2 bg-[#0d1117] rounded-xl border border-[rgba(255,255,255,0.05)] shadow-sm">
        <button
          onClick={() => { setAdding(!adding); setSelectedIds(new Set()); }}
          className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors
            ${adding ? 'bg-[rgba(125,211,252,0.1)] text-[#7dd3fc] ring-1 ring-[#7dd3fc]' : 'text-[#eef6ff] hover:bg-[rgba(255,255,255,0.05)]'}`}
        >
          <Plus size={16} /> {adding ? 'Click on image to place label' : 'Add Label'}
        </button>
        <button
          onClick={deleteSelected}
          disabled={selectedIds.size === 0}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[#eef6ff] rounded-lg hover:bg-red-900/20 hover:text-red-400 disabled:opacity-40 transition-colors"
        >
          <Trash2 size={16} /> Delete ({selectedIds.size})
        </button>
        <div className="w-px h-6 bg-[rgba(255,255,255,0.1)] my-auto mx-1" />
        <button onClick={undo} disabled={historyIndex === 0} className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[#eef6ff] rounded-lg hover:bg-[rgba(255,255,255,0.05)] disabled:opacity-40 transition-colors">
          <Undo size={16} /> Undo
        </button>
        <button onClick={redo} disabled={historyIndex === history.length - 1} className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[#eef6ff] rounded-lg hover:bg-[rgba(255,255,255,0.05)] disabled:opacity-40 transition-colors">
          <Redo size={16} /> Redo
        </button>
        <div className="ml-auto text-xs text-[#8899aa] self-center pr-2">
          {labels.length} card{labels.length !== 1 ? 's' : ''} will be created
        </div>
      </div>

      {/* Image + Labels */}
      <div className="bg-[#131820] rounded-xl overflow-auto flex justify-center p-4 border border-[rgba(255,255,255,0.05)]">
        <div
          ref={containerRef}
          className={`relative inline-block select-none ${adding ? 'cursor-crosshair' : ''}`}
          onClick={handleContainerClick}
        >
          {/* ← Fixed: use src URL directly, no base64 needed */}
          <img
            src={currentImage.src}
            alt={currentImage.name}
            className="max-w-[900px] w-full h-auto block shadow-md rounded"
            draggable={false}
          />

          {labels.map(label => {
            const isSelected = selectedIds.has(label.id);
            return (
              <div
                key={label.id}
                onMouseDown={(e) => handleLabelMouseDown(e, label.id)}
                onDoubleClick={() => setEditingId(label.id)}
                style={{
                  position: 'absolute',
                  left: `${label.x * 100}%`,
                  top: `${label.y * 100}%`,
                  width: `${label.w * 100}%`,
                  height: `${label.h * 100}%`,
                  border: `2px solid ${isSelected ? '#f39c12' : '#e74c3c'}`,
                  backgroundColor: isSelected ? 'rgba(243,156,18,0.15)' : 'rgba(231,76,60,0.15)',
                  cursor: dragging?.id === label.id ? 'grabbing' : 'grab',
                  boxSizing: 'border-box'
                }}
                className="flex items-center justify-center overflow-hidden"
              >
                {editingId === label.id ? (
                  <input
                    autoFocus
                    className="w-full h-full bg-[#0d1117]/90 text-[#eef6ff] text-xs text-center outline-none border-none p-0"
                    value={label.text}
                    onChange={(e) => setLabels(labels.map(l => l.id === label.id ? { ...l, text: e.target.value } : l))}
                    onBlur={() => { setEditingId(null); saveToHistory(labels); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { setEditingId(null); saveToHistory(labels); } }}
                  />
                ) : (
                  <span className="text-[#e74c3c] text-[10px] font-bold truncate px-1 pointer-events-none leading-tight drop-shadow-md">
                    {label.text}
                  </span>
                )}

                {isSelected && !editingId && (
                  <>
                    {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(handle => (
                      <div
                        key={handle}
                        onMouseDown={(e) => handleResizeMouseDown(e, label.id, handle)}
                        style={{
                          position: 'absolute',
                          width: '8px',
                          height: '8px',
                          backgroundColor: '#f39c12',
                          border: '1px solid white',
                          borderRadius: '2px',
                          ...getHandleStyle(handle)
                        }}
                      />
                    ))}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {images.length > 1 && (
        <div className="flex justify-between items-center bg-[#0d1117] p-3 rounded-xl border border-[rgba(255,255,255,0.05)] shadow-sm">
          <button
            onClick={() => setCurrentImageIndex(prev => Math.max(0, prev - 1))}
            disabled={currentImageIndex === 0}
            className="px-4 py-2 text-sm font-medium text-[#eef6ff] bg-[#131820] rounded-lg hover:bg-[rgba(255,255,255,0.05)] disabled:opacity-50 transition-colors"
          >
            ← Previous Image
          </button>
          <span className="text-sm font-medium text-[#8899aa]">
            Image {currentImageIndex + 1} of {images.length}
          </span>
          <button
            onClick={() => setCurrentImageIndex(prev => Math.min(images.length - 1, prev + 1))}
            disabled={currentImageIndex === images.length - 1}
            className="px-4 py-2 text-sm font-medium text-[#eef6ff] bg-[#131820] rounded-lg hover:bg-[rgba(255,255,255,0.05)] disabled:opacity-50 transition-colors"
          >
            Next Image →
          </button>
        </div>
      )}

      <button
        onClick={() => {
          const result = images.map(img => ({
            imageName: img.name,
            labels: allLabels[img.name] || []
          }));
          onSave(result);
        }}
        className="w-full py-4 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-[#7dd3fc]/20 bg-[#7dd3fc] text-[#07090f] hover:opacity-90 hover:-translate-y-0.5 flex items-center justify-center gap-2"
      >
        <Check size={22} />
        Generate Flashcards →
      </button>
    </motion.div>
  );
}

function getHandleStyle(handle: string): React.CSSProperties {
  const style: React.CSSProperties = { cursor: `${handle}-resize` };
  if (handle.includes('n')) style.top = '-4px';
  if (handle.includes('s')) style.bottom = '-4px';
  if (!handle.includes('n') && !handle.includes('s')) style.top = 'calc(50% - 4px)';
  if (handle.includes('w')) style.left = '-4px';
  if (handle.includes('e')) style.right = '-4px';
  if (!handle.includes('w') && !handle.includes('e')) style.left = 'calc(50% - 4px)';
  return style;
}