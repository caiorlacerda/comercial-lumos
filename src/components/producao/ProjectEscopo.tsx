import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Plus, Target, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/components/ui/useConfirm';
import Select from '@/components/ui/Select';

/**
 * O COMBINADO DO MÊS, E QUANTO JÁ SAIU.
 *
 * Contrato de volume ("quatro diárias e doze vídeos por mês") vivia na cabeça
 * de quem fechou e numa planilha. A pergunta "quantas diárias já usamos em
 * agosto?" era respondida contando na mão, e por isso quase nunca era feita
 * antes de estourar.
 *
 * Aqui o combinado é do projeto e o realizado é CONTADO do que já existe no
 * app: diárias marcadas, vídeos entregues, tarefas concluídas. Ninguém alimenta
 * número de acompanhamento — ele é consequência do trabalho registrado, então
 * não tem como ficar desatualizado.
 */

interface Item {
  id: string;
  chave: 'diarias' | 'videos' | 'tarefas';
  rotulo: string;
  meta: number;
  periodo: 'mes' | 'projeto';
  realizado: number;
}

const CHAVES = [
  { value: 'diarias', label: 'Diárias marcadas' },
  { value: 'videos', label: 'Vídeos entregues ao cliente' },
  { value: 'tarefas', label: 'Tarefas concluídas' },
];

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const primeiroDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

interface Props { projectId: string; canManage: boolean }

export default function ProjectEscopo({ projectId, canManage }: Props) {
  const { profile } = useAuth();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [itens, setItens] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [faltaMigracao, setFaltaMigracao] = useState(false);
  const [mes, setMes] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [criando, setCriando] = useState(false);
  const [novo, setNovo] = useState({ chave: 'videos', rotulo: '', meta: '' });

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('escopo_do_mes', {
      p_project_id: projectId, p_mes: primeiroDia(mes),
    });
    if (error) { setFaltaMigracao(true); setItens([]); setLoading(false); return; }
    setFaltaMigracao(false);
    setItens((data as Item[]) || []);
    setLoading(false);
  }, [projectId, mes]);
  useEffect(() => { load(); }, [load]);

  const andarMes = (passos: number) => setMes(m => new Date(m.getFullYear(), m.getMonth() + passos, 1));

  const criar = async () => {
    const meta = parseInt(novo.meta, 10);
    if (!meta || meta < 1) { toast.error('Diga quantos por mês.'); return; }
    const rotulo = novo.rotulo.trim() || CHAVES.find(c => c.value === novo.chave)!.label;
    const { error } = await supabase.from('project_escopo').insert({
      project_id: projectId, chave: novo.chave, rotulo, meta,
      ordem: itens.length * 10, created_by: profile?.id ?? null,
    });
    if (error) {
      toast.error(/relation|does not exist/i.test(error.message)
        ? 'Falta rodar a migration 2026093324.' : 'Não foi possível salvar.');
      return;
    }
    setNovo({ chave: 'videos', rotulo: '', meta: '' });
    setCriando(false);
    load();
  };

  const remover = async (it: Item) => {
    if (!await confirm({
      title: `Tirar "${it.rotulo}" do escopo`,
      message: 'O acompanhamento some. Nada do que já foi feito é apagado.',
      confirmLabel: 'Tirar', danger: true,
    })) return;
    const { error } = await supabase.from('project_escopo').delete().eq('id', it.id);
    if (error) { toast.error('Não foi possível tirar.'); return; }
    load();
  };

  const mudarMeta = async (it: Item, valor: string) => {
    const meta = parseInt(valor, 10);
    if (!meta || meta === it.meta) return;
    setItens(prev => prev.map(x => (x.id === it.id ? { ...x, meta } : x)));
    const { error } = await supabase.from('project_escopo').update({ meta }).eq('id', it.id);
    if (error) { toast.error('Não foi possível mudar a meta.'); load(); }
  };

  // Mês fechado não muda mais; o mês corrente ainda pode encher.
  const ehMesAtual = mes.getMonth() === new Date().getMonth() && mes.getFullYear() === new Date().getFullYear();

  if (loading) return null;
  if (faltaMigracao) return null;
  if (!itens.length && !canManage) return null;

  return (
    <div className="card p-4 md:p-5">
      {dialog}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <p className="text-[11px] font-black uppercase tracking-widest text-lumos-text-primary flex items-center gap-2">
          <Target className="w-4 h-4 text-lumos-yellow" /> Escopo do mês
        </p>
        <div className="flex items-center gap-1 ml-auto">
          <button type="button" onClick={() => andarMes(-1)} title="Mês anterior"
            className="p-1.5 rounded-lumos text-lumos-text-secondary hover:text-lumos-text-primary">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[11.5px] font-bold text-lumos-text-primary min-w-[112px] text-center capitalize">
            {MESES[mes.getMonth()]} {mes.getFullYear()}
          </span>
          <button type="button" onClick={() => andarMes(1)} disabled={ehMesAtual} title="Mês seguinte"
            className="p-1.5 rounded-lumos text-lumos-text-secondary hover:text-lumos-text-primary disabled:opacity-30 disabled:cursor-not-allowed">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!itens.length ? (
        <p className="text-xs text-lumos-text-secondary">
          Nada combinado por aqui ainda. Se este projeto tem contrato por volume, diga quantas
          diárias ou quantos vídeos por mês e o acompanhamento passa a se manter sozinho.
        </p>
      ) : (
        <div className="space-y-3.5">
          {itens.map(it => {
            const pct = Math.min(100, Math.round((it.realizado / it.meta) * 100));
            const passou = it.realizado > it.meta;
            const fechou = it.realizado >= it.meta;
            return (
              <div key={it.id}>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[12.5px] font-bold text-lumos-text-primary">{it.rotulo}</span>
                  <span className={clsx('text-[12.5px] font-mono font-black tabular-nums',
                    passou ? 'text-amber-500' : fechou ? 'text-green-500' : 'text-lumos-text-primary')}>
                    {it.realizado}<span className="text-lumos-text-secondary font-bold"> de {it.meta}</span>
                  </span>
                  {passou && (
                    <span className="text-[10.5px] font-bold text-amber-500">
                      {it.realizado - it.meta} acima do combinado
                    </span>
                  )}
                  {!passou && !fechou && ehMesAtual && (
                    <span className="text-[10.5px] text-lumos-text-secondary">faltam {it.meta - it.realizado}</span>
                  )}
                  {canManage && (
                    <span className="ml-auto flex items-center gap-1.5">
                      <input
                        type="number" min={1} defaultValue={it.meta}
                        onBlur={e => mudarMeta(it, e.target.value)}
                        title="Quantos por mês"
                        className="input-lumos w-14 h-7 text-[11px] text-center py-0"
                      />
                      <button type="button" onClick={() => remover(it)} title="Tirar do escopo"
                        className="p-1 text-lumos-text-secondary hover:text-red-400">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  )}
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-lumos-text-secondary/15 overflow-hidden">
                  <div className={clsx('h-full rounded-full transition-all',
                    passou ? 'bg-amber-500' : fechou ? 'bg-green-500' : 'bg-lumos-yellow')}
                    style={{ width: `${Math.max(pct, it.realizado ? 4 : 0)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canManage && (criando ? (
        <div className="mt-4 pt-3.5 border-t border-lumos-border/60 flex items-end gap-2 flex-wrap">
          <div className="w-56">
            <label className="block text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary mb-1">O que conta</label>
            <Select value={novo.chave} onChange={v => setNovo(n => ({ ...n, chave: v }))}
              className="w-full h-9 px-3 rounded-lumos border border-lumos-border bg-lumos-surface text-[11.5px] font-bold text-lumos-text-primary"
              options={CHAVES} />
          </div>
          <div className="flex-1 min-w-[150px]">
            <label className="block text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary mb-1">Como chamar</label>
            <input value={novo.rotulo} onChange={e => setNovo(n => ({ ...n, rotulo: e.target.value }))}
              placeholder={CHAVES.find(c => c.value === novo.chave)?.label}
              className="input-lumos w-full h-9 text-xs" />
          </div>
          <div className="w-24">
            <label className="block text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary mb-1">Por mês</label>
            <input value={novo.meta} onChange={e => setNovo(n => ({ ...n, meta: e.target.value }))}
              type="number" min={1} placeholder="4" className="input-lumos w-full h-9 text-xs text-center" />
          </div>
          <button onClick={criar} className="btn-primary h-9 px-4 text-xs font-black">Salvar</button>
          <button onClick={() => setCriando(false)}
            className="h-9 px-3 rounded-lumos border border-lumos-border text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary">
            Cancelar
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setCriando(true)}
          className="mt-4 h-8 px-3 rounded-lumos border border-dashed border-lumos-border text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary hover:border-lumos-yellow/50 flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> {itens.length ? 'Outro item' : 'Definir o combinado'}
        </button>
      ))}

      {!!itens.length && (
        <p className="text-[10px] text-lumos-text-secondary/70 mt-3 leading-snug">
          O vídeo conta no mês em que foi enviado ao cliente, uma vez por peça: versão nova não
          gera entrega nova.
        </p>
      )}
    </div>
  );
}
