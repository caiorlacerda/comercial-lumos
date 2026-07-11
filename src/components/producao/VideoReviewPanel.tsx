import { useCallback, useEffect, useMemo, useState } from 'react';
import { Film, ExternalLink, Check, RotateCcw, CircleCheckBig, Clock, Link2, Copy, Droplet, DownloadCloud, MessageSquare, FolderUp, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';

type ReviewStatus =
  | 'EM_REVISAO_INTERNA' | 'ALTERACOES_INTERNAS'
  | 'EM_REVISAO_CLIENTE' | 'ALTERACOES_CLIENTE' | 'APROVADO';

interface VideoVersion {
  id: string;
  project_id: string;
  task_id: string | null;
  versao: number;
  file_name: string;
  drive_file_id: string;
  drive_web_link: string | null;
  status: ReviewStatus;
  approved_file_id: string | null;
  created_at: string;
}

const STATUS_UI: Record<ReviewStatus, { label: string; color: string }> = {
  EM_REVISAO_INTERNA: { label: 'Revisão interna', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
  ALTERACOES_INTERNAS: { label: 'Alterações (interno)', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
  EM_REVISAO_CLIENTE: { label: 'Revisão do cliente', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  ALTERACOES_CLIENTE: { label: 'Alterações (cliente)', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
  APROVADO: { label: 'Aprovado', color: 'bg-green-500/10 text-green-400 border-green-500/20' },
};

// Espelho do estado da revisão no status da tarefa vinculada
const STATUS_TO_TASK: Record<ReviewStatus, string> = {
  EM_REVISAO_INTERNA: 'revisao_interna',
  ALTERACOES_INTERNAS: 'alteracoes',
  EM_REVISAO_CLIENTE: 'revisao_cliente',
  ALTERACOES_CLIENTE: 'alteracoes',
  APROVADO: 'entregue',
};

const driveFileUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;

interface Props {
  projectId: string;
  tasks: { id: string; titulo: string }[];
}

export default function VideoReviewPanel({ projectId, tasks }: Props) {
  const { isAdmin, profile } = useAuth();
  const toast = useToast();
  const canManage = isAdmin || profile?.role === 'producao';

  const [versions, setVersions] = useState<VideoVersion[]>([]);
  const [links, setLinks] = useState<Record<string, { id: string; token: string; watermark: boolean; allow_download: boolean }>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [driveFolders, setDriveFolders] = useState<{ root: string | null; upload: string | null }>({ root: null, upload: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // Pasta de upload = 06_ENTREGA/01_REVISAO; fallback: raiz do projeto no Drive
  const uploadFolderUrl = driveFolders.upload || driveFolders.root
    ? `https://drive.google.com/drive/folders/${driveFolders.upload || driveFolders.root}`
    : null;

  const fetchVersions = useCallback(async () => {
    const { data, error } = await supabase
      .from('video_versions')
      .select('*')
      .eq('project_id', projectId)
      .order('versao', { ascending: false });
    if (!error) {
      const vs = (data as VideoVersion[]) || [];
      setVersions(vs);
      const ids = vs.map(v => v.id);
      if (ids.length) {
        const [linkRes, cmtRes] = await Promise.all([
          supabase.from('review_links').select('id, token, watermark, allow_download, video_version_id').in('video_version_id', ids).eq('active', true),
          supabase.from('review_comments').select('video_version_id').in('video_version_id', ids),
        ]);
        const lmap: Record<string, any> = {};
        (linkRes.data || []).forEach((l: any) => { lmap[l.video_version_id] = l; });
        setLinks(lmap);
        const cmap: Record<string, number> = {};
        (cmtRes.data || []).forEach((c: any) => { cmap[c.video_version_id] = (cmap[c.video_version_id] || 0) + 1; });
        setCounts(cmap);
      }
    }
    setLoading(false);
  }, [projectId]);

  const publicUrl = (tk: string) => `${window.location.origin}/revisao/${tk}`;

  const generateLink = async (versionId: string) => {
    setBusy(versionId);
    const { data, error } = await supabase
      .from('review_links')
      .insert([{ video_version_id: versionId, created_by: profile?.id }])
      .select('id, token, watermark, allow_download')
      .single();
    setBusy(null);
    if (error || !data) { toast.error('Erro ao gerar link.'); return; }
    setLinks(prev => ({ ...prev, [versionId]: data as any }));
    await navigator.clipboard.writeText(publicUrl(data.token)).catch(() => {});
    toast.success('Link do cliente gerado e copiado ✓');
  };

  const copyLink = async (tk: string) => {
    await navigator.clipboard.writeText(publicUrl(tk)).catch(() => {});
    toast.success('Link copiado ✓');
  };

  const toggleLinkFlag = async (versionId: string, field: 'watermark' | 'allow_download') => {
    const link = links[versionId]; if (!link) return;
    const next = !link[field];
    setLinks(prev => ({ ...prev, [versionId]: { ...link, [field]: next } }));
    const { error } = await supabase.from('review_links').update({ [field]: next }).eq('id', link.id);
    if (error) { toast.error('Não foi possível salvar.'); setLinks(prev => ({ ...prev, [versionId]: link })); }
  };

  const scanNow = async () => {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke('review-scan', { body: { project_id: projectId } });
      if (error) throw error;
      await fetchVersions();
      const found = (data as any)?.found ?? 0;
      toast.success(found > 0 ? `${found} vídeo(s) encontrado(s) ✓` : 'Tudo em dia — nenhum vídeo novo.');
    } catch {
      toast.error('Não foi possível verificar o Drive agora.');
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    supabase
      .from('projects')
      .select('drive_folder_id, drive_upload_folder_id')
      .eq('id', projectId)
      .single()
      .then(({ data }) => {
        if (data) setDriveFolders({ root: (data as any).drive_folder_id ?? null, upload: (data as any).drive_upload_folder_id ?? null });
      });
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    fetchVersions();
    // Realtime: o watcher insere versões / finaliza de forma assíncrona
    const channel = supabase
      .channel(`video_versions:${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'video_versions', filter: `project_id=eq.${projectId}` }, () => fetchVersions())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [projectId, fetchVersions]);

  const mirrorTaskId = useMemo(() => versions.find(v => v.task_id)?.task_id ?? '', [versions]);

  const linkTask = async (taskId: string) => {
    // Vincula toda a thread de revisão deste projeto à tarefa escolhida
    const value = taskId || null;
    setVersions(prev => prev.map(v => ({ ...v, task_id: value })));
    const { error } = await supabase.from('video_versions').update({ task_id: value }).eq('project_id', projectId);
    if (error) { toast.error('Não foi possível vincular a tarefa.'); fetchVersions(); }
  };

  const transition = async (v: VideoVersion, next: ReviewStatus) => {
    try {
      setBusy(v.id);
      const { error } = await supabase
        .from('video_versions')
        .update({ status: next, updated_at: new Date().toISOString() })
        .eq('id', v.id);
      if (error) throw error;

      // Espelha no status da tarefa vinculada (se houver)
      if (v.task_id) {
        await supabase.from('project_tasks').update({ status: STATUS_TO_TASK[next] }).eq('id', v.task_id);
      }

      if (next === 'APROVADO') {
        toast.success('Aprovado! Gerando o vFINAL em 02_APROVADO…');
      } else {
        toast.success('Status atualizado ✓');
      }
      fetchVersions();
    } catch (err: any) {
      console.error('Erro na transição:', err);
      toast.error(`Erro: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card p-6 mt-6">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest flex items-center gap-2">
          <Film className="w-4 h-4 text-lumos-yellow" /> Revisão de Vídeo
          <span className="text-lumos-text-secondary/60 font-bold normal-case tracking-normal">· dropzone 06_ENTREGA/01_REVISAO</span>
        </h3>

        <div className="flex items-center gap-2">
          <button
            onClick={scanNow}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lumos text-[11px] font-bold border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:border-lumos-text-secondary/40 transition-all disabled:opacity-60"
            title="Procura vídeos novos no Drive agora, sem esperar o ciclo automático"
          >
            <RefreshCw className={clsx('w-3.5 h-3.5', scanning && 'animate-spin')} /> {scanning ? 'Verificando…' : 'Verificar agora'}
          </button>
          {uploadFolderUrl && (
            <a
              href={uploadFolderUrl}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lumos text-[11px] font-bold bg-lumos-yellow text-black hover:brightness-95 transition-all"
              title="Abre a pasta 06_ENTREGA/01_REVISAO no Google Drive"
            >
              <FolderUp className="w-3.5 h-3.5" /> Subir vídeo no Drive
            </a>
          )}
        </div>

        {canManage && versions.length > 0 && (
          <label className="flex items-center gap-1.5 text-[10px] font-bold text-lumos-text-secondary">
            <Link2 className="w-3 h-3" /> Espelhar na tarefa:
            <select
              value={mirrorTaskId}
              onChange={e => linkTask(e.target.value)}
              className="input-lumos h-7 text-[11px] w-auto max-w-[180px] py-0"
            >
              <option value="">Nenhuma</option>
              {tasks.map(t => <option key={t.id} value={t.id}>{t.titulo}</option>)}
            </select>
          </label>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-7 w-7 border-t-2 border-b-2 border-lumos-yellow" /></div>
      ) : versions.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-lumos-border/50 rounded-lumos">
          <Film className="w-8 h-8 text-lumos-text-secondary/30 mx-auto mb-2" />
          <p className="text-xs text-lumos-text-secondary">Nenhuma versão ainda.</p>
          <p className="text-[10px] text-lumos-text-secondary/60 mt-1">
            O editor sobe o corte em <b>06_ENTREGA/01_REVISAO</b> (qualquer nome de arquivo) e ele aparece aqui — clique em <b>Verificar agora</b> pra trazer na hora.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {versions.map(v => {
            const ui = STATUS_UI[v.status];
            const isBusy = busy === v.id;
            return (
              <div key={v.id} className="p-3 rounded-lumos border border-lumos-border/50 bg-lumos-bg/30 space-y-2">
               <div className="flex items-center gap-3">
                <span className="text-sm font-black text-lumos-text-primary w-10 flex-shrink-0">v{String(v.versao).padStart(2, '0')}</span>

                <div className="flex-1 min-w-0">
                  <a
                    href={v.drive_web_link || driveFileUrl(v.drive_file_id)}
                    target="_blank" rel="noopener noreferrer"
                    className="text-xs font-bold text-lumos-text-primary hover:text-lumos-yellow transition-colors truncate flex items-center gap-1"
                  >
                    {v.file_name} <ExternalLink className="w-3 h-3 opacity-50 flex-shrink-0" />
                  </a>
                  <span className={clsx('inline-block mt-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border', ui.color)}>
                    {ui.label}
                  </span>
                </div>

                {/* Ações da máquina de estados */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {!canManage ? null : v.status === 'EM_REVISAO_INTERNA' ? (
                    <>
                      <button disabled={isBusy} onClick={() => transition(v, 'EM_REVISAO_CLIENTE')} className="px-2.5 py-1.5 rounded-lumos text-[10px] font-bold bg-lumos-yellow/10 text-lumos-yellow hover:bg-lumos-yellow/20 transition-colors flex items-center gap-1">
                        <Check className="w-3 h-3" /> Aprovar (interno)
                      </button>
                      <button disabled={isBusy} onClick={() => transition(v, 'ALTERACOES_INTERNAS')} className="px-2.5 py-1.5 rounded-lumos text-[10px] font-bold text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-1">
                        <RotateCcw className="w-3 h-3" /> Alteração
                      </button>
                    </>
                  ) : v.status === 'EM_REVISAO_CLIENTE' ? (
                    <>
                      <button disabled={isBusy} onClick={() => transition(v, 'APROVADO')} className="px-2.5 py-1.5 rounded-lumos text-[10px] font-bold bg-green-500/10 text-green-500 hover:bg-green-500/20 transition-colors flex items-center gap-1">
                        <CircleCheckBig className="w-3 h-3" /> Cliente aprovou
                      </button>
                      <button disabled={isBusy} onClick={() => transition(v, 'ALTERACOES_CLIENTE')} className="px-2.5 py-1.5 rounded-lumos text-[10px] font-bold text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-1">
                        <RotateCcw className="w-3 h-3" /> Alteração
                      </button>
                    </>
                  ) : v.status === 'APROVADO' ? (
                    v.approved_file_id ? (
                      <a href={driveFileUrl(v.approved_file_id)} target="_blank" rel="noopener noreferrer" className="px-2.5 py-1.5 rounded-lumos text-[10px] font-bold bg-green-500/10 text-green-500 hover:bg-green-500/20 transition-colors flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" /> vFINAL
                      </a>
                    ) : (
                      <span className="text-[10px] font-bold text-lumos-text-secondary flex items-center gap-1"><Clock className="w-3 h-3 animate-pulse" /> Gerando vFINAL…</span>
                    )
                  ) : (
                    <span className="text-[10px] font-semibold text-lumos-text-secondary/70 italic">Aguardando novo corte</span>
                  )}
                </div>
               </div>

               {/* Link do cliente + comentários */}
               {canManage && (
                 <div className="flex items-center gap-2 flex-wrap pl-[52px] pt-0.5">
                   {links[v.id] ? (
                     <>
                       <button onClick={() => copyLink(links[v.id].token)} className="text-[10px] font-bold text-lumos-text-secondary hover:text-lumos-yellow flex items-center gap-1 border border-lumos-border rounded-full px-2 py-1 transition-colors">
                         <Copy className="w-3 h-3" /> Copiar link
                       </button>
                       <a href={`/revisao/${links[v.id].token}`} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-lumos-text-secondary hover:text-lumos-yellow flex items-center gap-1 border border-lumos-border rounded-full px-2 py-1 transition-colors">
                         <ExternalLink className="w-3 h-3" /> Abrir
                       </a>
                       <button onClick={() => toggleLinkFlag(v.id, 'watermark')} title="Marca d'água" className={clsx('text-[10px] font-bold flex items-center gap-1 rounded-full px-2 py-1 transition-colors border', links[v.id].watermark ? 'text-lumos-yellow border-lumos-yellow/40 bg-lumos-yellow/10' : 'text-lumos-text-secondary/60 border-lumos-border')}>
                         <Droplet className="w-3 h-3" /> Marca d'água
                       </button>
                       <button onClick={() => toggleLinkFlag(v.id, 'allow_download')} title="Permitir download" className={clsx('text-[10px] font-bold flex items-center gap-1 rounded-full px-2 py-1 transition-colors border', links[v.id].allow_download ? 'text-lumos-yellow border-lumos-yellow/40 bg-lumos-yellow/10' : 'text-lumos-text-secondary/60 border-lumos-border')}>
                         <DownloadCloud className="w-3 h-3" /> Download
                       </button>
                     </>
                   ) : (
                     <button disabled={isBusy} onClick={() => generateLink(v.id)} className="text-[10px] font-bold text-lumos-yellow hover:bg-lumos-yellow/10 flex items-center gap-1 border border-lumos-yellow/40 rounded-full px-2.5 py-1 transition-colors">
                       <Link2 className="w-3 h-3" /> Gerar link do cliente
                     </button>
                   )}
                   {(counts[v.id] || 0) > 0 && (
                     <span className="text-[10px] font-bold text-lumos-text-secondary flex items-center gap-1 ml-auto">
                       <MessageSquare className="w-3 h-3" /> {counts[v.id]} comentário{counts[v.id] > 1 ? 's' : ''}
                     </span>
                   )}
                 </div>
               )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
