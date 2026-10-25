import { useEffect, useState } from 'react';
import { EsqueletoItens } from '@/components/ui/Esqueleto';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import BlocoCartao from '../BlocoCartao';
import type { DadosHome } from '../tipos';

interface VideoAjuste { id: string; arquivo: string; versao: number; status: string; projeto: string | null; projectId: string; taskId: string }

const ROTULO: Record<string, string> = { ALTERACOES_INTERNAS: 'Ajustes internos', ALTERACOES_CLIENTE: 'Ajustes do cliente' };

/** Vídeos das minhas tarefas cuja versão mais recente voltou com ajustes (internos ou do cliente). */
export default function VideosAjustesBloco({ dados }: { dados: DadosHome }) {
  const navigate = useNavigate();
  const idsChave = dados.tarefas.map(t => t.id).sort().join(',');
  const [itens, setItens] = useState<VideoAjuste[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (dados.carregando) return;
      const ids = idsChave ? idsChave.split(',') : [];
      if (!ids.length) { setItens([]); setCarregando(false); return; }
      try {
        // Todas as versões das minhas tarefas: só vale a MAIS RECENTE de cada vídeo (grupo).
        let q: any = await supabase.from('video_versions')
          .select('id, file_name, versao, status, group_id, project_id, task_id, projects(name)')
          .in('task_id', ids);
        if (q.error) {
          q = await supabase.from('video_versions')
            .select('id, file_name, versao, status, group_id, project_id, task_id')
            .in('task_id', ids);
        }
        if (!vivo) return;
        const maisRecente = new Map<string, any>();
        for (const v of (q.data as any[]) || []) {
          const chave = v.group_id || v.id;
          const atual = maisRecente.get(chave);
          if (!atual || v.versao > atual.versao) maisRecente.set(chave, v);
        }
        const lista: VideoAjuste[] = [...maisRecente.values()]
          .filter(v => v.status === 'ALTERACOES_INTERNAS' || v.status === 'ALTERACOES_CLIENTE')
          .map(v => ({
            id: v.id, arquivo: v.file_name, versao: v.versao, status: v.status,
            projeto: v.projects?.name || null, projectId: v.project_id, taskId: v.task_id,
          }));
        setItens(lista);
      } catch (e) {
        console.error('Home: vídeos com ajustes', e);
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => { vivo = false; };
  }, [idsChave, dados.carregando]);

  return (
    <BlocoCartao titulo="Vídeos com ajustes" direita={itens.length > 0 ? (
      <span className="text-[10px] font-black uppercase bg-red-500/10 text-red-500 px-2 py-0.5 rounded">{itens.length}</span>
    ) : undefined}>
      {carregando ? (
        <EsqueletoItens n={2} />
      ) : itens.length === 0 ? (
        <p className="text-xs text-lumos-text-secondary italic text-center py-6">Nenhum vídeo seu com ajustes pendentes.</p>
      ) : (
        <div className="space-y-2">
          {itens.map(v => (
            <button
              key={v.id}
              onClick={() => navigate(`/producao/projetos?projectId=${v.projectId}&taskId=${v.taskId}`)}
              className="w-full text-left p-3 rounded border border-lumos-border bg-lumos-bg/30 hover:bg-lumos-yellow/5 hover:border-lumos-yellow/20 transition-all flex items-center gap-3 group cursor-pointer"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold text-lumos-text-primary truncate group-hover:text-lumos-yellow transition-colors">{v.arquivo}</span>
                <span className="block text-[10px] uppercase tracking-wider text-lumos-text-secondary truncate">
                  {ROTULO[v.status]} · V{v.versao}{v.projeto ? ` · ${v.projeto}` : ''}
                </span>
              </span>
              <ChevronRight className="w-4 h-4 text-lumos-text-secondary group-hover:text-lumos-yellow flex-shrink-0 transition-colors" />
            </button>
          ))}
        </div>
      )}
    </BlocoCartao>
  );
}
