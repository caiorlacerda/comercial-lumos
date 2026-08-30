import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import VideoReviewPanel from '@/components/producao/VideoReviewPanel';
import { formatBudgetCode } from '@/utils/formatters';
import { Film, X, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import VideoThumb from '@/components/producao/VideoThumb';
import StreamMigracao from '@/components/producao/StreamMigracao';

interface VV {
  id: string;
  project_id: string;
  versao: number;
  status: string;
  updated_at: string;
  file_name: string;
  project: { id: string; name: string; code: string | null; status: string; client: { name: string } | null } | null;
}

const STATUS: Record<string, { label: string; color: string }> = {
  EM_REVISAO_INTERNA: { label: 'Revisão interna', color: 'bg-purple-500/15 text-purple-400 border-purple-500/25' },
  ALTERACOES_INTERNAS: { label: 'Alterações internas', color: 'bg-orange-500/15 text-orange-400 border-orange-500/25' },
  EM_REVISAO_CLIENTE: { label: 'Revisão do cliente', color: 'bg-amber-500/15 text-amber-500 border-amber-500/25' },
  ALTERACOES_CLIENTE: { label: 'Alterações do cliente', color: 'bg-red-500/15 text-red-400 border-red-500/25' },
  APROVADO: { label: 'Aprovado', color: 'bg-green-500/15 text-green-500 border-green-500/25' },
};

function rel(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d < 1) return 'hoje';
  if (d === 1) return 'ontem';
  if (d < 30) return `há ${d}d`;
  const mo = Math.floor(d / 30);
  return `há ${mo}mês`;
}

export default function VideoReviewHub() {
  const [rows, setRows] = useState<VV[]>([]);
  /**
   * As capas vêm DEPOIS, e só as que a tela mostra.
   *
   * A miniatura é uma imagem inteira guardada dentro da linha do banco. Esta
   * página pedia todas as linhas COM a imagem: 193 vídeos, 5,3 MB e 9 segundos
   * de espera — pra desenhar uma capa por projeto, quinze imagens. Agora a
   * lista vem sem imagem nenhuma (rápida) e só as capas que aparecem são
   * buscadas em seguida.
   */
  const [capas, setCapas] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [openProject, setOpenProject] = useState<{ id: string; name: string; code: string | null } | null>(null);
  const [openTasks, setOpenTasks] = useState<{ id: string; titulo: string }[]>([]);

  useEffect(() => { load(); }, []);
  useRealtimeRefetch(['video_versions'], () => load(true));

  async function load(silent = false) {
    if (!silent) setLoading(true);
    const projJoin = 'project:projects(id, name, code, status, client:clients(name))';
    const res = await supabase
      .from('video_versions')
      .select(`id, project_id, versao, status, updated_at, file_name, ${projJoin}`)
      .order('updated_at', { ascending: false });
    setRows(((res.data as unknown) as VV[]) || []);
    setLoading(false);
  }

  // Agrupa por projeto: contagem de vídeos, último update e status mais recente.
  const projects = useMemo(() => {
    const m = new Map<string, { project: NonNullable<VV['project']>; count: number; latest: string; latestStatus: string; capaId: string | null }>();
    // rows já vem ordenado por updated_at desc → o 1º de cada projeto é o mais recente.
    rows.forEach(r => {
      if (!r.project_id || !r.project) return;
      // Só projetos ativos: os encerrados somem do hub de revisão.
      if (r.project.status === 'concluido') return;
      const cur = m.get(r.project_id);
      if (!cur) m.set(r.project_id, { project: r.project, count: 1, latest: r.updated_at, latestStatus: r.status, capaId: r.id });
      else {
        cur.count++;
        if (r.updated_at > cur.latest) { cur.latest = r.updated_at; cur.latestStatus = r.status; cur.capaId = r.id; }
      }
    });
    return Array.from(m.values()).sort((a, b) => b.latest.localeCompare(a.latest));
  }, [rows]);

  // Só as capas que a tela mostra: uma por projeto, não uma por vídeo.
  useEffect(() => {
    const faltando = projects.map(p => p.capaId).filter(id => id && !(id in capas)) as string[];
    if (!faltando.length) return;
    let vivo = true;
    (async () => {
      const { data } = await supabase.from('video_versions').select('id, thumb_url').in('id', faltando);
      if (!vivo) return;
      const novo: Record<string, string | null> = {};
      faltando.forEach(id => { novo[id] = null; });   // sem capa também é resposta
      (data || []).forEach((r: any) => { novo[r.id] = r.thumb_url ?? null; });
      setCapas(prev => ({ ...prev, ...novo }));
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  const openReview = async (p: (typeof projects)[number]) => {
    setOpenProject({ id: p.project.id, name: p.project.name, code: p.project.code });
    setOpenTasks([]);
    // 'status' incluído: sem ele, vincular tarefa aqui não sincronizava o
    // status do vídeo (taskStatusToVideo recebia undefined).
    const { data } = await supabase.from('project_tasks').select('id, titulo, status').eq('project_id', p.project.id).is('deleted_at', null);
    setOpenTasks((data as any) || []);
  };

  return (
    <div className="bg-lumos-surface border border-lumos-border rounded-lumos overflow-hidden">
      <div className="px-4 py-3 border-b border-lumos-border flex items-center gap-2">
        <Film className="w-4 h-4 text-lumos-yellow" />
        <h2 className="text-sm font-black uppercase tracking-tight text-lumos-text-primary">Revisões de Vídeo</h2>
        <span className="text-[11px] text-lumos-text-secondary">{projects.length} {projects.length === 1 ? 'projeto' : 'projetos'} com vídeos</span>
      </div>

      <StreamMigracao />

      {loading ? (
        <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin text-lumos-yellow mx-auto" /></div>
      ) : projects.length === 0 ? (
        <div className="py-10 text-center text-sm text-lumos-text-secondary">
          Nenhuma revisão de vídeo ainda. Quando um projeto recebe um vídeo, ele aparece aqui pra revisar direto.
        </div>
      ) : (
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {projects.map(p => {
            const st = STATUS[p.latestStatus] || { label: p.latestStatus, color: 'bg-lumos-text-secondary/10 text-lumos-text-secondary border-lumos-border' };
            return (
              <button
                key={p.project.id}
                onClick={() => openReview(p)}
                className="group text-left rounded-lumos border border-lumos-border overflow-hidden hover:border-lumos-yellow/40 hover:shadow-lg transition-all"
              >
                {/* Capa = thumbnail do vídeo mais recente (fallback para o play). */}
                <div className="relative aspect-video">
                  <VideoThumb src={p.capaId ? capas[p.capaId] : null} className="w-full h-full" iconSize="w-11 h-11" />
                  <span className="absolute top-1.5 right-1.5 z-10 text-[10px] font-black bg-black/60 text-white px-1.5 py-0.5 rounded-full">{p.count} {p.count === 1 ? 'vídeo' : 'vídeos'}</span>
                </div>
                <div className="p-2.5 space-y-1.5">
                  <div>
                    {p.project.code && <span className="text-[9px] font-black text-amber-600 dark:text-lumos-yellow">{formatBudgetCode(p.project.code)} </span>}
                    <span className="text-xs font-bold text-lumos-text-primary group-hover:text-lumos-yellow transition-colors line-clamp-1">{p.project.name}</span>
                  </div>
                  <p className="text-[10px] text-lumos-text-secondary truncate">{p.project.client?.name || 'Sem cliente'} · atualizado {rel(p.latest)}</p>
                  <span className={clsx('inline-block text-[9px] font-black uppercase px-1.5 py-0.5 rounded border', st.color)}>{st.label}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Modal de revisão (abre o player + comentários ali mesmo) */}
      {openProject && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150" onClick={() => setOpenProject(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-6xl max-h-[94vh] overflow-y-auto custom-scrollbar bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl">
            <div className="sticky top-0 z-10 bg-lumos-surface border-b border-lumos-border px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <Film className="w-4 h-4 text-lumos-yellow" />
                <h3 className="text-sm font-black uppercase tracking-tight text-lumos-text-primary truncate">
                  {openProject.code && <span className="text-amber-600 dark:text-lumos-yellow">{formatBudgetCode(openProject.code)} </span>}
                  {openProject.name}
                </h3>
              </div>
              <button onClick={() => setOpenProject(null)} className="p-1.5 rounded-lumos text-lumos-text-secondary hover:text-lumos-text-primary"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4">
              <VideoReviewPanel projectId={openProject.id} tasks={openTasks} />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
