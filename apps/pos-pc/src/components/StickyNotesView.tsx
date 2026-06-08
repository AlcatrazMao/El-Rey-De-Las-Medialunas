import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, X, GripVertical, Save, StickyNote } from 'lucide-react';

interface StickyNote {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  content: string;
  color: string;
  created: string;
}

const COLORS = ['#FFF8DC', '#F0FDF4', '#EFF6FF', '#FFF7ED', '#FEF2F2', '#FAF5FF'];
const STORAGE_KEY = 'erp_sticky_notes';

export const StickyNotesView: React.FC = () => {
  const [notes, setNotes] = useState<StickyNote[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  });
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [editing, setEditing] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const save = (list: StickyNote[]) => {
    setNotes(list);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  };

  const addNote = () => {
    const note: StickyNote = {
      id: `note_${Date.now()}`,
      x: 40 + Math.random() * 100,
      y: 40 + Math.random() * 100,
      width: 240,
      height: 200,
      title: 'Nueva nota',
      content: '',
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      created: new Date().toISOString(),
    };
    save([note, ...notes]);
  };

  const deleteNote = (id: string) => save(notes.filter(n => n.id !== id));
  
  const updateNote = (id: string, data: Partial<StickyNote>) => {
    save(notes.map(n => n.id === id ? { ...n, ...data } : n));
  };

  // Drag handlers
  const handleMouseDown = (e: React.MouseEvent, id: string) => {
    const note = notes.find(n => n.id === id);
    if (!note || (e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'INPUT') return;
    setDragging(id);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      setDragOffset({ x: e.clientX - rect.left - note.x, y: e.clientY - rect.top - note.y });
    }
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        updateNote(dragging, {
          x: Math.max(0, e.clientX - rect.left - dragOffset.x),
          y: Math.max(0, e.clientY - rect.top - dragOffset.y),
        });
      }
    };
    const up = () => setDragging(null);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [dragging, dragOffset]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <StickyNote className="w-5 h-5 text-amber-500" />
          <h2 className="text-base font-bold text-gray-800 dark:text-zinc-100">Notas del Tablero</h2>
          <span className="text-xs text-gray-400">({notes.length})</span>
        </div>
        <button onClick={addNote}
          className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-bold hover:bg-amber-600 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Agregar nota
        </button>
      </div>
      <div ref={canvasRef} className="flex-1 relative bg-[#FAF0E6] dark:bg-zinc-950 border border-dashed border-amber-200 dark:border-zinc-800 rounded-xl overflow-hidden"
        style={{ minHeight: '60vh' }}>
        {notes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 pointer-events-none">
            <div className="text-center">
              <StickyNote className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Hacé clic en "Agregar nota" para empezar</p>
            </div>
          </div>
        )}
        {notes.map(note => (
          <div key={note.id}
            onMouseDown={(e) => handleMouseDown(e, note.id)}
            className={`absolute rounded-lg shadow-md border border-amber-200 dark:border-zinc-700 cursor-move ${dragging === note.id ? 'shadow-xl z-50 ring-2 ring-amber-500' : 'z-10'}`}
            style={{ left: note.x, top: note.y, width: note.width, height: note.height, background: note.color }}>
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-amber-200/50">
              <GripVertical className="w-3 h-3 text-gray-400" />
              {editing === note.id ? (
                <input value={note.title} onChange={e => updateNote(note.id, { title: e.target.value })}
                  onBlur={() => setEditing(null)}
                  autoFocus
                  className="flex-1 mx-2 text-xs font-bold bg-transparent border-b border-dashed border-gray-300 outline-none"
                />
              ) : (
                <span onDoubleClick={() => setEditing(note.id)}
                  className="flex-1 mx-2 text-xs font-bold text-gray-700 truncate cursor-text">
                  {note.title}
                </span>
              )}
              <button onClick={() => deleteNote(note.id)}
                className="p-0.5 hover:bg-red-100 rounded text-gray-400 hover:text-red-500">
                <X className="w-3 h-3" />
              </button>
            </div>
            {/* Content */}
            <textarea value={note.content}
              onChange={e => updateNote(note.id, { content: e.target.value })}
              placeholder="Escribí algo..."
              className="w-full h-[calc(100%-32px)] px-3 py-2 text-xs bg-transparent resize-none outline-none placeholder:text-gray-400"
              style={{ color: '#4A3E3E' }} />
          </div>
        ))}
      </div>
    </div>
  );
};
