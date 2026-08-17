import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Calendar, ChevronRight, Trash2, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { OrdemDoDia } from '@/types/ordemDoDia';
import QuickForm from '@/components/common/QuickForm';

export default function OrdensDoDia() {
  const navigate = useNavigate();
  const toast = useToast();
  const [ordens, setOrdens] = useState<OrdemDoDia[]>([]);
  const [novaAberta, setNovaAberta] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  useEffect(() => { fetchOrdens(); }, []);

  // Tempo real: ordens criadas/alteradas por outros usuários aparecem sem spinner
  useRealtimeRefetch(['ordens_do_dia'], () => fetchOrdens(true));

  async function fetchOrdens(silent = false) {
    try {
      if (!silent) setLoading(true);
      const { data, error } = await supabase
        .from('ordens_do_dia')
        .select('*')
        .order('data_producao', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      setOrdens((data || []) as OrdemDoDia[]);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      const { error } = await supabase.from('ordens_do_dia').delete().eq('id', deletingId);
      if (error) throw error;
      toast.success('Ordem do Dia excluída.');
      setDeletingId(null);
      setIsDeleteModalOpen(false);
      fetchOrdens();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const filtered = ordens.filter(o =>
    o.titulo.toLowerCase().includes(searchTerm.toLowerCase()) ||
    o.codigo.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    try {
      return format(new Date(d + 'T00:00:00'), "dd 'de' MMM 'de' yyyy", { locale: ptBR });
    } catch {
      return d;
    }
  };

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">Ordens do Dia</h1>
          <p className="text-lumos-text-secondary text-sm">Briefings e cronogramas operacionais das produções.</p>
        </div>
        <button onClick={() => setNovaAberta(true)} className="btn-primary h-10 px-6 flex items-center gap-2">
          <Plus className="w-4 h-4" /> Nova Ordem do Dia
        </button>
      </div>

      <div className="card p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
          <input
            type="text"
            placeholder="Buscar por código ou título..."
            className="input-lumos pl-10 w-full h-10"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {loading ? (
          <div className="card p-12 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-lumos-yellow mx-auto"></div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-12 text-center text-lumos-text-secondary text-sm italic">
            Nenhuma ordem do dia criada ainda.
          </div>
        ) : (
          filtered.map(o => (
            <div
              key={o.id}
              onClick={() => navigate(`/ordem-do-dia/${o.id}`)}
              className={clsx(
                'card p-6 flex flex-col md:flex-row items-center gap-6 hover:border-lumos-yellow/30 cursor-pointer group relative transition-all'
              )}
            >
              <div className="flex-1 w-full">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-black text-lumos-yellow bg-lumos-yellow/10 px-2 py-0.5 rounded uppercase tracking-tighter">
                    {o.codigo}
                  </span>
                  <h3 className="text-lg font-bold text-lumos-text-primary group-hover:text-lumos-yellow transition-colors">
                    {o.titulo}
                  </h3>
                </div>
                <p className="text-xs text-lumos-text-secondary flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Produção em {formatDate(o.data_producao)}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={e => { e.stopPropagation(); setDeletingId(o.id); setIsDeleteModalOpen(true); }}
                  className="p-2 rounded-full hover:bg-red-500/10 text-lumos-text-secondary hover:text-red-500 transition-all"
                  title="Excluir"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <ChevronRight className="w-5 h-5 text-lumos-text-secondary group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          ))
        )}
      </div>

      <Modal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} title="Excluir Ordem do Dia">
        <div className="space-y-4">
          <div className="flex gap-4 items-start">
            <div className="p-3 bg-red-500/10 rounded-full flex-shrink-0">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <div className="space-y-1">
              <p className="text-lumos-text-primary font-bold">Confirma a exclusão?</p>
              <p className="text-xs text-lumos-text-secondary">
                Esta ação não pode ser desfeita. Os dados deste documento serão permanentemente removidos.
              </p>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setIsDeleteModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handleDelete} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lumos flex-1 transition-all">
              Sim, Excluir
            </button>
          </div>
        </div>
      </Modal>
      {novaAberta && (
        <QuickForm title="Nova Ordem do Dia" submitLabel="Criar"
          fields={[
            { key: 'nome', label: 'Nome', value: 'Ordem do Dia - ', required: true },
            { key: 'data', label: 'Data da produção', type: 'date' },
            { key: 'hora', label: 'Hora do início', type: 'time', value: '08:00' },
            { key: 'locacao', label: 'Primeira locação (opcional)', placeholder: 'Ex.: Praia da Reserva, Rio de Janeiro' },
          ]}
          onSubmit={async v => {
            const base: Record<string, unknown> = {
              codigo: `OD-${ordens.length + 1}`,
              titulo: v.nome.trim(),
              data_producao: v.data || null,
              hora_inicio: v.hora || null,
              ...(v.locacao.trim() ? { locacao: { nome: v.locacao.trim(), endereco: '', observacoes: '' } } : {}),
            };
            let { data: novo, error } = await supabase.from('ordens_do_dia').insert([base]).select('id').single();
            if (error && /hora_inicio/.test(String(error.message))) {
              const { hora_inicio: _h, ...semHora } = base;
              ({ data: novo, error } = await supabase.from('ordens_do_dia').insert([semHora]).select('id').single());
            }
            if (error || !novo) { toast.error('Não foi possível criar.'); return; }
            navigate(`/ordem-do-dia/${novo.id}`);
          }}
          onClose={() => setNovaAberta(false)} />
      )}
    </div>
  );
}
