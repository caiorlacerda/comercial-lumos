import { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/common/Modal';
import { resumoPendencias } from '@/lib/arvoreProjetos';
import type { ProjetoArvore } from '@/lib/arvoreProjetos';

// Confirmação de encerrar/reabrir projeto pela barra lateral. Encerrar mostra
// antes o que está em aberto (só informa, não bloqueia). Só troca
// projects.status; o aviso "Projeto encerrado" vem do gatilho do banco.

// null = não foi possível conferir; undefined (aReceber) = projeto sem proposta
interface Conferencia {
  tarefas: number | null;
  videos: number | null;
  aReceber: number | null | undefined;
}

async function contarTarefas(projectId: string): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from('project_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .not('status', 'in', '("concluido","entregue")');
    if (error || count === null) return null;
    return count;
  } catch {
    return null;
  }
}

async function contarVideos(projectId: string): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('video_versions')
      .select('id, group_id, status, versao')
      .eq('project_id', projectId)
      .order('versao', { ascending: false });
    if (error || !data) return null;
    // A primeira linha de cada grupo é a versão mais recente (maior `versao`)
    const vistos = new Set<string>();
    let emRevisao = 0;
    (data as { id: string; group_id: string | null; status: string }[]).forEach(v => {
      const chave = v.group_id ?? v.id;
      if (vistos.has(chave)) return;
      vistos.add(chave);
      if (v.status === 'EM_REVISAO_CLIENTE') emRevisao++;
    });
    return emRevisao;
  } catch {
    return null;
  }
}

async function somarAReceber(projectId: string, podeVerFinanceiro: boolean): Promise<number | null | undefined> {
  // O banco só deixa admin e produção lerem projetos_financeiro; para os outros
  // papéis a consulta voltaria vazia (sem erro) e pareceria que nada falta receber.
  if (!podeVerFinanceiro) return null;
  try {
    const { data: fin, error: errFin } = await supabase
      .from('projetos_financeiro')
      .select('proposta_id')
      .eq('project_id', projectId);
    if (errFin || !fin) return null;
    const propostaId = (fin as { proposta_id: string | null }[]).find(r => r.proposta_id)?.proposta_id;
    if (!propostaId) return undefined; // sem proposta: a linha some
    const { data, error } = await supabase
      .from('receivables')
      .select('total_amount, received_amount')
      .eq('budget_id', propostaId)
      .not('status', 'in', '("recebido","cancelado")');
    if (error || !data) return null;
    return (data as { total_amount: number | null; received_amount: number | null }[])
      .reduce((s, r) => s + (Number(r.total_amount || 0) - Number(r.received_amount || 0)), 0);
  } catch {
    return null;
  }
}

export default function EncerrarProjetoConfirmModal({ proj, acao, onClose, onDone }: {
  proj: ProjetoArvore;
  acao: 'encerrar' | 'reabrir';
  onClose: () => void;
  onDone: (novoStatus: 'ativo' | 'concluido') => void;
}) {
  const toast = useToast();
  const { profile } = useAuth();
  const podeVerFinanceiro = profile?.role === 'admin' || profile?.role === 'producao';
  const encerrando = acao === 'encerrar';
  const [conferindo, setConferindo] = useState(encerrando);
  const [conf, setConf] = useState<Conferencia | null>(null);
  const [salvando, setSalvando] = useState(false);

  // As três conferências rodam em paralelo; cada uma falha sozinha
  useEffect(() => {
    if (!encerrando) return;
    let cancelado = false;
    (async () => {
      const [tarefas, videos, aReceber] = await Promise.all([
        contarTarefas(proj.id),
        contarVideos(proj.id),
        somarAReceber(proj.id, podeVerFinanceiro),
      ]);
      if (cancelado) return;
      setConf({ tarefas, videos, aReceber });
      setConferindo(false);
    })();
    return () => { cancelado = true; };
  }, [encerrando, proj.id, podeVerFinanceiro]);

  const linhas = useMemo(() => (conf ? resumoPendencias(conf) : []), [conf]);

  const confirmar = async () => {
    if (salvando) return;
    setSalvando(true);
    try {
      const de = encerrando ? 'ativo' : 'concluido';
      const para = encerrando ? 'concluido' : 'ativo';
      // Só grava se o projeto ainda está no status que a pessoa viu
      const { data, error } = await supabase.from('projects')
        .update({ status: para }).eq('id', proj.id).eq('status', de).select('id');
      if (error) { toast.error('Não foi possível salvar. Tente de novo.'); return; }
      if (!data || data.length === 0) {
        // 0 linhas: ou a RLS filtrou o UPDATE (sem permissão) ou o status já mudou
        let statusAtual: string | null = null;
        try {
          const { data: atual } = await supabase.from('projects').select('status').eq('id', proj.id).maybeSingle();
          statusAtual = (atual as { status?: string } | null)?.status ?? null;
        } catch { /* sem releitura: cai no texto genérico */ }
        toast.error(statusAtual === de
          ? 'Você não tem permissão para alterar este projeto.'
          : 'Esse projeto mudou desde que a barra carregou. Recarregue a página.');
        onClose(); // não há o que tentar de novo
        return;
      }
      toast.success(encerrando ? 'Projeto encerrado.' : 'Projeto reaberto.');
      onDone(para);
    } catch {
      toast.error('Não foi possível salvar. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={salvando ? () => {} : onClose}
      title={encerrando ? 'Encerrar projeto' : 'Reabrir projeto'}
      size="md"
      camada="z-[195]" // abaixo dos avisos (z-200), para o toast ficar nítido por cima
      footer={(
        <>
          <button onClick={onClose} disabled={salvando} className="btn-secondary h-10 px-4 text-xs font-bold">
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={salvando}
            className="btn-primary h-10 px-5 text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {salvando
              ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              : encerrando ? 'Encerrar projeto' : 'Reabrir projeto'}
          </button>
        </>
      )}
    >
      {encerrando ? (
        <div className="space-y-4">
          <p className="text-sm font-bold text-lumos-text-primary">{proj.name}</p>

          {conferindo ? (
            <div className="space-y-2 animate-pulse" aria-label="Conferindo o que está em aberto">
              {[0, 1, 2].map(i => <div key={i} className="h-3.5 bg-lumos-text-secondary/15 rounded w-3/4" />)}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {linhas.map(l => (
                <li
                  key={l.texto}
                  className={clsx(
                    'text-xs',
                    l.tom === 'aviso' && 'text-lumos-yellow font-bold',
                    l.tom === 'ok' && 'text-lumos-text-secondary',
                    l.tom === 'desconhecido' && 'text-lumos-text-secondary italic'
                  )}
                >
                  {l.texto}
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-lumos-text-secondary leading-relaxed">
            Isso só marca o projeto como encerrado. Não encerra no financeiro, não desativa links de revisão e não
            fecha tarefas. A equipe recebe um aviso.
          </p>
        </div>
      ) : (
        <p className="text-sm text-lumos-text-primary leading-relaxed">
          Reabrir <span className="font-bold">{proj.name}</span>?{' '}
          {proj.oculto_na_barra === true
            ? 'Ele volta para o grupo "Ocultos" da barra (use "Mostrar na barra" para trazê-lo de volta à lista do cliente).'
            : 'Ele volta para a árvore de projetos ativos.'}
        </p>
      )}
    </Modal>
  );
}
