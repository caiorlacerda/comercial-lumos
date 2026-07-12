import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Film, ExternalLink, Check, RotateCcw, CircleCheckBig, Clock, Link2, Copy, Droplet, DownloadCloud, MessageSquare, FolderUp, RefreshCw, ChevronDown, ChevronUp, ChevronRight, Pencil, Layers, SlidersHorizontal, X, Upload, Play, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import InternalReviewModal from './InternalReviewModal';
import Select from '@/components/ui/Select';

type ReviewStatus =
  | 'EM_REVISAO_INTERNA' | 'ALTERACOES_INTERNAS'
  | 'EM_REVISAO_CLIENTE' | 'ALTERACOES_CLIENTE' | 'APROVADO';

interface VideoVersion {
  id: string;
  project_id: string;
  task_id: string | null;
  group_id: string | null;
  versao: number;
  file_name: string;
  drive_file_id: string;
  drive_web_link: string | null;
  status: ReviewStatus;
  approved_file_id: string | null;
  created_at: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  size_bytes: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  uploaded_at: string | null;
  fps: number | null;
}

interface Group { id: string; versions: VideoVersion[]; current: VideoVersion; count: number; }

type SortKey = 'versao' | 'file_name' | 'status' | 'duration' | 'resolution' | 'format' | 'fps' | 'size' | 'uploader' | 'date' | 'comments';
const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'versao', label: 'Versão' },
  { key: 'file_name', label: 'Nome' },
  { key: 'status', label: 'Status' },
  { key: 'duration', label: 'Duração', align: 'right' },
  { key: 'resolution', label: 'Resolução', align: 'right' },
  { key: 'format', label: 'Formato' },
  { key: 'fps', label: 'FPS', align: 'right' },
  { key: 'size', label: 'Tamanho', align: 'right' },
  { key: 'uploader', label: 'Enviado por' },
  { key: 'date', label: 'Data' },
  { key: 'comments', label: 'Coment.', align: 'right' },
];
const FIXED: SortKey[] = ['versao', 'file_name', 'status'];
const OPTIONAL = COLUMNS.filter(c => !FIXED.includes(c.key)).map(c => c.key);

const fmtDur = (ms: number | null) => { if (!ms) return '—'; const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtSize = (b: number | null) => b ? `${(b / 1048576).toFixed(1)} MB` : '—';
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
const vLabel = (n: number) => `v${String(n).padStart(2, '0')}`;

const STATUS_UI: Record<ReviewStatus, { label: string; color: string }> = {
  EM_REVISAO_INTERNA: { label: 'Revisão interna', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
  ALTERACOES_INTERNAS: { label: 'Alterações (interno)', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
  EM_REVISAO_CLIENTE: { label: 'Revisão do cliente', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  ALTERACOES_CLIENTE: { label: 'Alterações (cliente)', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
  APROVADO: { label: 'Aprovado', color: 'bg-green-500/10 text-green-400 border-green-500/20' },
};

const STATUS_TO_TASK: Record<ReviewStatus, string> = {
  EM_REVISAO_INTERNA: 'revisao_interna', ALTERACOES_INTERNAS: 'alteracoes',
  EM_REVISAO_CLIENTE: 'revisao_cliente', ALTERACOES_CLIENTE: 'alteracoes', APROVADO: 'entregue',
};

const driveFileUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;

function IconBtn({ title, onClick, active, disabled, className, children }: { title: string; onClick?: () => void; active?: boolean; disabled?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
      className={clsx('p-1.5 rounded-lumos border transition-colors disabled:opacity-40',
        active ? 'text-lumos-yellow border-lumos-yellow/40 bg-lumos-yellow/10' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary',
        className)}>
      {children}
    </button>
  );
}

interface Props { projectId: string; tasks: { id: string; titulo: string }[]; }

export default function VideoReviewPanel({ projectId, tasks }: Props) {
  const { isAdmin, profile, can } = useAuth();
  const toast = useToast();
  // Produção, editores e atendimento gerenciam a revisão de vídeo (todos têm
  // 'ordem_do_dia'). Editores têm autonomia para comentar/subir/organizar vídeos.
  const canManage = isAdmin || can('ordem_do_dia');

  const [versions, setVersions] = useState<VideoVersion[]>([]);
  const [linksByGroup, setLinksByGroup] = useState<Record<string, { id: string; token: string; watermark: boolean; allow_download: boolean }>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [driveFolders, setDriveFolders] = useState<{ root: string | null; upload: string | null }>({ root: null, upload: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<{ id: string; value: string; orig: string } | null>(null);
  const [stackMenuFor, setStackMenuFor] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [showCols, setShowCols] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadName, setUploadName] = useState('');
  const [fileDragging, setFileDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reviewModal, setReviewModal] = useState<{ versionId: string; token: string; fileName: string; versao: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Set<SortKey>>(() => {
    try { const s = JSON.parse(localStorage.getItem('rev_cols_v1') || 'null'); if (Array.isArray(s)) return new Set(s); } catch { /* ignore */ }
    return new Set(OPTIONAL);
  });
  useEffect(() => { localStorage.setItem('rev_cols_v1', JSON.stringify([...visibleCols])); }, [visibleCols]);

  const toggleSort = (key: SortKey) => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  const toggleGroupOpen = (id: string) => setOpenGroups(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleCol = (k: SortKey) => setVisibleCols(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const shownColumns = COLUMNS.filter(c => FIXED.includes(c.key) || visibleCols.has(c.key));

  const uploadFolderUrl = driveFolders.upload || driveFolders.root
    ? `https://drive.google.com/drive/folders/${driveFolders.upload || driveFolders.root}`
    : null;

  const fetchVersions = useCallback(async () => {
    const { data, error } = await supabase
      .from('video_versions').select('*').eq('project_id', projectId).order('versao', { ascending: false });
    if (!error) {
      const vs = (data as VideoVersion[]) || [];
      setVersions(vs);
      const versionIds = vs.map(v => v.id);
      const groupIds = [...new Set(vs.map(v => v.group_id).filter(Boolean))] as string[];
      const [linkRes, cmtRes] = await Promise.all([
        groupIds.length ? supabase.from('review_links').select('*').in('group_id', groupIds).eq('active', true) : Promise.resolve({ data: [] as any[] }),
        versionIds.length ? supabase.from('review_comments').select('video_version_id').in('video_version_id', versionIds) : Promise.resolve({ data: [] as any[] }),
      ]);
      const lmap: Record<string, any> = {};
      (linkRes.data || []).forEach((l: any) => { if (l.group_id) lmap[l.group_id] = l; });
      setLinksByGroup(lmap);
      const cmap: Record<string, number> = {};
      (cmtRes.data || []).forEach((c: any) => { cmap[c.video_version_id] = (cmap[c.video_version_id] || 0) + 1; });
      setCounts(cmap);
    }
    setLoading(false);
  }, [projectId]);

  const publicUrl = (tk: string) => `${window.location.origin}/revisao/${tk}`;

  const generateLink = async (g: Group) => {
    setBusy(g.current.id);
    const { data, error } = await supabase
      .from('review_links')
      .insert([{ video_version_id: g.current.id, group_id: g.id, created_by: profile?.id }])
      .select('id, token, watermark, allow_download').single();
    setBusy(null);
    if (error || !data) { toast.error('Erro ao gerar link.'); return; }
    setLinksByGroup(prev => ({ ...prev, [g.id]: data as any }));
    await navigator.clipboard.writeText(publicUrl(data.token)).catch(() => {});
    toast.success('Link do cliente gerado e copiado ✓');
  };
  const copyLink = async (tk: string) => { await navigator.clipboard.writeText(publicUrl(tk)).catch(() => {}); toast.success('Link copiado ✓'); };
  const toggleLinkFlag = async (groupId: string, field: 'watermark' | 'allow_download') => {
    const link = linksByGroup[groupId]; if (!link) return;
    const next = !link[field];
    setLinksByGroup(prev => ({ ...prev, [groupId]: { ...link, [field]: next } }));
    const { error } = await supabase.from('review_links').update({ [field]: next }).eq('id', link.id);
    if (error) { toast.error('Não foi possível salvar.'); setLinksByGroup(prev => ({ ...prev, [groupId]: link })); }
  };

  // Abre a revisão interna (player + comentários do time). Garante um token de
  // stream (reusa o link do grupo ou cria um) para o <video> conseguir tocar.
  const openReview = async (g: Group) => {
    setBusy(g.current.id);
    let link = linksByGroup[g.id];
    if (!link) {
      const { data } = await supabase.from('review_links')
        .insert([{ video_version_id: g.current.id, group_id: g.id, created_by: profile?.id }])
        .select('id, token, watermark, allow_download').single();
      if (data) { link = data as any; setLinksByGroup(prev => ({ ...prev, [g.id]: data as any })); }
    }
    setBusy(null);
    if (!link) { toast.error('Não foi possível abrir a revisão.'); return; }
    setReviewModal({ versionId: g.current.id, token: link.token, fileName: g.current.file_name, versao: g.current.versao });
  };

  const toggleSelect = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); setConfirmingDelete(false); return n; });

  const deleteSelected = async () => {
    const versionIds = groups.filter(g => selected.has(g.id)).flatMap(g => g.versions.map(v => v.id));
    if (!versionIds.length) return;
    setDeleting(true);
    try {
      const { error } = await supabase.functions.invoke('drive-delete', { body: { version_ids: versionIds } });
      if (error) throw error;
      toast.success(`${selected.size} vídeo(s) excluído(s) ✓`);
      setSelected(new Set()); setConfirmingDelete(false);
      await fetchVersions();
    } catch { toast.error('Não foi possível excluir.'); }
    finally { setDeleting(false); }
  };

  const scanNow = async () => {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke('review-scan', { body: { project_id: projectId } });
      if (error) throw error;
      await fetchVersions();
      const found = (data as any)?.found ?? 0;
      toast.success(found > 0 ? `${found} vídeo(s) encontrado(s) ✓` : 'Tudo em dia — nenhum vídeo novo.');
    } catch { toast.error('Não foi possível verificar o Drive agora.'); }
    finally { setScanning(false); }
  };

  // Upload pela plataforma: abre a sessão resumável e manda os bytes direto pro
  // Google (com progresso). Ao terminar, dispara o scan p/ detectar na revisão.
  const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv|mpg|mpeg|wmv|mts|m2ts)$/i;
  const uploadFile = async (file: File) => {
    if (!file) return;
    if (!(file.type.startsWith('video/') || VIDEO_EXT.test(file.name))) { toast.error('Selecione um arquivo de vídeo.'); return; }
    setUploading(true); setUploadPct(0); setUploadName(file.name);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const token = session?.access_token || anon;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/drive-upload`
        + `?project_id=${encodeURIComponent(projectId)}&file_name=${encodeURIComponent(file.name)}&mime_type=${encodeURIComponent(file.type || 'video/mp4')}`;
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('apikey', anon);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = e => { if (e.lengthComputable) setUploadPct(e.loaded / e.total); };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`${xhr.status}`));
        xhr.onerror = () => reject(new Error('network'));
        xhr.send(file);
      });
      setUploadPct(1);
      toast.success('Upload concluído ✓ Detectando na revisão…');
      await supabase.functions.invoke('review-scan', { body: { project_id: projectId } });
      await fetchVersions();
    } catch {
      toast.error('Falha no upload. Tente novamente.');
    } finally {
      setUploading(false); setUploadName(''); setUploadPct(0);
    }
  };

  const startRename = (v: VideoVersion) => setRenaming({ id: v.id, value: v.file_name, orig: v.file_name });
  const saveRename = async () => {
    const r = renaming; setRenaming(null);
    if (!r) return;
    const name = r.value.trim();
    if (!name || name === r.orig) return;
    setVersions(prev => prev.map(v => v.id === r.id ? { ...v, file_name: name } : v));
    const { error } = await supabase.functions.invoke('drive-rename', { body: { version_id: r.id, new_name: name } });
    if (error) { toast.error('Não foi possível renomear no Drive.'); fetchVersions(); }
    else toast.success('Renomeado no Drive ✓');
  };

  useEffect(() => {
    supabase.from('projects').select('drive_folder_id, drive_upload_folder_id').eq('id', projectId).single()
      .then(({ data }) => { if (data) setDriveFolders({ root: (data as any).drive_folder_id ?? null, upload: (data as any).drive_upload_folder_id ?? null }); });
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    fetchVersions();
    const channel = supabase
      .channel(`video_versions:${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'video_versions', filter: `project_id=eq.${projectId}` }, () => fetchVersions())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [projectId, fetchVersions]);

  // --- Agrupamento: 1 linha por vídeo (grupo); versão atual = maior versão ---
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, VideoVersion[]>();
    for (const v of versions) { const k = v.group_id || v.id; if (!map.has(k)) map.set(k, []); map.get(k)!.push(v); }
    return [...map.entries()].map(([id, vs]) => {
      const sorted = [...vs].sort((a, b) => b.versao - a.versao);
      return { id, versions: sorted, current: sorted[0], count: sorted.length };
    });
  }, [versions]);

  const sortedGroups = useMemo(() => {
    const val = (g: Group): string | number => {
      const v = g.current;
      switch (sort.key) {
        case 'versao': return v.versao;
        case 'file_name': return (v.file_name || '').toLowerCase();
        case 'status': return v.status;
        case 'duration': return v.duration_ms || 0;
        case 'resolution': return (v.height || 0) * 100000 + (v.width || 0);
        case 'format': return (v.mime_type || '').toLowerCase();
        case 'fps': return v.fps || 0;
        case 'size': return v.size_bytes || 0;
        case 'uploader': return (v.uploaded_by || '').toLowerCase();
        case 'date': return new Date(v.uploaded_at || v.created_at).getTime();
        case 'comments': return counts[v.id] || 0;
      }
    };
    return [...groups].sort((a, b) => { const x = val(a), y = val(b); const c = x < y ? -1 : x > y ? 1 : 0; return sort.dir === 'asc' ? c : -c; });
  }, [groups, sort, counts]);

  const mirrorTaskId = useMemo(() => versions.find(v => v.task_id)?.task_id ?? '', [versions]);
  const linkTask = async (taskId: string) => {
    const value = taskId || null;
    setVersions(prev => prev.map(v => ({ ...v, task_id: value })));
    const { error } = await supabase.from('video_versions').update({ task_id: value }).eq('project_id', projectId);
    if (error) { toast.error('Não foi possível vincular a tarefa.'); fetchVersions(); }
  };

  const transition = async (v: VideoVersion, next: ReviewStatus) => {
    try {
      setBusy(v.id);
      const { error } = await supabase.from('video_versions').update({ status: next, updated_at: new Date().toISOString() }).eq('id', v.id);
      if (error) throw error;
      if (v.task_id) await supabase.from('project_tasks').update({ status: STATUS_TO_TASK[next] }).eq('id', v.task_id);
      toast.success(next === 'APROVADO' ? 'Aprovado! Gerando o vFINAL em 02_APROVADO…' : 'Status atualizado ✓');
      fetchVersions();
    } catch (err: any) { toast.error(`Erro: ${err.message}`); }
    finally { setBusy(null); }
  };

  // Empilha o grupo `source` como versões novas de `target` (a mais nova vira a atual)
  const stackInto = async (source: Group, target: Group) => {
    setStackMenuFor(null); setBusy(source.current.id);
    try {
      let n = target.current.versao;
      const ordered = [...source.versions].sort((a, b) => new Date(a.uploaded_at || a.created_at).getTime() - new Date(b.uploaded_at || b.created_at).getTime());
      for (const v of ordered) { n++; await supabase.from('video_versions').update({ group_id: target.id, versao: n }).eq('id', v.id); }
      await supabase.from('review_links').delete().eq('group_id', source.id); // links órfãos do grupo esvaziado
      toast.success('Vídeos agrupados ✓');
      await fetchVersions();
    } catch { toast.error('Não foi possível agrupar.'); }
    finally { setBusy(null); }
  };
  // Tira uma versão do stack e a torna um vídeo próprio (v01, grupo novo)
  const unstack = async (v: VideoVersion) => {
    setBusy(v.id);
    const { error } = await supabase.from('video_versions').update({ group_id: crypto.randomUUID(), versao: 1 }).eq('id', v.id);
    if (error) toast.error('Não foi possível desagrupar.'); else { toast.success('Desagrupado ✓'); await fetchVersions(); }
    setBusy(null);
  };

  const renderCell = (g: Group, key: SortKey) => {
    const v = g.current;
    switch (key) {
      case 'versao':
        return (
          <button type="button" onClick={() => g.count > 1 && toggleGroupOpen(g.id)}
            className={clsx('flex items-center gap-1.5', g.count > 1 && 'hover:text-lumos-yellow')} title={g.count > 1 ? 'Ver versões' : undefined}>
            <span className="text-xs font-black text-lumos-text-primary">{vLabel(v.versao)}</span>
            {g.count > 1 && <span className="text-[9px] font-black text-lumos-text-secondary bg-lumos-text-secondary/15 rounded-full px-1.5 py-0.5">{g.count}</span>}
            {g.count > 1 && <ChevronRight className={clsx('w-3 h-3 transition-transform', openGroups.has(g.id) && 'rotate-90')} />}
          </button>
        );
      case 'file_name':
        return renaming?.id === v.id ? (
          <input autoFocus value={renaming.value}
            onChange={e => setRenaming(r => r && { ...r, value: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(null); }}
            onBlur={saveRename}
            className="input-lumos h-7 text-xs w-full min-w-[160px]" />
        ) : (
          <div className="flex items-center gap-1.5 group/name max-w-[280px]">
            <button type="button" onClick={() => openReview(g)} title="Abrir revisão interna (comentar no vídeo)"
              className="text-xs font-bold text-lumos-text-primary hover:text-lumos-yellow transition-colors truncate text-left">
              {v.file_name}
            </button>
            <a href={v.drive_web_link || driveFileUrl(v.drive_file_id)} target="_blank" rel="noopener noreferrer" title="Abrir arquivo no Google Drive"
              className="text-lumos-text-secondary/50 hover:text-lumos-yellow flex-shrink-0"><ExternalLink className="w-3 h-3" /></a>
            {canManage && <button type="button" title="Renomear" onClick={() => startRename(v)} className="opacity-0 group-hover/name:opacity-100 text-lumos-text-secondary hover:text-lumos-yellow flex-shrink-0"><Pencil className="w-3 h-3" /></button>}
          </div>
        );
      case 'status':
        return <span className={clsx('inline-block text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border whitespace-nowrap', STATUS_UI[v.status].color)}>{STATUS_UI[v.status].label}</span>;
      case 'duration': return <span className="text-[11px] font-mono font-bold text-lumos-text-secondary">{fmtDur(v.duration_ms)}</span>;
      case 'resolution': return <span className="text-[11px] font-mono text-lumos-text-secondary">{v.width ? `${v.width}×${v.height}` : '—'}</span>;
      case 'format': return <span className="text-[11px] font-bold text-lumos-text-secondary">{(v.mime_type || '').split('/')[1]?.toUpperCase() || '—'}</span>;
      case 'fps': return <span className="text-[11px] font-mono text-lumos-text-secondary">{v.fps ? v.fps : '—'}</span>;
      case 'size': return <span className="text-[11px] font-mono text-lumos-text-secondary">{fmtSize(v.size_bytes)}</span>;
      case 'uploader': return <span className="text-[11px] font-semibold text-lumos-text-secondary truncate">{v.uploaded_by || '—'}</span>;
      case 'date': return <span className="text-[11px] font-mono text-lumos-text-secondary">{fmtDate(v.uploaded_at || v.created_at)}</span>;
      case 'comments': return (counts[v.id] || 0) > 0 ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-lumos-text-primary"><MessageSquare className="w-3 h-3" />{counts[v.id]}</span> : <span className="text-[11px] text-lumos-text-secondary">—</span>;
    }
  };

  const ActionsCell = ({ g }: { g: Group }) => {
    const v = g.current; const link = linksByGroup[g.id]; const isBusy = busy === v.id;
    return (
      <div className="flex items-center gap-1 justify-end">
        <IconBtn title="Revisar e comentar (interno)" onClick={() => openReview(g)} className="!text-lumos-yellow !border-lumos-yellow/40"><Play className="w-3.5 h-3.5" /></IconBtn>
        {canManage && <span className="w-px h-5 bg-lumos-border mx-0.5" />}
        {canManage && v.status === 'EM_REVISAO_INTERNA' && (<>
          <IconBtn title="Aprovar (interno)" disabled={isBusy} onClick={() => transition(v, 'EM_REVISAO_CLIENTE')} className="!text-lumos-yellow"><Check className="w-3.5 h-3.5" /></IconBtn>
          <IconBtn title="Pedir alteração" disabled={isBusy} onClick={() => transition(v, 'ALTERACOES_INTERNAS')} className="!text-red-400"><RotateCcw className="w-3.5 h-3.5" /></IconBtn>
        </>)}
        {canManage && v.status === 'EM_REVISAO_CLIENTE' && (<>
          <IconBtn title="Cliente aprovou" disabled={isBusy} onClick={() => transition(v, 'APROVADO')} className="!text-green-500"><CircleCheckBig className="w-3.5 h-3.5" /></IconBtn>
          <IconBtn title="Pedir alteração" disabled={isBusy} onClick={() => transition(v, 'ALTERACOES_CLIENTE')} className="!text-red-400"><RotateCcw className="w-3.5 h-3.5" /></IconBtn>
        </>)}
        {v.status === 'APROVADO' && (v.approved_file_id
          ? <a href={driveFileUrl(v.approved_file_id)} target="_blank" rel="noopener noreferrer" title="Abrir vFINAL aprovado" className="p-1.5 rounded-lumos border border-green-500/30 text-green-500 hover:bg-green-500/10"><CircleCheckBig className="w-3.5 h-3.5" /></a>
          : <span className="text-[10px] font-bold text-lumos-text-secondary flex items-center gap-1 px-1"><Clock className="w-3 h-3 animate-pulse" /> vFINAL…</span>)}

        {canManage && <span className="w-px h-5 bg-lumos-border mx-0.5" />}

        {canManage && (link ? (<>
          <IconBtn title="Copiar link do cliente" onClick={() => copyLink(link.token)}><Copy className="w-3.5 h-3.5" /></IconBtn>
          <a href={`/revisao/${link.token}`} target="_blank" rel="noopener noreferrer" title="Abrir link do cliente" className="p-1.5 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary"><ExternalLink className="w-3.5 h-3.5" /></a>
          <IconBtn title="Marca d'água" active={link.watermark} onClick={() => toggleLinkFlag(g.id, 'watermark')}><Droplet className="w-3.5 h-3.5" /></IconBtn>
          <IconBtn title="Permitir download" active={link.allow_download} onClick={() => toggleLinkFlag(g.id, 'allow_download')}><DownloadCloud className="w-3.5 h-3.5" /></IconBtn>
        </>) : (
          <IconBtn title="Gerar link do cliente" disabled={isBusy} onClick={() => generateLink(g)} className="!text-lumos-yellow !border-lumos-yellow/40"><Link2 className="w-3.5 h-3.5" /></IconBtn>
        ))}

        {canManage && groups.length > 1 && (
          <div className="relative">
            <IconBtn title="Agrupar como versão de outro vídeo" onClick={() => setStackMenuFor(stackMenuFor === g.id ? null : g.id)}><Layers className="w-3.5 h-3.5" /></IconBtn>
            {stackMenuFor === g.id && (
              <div className="absolute right-0 top-9 z-30 w-56 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary/70 px-2 py-1.5">Empilhar como versão de:</p>
                {groups.filter(o => o.id !== g.id).map(o => (
                  <button key={o.id} type="button" onClick={() => stackInto(g, o)}
                    className="w-full text-left px-2 py-1.5 text-[11px] font-semibold text-lumos-text-primary hover:bg-lumos-text-secondary/10 rounded truncate">
                    {o.current.file_name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
    <div className="card p-6 mt-6 relative"
      onDragOver={e => { if (canManage && !uploading && Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); setFileDragging(true); } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileDragging(false); }}
      onDrop={e => { if (canManage && Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); setFileDragging(false); const f = e.dataTransfer.files?.[0]; if (f) uploadFile(f); } }}
    >
      {fileDragging && (
        <div className="absolute inset-0 z-40 rounded-lumos border-2 border-dashed border-lumos-yellow bg-lumos-yellow/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <p className="text-sm font-black text-lumos-yellow flex items-center gap-2"><Upload className="w-5 h-5" /> Solte o vídeo aqui pra enviar</p>
        </div>
      )}
      <input ref={fileInputRef} type="file" accept="video/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ''; }} />

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest flex items-center gap-2">
          <Film className="w-4 h-4 text-lumos-yellow" /> Revisão de Vídeo
        </h3>

        <div className="flex items-center gap-2 flex-wrap">
          {versions.length > 0 && (
            <div className="relative">
              <button type="button" onClick={() => setShowCols(s => !s)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lumos text-[11px] font-bold border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary transition-all">
                <SlidersHorizontal className="w-3.5 h-3.5" /> Colunas
              </button>
              {showCols && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setShowCols(false)} />
                  <div className="absolute right-0 top-10 z-30 w-56 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary/70 px-1 pb-1.5">Colunas visíveis</p>
                    {COLUMNS.filter(c => FIXED.includes(c.key)).map(c => (
                      <div key={c.key} className="flex items-center justify-between px-1 py-1 opacity-60">
                        <span className="text-[11px] font-bold text-lumos-text-primary">{c.label}</span>
                        <span className="text-[8px] font-black uppercase text-lumos-text-secondary">fixo</span>
                      </div>
                    ))}
                    <div className="h-px bg-lumos-border my-1" />
                    {COLUMNS.filter(c => OPTIONAL.includes(c.key)).map(c => (
                      <button key={c.key} type="button" onClick={() => toggleCol(c.key)} className="w-full flex items-center justify-between px-1 py-1 rounded hover:bg-lumos-text-secondary/10">
                        <span className="text-[11px] font-bold text-lumos-text-primary">{c.label}</span>
                        <span className={clsx('w-8 h-4 rounded-full relative transition-colors', visibleCols.has(c.key) ? 'bg-lumos-yellow' : 'bg-lumos-text-secondary/30')}>
                          <span className={clsx('absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all', visibleCols.has(c.key) ? 'left-4' : 'left-0.5')} />
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <button type="button" onClick={scanNow} disabled={scanning}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lumos text-[11px] font-bold border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:border-lumos-text-secondary/40 transition-all disabled:opacity-60"
            title="Procura vídeos novos no Drive agora">
            <RefreshCw className={clsx('w-3.5 h-3.5', scanning && 'animate-spin')} /> {scanning ? 'Verificando…' : 'Verificar agora'}
          </button>
          {uploadFolderUrl && (
            <a href={uploadFolderUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lumos text-[11px] font-bold border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary transition-all"
              title="Abre a pasta 06_ENTREGA/01_REVISAO no Google Drive">
              <FolderUp className="w-3.5 h-3.5" /> Abrir no Drive
            </a>
          )}
          {canManage && (
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lumos text-[11px] font-bold bg-lumos-yellow text-black hover:brightness-95 transition-all disabled:opacity-60"
              title="Envia um vídeo do seu computador direto pro Drive e pra revisão">
              <Upload className="w-3.5 h-3.5" /> Enviar vídeo
            </button>
          )}
        </div>

        {canManage && versions.length > 0 && (
          <label className="flex items-center gap-1.5 text-[10px] font-bold text-lumos-text-secondary">
            <Link2 className="w-3 h-3" /> Espelhar na tarefa:
            <Select value={mirrorTaskId} onChange={linkTask} align="right"
              className="input-lumos h-7 text-[11px] py-0 min-w-[150px] max-w-[190px]"
              options={[{ value: '', label: 'Nenhuma' }, ...tasks.map(t => ({ value: t.id, label: t.titulo }))]} />
          </label>
        )}
      </div>

      {uploading && (
        <div className="mb-4 p-3 rounded-lumos border border-lumos-yellow/30 bg-lumos-yellow/5">
          <div className="flex items-center justify-between mb-1.5 gap-2">
            <span className="text-[11px] font-bold text-lumos-text-primary flex items-center gap-1.5 truncate"><Upload className="w-3.5 h-3.5 text-lumos-yellow flex-shrink-0" /> Enviando <span className="truncate">{uploadName}</span></span>
            <span className="text-[11px] font-mono font-bold text-lumos-yellow flex-shrink-0">{Math.round(uploadPct * 100)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-lumos-text-secondary/20 overflow-hidden">
            <div className="h-full bg-lumos-yellow transition-all" style={{ width: `${Math.round(uploadPct * 100)}%` }} />
          </div>
        </div>
      )}

      {canManage && selected.size > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3 p-2.5 rounded-lumos border border-red-500/30 bg-red-500/5">
          <span className="text-[11px] font-bold text-lumos-text-primary">{selected.size} vídeo(s) selecionado(s)</span>
          <div className="flex items-center gap-2">
            {confirmingDelete ? (
              <>
                <span className="text-[11px] font-bold text-red-400 hidden sm:inline">Excluir e mandar pra lixeira do Drive?</span>
                <button onClick={() => setConfirmingDelete(false)} className="text-[11px] font-bold px-2.5 py-1 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary">Cancelar</button>
                <button onClick={deleteSelected} disabled={deleting} className="text-[11px] font-bold px-2.5 py-1 rounded-lumos bg-red-500 text-white hover:brightness-110 disabled:opacity-60 flex items-center gap-1">
                  {deleting ? <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Confirmar
                </button>
              </>
            ) : (
              <button onClick={() => setConfirmingDelete(true)} className="text-[11px] font-bold px-2.5 py-1 rounded-lumos border border-red-500/40 text-red-400 hover:bg-red-500/10 flex items-center gap-1">
                <Trash2 className="w-3.5 h-3.5" /> Excluir
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-7 w-7 border-t-2 border-b-2 border-lumos-yellow" /></div>
      ) : groups.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-lumos-border/50 rounded-lumos">
          <Film className="w-8 h-8 text-lumos-text-secondary/30 mx-auto mb-2" />
          <p className="text-xs text-lumos-text-secondary">Nenhum vídeo ainda.</p>
          <p className="text-[10px] text-lumos-text-secondary/60 mt-1">
            O editor sobe o corte em <b>06_ENTREGA/01_REVISAO</b> (qualquer nome) e ele aparece aqui — clique em <b>Verificar agora</b> pra trazer na hora.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-lumos-border">
                {canManage && (
                  <th className="w-8 py-2 px-2">
                    <input type="checkbox" className="accent-lumos-yellow cursor-pointer"
                      checked={sortedGroups.length > 0 && selected.size === sortedGroups.length}
                      onChange={e => { setConfirmingDelete(false); setSelected(e.target.checked ? new Set(sortedGroups.map(g => g.id)) : new Set()); }} />
                  </th>
                )}
                {shownColumns.map(col => (
                  <th key={col.key} onClick={() => toggleSort(col.key)}
                    className={clsx('py-2 px-2 text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary/70 cursor-pointer select-none whitespace-nowrap hover:text-lumos-text-primary transition-colors', col.align === 'right' && 'text-right')}>
                    <span className={clsx('inline-flex items-center gap-1', col.align === 'right' && 'flex-row-reverse')}>
                      {col.label}
                      {sort.key === col.key && (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3 text-lumos-yellow" /> : <ChevronDown className="w-3 h-3 text-lumos-yellow" />)}
                    </span>
                  </th>
                ))}
                <th className="py-2 px-2 text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary/70 text-right whitespace-nowrap">Ações</th>
              </tr>
            </thead>
            <tbody>
              {sortedGroups.map(g => (
                <Fragment key={g.id}>
                  <tr
                    draggable={canManage && renaming?.id !== g.current.id}
                    onDragStart={e => { setDragId(g.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', g.id); } catch { /* noop */ } }}
                    onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                    onDragOver={e => { if (dragId && dragId !== g.id) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverId !== g.id) setDragOverId(g.id); } }}
                    onDrop={e => { e.preventDefault(); const src = dragId; setDragId(null); setDragOverId(null); if (src && src !== g.id) { const s = groups.find(x => x.id === src); if (s) stackInto(s, g); } }}
                    className={clsx('border-b border-lumos-border/40 transition-colors', canManage && renaming?.id !== g.current.id && 'cursor-grab active:cursor-grabbing',
                      selected.has(g.id) ? 'bg-lumos-yellow/[0.06]' : dragOverId === g.id ? 'bg-lumos-yellow/10 ring-1 ring-inset ring-lumos-yellow/50' : dragId === g.id ? 'opacity-40' : 'hover:bg-lumos-text-secondary/[0.03]')}>
                    {canManage && (
                      <td className="w-8 py-2.5 px-2" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" className="accent-lumos-yellow cursor-pointer" checked={selected.has(g.id)} onChange={() => toggleSelect(g.id)} />
                      </td>
                    )}
                    {shownColumns.map(col => (
                      <td key={col.key} className={clsx('py-2.5 px-2 align-middle whitespace-nowrap', col.align === 'right' && 'text-right')}>
                        {renderCell(g, col.key)}
                      </td>
                    ))}
                    <td className="py-2.5 px-2"><ActionsCell g={g} /></td>
                  </tr>

                  {openGroups.has(g.id) && g.count > 1 && (
                    <tr className="border-b border-lumos-border/40 bg-lumos-bg/30">
                      <td colSpan={shownColumns.length + (canManage ? 2 : 1)} className="px-3 py-2">
                        <div className="pl-4 space-y-1.5">
                          <p className="text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary/60">Versões deste vídeo</p>
                          {g.versions.map(v => (
                            <div key={v.id} className="flex items-center gap-3 text-[11px]">
                              <span className="font-black text-lumos-text-primary w-9 flex-shrink-0">{vLabel(v.versao)}</span>
                              <a href={v.drive_web_link || driveFileUrl(v.drive_file_id)} target="_blank" rel="noopener noreferrer" className="text-lumos-text-primary hover:text-lumos-yellow truncate max-w-[240px]">{v.file_name}</a>
                              <span className="text-lumos-text-secondary whitespace-nowrap">{v.uploaded_by || '—'} · {fmtDate(v.uploaded_at || v.created_at)}</span>
                              {(counts[v.id] || 0) > 0 && <span className="inline-flex items-center gap-1 text-lumos-text-secondary"><MessageSquare className="w-3 h-3" />{counts[v.id]}</span>}
                              {canManage && g.count > 1 && (
                                <button type="button" onClick={() => unstack(v)} className="ml-auto text-[10px] font-bold text-lumos-text-secondary hover:text-red-400 flex items-center gap-1 flex-shrink-0"><X className="w-3 h-3" /> Desagrupar</button>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>

    {reviewModal && (
      <InternalReviewModal
        versionId={reviewModal.versionId}
        token={reviewModal.token}
        fileName={reviewModal.fileName}
        versao={reviewModal.versao}
        onClose={() => { setReviewModal(null); fetchVersions(); }}
      />
    )}
    </>
  );
}
