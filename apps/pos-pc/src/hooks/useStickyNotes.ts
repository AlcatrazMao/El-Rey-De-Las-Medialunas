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
const ADD_NOTE_EVENT = 'sticky-note-add';

// Despacha la nota vía evento — el hook la aplica al state directamente,
// evitando el race condition de lectura/escritura paralela en localStorage.
export function addAutoNote(title: string, content: string, category: StickyNote['category'], priority: StickyNote['priority'] = 'medium') {
  const note: StickyNote = {
    id: `auto_${Date.now()}`,
    x: 40, y: 40,
    width: 260, height: 180,
    title, content,
    color: COLORS[category],
    category, status: 'active',
    created: new Date().toISOString(),
    priority,
  };
  // Try live dispatch first
  window.dispatchEvent(new CustomEvent<StickyNote>(ADD_NOTE_EVENT, { detail: note }));

  // Also persist to a queue in localStorage so notes survive if view isn't mounted
  try {
    const queue = JSON.parse(localStorage.getItem('pan_erp_notes_queue') ?? '[]');
    queue.push({ title, content, category, priority, queuedAt: new Date().toISOString() });
    localStorage.setItem('pan_erp_notes_queue', JSON.stringify(queue));
  } catch {
    // ignore quota errors
  }
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

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
      } catch {
        // quota exceeded — silently skip
      }
    }, 500); // 500ms debounce

    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [notes]);

  // Recibe notas del evento ADD_NOTE_EVENT con los datos en detail,
  // sin tocar localStorage — el useEffect de arriba persiste solo.
  useEffect(() => {
    const onAdd = (e: Event) => {
      const note = (e as CustomEvent<StickyNote>).detail;
      if (!note?.id) return;
      setNotes(prev => {
        if (prev.some(n => n.id === note.id)) return prev;
        return [{ ...note, x: 40 + prev.length * 20, y: 40 + prev.length * 20 }, ...prev];
      });
    };
    window.addEventListener(ADD_NOTE_EVENT, onAdd);
    return () => window.removeEventListener(ADD_NOTE_EVENT, onAdd);
  }, []);

  // Drain the queue of notes that were dispatched while this view was unmounted
  useEffect(() => {
    try {
      const queue = JSON.parse(localStorage.getItem('pan_erp_notes_queue') ?? '[]');
      if (queue.length > 0) {
        localStorage.removeItem('pan_erp_notes_queue');
        queue.forEach((item: { title: string; content: string; category: StickyNote['category']; priority: StickyNote['priority'] }) => {
          setNotes(prev => {
            const newNote: StickyNote = {
              id: `auto_q_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              x: 40 + prev.length * 20,
              y: 40 + prev.length * 20,
              width: 260,
              height: 180,
              title: item.title,
              content: item.content,
              color: COLORS[item.category],
              category: item.category,
              status: 'active',
              created: new Date().toISOString(),
              priority: item.priority,
            };
            if (prev.some(n => n.title === newNote.title && n.content === newNote.content)) return prev;
            return [newNote, ...prev];
          });
        });
      }
    } catch {
      // ignore
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount

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

  const addAutoNoteLocal = useCallback((title: string, content: string, category: StickyNote['category'], priority: StickyNote['priority'] = 'medium') => {
    addNote({ title, content, category, priority });
  }, [addNote]);

  const notesRef = useRef(notes);
  notesRef.current = notes;

  const syncDailyTasks = useCallback((userRole: string) => {
    const today = new Date().getDay();
    const todayStr = new Date().toISOString().split('T')[0];
    const dailyTasks = loadDailyTasks();
    const specialTasks = loadSpecialTasks();

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
  }, [addNote]);

  return { notes, addNote, deleteNote, updateNote, toggleStatus, addAutoNote: addAutoNoteLocal, syncDailyTasks, setNotes };
}
