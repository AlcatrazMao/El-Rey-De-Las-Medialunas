import { X, Calendar, Flag, Maximize2, Minimize2 } from 'lucide-react';
import * as React from 'react'
import { useState, useRef, useCallback, useEffect } from 'react';

import type { StickyNote } from '../hooks/useStickyNotes';

interface NotesCanvasProps {
  notes: StickyNote[];
  onUpdate: (id: string, data: Partial<StickyNote>) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
}

export const NotesCanvas: React.FC<NotesCanvasProps> = ({ notes, onUpdate, onDelete, onToggle }) => {
  const [dragging, setDragging] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const dragRef = useRef<{ id: string; ox: number; oy: number; nx: number; ny: number; moved: boolean } | null>(null);
  const noteRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const canvasRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  // Fullscreen & Horizontal orientation support
  const toggleFullscreen = useCallback(async () => {
    try {
      const container = canvasRef.current;
      if (!container) return;

      const isCurrentlyFs = Boolean(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement
      );

      if (!isCurrentlyFs) {
        if (container.requestFullscreen) {
          await container.requestFullscreen();
        } else if ((container as any).webkitRequestFullscreen) {
          await (container as any).webkitRequestFullscreen();
        }

        // Intento de rotación horizontal si está soportado por la API ScreenOrientation
        try {
          if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.lock === 'function') {
            await screen.orientation.lock('landscape').catch(() => {});
          }
        } catch {
          // Navegadores no soportados o bloqueo de permisos en iframe
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        }

        try {
          if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.unlock === 'function') {
            screen.orientation.unlock();
          }
        } catch {
          // Ignorar si no está soportado
        }
      }
    } catch (err) {
      console.warn('Fullscreen toggle failed:', err);
    }
  }, []);

  useEffect(() => {
    const handleFsChange = () => {
      const isFs = Boolean(
        (document.fullscreenElement && document.fullscreenElement === canvasRef.current) ||
        ((document as any).webkitFullscreenElement && (document as any).webkitFullscreenElement === canvasRef.current)
      );
      setIsFullscreen(isFs);
      if (!isFs) {
        try {
          if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.unlock === 'function') {
            screen.orientation.unlock();
          }
        } catch {
          // ignore
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
    };
  }, []);

  const activeNotes = notes.filter(n => n.status !== 'archived');

  // Enter edit mode (double-click)
  const enterEdit = useCallback((note: StickyNote) => {
    setEditingId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content);
    setTimeout(() => editRef.current?.focus(), 50);
    setDragging(null);
  }, []);

  // Save and exit edit mode
  const exitEdit = useCallback(() => {
    if (editingId) {
      onUpdate(editingId, { title: editTitle, content: editContent });
      setEditingId(null);
    }
  }, [editingId, editTitle, editContent, onUpdate]);

  // Handle drag start - works anywhere on the card
  const handlePointerDown = (e: React.PointerEvent, note: StickyNote) => {
    if (editingId === note.id) return; // no drag while editing
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.closest('button')) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { id: note.id, ox: e.clientX, oy: e.clientY, nx: note.x, ny: note.y, moved: false };
    setDragging(note.id);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.ox;
      const dy = e.clientY - dragRef.current.oy;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragRef.current.moved = true;
      dragRef.current.ox = e.clientX;
      dragRef.current.oy = e.clientY;
      dragRef.current.nx += dx;
      dragRef.current.ny += dy;
      const el = noteRefs.current[dragRef.current.id];
      if (el) {
        el.style.left = `${Math.max(0, dragRef.current.nx)}px`;
        el.style.top = `${Math.max(0, dragRef.current.ny)}px`;
      }
    };
    const up = () => {
      if (dragRef.current?.moved) {
        onUpdate(dragRef.current.id, { x: Math.max(0, Math.round(dragRef.current.nx)), y: Math.max(0, Math.round(dragRef.current.ny)) });
      }
      setDragging(null);
      dragRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [dragging, onUpdate]);

  // Keyboard: Escape exits edit mode
  useEffect(() => {
    if (!editingId) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') exitEdit(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [editingId, exitEdit]);

  const priorityColor = (p: string) => p === 'high' ? 'text-red-500' : p === 'medium' ? 'text-amber-500' : 'text-gray-400';

  return (
    <div
      ref={canvasRef}
      id="notes-canvas-container"
      className={`relative select-none transition-all duration-200 ${
        isFullscreen
          ? 'fixed inset-0 z-50 w-full h-full min-h-screen bg-[#FAF0E6] dark:bg-zinc-950 p-4 sm:p-6 overflow-auto'
          : 'flex-1 w-full h-full min-h-[60vh] bg-[#FAF0E6] dark:bg-zinc-950 border border-dashed border-amber-200 dark:border-zinc-800 rounded-xl overflow-auto'
      }`}
      style={{
        minHeight: isFullscreen ? '100vh' : '60vh',
        minWidth: '100%',
        touchAction: 'none'
      }}
      onDoubleClick={(e) => { if (e.target === canvasRef.current) return; }}
    >
      {/* Botón flotante de Pantalla Completa / Salir */}
      <div className="absolute top-3 right-3 z-30 flex items-center gap-2">
        <button
          type="button"
          id="btn-toggle-canvas-fullscreen"
          onClick={toggleFullscreen}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold shadow-md transition-all cursor-pointer backdrop-blur-md active:scale-95 ${
            isFullscreen
              ? 'bg-amber-500 text-white hover:bg-amber-600 ring-2 ring-white/50'
              : 'bg-white/90 dark:bg-zinc-900/90 hover:bg-white dark:hover:bg-zinc-850 text-gray-700 dark:text-zinc-200 border border-amber-200/80 dark:border-zinc-700 hover:border-amber-400'
          }`}
          title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
        >
          {isFullscreen ? (
            <>
              <Minimize2 className="w-3.5 h-3.5" />
              <span>Salir</span>
            </>
          ) : (
            <>
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Pantalla completa</span>
            </>
          )}
        </button>
      </div>
      {activeNotes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400 pointer-events-none">
          <div className="text-center"><div className="text-4xl mb-2 opacity-30">📝</div><p className="text-sm">Doble clic para editar, arrastrar para mover</p></div>
        </div>
      )}
      {activeNotes.map(note => {
        const isEditing = editingId === note.id;
        const isDragging = dragging === note.id;
        
        return (
          <div key={note.id}
            ref={(el) => { noteRefs.current[note.id] = el; }}
            onPointerDown={(e) => handlePointerDown(e, note)}
            onDoubleClick={() => enterEdit(note)}
            className={`absolute rounded-xl shadow-sm border-2 group cursor-grab active:cursor-grabbing
              ${isDragging ? 'shadow-xl z-50 ring-2 ring-amber-500 scale-105' : 'z-10 hover:shadow-md transition-shadow'}
              ${isEditing ? 'ring-2 ring-amber-400 cursor-text z-40' : ''}
              ${note.status === 'done' ? 'opacity-70' : ''}`}
            style={{ left: note.x, top: note.y, width: note.width, background: note.color, willChange: isDragging ? 'left, top' : 'auto' }}>
            
            {/* Header bar */}
            <div className={`flex items-center gap-1.5 px-3 py-2 border-b border-black/5 ${isEditing ? 'bg-white/50' : ''}`}>
              <span className="text-xs">{note.category === 'tarea' ? '📋' : note.category === 'ventas' ? '💸' : note.category === 'inventario' ? '📦' : note.category === 'caja' ? '💰' : note.category === 'produccion' ? '🏭' : '📌'}</span>
              {isEditing ? (
                <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                  className="flex-1 mx-1 text-xs font-bold bg-white/80 border border-amber-300 rounded px-1.5 py-0.5 outline-none" />
              ) : (
                <span className={`flex-1 mx-1 text-xs font-bold truncate ${note.status === 'done' ? 'line-through text-gray-500' : 'text-gray-700'}`}>
                  {note.title}
                </span>
              )}
              <Flag className={`w-3 h-3 shrink-0 ${priorityColor(note.priority)}`} />
              <button onClick={() => onToggle(note.id)}
                className={`p-0.5 rounded text-xs font-bold ${note.status === 'done' ? 'bg-emerald-100 text-emerald-600' : 'hover:bg-emerald-100 text-gray-400 hover:text-emerald-600'}`}
                title={note.status === 'done' ? 'Reabrir' : 'Completar'}>
                {note.status === 'done' ? '✓' : '○'}
              </button>
              <button onClick={() => onDelete(note.id)}
                className="p-0.5 hover:bg-red-100 rounded text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                <X className="w-3 h-3" />
              </button>
            </div>

            {/* Content area */}
            {isEditing ? (
              <textarea ref={editRef} value={editContent} onChange={e => setEditContent(e.target.value)}
                placeholder="Escribí algo..."
                className="w-full h-[calc(100%-36px)] px-3 py-2 text-xs bg-white/80 resize-none outline-none placeholder:text-gray-400"
                style={{ color: '#4A3E3E' }} />
            ) : (
              <div className="w-full h-[calc(100%-36px)] px-3 py-2 text-xs whitespace-pre-wrap overflow-hidden"
                style={{ color: note.content ? '#4A3E3E' : '#B0A090' }}>
                {note.content || <span className="text-gray-400 italic">Doble clic para editar...</span>}
              </div>
            )}

            {/* Edit mode indicator */}
            {isEditing && (
              <div className="absolute -top-2 -right-2 bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold animate-pulse">
                Editando
              </div>
            )}

            {/* Footer */}
            {note.dueDate && (
              <div className="absolute bottom-1 right-2 text-[10px] text-gray-400 flex items-center gap-1">
                <Calendar className="w-2.5 h-2.5" />{new Date(note.dueDate).toLocaleDateString()}
              </div>
            )}
          </div>
        );
      })}
      
      {/* Overlay to close edit mode when clicking outside */}
      {editingId && (
        <div className="fixed inset-0 z-30" onClick={exitEdit} />
      )}
    </div>
  );
};
