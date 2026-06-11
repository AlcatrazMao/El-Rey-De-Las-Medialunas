import { useState, useEffect, useCallback, useRef } from 'react';

import { loadDailyTasks, loadSpecialTasks } from './dailyTasks';

export interface StickyNote {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  content: string;
  color: string;
  category: 'general' | 'ventas' | 'inventario' | 'caja' | 'produccion' | 'tarea';
  status: 'active' | 'done' | 'archived';
  created: string;
  dueDate?: string;
  priority: 'low' | 'medium' | 'high';
}

const COLORS: Record<StickyNote['category'], string> = {
  general: '#FFF8DC',
  ventas: '#EFF6FF',
  inventario: '#F0FDF4',
  caja: '#FFF7ED',
  produccion: '#FAF5FF',
  tarea: '#FEF2F2',
};

const STORAGE_KEY = 'erp_sticky_notes_v2';

// Helper to add auto-notes from anywhere (AppContext, etc.)
export function addAutoNote(title: string, content: string, category: StickyNote['category'], priority: StickyNote['priority'] = 'medium') {
  try {
    const notes: StickyNote[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    notes.unshift({
      id: `auto_${Date.now()}`,
      x: 40 + notes.length * 20,
      y: 40 + notes.length * 20,
      width: 260, height: 180,
      title, content,
      color: COLORS[category],
      category, status: 'active',
      created: new Date().toISOString(),
      priority,
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    // Dispatch event so the hook picks it up
    window.dispatchEvent(new CustomEvent('sticky-note-added'));
  } catch { /* localStorage not available */ }
}

const defaultNotes: StickyNote[] = [
  { id: 'default_1', x: 40, y: 40, width: 260, height: 180, title: '📋 Tareas del día',
    content: '• Revisar stock de harina\n• Preparar masa para medialunas\n• Limpiar vitrinas', color: COLORS.tarea, category: 'tarea', status: 'active', created: new Date().toISOString(), priority: 'high' },
  { id: 'default_2', x: 340, y: 40, width: 260, height: 180, title: '💰 Caja pendiente',
    content: 'Cerrar caja del turno mañana\nDiferencia esperada: ±$50', color: COLORS.caja, category: 'caja', status: 'active', created: new Date().toISOString(), priority: 'medium' },
  { id: 'default_3', x: 640, y: 40, width: 260, height: 180, title: '🏭 Producción',
    content: '• Pan francés: 50 unidades\n• Medialunas: 120 unidades\n• Facturas: 80 unidades', color: COLORS.produccion, category: 'produccion', status: 'active', created: new Date().toISOString(), priority: 'high' },
];

export function useStickyNotes() {
  const [notes, setNotes] = useState<StickyNote[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : defaultNotes;
    } catch { return defaultNotes; }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }, [notes]);

  // Listen for auto-notes added outside React state
  useEffect(() => {
    const reload = () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) setNotes(JSON.parse(saved));
      } catch { /* ignore parse errors */ }
    };
    window.addEventListener('sticky-note-added', reload);
    return () => window.removeEventListener('sticky-note-added', reload);
  }, []);

  const addNote = useCallback((note: Partial<StickyNote> = {}) => {
    const newNote: StickyNote = {
      id: `note_${Date.now()}`,
      x: 40 + Math.random() * 200,
      y: 40 + Math.random() * 200,
      width: 260,
      height: 180,
      title: note.title || 'Nueva nota',
      content: note.content || '',
      color: note.category ? COLORS[note.category] : COLORS.general,
      category: note.category || 'general',
      status: 'active',
      created: new Date().toISOString(),
      dueDate: note.dueDate,
      priority: note.priority || 'medium',
    };
    setNotes(prev => [newNote, ...prev]);
    return newNote;
  }, []);

  const deleteNote = useCallback((id: string) => {
    setNotes(prev => prev.filter(n => n.id !== id));
  }, []);

  const updateNote = useCallback((id: string, data: Partial<StickyNote>) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...data, color: data.category ? COLORS[data.category] : n.color } : n));
  }, []);

  const toggleStatus = useCallback((id: string) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, status: n.status === 'active' ? 'done' : 'active' } : n));
  }, []);

  const addAutoNote = useCallback((title: string, content: string, category: StickyNote['category'], priority: StickyNote['priority'] = 'medium') => {
    addNote({ title, content, category, priority, x: 40 + notes.length * 20, y: 40 + notes.length * 20 });
  }, [notes.length]);

  // Generate today's daily tasks as sticky notes
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const syncDailyTasks = useCallback((userRole: string) => {
    const today = new Date().getDay();
    const todayStr = new Date().toISOString().split('T')[0];
    const dailyTasks = loadDailyTasks();
    const specialTasks = loadSpecialTasks();

    // Check existing titles to avoid duplicates
    const existingTitles = new Set(notesRef.current.map(n => n.title));
    
    dailyTasks.filter(t => t.active && t.days.includes(today) && (t.assignedRole === userRole || t.assignedRole === 'all')).forEach(t => {
      const key = `[Diaria] ${t.title}`;
      if (!existingTitles.has(key)) {
        existingTitles.add(key);
        addNote({ title: key, content: `${t.description}\n⏰ ${t.time || 'Sin hora'}`, category: 'tarea', priority: t.priority, x: 40 + Math.random() * 200, y: 40 + Math.random() * 200 });
      }
    });

    specialTasks.filter(t => t.date === todayStr && (t.assignedRole === userRole || t.assignedRole === 'all')).forEach(t => {
      const key = `[Especial] ${t.title}`;
      if (!existingTitles.has(key)) {
        existingTitles.add(key);
        addNote({ title: key, content: t.description, category: 'tarea', priority: t.priority, x: 40 + Math.random() * 200, y: 40 + Math.random() * 200 });
      }
    });
  }, []);

  return { notes, addNote, deleteNote, updateNote, toggleStatus, addAutoNote, syncDailyTasks, setNotes };
}
