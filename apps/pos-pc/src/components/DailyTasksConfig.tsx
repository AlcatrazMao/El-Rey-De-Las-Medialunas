import React, { useState, useEffect } from 'react';
import { X, Plus, Calendar, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { type DailyTask, type SpecialTask, getDefaultDailyTasks, loadDailyTasks, saveDailyTasks, loadSpecialTasks, saveSpecialTasks } from '../hooks/dailyTasks';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const ROLES: { value: DailyTask['assignedRole']; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'admin', label: 'Admin' },
  { value: 'cajero', label: 'Cajero' },
  { value: 'panadero', label: 'Panadero' },
];

interface Props {
  onClose: () => void;
  onSync: () => void;
}

export const DailyTasksConfig: React.FC<Props> = ({ onClose, onSync }) => {
  const [dailyTasks, setDailyTasks] = useState<DailyTask[]>(() => loadDailyTasks().length > 0 ? loadDailyTasks() : getDefaultDailyTasks());
  const [specialTasks, setSpecialTasks] = useState<SpecialTask[]>(() => loadSpecialTasks());
  const [showDailyForm, setShowDailyForm] = useState(false);
  const [showSpecialForm, setShowSpecialForm] = useState(false);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  const handleSaveDaily = (task: Partial<DailyTask>) => {
    const newTask: DailyTask = {
      id: `dt_${Date.now()}`,
      title: task.title || 'Nueva tarea',
      description: task.description || '',
      assignedRole: task.assignedRole || 'all',
      days: task.days || [1,2,3,4,5,6],
      time: task.time,
      priority: task.priority || 'medium',
      active: true,
    };
    const updated = [newTask, ...dailyTasks];
    setDailyTasks(updated);
    saveDailyTasks(updated);
    onSync();
    setShowDailyForm(false);
  };

  // Auto-save when dailyTasks changes
  useEffect(() => { saveDailyTasks(dailyTasks); }, [dailyTasks]);
  useEffect(() => { saveSpecialTasks(specialTasks); }, [specialTasks]);

  const toggleDay = (taskId: string, day: number) => {
    setDailyTasks(prev => prev.map(t => t.id === taskId ? {
      ...t, days: t.days.includes(day) ? t.days.filter(d => d !== day) : [...t.days, day].sort()
    } : t));
  };

  const toggleActive = (taskId: string) => {
    setDailyTasks(prev => prev.map(t => t.id === taskId ? { ...t, active: !t.active } : t));
  };

  const deleteDaily = (taskId: string) => {
    const updated = dailyTasks.filter(t => t.id !== taskId);
    setDailyTasks(updated);
    saveDailyTasks(updated);
  };

  const handleAddSpecial = (task: Partial<SpecialTask>) => {
    const newTask: SpecialTask = {
      id: `st_${Date.now()}`,
      date: task.date || new Date().toISOString().split('T')[0],
      title: task.title || 'Evento especial',
      description: task.description || '',
      assignedRole: task.assignedRole || 'all',
      priority: task.priority || 'medium',
    };
    const updated = [newTask, ...specialTasks];
    setSpecialTasks(updated);
    saveSpecialTasks(updated);
    onSync();
    setShowSpecialForm(false);
  };

  const deleteSpecial = (id: string) => {
    const updated = specialTasks.filter(t => t.id !== id);
    setSpecialTasks(updated);
    saveSpecialTasks(updated);
  };

  return (
    <div className="bg-white dark:bg-zinc-900 border border-amber-200 dark:border-zinc-800 rounded-xl p-4 space-y-4 max-h-[60vh] overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold flex items-center gap-2"><Calendar className="w-4 h-4 text-amber-500" /> Tareas Diarias</h3>
        <button onClick={onClose}><X className="w-4 h-4" /></button>
      </div>

      {/* Daily tasks list */}
      <div className="space-y-2">
        {dailyTasks.map(task => (
          <div key={task.id} className={`border rounded-lg p-2 ${task.active ? 'border-amber-200 dark:border-zinc-700' : 'border-gray-100 dark:border-zinc-800 opacity-50'}`}>
            <div className="flex items-center gap-2">
              <button onClick={() => toggleActive(task.id)} className={`text-xs ${task.active ? 'text-emerald-600' : 'text-gray-400'}`}>
                {task.active ? '🟢' : '⚫'}
              </button>
              <span className="flex-1 text-xs font-bold truncate">{task.title}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${task.priority === 'high' ? 'bg-red-100 text-red-600' : task.priority === 'medium' ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-500'}`}>
                {task.priority}
              </span>
              <button onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}>
                {expandedTask === task.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              <button onClick={() => deleteDaily(task.id)} className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
            </div>
            {expandedTask === task.id && (
              <div className="mt-2 pt-2 border-t border-gray-100 dark:border-zinc-800 space-y-1.5">
                <div className="flex items-center gap-1 flex-wrap">
                  {DAYS.map((d, i) => (
                    <button key={i} onClick={() => toggleDay(task.id, i)}
                      className={`w-7 h-6 text-[10px] rounded font-bold ${task.days.includes(i) ? 'bg-amber-500 text-white' : 'bg-gray-100 dark:bg-zinc-800 text-gray-500'}`}>{d}</button>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-gray-500">
                  <Clock className="w-2.5 h-2.5" />{task.time || 'Sin hora'}
                  <span>· {ROLES.find(r => r.value === task.assignedRole)?.label}</span>
                </div>
                {task.description && <p className="text-[10px] text-gray-400">{task.description}</p>}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add daily task button */}
      <button onClick={() => setShowDailyForm(true)}
        className="w-full py-2 border border-dashed border-gray-300 dark:border-zinc-700 rounded-lg text-xs text-gray-500 hover:border-amber-500 hover:text-amber-600 transition-colors">
        + Agregar tarea diaria
      </button>

      {/* Special tasks section */}
      <div className="border-t pt-3">
        <h4 className="text-xs font-bold flex items-center gap-1 mb-2">📅 Fechas especiales</h4>
        {specialTasks.map(t => (
          <div key={t.id} className="flex items-center gap-2 py-1 text-xs">
            <span className="text-amber-600 font-bold">{t.date}</span>
            <span className="flex-1 truncate">{t.title}</span>
            <button onClick={() => deleteSpecial(t.id)} className="text-gray-400 hover:text-red-500"><X className="w-2.5 h-2.5" /></button>
          </div>
        ))}
        <button onClick={() => setShowSpecialForm(true)}
          className="w-full py-1.5 border border-dashed border-gray-300 dark:border-zinc-700 rounded-lg text-xs text-gray-500 hover:border-amber-500 hover:text-amber-600 transition-colors mt-2">
          + Agregar fecha especial
        </button>
      </div>

      {/* Add Daily Task Modal */}
      {showDailyForm && <TaskForm type="daily" onSave={(t) => handleSaveDaily(t)} onClose={() => setShowDailyForm(false)} />}
      {/* Add Special Task Modal */}
      {showSpecialForm && <TaskForm type="special" onSave={(t) => handleAddSpecial(t)} onClose={() => setShowSpecialForm(false)} />}
    </div>
  );
};

// Inline form component
function TaskForm({ type, onSave, onClose }: { type: 'daily' | 'special'; onSave: (t: any) => void; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [role, setRole] = useState<DailyTask['assignedRole']>('all');
  const [prio, setPrio] = useState<DailyTask['priority']>('medium');
  const [time, setTime] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  const save = () => {
    if (!title.trim()) return;
    onSave({ title, description: desc, assignedRole: role, priority: prio, time: time || undefined, date });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-2xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <h4 className="text-sm font-bold mb-3">{type === 'daily' ? 'Nueva Tarea Diaria' : 'Nueva Fecha Especial'}</h4>
        <div className="space-y-2">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Título" className="w-full px-3 py-2 border rounded-lg text-sm" autoFocus />
          <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Descripción" rows={2} className="w-full px-3 py-2 border rounded-lg text-xs" />
          {type === 'special' && <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />}
          {type === 'daily' && <input type="time" value={time} onChange={e => setTime(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />}
          <div className="flex gap-2">
            <select value={role} onChange={e => setRole(e.target.value as any)} className="flex-1 px-2 py-2 border rounded-lg text-xs">
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <select value={prio} onChange={e => setPrio(e.target.value as any)} className="flex-1 px-2 py-2 border rounded-lg text-xs">
              <option value="high">🔴 Alta</option>
              <option value="medium">🟡 Media</option>
              <option value="low">⚪ Baja</option>
            </select>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 py-2 border rounded-xl text-sm">Cancelar</button>
            <button onClick={save} className="flex-1 py-2 bg-amber-500 text-white rounded-xl text-sm font-bold">Guardar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
