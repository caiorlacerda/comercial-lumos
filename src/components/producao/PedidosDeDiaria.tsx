import { useCallback, useEffect, useState } from 'react';
import { AlarmClock, Check, Clock, Loader2, MapPin, Tag, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/components/ui/useConfirm';
import QuickForm from '@/components/common/QuickForm';

/**
 * Fila de pedidos de diária feitos pelo cliente no portal (aba Diárias, bem
 * no topo). Aceitar chama `aceitar_pedido_diaria`, que cria a diária de
 * gravação e fecha o pedido numa transação só. Se o dia já tiver diária de
 * outro projeto, a função devolve `dia_ocupado` em vez de recusar sozinha:
 * confirma com quem está aceitando e chama de novo com `p_confirmar: true`.
 * Recusar é update direto na tabela, com um motivo que o cliente vê no
 * portal. Fila vazia não ocupa tela: sem pedido pendente, não renderiza nada.
 */

interface Pedido {
  id: string;
  nome: string;
  email: string;
  data_desejada: string;
  duracao_horas: number;
  local: string | null;
  descricao: string;
  fora_do_pacote: boolean;
}

interface Props { projectId: string; canManage: boolean; onMudou: () => void }

// toLocaleDateString devolve tudo minúsculo; só a primeira letra sobe.
const fmtData = (d: string) => {
  const s = new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default function PedidosDeDiaria({ projectId, canManage, onMudou }: Props) {
  const { profile } = useAuth();
  const toast = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [processando, setProcessando] = useState<string | null>(null);
  const [recusando, setRecusando] = useState<Pedido | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('diaria_pedidos')
      .select('id, nome, email, data_desejada, duracao_horas, local, descricao, fora_do_pacote')
      .eq('project_id', projectId).eq('estado', 'pendente')
      .order('created_at', { ascending: true });
    setPedidos((data as Pedido[]) || []);
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const aceitar = async (p: Pedido, confirmar = false) => {
    setProcessando(p.id);
    const { data, error } = await supabase.rpc('aceitar_pedido_diaria', { p_pedido_id: p.id, p_confirmar: confirmar });
    setProcessando(null);
    const r = data as { ok?: boolean; error?: string; ocupado_por?: string } | null;
    if (error || r?.error === 'sem_permissao') { toast.error('Não foi possível aceitar o pedido.'); return; }
    if (r?.error === 'nao_encontrado') { toast.error('Esse pedido não está mais pendente, alguém já respondeu.'); load(); return; }
    if (r?.error === 'dia_ocupado') {
      const seguir = await confirm({
        title: 'Esse dia já tem gravação',
        message: `Já existe diária em ${r.ocupado_por} nesse dia. Quer marcar assim mesmo?`,
        confirmLabel: 'Marcar assim mesmo',
      });
      if (seguir) await aceitar(p, true);
      return;
    }
    if (r?.ok) {
      toast.success('Pedido aceito, diária criada ✓');
      load();
      onMudou();
      return;
    }
    // RPC não devolveu nem erro reconhecido nem `ok`, o que não deveria
    // acontecer, mas o botão não pode ficar mudo, sem toast, sem recarregar.
    toast.error('Não deu pra saber se o pedido foi aceito, confira a fila.');
    load();
  };

  const recusar = async (motivo: string) => {
    if (!recusando) return;
    // Mesma guarda que o aceitar tem no SQL (FOR UPDATE + WHERE estado =
    // 'pendente'): sem o filtro por estado aqui, um pedido aceito por outra
    // pessoa entre a fila carregar e o motivo ser enviado vira 'recusado' por
    // cima do 'aceito', mantendo a diária já criada, um estado que engana o
    // cliente no portal. `select()` devolve as linhas afetadas, então dá pra
    // distinguir "recusou" de "não achou nada pendente pra recusar".
    const { data, error } = await supabase.from('diaria_pedidos').update({
      estado: 'recusado',
      motivo_recusa: motivo.trim(),
      respondido_por: profile?.id || null,
      respondido_em: new Date().toISOString(),
    }).eq('id', recusando.id).eq('estado', 'pendente').select('id');
    if (error) { toast.error('Não foi possível recusar o pedido.'); return; }
    if (!data || data.length === 0) {
      toast.error('Esse pedido não está mais pendente, alguém já respondeu.');
      load();
      return;
    }
    toast.success('Pedido recusado.');
    load();
  };

  if (pedidos.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-black uppercase tracking-widest text-lumos-text-primary flex items-center gap-2">
        <AlarmClock className="w-4 h-4 text-lumos-yellow" /> Pedidos de diária do cliente
        <span className="text-lumos-text-secondary font-bold normal-case tracking-normal">· {pedidos.length}</span>
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {pedidos.map(p => (
          <div key={p.id} className="card p-4 border-l-4 border-l-lumos-yellow">
            {p.fora_do_pacote && (
              <p className="inline-flex items-center gap-1 text-[9.5px] font-black uppercase tracking-widest text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5 mb-2">
                <Tag className="w-3 h-3" /> Fora do pacote, cobrança à parte
              </p>
            )}
            <p className="text-[13px] font-black text-lumos-text-primary">{p.nome}</p>
            <p className="text-[11px] text-lumos-text-secondary truncate">{p.email}</p>

            <div className="mt-2.5 space-y-1.5 text-[11.5px] text-lumos-text-primary">
              <p>{fmtData(p.data_desejada)}</p>
              <p className="flex items-center gap-2 text-lumos-text-secondary">
                <Clock className="w-3.5 h-3.5 flex-shrink-0" /> {Number(p.duracao_horas).toLocaleString('pt-BR')} horas
              </p>
              {p.local && (
                <p className="flex items-center gap-2 min-w-0 text-lumos-text-secondary">
                  <MapPin className="w-3.5 h-3.5 flex-shrink-0" /> <span className="truncate">{p.local}</span>
                </p>
              )}
            </div>

            <p className="text-[11.5px] text-lumos-text-secondary mt-2 leading-snug">{p.descricao}</p>

            {canManage && (
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-lumos-border/50">
                <button type="button" disabled={processando === p.id} onClick={() => aceitar(p)}
                  className="flex items-center gap-1.5 text-xs font-bold text-green-500 hover:bg-green-500/10 px-3 py-1.5 rounded-lumos border border-green-500/20 disabled:opacity-60">
                  {processando === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Aceitar
                </button>
                <button type="button" disabled={processando === p.id} onClick={() => setRecusando(p)}
                  className="flex items-center gap-1.5 text-xs font-bold text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lumos border border-red-500/20 disabled:opacity-60">
                  <X className="w-3.5 h-3.5" /> Recusar
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {confirmDialog}

      {recusando && (
        <QuickForm
          title={`Recusar pedido de ${recusando.nome}`}
          fields={[{
            key: 'motivo',
            label: 'Motivo da recusa, o cliente vai ver isso no portal',
            placeholder: 'Ex.: Data já reservada para outro projeto',
            required: true,
          }]}
          submitLabel="Recusar"
          onSubmit={v => recusar(v.motivo)}
          onClose={() => setRecusando(null)}
        />
      )}
    </div>
  );
}
