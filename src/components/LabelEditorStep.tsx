import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Plus, Trash2, Maximize, Layers, Undo, Redo, Check } from 'lucide-react';

export interface Label {
  id: string;
  text: string;
  x: number;     // fraction 0-1
  y: number;     // fraction 0-1
  w: number;     // fraction 0-1
  h: number;     // fraction 0-1
}

interface ExtractedImage {
  name: string;
  data: string; // base64
  mimeType: string;
}

interface Props {
  image: ExtractedImage;
  initialLabels: Label[];
  onSave: (labels: Label[]) => void;
  onBack: () => void;
}

export default function LabelEditorStep({ image, initialLabels, onSave, onBack }: Props) {
  const [labels, setLabels] = useState<Label[]>(initialLabels);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<{id: string, startX: number, startY: number, origX: number, origY: number} | null>(null);
  const [resizing, setResizing] = useState<{id: string, handle: string, startX: number, startY: number, origX: number, origY: number, origW: number, origH: number} | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [history, setHistory] = useState<Label[][]>([initialLabels]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);

  const saveToHistory = (newLabels: Label[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newLabels);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setLabels(newLabels);
  };

  const undo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setLabels(history[historyIndex - 1]);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
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
    setResizing({
      id,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      origX: label.x,
      origY: label.y,
      origW: label.w,
      origH: label.h
    });
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
          let newX = resizing.origX;
          let newY = resizing.origY;
          let newW = resizing.origW;
          let newH = resizing.origH;

          if (resizing.handle.includes('e')) newW = Math.max(0.01, resizing.origW + dx);
          if (resizing.handle.includes('s')) newH = Math.max(0.01, resizing.origH + dy);
          if (resizing.handle.includes('w')) {
            const maxDx = resizing.origW - 0.01;
            const actualDx = Math.min(dx, maxDx);
            newX = resizing.origX + actualDx;
            newW = resizing.origW - actualDx;
          }
          if (resizing.handle.includes('n')) {
            const maxDy = resizing.origH - 0.01;
            const actualDy = Math.min(dy, maxDy);
            newY = resizing.origY + actualDy;
            newH = resizing.origH - actualDy;
          }

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
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (editingId) return; // Don't delete label if editing text
        deleteSelected();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, labels, editingId]);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <button onClick={onBack} className="text-sm font-medium text-neutral-500 hover:text-neutral-900 mb-2">
            ← Back
          </button>
          <h2 className="text-2xl font-bold text-neutral-900">Modify Covering Labels</h2>
          <p className="text-neutral-500 mt-1">Do you want to modify the covering labels?</p>
          <p className="text-xs text-neutral-400 mt-1">A separate Anki flashcard will be created for each label box you create.</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 p-2 bg-white rounded-xl border border-neutral-200 shadow-sm">
        <button 
          onClick={() => setAdding(!adding)}
          className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${adding ? 'bg-indigo-100 text-indigo-700' : 'text-neutral-700 hover:bg-neutral-100'}`}
        >
          <Plus size={16} /> Add Label
        </button>
        <button 
          onClick={deleteSelected}
          disabled={selectedIds.size === 0}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-neutral-700 rounded-lg hover:bg-red-50 hover:text-red-600 disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-neutral-700 transition-colors"
        >
          <Trash2 size={16} /> Delete Label
        </button>
        <div className="w-px h-6 bg-neutral-200 my-auto mx-1" />
        <button 
          onClick={() => {}}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-neutral-700 rounded-lg hover:bg-neutral-100 transition-colors"
          title="Click a label to show resize handles"
        >
          <Maximize size={16} /> Resize Labels
        </button>
        <button 
          onClick={() => {}}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-neutral-700 rounded-lg hover:bg-neutral-100 transition-colors"
          title="Hold Shift and click to select multiple"
        >
          <Layers size={16} /> Group Selected
        </button>
        <div className="w-px h-6 bg-neutral-200 my-auto mx-1" />
        <button 
          onClick={undo}
          disabled={historyIndex === 0}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-neutral-700 rounded-lg hover:bg-neutral-100 disabled:opacity-50 transition-colors"
        >
          <Undo size={16} /> Undo
        </button>
        <button 
          onClick={redo}
          disabled={historyIndex === history.length - 1}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-neutral-700 rounded-lg hover:bg-neutral-100 disabled:opacity-50 transition-colors"
        >
          <Redo size={16} /> Redo
        </button>
      </div>

      {/* Image Container */}
      <div className="bg-neutral-200 p-4 rounded-xl overflow-hidden flex justify-center">
        <div 
          ref={containerRef}
          className={`relative inline-block select-none ${adding ? 'cursor-crosshair' : ''}`}
          onClick={handleContainerClick}
        >
          <img 
            src={`data:${image.mimeType};base64,${image.data}`} 
            alt={image.name}
            className="max-w-[900px] w-full h-auto block shadow-md"
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
                  backgroundColor: 'rgba(231, 76, 60, 0.15)',
                  cursor: dragging?.id === label.id ? 'grabbing' : 'grab',
                  boxSizing: 'border-box'
                }}
                className="flex items-center justify-center overflow-hidden group"
              >
                {editingId === label.id ? (
                  <input
                    autoFocus
                    className="w-full h-full bg-white text-red-600 text-xs text-center outline-none border-none p-0 m-0"
                    value={label.text}
                    onChange={(e) => setLabels(labels.map(l => l.id === label.id ? { ...l, text: e.target.value } : l))}
                    onBlur={() => {
                      setEditingId(null);
                      saveToHistory(labels);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setEditingId(null);
                        saveToHistory(labels);
                      }
                    }}
                  />
                ) : (
                  <span className="text-[#e74c3c] text-xs font-bold truncate px-1 pointer-events-none">
                    {label.text}
                  </span>
                )}

                {/* Resize Handles */}
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

      <button
        onClick={() => onSave(labels)}
        className="w-full py-4 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-teal-100 bg-teal-500 text-white hover:bg-teal-600 hover:shadow-teal-200 hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2"
      >
        <Check size={24} />
        Labels are correct - Save Flashcards
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
