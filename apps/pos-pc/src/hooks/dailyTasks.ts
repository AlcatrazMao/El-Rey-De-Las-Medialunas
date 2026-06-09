// Tipos y lógica para tareas diarias configurables semanalmente
export interface DailyTask {
  id: string;
  title: string;
  description: string;
  assignedRole: 'admin' | 'cajero' | 'panadero' | 'all';
  days: number[]; // 0=Domingo...6=Sábado
  time?: string; // HH:MM
  priority: 'low' | 'medium' | 'high';
  active: boolean;
}

export interface SpecialTask {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  description: string;
  assignedRole: 'admin' | 'cajero' | 'panadero' | 'all';
  priority: 'low' | 'medium' | 'high';
}

const DAILY_TASKS_KEY = 'erp_daily_tasks';
const SPECIAL_TASKS_KEY = 'erp_special_tasks';

export function loadDailyTasks(): DailyTask[] {
  try { return JSON.parse(localStorage.getItem(DAILY_TASKS_KEY) || '[]'); } catch { return []; }
}

export function saveDailyTasks(tasks: DailyTask[]) {
  localStorage.setItem(DAILY_TASKS_KEY, JSON.stringify(tasks));
}

export function loadSpecialTasks(): SpecialTask[] {
  try { return JSON.parse(localStorage.getItem(SPECIAL_TASKS_KEY) || '[]'); } catch { return []; }
}

export function saveSpecialTasks(tasks: SpecialTask[]) {
  localStorage.setItem(SPECIAL_TASKS_KEY, JSON.stringify(tasks));
}

export function getDefaultDailyTasks(): DailyTask[] {
  return [
    { id: 'dt_1', title: 'Preparar masa de medialunas', description: 'Mezclar harina, levadura, manteca, azúcar. Dejar leudar 2h.', assignedRole: 'panadero', days: [1,2,3,4,5,6], time: '05:00', priority: 'high', active: true },
    { id: 'dt_2', title: 'Hornear pan francés', description: 'Cocinar a 200°C por 25 min. Sacar y dejar enfriar en rejilla.', assignedRole: 'panadero', days: [1,2,3,4,5,6], time: '06:30', priority: 'high', active: true },
    { id: 'dt_3', title: 'Control de stock de harina', description: 'Revisar nivel de harina 0000. Si está por debajo de 30kg, hacer pedido.', assignedRole: 'panadero', days: [1,3,5], time: '08:00', priority: 'medium', active: true },
    { id: 'dt_4', title: 'Limpieza de vitrinas', description: 'Limpiar vidrios, reponer productos, ordenar mostrador.', assignedRole: 'cajero', days: [1,2,3,4,5,6], time: '07:00', priority: 'medium', active: true },
    { id: 'dt_5', title: 'Apertura de caja', description: 'Contar cambio inicial y registrar apertura en el sistema.', assignedRole: 'cajero', days: [1,2,3,4,5,6], time: '06:00', priority: 'high', active: true },
    { id: 'dt_6', title: 'Cierre de caja y arqueo', description: 'Contar efectivo, registrar cierre, calcular diferencia.', assignedRole: 'cajero', days: [1,2,3,4,5,6], time: '20:00', priority: 'high', active: true },
    { id: 'dt_7', title: 'Revisión de pedidos pendientes', description: 'Verificar órdenes de proveedores, pagos vencidos, deudas.', assignedRole: 'admin', days: [1,3,5], time: '10:00', priority: 'medium', active: true },
    { id: 'dt_8', title: 'Inventario semanal', description: 'Conteo físico de productos terminados y materia prima.', assignedRole: 'admin', days: [6], time: '14:00', priority: 'high', active: true },
  ];
}
