import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Lock, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';

/**
 * Pipeline do projeto: o ciclo inteiro, da negociação ao encerramento, em
 * colunas de fase com checklist. Etapas AUTOMÁTICAS são derivadas dos dados
 * (orçamento, briefing, diárias, OD, vídeos) e não podem ser marcadas à mão;
 * as MANUAIS ficam em project_stage_checks. Nada aqui lê financeiro.
 */

interface Etapa { key: string; label: string; auto?: boolean }
interface Fase { nome: string; etapas: Etapa[] }

const FASES: Fase[] = [
  {
    nome: 'Negociação',
    etapas: [
      { key: 'contato_inicial', label: 'Contato inicial' },
      { key: 'orcamento_enviado', label: 'Envio do orçamento', auto: true },
      { key: 'followup', label: 'Follow-up da proposta' },
      { key: 'orcamento_aprovado', label: 'Aprovação do orçamento', auto: true },
    ],
  },
  {
    nome: 'Pré-produção',
    etapas: [
      { key: 'reuniao_briefing', label: 'Reunião de briefing' },
      { key: 'briefing_preenchido', label: 'Briefing preenchido', auto: true },
      { key: 'referencias', label: 'Brainstorm e referências' },
      { key: 'roteiro_criado', label: 'Criação do roteiro' },
      { key: 'roteiro_aprovado', label: 'Roteiro aprovado pelo cliente' },
    ],
  },
  {
    nome: 'Produção',
    etapas: [
      { key: 'visita_tecnica', label: 'Visita técnica' },
      { key: 'diarias_planejadas', label: 'Diárias planejadas', auto: true },
      { key: 'ordem_do_dia', label: 'Ordem do dia criada', auto: true },
      { key: 'gravacao', label: 'Gravação concluída', auto: true },
      { key: 'backup_bruto', label: 'Backup do material bruto' },
    ],
  },
  {
    nome: 'Pós-produção',
    etapas: [
      { key: 'edicao_iniciada', label: 'Edição iniciada', auto: true },
      { key: 'primeira_versao', label: 'Primeira versão ao cliente', auto: true },
      { key: 'feedback_cliente', label: 'Feedback do cliente', auto: true },
      { key: 'aprovacao_final', label: 'Aprovação final das entregas', auto: true },
    ],
  },
  {
    nome: 'Pós-venda',
    etapas: [
      { key: 'organizacao_material', label: 'Organização final do material' },
      { key: 'redes_sociais', label: 'Comunicação nas redes' },
      { key: 'pesquisa_satisfacao', label: 'Pesquisa de satisfação' },
      { key: 'encerramento', label: 'Projeto encerrado', auto: true },
    ],
  },
];

interface Props {
  projectId: string;
  projectStatus: 'ativo' | 'concluido';
  budgetStatus: string | null; // status do orçamento ligado (null = sem orçamento)
  canManage: boolean;
}

export default function ProjectStatusPipeline({ projectId, projectStatus, budgetStatus, canManage }: Props) {
  const { profile } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [manuais, setManuais] = useState<Set<string>>(new Set());
  const [dados, setDados] = useState({
    temBriefing: false, nDiarias: 0, todasDiariasPassadas: false,
    nOrdens: 0, nVideos: 0, foiAoCliente: false, temDecisao: 0, todosAprovados: false,
  });

  const load = useCallback(async () => {
    const [checks, brief, diarias, ordens, videos] = await Promise.all([
      supabase.from('project_stage_checks').select('stage_key').eq('project_id', projectId),
      supabase.from('project_briefings').select('sections').eq('project_id', projectId).maybeSingle(),
      supabase.from('project_diarias').select('data').eq('project_id', projectId),
      supabase.from('ordens_do_dia').select('id').eq('project_id', projectId),
      supabase.from('video_versions').select('group_id, versao, status, client_decision').eq('project_id', projectId),
    ]);
    setManuais(new Set((checks.data || []).map(c => c.stage_key)));

    const secoes = (brief.data?.sections || {}) as Record<string, unknown>;
    const temBriefing = Object.values(secoes).some(v =>
      Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.trim().length > 0);

    const ds = diarias.data || [];
    const hoje = new Date().toISOString().slice(0, 10);
    const todasPassadas = ds.length > 0 && ds.every(d => d.data && d.data < hoje);

    // Um "vídeo" = grupo; conta a versão mais recente de cada.
    const vs = videos.data || [];
    const porGrupo = new Map<string, { status: string; client_decision: string | null }>();
    for (const v of vs.sort((a, b) => a.versao - b.versao)) porGrupo.set(v.group_id, v);
    const grupos = [...porGrupo.values()];
    const CLIENTE = ['EM_REVISAO_CLIENTE', 'ALTERACOES_CLIENTE', 'APROVADO'];

    setDados({
      temBriefing,
      nDiarias: ds.length,
      todasDiariasPassadas: todasPassadas,
      nOrdens: (ordens.data || []).length,
      nVideos: grupos.length,
      foiAoCliente: grupos.some(g => CLIENTE.includes(g.status)),
      temDecisao: vs.filter(v => v.client_decision).length,
      todosAprovados: grupos.length > 0 && grupos.every(g => g.status === 'APROVADO'),
    });
    setLoading(false);
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  // Estado de cada etapa automática, derivado dos dados de verdade.
  const autoDone: Record<string, boolean> = useMemo(() => ({
    orcamento_enviado: budgetStatus != null && budgetStatus !== 'rascunho',
    orcamento_aprovado: budgetStatus === 'aprovado',
    briefing_preenchido: dados.temBriefing,
    diarias_planejadas: dados.nDiarias > 0,
    ordem_do_dia: dados.nOrdens > 0,
    gravacao: dados.todasDiariasPassadas,
    edicao_iniciada: dados.nVideos > 0,
    primeira_versao: dados.foiAoCliente,
    feedback_cliente: dados.temDecisao > 0,
    aprovacao_final: dados.todosAprovados,
    encerramento: projectStatus === 'concluido',
  }), [budgetStatus, dados, projectStatus]);

  const isDone = useCallback((e: Etapa) => e.auto ? !!autoDone[e.key] : manuais.has(e.key), [autoDone, manuais]);

  const { feitas, total, proxima } = useMemo(() => {
    const todas = FASES.flatMap(f => f.etapas);
    const feitas = todas.filter(isDone).length;
    const proxima = todas.find(e => !isDone(e)) || null;
    return { feitas, total: todas.length, proxima };
  }, [isDone]);

  const toggle = async (e: Etapa) => {
    if (e.auto || !canManage) return;
    const marcada = manuais.has(e.key);
    const novo = new Set(manuais);
    if (marcada) novo.delete(e.key); else novo.add(e.key);
    setManuais(novo);
    const q = marcada
      ? supabase.from('project_stage_checks').delete().eq('project_id', projectId).eq('stage_key', e.key)
      : supabase.from('project_stage_checks').insert([{ project_id: projectId, stage_key: e.key, done_by: profile?.id || null }]);
    const { error } = await q;
    if (error) { setManuais(manuais); toast.error('Não foi possível salvar a etapa.'); }
  };

  if (loading) return <div className="card p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-lumos-yellow" /></div>;

  const pct = Math.round((feitas / total) * 100);

  return (
    <div className="space-y-4">
      {/* Barra de progresso + próxima ação */}
      <div className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">Etapas concluídas</p>
            <p className="text-[11px] font-black tabular-nums">{feitas}/{total} · {pct}%</p>
          </div>
          <div className="mt-2 h-2 rounded-full bg-lumos-text-secondary/15 overflow-hidden">
            <div className="h-full rounded-full bg-lumos-yellow transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {proxima && (
          <div className="sm:text-right sm:pl-4 sm:border-l border-lumos-border flex-shrink-0">
            <p className="text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary">Próxima ação</p>
            <p className="text-[12.5px] font-black text-lumos-yellow">{proxima.label}</p>
          </div>
        )}
      </div>

      {/* Colunas de fase */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        {FASES.map(fase => {
          const done = fase.etapas.filter(isDone).length;
          const completa = done === fase.etapas.length;
          const temAtual = !completa && fase.etapas.some(e => e === proxima);
          return (
            <div key={fase.nome} className={clsx('card p-3.5', completa && 'border-green-500/40')}>
              <div className="flex items-center gap-1.5 mb-3">
                <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">{fase.nome}</p>
                <span className={clsx('ml-auto text-[10px] font-black tabular-nums', completa ? 'text-green-500' : 'text-lumos-text-secondary')}>
                  {completa ? <Check className="w-3.5 h-3.5" /> : `${done}/${fase.etapas.length}`}
                </span>
              </div>
              <div className="space-y-0.5">
                {fase.etapas.map((e, i) => {
                  const feito = isDone(e);
                  const atual = proxima === e;
                  return (
                    <button key={e.key} type="button" onClick={() => toggle(e)}
                      disabled={e.auto || !canManage}
                      title={e.auto ? 'Etapa automática, marcada pelo próprio sistema' : canManage ? (feito ? 'Desmarcar' : 'Marcar como feita') : undefined}
                      className={clsx('w-full flex items-start gap-2.5 px-1.5 py-1.5 rounded text-left relative',
                        !e.auto && canManage && 'hover:bg-lumos-text-primary/5 cursor-pointer',
                        (e.auto || !canManage) && 'cursor-default')}>
                      {/* trilho vertical */}
                      {i < fase.etapas.length - 1 && (
                        <span className={clsx('absolute left-[16px] top-[26px] bottom-[-4px] w-[2px]',
                          feito ? 'bg-lumos-yellow/60' : 'bg-lumos-text-secondary/12')} />
                      )}
                      <span className={clsx('w-[21px] h-[21px] rounded-full grid place-items-center flex-shrink-0 border-2 relative z-10 mt-[1px]',
                        feito ? 'bg-lumos-yellow border-lumos-yellow text-black'
                          : atual ? 'border-lumos-yellow text-lumos-yellow bg-lumos-surface'
                          : 'border-lumos-text-secondary/25 text-lumos-text-secondary/40 bg-lumos-surface')}>
                        {feito ? <Check className="w-3 h-3" /> : e.auto ? <Lock className="w-2.5 h-2.5" /> : null}
                      </span>
                      <span className="min-w-0">
                        <span className={clsx('block text-[11.5px] font-bold leading-tight',
                          feito ? 'text-lumos-text-primary' : atual ? 'text-lumos-text-primary' : 'text-lumos-text-secondary')}>
                          {e.label}
                        </span>
                        {atual && <span className="text-[9px] font-black uppercase tracking-wide text-lumos-yellow">agora</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10.5px] text-lumos-text-secondary">
        Etapas com cadeado são automáticas: o sistema marca sozinho quando o dado de verdade acontece (orçamento aprovado, vídeo enviado, projeto encerrado). As outras, o time marca à mão.
      </p>
    </div>
  );
}
