import { Plus, LayoutGrid, List, StickyNote as StickyNoteIcon, CalendarCheck } from 'lucide-react';
import * as React from 'react'
import { useState, useEffect } from 'react';

import { useApp } from '../AppContext';
import { useStickyNotes, type StickyNote } from '../hooks/useStickyNotes';

import { DailyTasksConfig } from './DailyTasksConfig';
import { NotesCanvas } from './NotesCanvas';
import { NotesList } from './NotesList';

export const StickyNotesView: React.FC = () => {
  const { notes, addNote, deleteNote, updateNote, toggleStatus, syncDailyTasks } = useStickyNotes();
  const { activeUser } = useApp();
  const [view, setView] = useState<'canvas' | 'list'>('canvas');
  const [showNewForm, setShowNewForm] = useState(false);
  const [showTaskConfig, setShowTaskConfig] = useState(false);
  const [newNote, setNewNote] = useState({ title: '', content: '', category: 'general' as StickyNote['category'], priority: 'medium' as StickyNote['priority'] });

  useEffect(() => { syncDailyTasks(activeUser.role); }, [activeUser.role]);

  const handleAdd = () => {
    if (!newNote.title.trim()) return;
    addNote(newNote);
    setNewNote({ title: '', content: '', category: 'general', priority: 'medium' });
    setShowNewForm(false);
  };

  const activeCount = notes.filter(n => n.status === 'active').length;
  const doneCount = notes.filter(n => n.status === 'done').length;

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <StickyNoteIcon className="w-5 h-5 text-amber-500" />
          <h2 className="text-base font-bold text-gray-800 dark:text-zinc-100">Notas</h2>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">{activeCount} activas</span>
            {doneCount > 0 && <span className="text-emerald-600">{doneCount} hechas</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex bg-gray-100 dark:bg-zinc-800 rounded-lg p-0.5">
            <button onClick={() => setView('canvas')}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${view === 'canvas' ? 'bg-white dark:bg-zinc-700 text-amber-600 shadow-sm' : 'text-gray-500'}`}>
              <LayoutGrid className="w-3.5 h-3.5 inline mr-1" />Canvas
            </button>
            <button onClick={() => setView('list')}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${view === 'list' ? 'bg-white dark:bg-zinc-700 text-amber-600 shadow-sm' : 'text-gray-500'}`}>
              <List className="w-3.5 h-3.5 inline mr-1" />Lista
            </button>
          </div>
          <button onClick={() => setShowTaskConfig(!showTaskConfig)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${showTaskConfig ? 'bg-amber-500 text-white' : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400'}`}>
            <CalendarCheck className="w-3.5 h-3.5" /> Tareas
          </button>
          <button onClick={() => setShowNewForm(!showNewForm)}
            className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-bold hover:bg-amber-600 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Nueva
          </button>
        </div>
      </div>

      {showTaskConfig && <DailyTasksConfig onClose={() => setShowTaskConfig(false)} onSync={() => syncDailyTasks(activeUser.role)} />}

      {/* New note form */}
      {showNewForm && (
        <div className="bg-white dark:bg-zinc-900 border border-amber-200 dark:border-zinc-800 rounded-xl p-3 space-y-2">
          <input value={newNote.title} onChange={e => setNewNote({ ...newNote, title: e.target.value })}
            placeholder="T├¡tulo de la nota" onKeyDown={e => e.key === 'Enter' && handleAdd()}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-950 border rounded-lg text-sm font-bold" autoFocus />
          <textarea value={newNote.content} onChange={e => setNewNote({ ...newNote, content: e.target.value })}
            placeholder="Contenido..." rows={2}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-950 border rounded-lg text-xs resize-none" />
          <div className="flex items-center gap-2">
            <select value={newNote.category} onChange={e => setNewNote({ ...newNote, category: e.target.value as StickyNote['category'] })}
              className="px-2 py-1.5 bg-gray-50 dark:bg-zinc-950 border rounded-lg text-xs">
              <option value="general">General</option>
              <option value="tarea">Tarea</option>
              <option value="ventas">Ventas</option>
              <option value="inventario">Inventario</option>
              <option value="caja">Caja</option>
              <option value="produccion">Producción</option>
            </select>
            <select value={newNote.priority} onChange={e => setNewNote({ ...newNote, priority: e.target.value as StickyNote['priority'] })}
              className="px-2 py-1.5 bg-gray-50 dark:bg-zinc-950 border rounded-lg text-xs">
              <option value="high">­ƒö┤ Alta</option>
              <option value="medium">­ƒƒí Media</option>
              <option value="low">ÔÜ¬ Baja</option>
            </select>
            <div className="flex-1" />
            <button onClick={() => setShowNewForm(false)}
              className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">Cancelar</button>
            <button onClick={handleAdd}
              className="px-4 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-bold">Crear</button>
          </div>
        </div>
      )}

      {/* Content */}
      {view === 'canvas' ? (
        <NotesCanvas notes={notes} onUpdate={updateNote} onDelete={deleteNote} onToggle={toggleStatus} />
      ) : (
        <NotesList notes={notes} onUpdate={updateNote} onDelete={deleteNote} onToggle={toggleStatus} />
      )}
    </div>
  );
};
