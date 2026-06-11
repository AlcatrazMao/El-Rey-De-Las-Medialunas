import { Check, X, Edit3, Calendar, Flag, Filter } from 'lucide-react';
import * as React from 'react'
import { useState } from 'react';

import type { StickyNote } from '../hooks/useStickyNotes';

interface NotesListProps {
  notes: StickyNote[];
  onUpdate: (id: string, data: Partial<StickyNote>) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
}

export const NotesList: React.FC<NotesListProps> = ({ notes, onUpdate, onDelete, onToggle }) => {
  const [filter, setFilter] = useState<'all' | 'active' | 'done' | 'tarea' | 'ventas' | 'inventario' | 'caja' | 'produccion'>('all');
  const [editingNote, setEditingNote] = useState<string | null>(null);

  const filtered = notes.filter(n => {
    if (filter === 'all') return n.status !== 'archived';
    if (filter === 'active') return n.status === 'active';
    if (filter === 'done') return n.status === 'done';
    return n.category === filter;
  }).sort((a, b) => {
    if (a.priority === 'high' && b.priority !== 'high') return -1;
    if (b.priority === 'high' && a.priority !== 'high') return 1;
    return new Date(b.created).getTime() - new Date(a.created).getTime();
  });

  const filters: { id: typeof filter; label: string; icon: string }[] = [
    { id: 'all', label: 'Todas', icon: '📋' },
    { id: 'active', label: 'Activas', icon: '🟢' },
    { id: 'done', label: 'Hechas', icon: '✅' },
    { id: 'tarea', label: 'Tareas', icon: '📋' },
    { id: 'ventas', label: 'Ventas', icon: '💸' },
    { id: 'inventario', label: 'Inventario', icon: '📦' },
    { id: 'caja', label: 'Caja', icon: '💰' },
    { id: 'produccion', label: 'Producción', icon: '🏭' },
  ];

  const priorityColor = (p: string) => p === 'high' ? 'text-red-500' : p === 'medium' ? 'text-amber-500' : 'text-gray-400';

  return (
    <div className="flex flex-col gap-3">
      {/* Filters */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-gray-400" />
        {filters.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
              filter === f.id ? 'bg-amber-500 text-white' : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-700'
            }`}>
            {f.icon} {f.label}
          </button>
        ))}
      </div>

      {/* Task list */}
      <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <div className="text-3xl mb-2 opacity-30">📝</div>
            <p className="text-sm">No hay {filter === 'all' ? 'notas' : filters.find(f => f.id === filter)?.label.toLowerCase()}</p>
          </div>
        )}
        {filtered.map(note => (
          <div key={note.id} className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${
            note.status === 'done' ? 'bg-gray-50 dark:bg-zinc-900/50 border-gray-200 dark:border-zinc-800 opacity-70' : 'bg-white dark:bg-zinc-900 border-amber-100 dark:border-zinc-800'
          }`}>
            <button onClick={() => onToggle(note.id)}
              className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                note.status === 'done' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 hover:border-emerald-500'
              }`}>
              {note.status === 'done' && <Check className="w-3 h-3" />}
            </button>
            <div className="flex-1 min-w-0">
              {editingNote === note.id ? (
                <input value={note.title} onChange={e => onUpdate(note.id, { title: e.target.value })} onBlur={() => setEditingNote(null)} autoFocus
                  className="text-sm font-bold bg-transparent border-b border-dashed border-gray-300 outline-none w-full" />
              ) : (
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${note.status === 'done' ? 'line-through text-gray-400' : 'text-gray-800 dark:text-zinc-100'}`}>
                    {note.title}
                  </span>
                  <Flag className={`w-3 h-3 ${priorityColor(note.priority)}`} />
                  <button onClick={() => setEditingNote(note.id)} className="text-gray-400 hover:text-amber-500"><Edit3 className="w-3 h-3" /></button>
                </div>
              )}
              {note.content && (
                <p className={`text-xs mt-1 whitespace-pre-wrap ${note.status === 'done' ? 'text-gray-400' : 'text-gray-600 dark:text-zinc-400'}`}>
                  {note.content}
                </p>
              )}
              <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400">
                <span className="flex items-center gap-1">
                  {note.category === 'tarea' ? '📋' : note.category === 'ventas' ? '💸' : note.category === 'inventario' ? '📦' : note.category === 'caja' ? '💰' : note.category === 'produccion' ? '🏭' : '📌'}
                  {note.category}
                </span>
                {note.dueDate && (
                  <span className="flex items-center gap-1"><Calendar className="w-2.5 h-2.5" />{new Date(note.dueDate).toLocaleDateString()}</span>
                )}
                <span>{new Date(note.created).toLocaleDateString()}</span>
              </div>
            </div>
            <button onClick={() => onDelete(note.id)}
              className="p-1 hover:bg-red-100 dark:hover:bg-red-900/20 rounded text-gray-400 hover:text-red-500 transition-colors shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
