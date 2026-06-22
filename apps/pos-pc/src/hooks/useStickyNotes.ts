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
const QUEUE_STORAGE_KEY = 'pan_erp_notes_queue';

export interface QueuedNote {
  title: string;
  content: string;
  category: StickyNote['category'];
  priority: StickyNote['priority'];
  queuedAt?: string;
}

// Lee y vacía atómicamente el queue de notas persistidas en localStorage.
// Exportado para tests aislados.
export function drainQueuedNotes(): QueuedNote[] {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(QUEUE_STORAGE_KEY);
      return [];
    }
    localStorage.removeItem(QUEUE_STORAGE_KEY);
    return parsed.filter((item): item is QueuedNote => {
      if (!item || typeof item !== 'object') return false;
      const q = item as Record<string, unknown>;
      return typeof q.title === 'string' && typeof q.content === 'string'
        && typeof q.category === 'string' && typeof q.priority === 'string';
    });
  } catch {
    return [];
  }
}

// Convierte una QueuedNote en StickyNote completa con coordenadas calculadas.
export function buildStickyFromQueued(item: QueuedNote, offsetIdx: number): StickyNote {
  return {
    id: `auto_q_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    x: 40 + offsetIdx * 20,
    y: 40 + offsetIdx * 20,
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
}

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
    const queue = JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) ?? '[]');
    queue.push({ title, content, category, priority, queuedAt: new Date().toISOString() });
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
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

  // Drena el queue persistido y aplica notas pendientes al state.
  // Se llama al mount Y cuando llega un CustomEvent — evita el race donde el
  // listener no estaba listo cuando la nota se persistió al queue, y previene
  // duplicación si la misma nota llegó por evento y queue al mismo tiempo.
  const drainQueueIntoState = useCallback(() => {
    const queue = drainQueuedNotes();
    if (queue.length === 0) return;
    setNotes(prev => {
      let next = prev;
      queue.forEach((item, i) => {
        // Deduplicar por título+contenido (las notas de queue no tienen id estable).
        if (next.some(n => n.title === item.title && n.content === item.content)) return;
        const newNote = buildStickyFromQueued(item, next.length + i);
        next = [newNote, ...next];
      });
      return next;
    });
  }, []);

  // Recibe notas del evento ADD_NOTE_EVENT con los datos en detail,
  // sin tocar localStorage — el useEffect de arriba persiste solo.
  // Además aprovecha la llegada de un evento para drenar el queue, cubriendo
  // el caso de que `addAutoNote` haya despachado el evento antes de que este
  // listener estuviera registrado: la nota igual queda persistida en el queue
  // y el siguiente drain la recupera sin duplicarla.
  useEffect(() => {
    const onAdd = (e: Event) => {
      const note = (e as CustomEvent<StickyNote>).detail;
      if (!note?.id) {
        // Evento sin payload — sólo drena queue.
        drainQueueIntoState();
        return;
      }
      setNotes(prev => {
        if (prev.some(n => n.id === note.id)) return prev;
        return [{ ...note, x: 40 + prev.length * 20, y: 40 + prev.length * 20 }, ...prev];
      });
      // Cualquier evento es señal para drenar; idempotente porque el queue se vacía.
      drainQueueIntoState();
    };
    window.addEventListener(ADD_NOTE_EVENT, onAdd);
    // Drain inicial al montar — captura todo lo que llegó mientras estaba unmounted.
    drainQueueIntoState();
    return () => window.removeEventListener(ADD_NOTE_EVENT, onAdd);
  }, [drainQueueIntoState]);

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
