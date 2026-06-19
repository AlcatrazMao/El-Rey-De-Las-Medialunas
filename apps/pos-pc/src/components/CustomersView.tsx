import {
  Search,
  Phone,
  Mail,
  CreditCard,
  Clock,
  X,
  Edit3,
  UserPlus,
  Building2,
  Users,
  TrendingUp,
  Hash,
  ArrowUpRight,
  History
} from 'lucide-react';
import * as React from 'react'
import { useState } from 'react';

import { useApp } from '../AppContext';
import type { Customer, CustomerTimelineEntry } from '../types';
import { formatCurrency } from '../utils/format';

const EMPTY_CUSTOMER: Omit<Customer, 'id' | 'created_at' | 'updated_at' | 'timeline' | 'total_purchases' | 'last_purchase_date' | 'current_debt'> = {
  name: '',
  email: '',
  phone: '',
  address: '',
  tax_id: '',
  type: 'consumidor_final',
  condicion_fiscal: 'consumidor_final',
  price_list_number: 1,
  credit_limit: 0,
  status: 'active',
  notes: ''
};

const CONDICION_FISCAL_LABELS: Record<string, string> = {
  consumidor_final: 'Consumidor Final',
  responsable_inscripto: 'Responsable Inscripto',
  monotributista: 'Monotributista',
  exento: 'Exento'
};

const TYPE_LABELS: Record<string, string> = {
  consumidor_final: 'Consumidor Final',
  frecuente: 'Cliente Frecuente',
  mayorista: 'Mayorista',
  empresa: 'Empresa'
};

export const CustomersView: React.FC = () => {
  const { sales, addSystemNotification, customers: contextCustomers, setCustomers } = useApp();
  const customers = contextCustomers;

  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formData, setFormData] = useState(EMPTY_CUSTOMER);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [newNote, setNewNote] = useState('');

  const saveCustomers = (list: Customer[]) => {
    setCustomers(list);
  };

  const handleCreate = () => {
    if (!formData.name.trim()) return;
    const now = new Date().toISOString();
    const newCustomer: Customer = {
      ...formData,
      id: `cust_${Date.now()}`,
      created_at: now,
      updated_at: now,
      timeline: [{ id: `tl_${Date.now()}`, date: now, type: 'status_change', description: 'Cliente creado', user: 'Sistema' }],
      total_purchases: 0,
      last_purchase_date: '',
      current_debt: 0
    };
    saveCustomers([newCustomer, ...customers]);
    setFormData(EMPTY_CUSTOMER);
    setShowForm(false);
    addSystemNotification('👤 Cliente Creado', `${newCustomer.name} fue registrado exitosamente.`, 'success');
  };

  const handleUpdate = () => {
    if (!editingCustomer || !formData.name.trim()) return;
    const updated = customers.map(c => {
      if (c.id === editingCustomer.id) {
        const timelineEntry: CustomerTimelineEntry = {
          id: `tl_${Date.now()}`,
          date: new Date().toISOString(),
          type: 'status_change',
          description: 'Datos actualizados',
          user: 'Sistema'
        };
        return {
          ...c,
          ...formData,
          updated_at: new Date().toISOString(),
          timeline: [timelineEntry, ...c.timeline]
        };
      }
      return c;
    });
    saveCustomers(updated);
    if (selectedCustomer && selectedCustomer.id === editingCustomer.id) {
      const refreshed = updated.find(c => c.id === editingCustomer.id);
      if (refreshed) setSelectedCustomer(refreshed);
    }
    setEditingCustomer(null);
    setFormData(EMPTY_CUSTOMER);
    setShowForm(false);
    addSystemNotification('✏️ Cliente Actualizado', `${formData.name} fue modificado.`, 'info');
  };

  const addNote = () => {
    if (!selectedCustomer || !newNote.trim()) return;
    const entry: CustomerTimelineEntry = {
      id: `tl_${Date.now()}`,
      date: new Date().toISOString(),
      type: 'note',
      description: newNote,
      user: 'Sistema'
    };
    const updated = customers.map(c => {
      if (c.id === selectedCustomer.id) {
        return { ...c, timeline: [entry, ...c.timeline], updated_at: new Date().toISOString() };
      }
      return c;
    });
    saveCustomers(updated);
    setSelectedCustomer(updated.find(c => c.id === selectedCustomer.id) || null);
    setNewNote('');
  };

  const toggleStatus = (customer: Customer) => {
    const newStatus = customer.status === 'active' ? 'inactive' : 'active';
    const entry: CustomerTimelineEntry = {
      id: `tl_${Date.now()}`,
      date: new Date().toISOString(),
      type: 'status_change',
      description: `Estado cambiado a ${newStatus === 'active' ? 'Activo' : 'Inactivo'}`,
      user: 'Sistema'
    };
    const newList = customers.map(c =>
      c.id === customer.id ? { ...c, status: newStatus as Customer['status'], timeline: [entry, ...c.timeline] } : c
    );
    saveCustomers(newList);
    const refreshed = newList.find(c => c.id === customer.id);
    if (refreshed) setSelectedCustomer(refreshed);
  };

  const customerSales = selectedCustomer
    ? sales.filter(s =>
        s.customerId === selectedCustomer.id ||
        (!s.customerId && s.customerName === selectedCustomer.name)
      )
    : [];

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.phone.includes(searchQuery) ||
    c.tax_id.includes(searchQuery)
  );

  if (selectedCustomer) {
    return (
      <div className="space-y-4">
        <button onClick={() => setSelectedCustomer(null)} className="flex items-center gap-2 text-sm text-amber-600 hover:text-amber-700 font-bold">
          ← Volver a lista
        </button>

        <div className="bg-white dark:bg-zinc-900 border border-orange-100/30 dark:border-zinc-800 rounded-2xl p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-xl font-bold text-gray-800 dark:text-zinc-100">{selectedCustomer.name}</h3>
              <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{selectedCustomer.email || '—'}</span>
                <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{selectedCustomer.phone || '—'}</span>
                <span className="bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full font-bold">{TYPE_LABELS[selectedCustomer.type]}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => toggleStatus(selectedCustomer)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${selectedCustomer.status === 'active' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
                {selectedCustomer.status === 'active' ? 'Desactivar' : 'Activar'}
              </button>
              <button onClick={() => { setEditingCustomer(selectedCustomer); setFormData(selectedCustomer); setShowForm(true); }}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-100 dark:bg-zinc-800 text-gray-600">
                <Edit3 className="w-3 h-3 inline mr-1" />Editar
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <StatCard icon={<Hash className="w-4 h-4" />} label="Condición Fiscal" value={CONDICION_FISCAL_LABELS[selectedCustomer.condicion_fiscal]} />
            <StatCard icon={<CreditCard className="w-4 h-4" />} label="Límite Crédito" value={formatCurrency(selectedCustomer.credit_limit)} />
            <StatCard icon={<TrendingUp className="w-4 h-4" />} label="Total Compras" value={formatCurrency(selectedCustomer.total_purchases)} />
            <StatCard icon={<Clock className="w-4 h-4" />} label="Última Compra" value={selectedCustomer.last_purchase_date ? new Date(selectedCustomer.last_purchase_date).toLocaleDateString() : '—'} />
          </div>

          {/* Notes */}
          <div className="mb-4">
            <label className="text-xs font-bold text-gray-500 block mb-1">Agregar nota</label>
            <div className="flex gap-2">
              <input value={newNote} onChange={e => setNewNote(e.target.value)}
                placeholder="Escribir nota o comentario..."
                className="flex-1 px-3 py-2 bg-gray-50 dark:bg-zinc-950 border rounded-lg text-sm" />
              <button onClick={addNote} className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-bold">Agregar</button>
            </div>
          </div>

          {/* Timeline */}
          <h4 className="text-sm font-bold text-gray-600 dark:text-zinc-400 mb-2 flex items-center gap-1"><History className="w-4 h-4" /> Historial</h4>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {selectedCustomer.timeline.map(entry => (
              <div key={entry.id} className="flex items-start gap-3 text-xs border-l-2 border-amber-300 dark:border-amber-700 pl-3 py-1">
                <span className="text-gray-400 whitespace-nowrap">{new Date(entry.date).toLocaleDateString()}</span>
                <span className="text-gray-700 dark:text-zinc-300">{entry.description}</span>
                {entry.amount != null && <span className="font-bold text-amber-600">{formatCurrency(entry.amount)}</span>}
              </div>
            ))}
          </div>

          {/* Sales history */}
          {customerSales.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-bold text-gray-600 dark:text-zinc-400 mb-2">Compras recientes</h4>
              <div className="space-y-1">
                {customerSales.slice(0, 10).map(s => (
                  <div key={s.id} className="flex justify-between text-xs text-gray-600 dark:text-zinc-400 py-1 border-b border-gray-100 dark:border-zinc-800">
                    <span>{s.invoiceNumber}</span>
                    <span>{new Date(s.date).toLocaleDateString()}</span>
                    <span className="font-bold">{formatCurrency(s.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-amber-500" />
          <h2 className="text-lg font-bold text-gray-800 dark:text-zinc-100">Clientes ({customers.length})</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar cliente..."
              className="pl-9 pr-4 py-2 bg-white dark:bg-zinc-900 border rounded-lg text-sm w-56"
            />
          </div>
          <button onClick={() => { setFormData(EMPTY_CUSTOMER); setEditingCustomer(null); setShowForm(true); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-bold">
            <UserPlus className="w-4 h-4" /> Nuevo
          </button>
        </div>
      </div>

      {/* Customer list */}
      <div className="bg-white dark:bg-zinc-900 border border-orange-100/30 dark:border-zinc-800 rounded-2xl overflow-hidden">
        <div className="divide-y divide-gray-100 dark:divide-zinc-800">
          {filteredCustomers.map(customer => (
            <div key={customer.id}
              onClick={() => setSelectedCustomer(customer)}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-amber-50/50 dark:hover:bg-amber-950/10 cursor-pointer transition-colors">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${
                  customer.type === 'empresa' ? 'bg-blue-100 text-blue-600' :
                  customer.type === 'mayorista' ? 'bg-purple-100 text-purple-600' :
                  'bg-amber-100 text-amber-600'
                }`}>
                  {customer.type === 'empresa' ? <Building2 className="w-5 h-5" /> : customer.name.charAt(0)}
                </div>
                <div>
                  <div className="font-bold text-gray-800 dark:text-zinc-100 text-sm">{customer.name}</div>
                  <div className="text-xs text-gray-500">{customer.email || customer.phone || 'Sin contacto'} · {TYPE_LABELS[customer.type]}</div>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="text-gray-500">{CONDICION_FISCAL_LABELS[customer.condicion_fiscal]}</span>
                {customer.credit_limit > 0 && (
                  <span className="font-bold text-amber-600">Crédito: {formatCurrency(customer.credit_limit)}</span>
                )}
                <span className={`px-2 py-0.5 rounded-full font-bold ${customer.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {customer.status === 'active' ? 'Activo' : 'Inactivo'}
                </span>
                <ArrowUpRight className="w-4 h-4 text-gray-400" />
              </div>
            </div>
          ))}
          {filteredCustomers.length === 0 && customers.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Aún no hay clientes registrados</p>
              <button onClick={() => { setFormData(EMPTY_CUSTOMER); setShowForm(true); }}
                className="text-amber-500 text-xs font-bold mt-1 hover:underline">Registrá tu primer cliente</button>
            </div>
          )}
          {filteredCustomers.length === 0 && customers.length > 0 && (
            <div className="text-center py-12 text-gray-400">
              <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No se encontraron clientes con ese filtro</p>
            </div>
          )}
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-start justify-center pt-20 px-4" onClick={() => setShowForm(false)}>
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{editingCustomer ? 'Editar Cliente' : 'Nuevo Cliente'}</h3>
              <button onClick={() => setShowForm(false)}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="Nombre o Razón Social *" className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-950 border rounded-lg text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <input value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })}
                  placeholder="Email" className="px-3 py-2 bg-gray-50 dark:bg-zinc-950 border rounded-lg text-sm" />
                <input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="Teléfono" className="px-3 py-2 bg-gray-50 dark:bg-zinc-950 border rounded-lg text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <select value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value as Customer['type'] })}
                  className="px-3 py-2 bg-gray-50 dark:bg-zinc-950 border rounded-lg text-sm">
                  {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select value={formData.condicion_fiscal} onChange={e => setFormData({ ...formData, condicion_fiscal: e.target.value as Customer['condicion_fiscal'] })}
                  className="px-3 py-2 bg-gray-50 dark:bg-zinc-950 border rounded-lg text-sm">
                  {Object.entries(CONDICION_FISCAL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <input value={formData.tax_id} onChange={e => setFormData({ ...formData, tax_id: e.target.value })}
                placeholder="CUIT / DNI" className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-950 border rounded-lg text-sm" />
              <input value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })}
                placeholder="Dirección" className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-950 border rounded-lg text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Límite de Crédito ($)</label>
                  <input type="number" value={formData.credit_limit} onChange={e => setFormData({ ...formData, credit_limit: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-950 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Lista de Precios #</label>
                  <input type="number" value={formData.price_list_number} onChange={e => setFormData({ ...formData, price_list_number: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-950 border rounded-lg text-sm" />
                </div>
              </div>
              <textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Notas internas..." rows={2} className="w-full px-3 py-2 bg-gray-50 dark:bg-zinc-950 border rounded-lg text-sm" />
              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 px-4 py-2.5 border rounded-xl text-sm font-bold">Cancelar</button>
                <button onClick={editingCustomer ? handleUpdate : handleCreate}
                  className="flex-1 px-4 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-bold">
                  {editingCustomer ? 'Guardar Cambios' : 'Crear Cliente'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-gray-50 dark:bg-zinc-950 border border-gray-100 dark:border-zinc-800 rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-gray-400 mb-1">{icon}<span className="text-[10px] font-bold uppercase">{label}</span></div>
      <div className="text-sm font-bold text-gray-800 dark:text-zinc-100">{value}</div>
    </div>
  );
}
