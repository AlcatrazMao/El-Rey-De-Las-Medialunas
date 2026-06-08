import React, { useRef, useEffect } from 'react';
import { GripVertical, X, Calendar, Flag } from 'lucide-react';
import type { StickyNote } from '../hooks/useStickyNotes';

interface NotesCanvasProps {
  notes: StickyNote[];
  onUpdate: (id: string, data: Partial<StickyNote>) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
}

export const NotesCanvas: React.FC<NotesCanvasProps> = ({ notes, onUpdate, onDelete, onToggle }) => {
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const dragRef = useRef<{ id: string; ox: number; oy: number; nx: number; ny: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const activeNotes = notes.filter(n => n.status !== 'archived');

  const handleMouseDown = (e: React.MouseEvent, note: StickyNote) => {
    if ((e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'BUTTON') return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { id: note.id, ox: e.clientX, oy: e.clientY, nx: note.x, ny: note.y };
    setDragging(note.id);
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.ox;
      const dy = e.clientY - dragRef.current.oy;
      dragRef.current.nx = dragRef.current.nx + dx;
      dragRef.current.ny = dragRef.current.ny + dy;
      dragRef.current.ox = e.clientX;
      dragRef.current.oy = e.clientY;
    };
    const up = () => {
      if (dragRef.current) {
        onUpdate(dragRef.current.id, { x: Math.max(0, dragRef.current.nx), y: Math.max(0, dragRef.current.ny) });
      }
      setDragging(null);
      dragRef.current = null;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [dragging]);

  const priorityColor = (p: string) => p === 'high' ? 'text-red-500' : p === 'medium' ? 'text-amber-500' : 'text-gray-400';

  return (
    <div ref={canvasRef} className="flex-1 relative bg-[#FAF0E6] dark:bg-zinc-950 border border-dashed border-amber-200 dark:border-zinc-800 rounded-xl overflow-auto select-none"
      style={{ minHeight: '60vh', minWidth: '100%' }}>
      {activeNotes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400 pointer-events-none">
          <div className="text-center">
            <div className="text-4xl mb-2 opacity-30">📝</div>
            <p className="text-sm">No hay notas activas</p>
          </div>
        </div>
      )}
      {activeNotes.map(note => (
        <div key={note.id}
          onMouseDown={(e) => handleMouseDown(e, note)}
          className={`absolute rounded-xl shadow-sm border transition-shadow group cursor-grab active:cursor-grabbing ${note.status === 'done' ? 'opacity-70' : ''} ${dragging === note.id ? 'shadow-xl z-50 ring-2 ring-amber-500' : 'z-10 hover:shadow-md'}`}
          style={{ left: note.x, top: note.y, width: note.width, height: note.height, background: note.color }}>
          {/* Header */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-black/5">
            <GripVertical className="w-3 h-3 text-gray-400 shrink-0" />
            <span className="text-xs">{note.category === 'tarea' ? '📋' : note.category === 'ventas' ? '💸' : note.category === 'inventario' ? '📦' : note.category === 'caja' ? '💰' : note.category === 'produccion' ? '🏭' : '📌'}</span>
            {editing === note.id ? (
              <input value={note.title} onChange={e => onUpdate(note.id, { title: e.target.value })} onBlur={() => setEditing(null)} autoFocus
                className="flex-1 mx-1 text-xs font-bold bg-transparent border-b border-dashed border-gray-400 outline-none" />
            ) : (
              <span onDoubleClick={() => setEditing(note.id)}
                className={`flex-1 mx-1 text-xs font-bold truncate cursor-text ${note.status === 'done' ? 'line-through text-gray-500' : 'text-gray-700'}`}>
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
          {/* Content */}
          <textarea value={note.content}
            onChange={e => onUpdate(note.id, { content: e.target.value })}
            placeholder="Escribí algo..."
            className="w-full h-[calc(100%-36px)] px-3 py-2 text-xs bg-transparent resize-none outline-none placeholder:text-gray-400"
            style={{ color: '#4A3E3E' }} />
          {/* Footer */}
          {note.dueDate && (
            <div className="absolute bottom-1 right-2 text-[10px] text-gray-400 flex items-center gap-1">
              <Calendar className="w-2.5 h-2.5" />
              {new Date(note.dueDate).toLocaleDateString()}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
