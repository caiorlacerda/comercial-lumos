import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock, Film, ExternalLink, Check, AlertTriangle, RotateCcw, CircleCheckBig, Clock, Link2, Copy, Droplet, DownloadCloud, MessageSquare, FolderUp, RefreshCw, ChevronDown, Pencil, Layers, Scissors, Upload, Play, Trash2, Search, MoreHorizontal, Send, UserCheck, LayoutGrid, List, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import InternalReviewModal from './InternalReviewModal';
import Select from '@/components/ui/Select';
import { type ReviewStatus, STATUS_UI, STATUS_TO_TASK, taskStatusToVideo } from '@/lib/reviewStatus';
import { captureVideoThumb } from '@/lib/videoThumb';

const STREAM_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/review-stream`;

type ItemFila = { id: string; file: File; pct: number; status: 'espera' | 'subindo' | 'ok' | 'erro'; erro?: string };

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
  thumb_url: string | null;
  client_decision: string | null;
  client_decided_by: string | null;
  client_decided_at: string | null;
}

interface Group { id: string; versions: VideoVersion[]; current: VideoVersion; count: number; }

const fmtDur = (ms: number | null) => { if (!ms) return null; const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtSize = (b: number | null) => b ? `${(b / 1048576).toFixed(1)} MB` : null;
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
const vLabel = (n: number) => `v${String(n).padStart(2, '0')}`;
const driveFileUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;
const normTxt = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

interface Props {
  projectId: string;
  tasks: { id: string; titulo: string; status?: string }[];
  /** Id da versão a abrir direto, vindo do link da notificação de menção. */
  abrirVersao?: string | null;
}

export default function VideoReviewPanel({ projectId, tasks, abrirVersao }: Props) {
  const { isAdmin, profile, can } = useAuth();
  const toast = useToast();
  const canManage = isAdmin || can('ordem_do_dia');
  // Quem dá o aval interno: admin, produção e quem receber 'revisao_interna'
  // (é assim que o atendimento entra, sem precisar de papel novo). O editor
  // sobe o vídeo, mas não aprova o próprio trabalho.
  const podeAvalInterno = isAdmin || can('revisao_interna');

  const [versions, setVersions] = useState<VideoVersion[]>([]);
  const [linksByGroup, setLinksByGroup] = useState<Record<string, { id: string; token: string; watermark: boolean; allow_download: boolean }>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [driveFolders, setDriveFolders] = useState<{ root: string | null; upload: string | null }>({ root: null, upload: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<{ id: string; value: string; orig: string } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [stackMenuFor, setStackMenuFor] = useState<string | null>(null);
  // Posição dos menus flutuantes. Eles vão num PORTAL com position:fixed, porque
  // a lista/o card têm overflow-hidden (pros cantos arredondados) e cortavam o
  // dropdown no fim da seção.
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  // Depois que o menu monta, mede a altura REAL e encaixa na tela. Estimar a
  // altura não funciona (o menu muda de tamanho conforme a etapa do vídeo), e
  // era isso que fazia o dropdown vazar pro rodapé.
  // Guarda o menu aberto: o fechamento por rolagem precisa saber diferenciar
  // "a página rolou" (aí o menu descola do botão e tem que fechar) de "a pessoa
  // rolou a lista DENTRO do menu" (aí não pode fechar, senão não dá pra chegar
  // no item lá embaixo).
  const menuElRef = useRef<HTMLDivElement | null>(null);
  const fitMenu = useCallback((el: HTMLDivElement | null) => {
    menuElRef.current = el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 8) {
      el.style.top = `${Math.max(8, window.innerHeight - 8 - r.height)}px`;
    }
  }, []);
  const [uploading, setUploading] = useState(false);
  const [fila, setFila] = useState<ItemFila[]>([]);
  const rodandoRef = useRef(false);
  const pendentesRef = useRef<ItemFila[]>([]);
  const [fileDragging, setFileDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reviewModal, setReviewModal] = useState<{ versionId: string; token: string; fileName: string; versao: number; status: string; version: VideoVersion } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Filtros da grade
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  // Grade (cards) ou lista (linhas compactas) — preferência persiste por navegador.
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    try { return (localStorage.getItem('lumos_entregas_view') as 'grid' | 'list') || 'grid'; } catch { return 'grid'; }
  });
  useEffect(() => { try { localStorage.setItem('lumos_entregas_view', viewMode); } catch { /* ignore */ } }, [viewMode]);

  const toggleGroupOpen = (id: string) => setOpenGroups(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

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
        versionIds.length ? supabase.from('review_comments').select('video_version_id, is_team').in('video_version_id', versionIds) : Promise.resolve({ data: [] as any[] }),
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
    toast.success('Link de revisão gerado e copiado ✓');
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
    setReviewModal({ versionId: g.current.id, token: link.token, fileName: g.current.file_name, versao: g.current.versao, status: g.current.status, version: g.current });
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

  // ── Ações em LOTE (sobre os vídeos selecionados) ─────────────────────────
  const selectedGroups = () => groups.filter(g => selected.has(g.id));

  // Move a etapa de todos os selecionados (e espelha nas tarefas vinculadas).
  const batchTransition = async (next: ReviewStatus) => {
    const gs = selectedGroups();
    if (!gs.length) return;
    setBusy('batch');
    try {
      const versionIds = gs.map(g => g.current.id);
      const { error } = await supabase.from('video_versions')
        .update({ status: next, updated_at: new Date().toISOString() }).in('id', versionIds);
      if (error) throw error;
      const taskIds = gs.map(g => g.current.task_id).filter(Boolean) as string[];
      if (taskIds.length) {
        await supabase.from('project_tasks').update({ status: STATUS_TO_TASK[next] }).in('id', taskIds);
      }
      toast.success(`${gs.length} vídeo(s) em ${STATUS_UI[next].label} ✓`);
      setSelected(new Set());
      await fetchVersions();
    } catch { toast.error('Não foi possível mudar a etapa.'); }
    finally { setBusy(null); }
  };

  // Vincula a MESMA tarefa a todos os selecionados (ou desvincula com '').
  const batchLinkTask = async (taskId: string) => {
    const gs = selectedGroups();
    if (!gs.length) return;
    setBusy('batch');
    try {
      const { error } = await supabase.from('video_versions')
        .update({ task_id: taskId || null }).in('group_id', gs.map(g => g.id));
      if (error) throw error;
      toast.success(taskId ? `Tarefa vinculada em ${gs.length} vídeo(s) ✓` : `Tarefa removida de ${gs.length} vídeo(s).`);
      setSelected(new Set());
      await fetchVersions();
    } catch { toast.error('Não foi possível vincular a tarefa.'); }
    finally { setBusy(null); }
  };

  // Garante link do cliente em todos os selecionados que ainda não têm.
  const batchGenerateLinks = async () => {
    const gs = selectedGroups().filter(g => !linksByGroup[g.id]);
    if (!gs.length) { toast.info('Todos os selecionados já têm link.'); return; }
    setBusy('batch');
    try {
      const { error } = await supabase.from('review_links').insert(
        gs.map(g => ({ video_version_id: g.current.id, group_id: g.id, created_by: profile?.id }))
      );
      if (error) throw error;
      toast.success(`${gs.length} link(s) do cliente gerado(s) ✓`);
      await fetchVersions();
    } catch { toast.error('Não foi possível gerar os links.'); }
    finally { setBusy(null); }
  };

  // Liga/desliga marca d'água ou download nos links dos selecionados.
  const batchLinkFlag = async (field: 'watermark' | 'allow_download', value: boolean) => {
    const ids = selectedGroups().map(g => linksByGroup[g.id]?.id).filter(Boolean) as string[];
    if (!ids.length) { toast.error('Os selecionados ainda não têm link do cliente.'); return; }
    setBusy('batch');
    try {
      const { error } = await supabase.from('review_links').update({ [field]: value }).in('id', ids);
      if (error) throw error;
      const nome = field === 'watermark' ? 'Marca d’água' : 'Download';
      toast.success(`${nome} ${value ? 'ligada' : 'desligada'} em ${ids.length} link(s) ✓`);
      await fetchVersions();
    } catch { toast.error('Não foi possível salvar.'); }
    finally { setBusy(null); }
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

  const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv|mpg|mpeg|wmv|mts|m2ts)$/i;
  const ehVideo = (f: File) => f.type.startsWith('video/') || VIDEO_EXT.test(f.name);

  /** PUT com barra de progresso. Serve pros dois caminhos de upload. */
  const put = (url: string, body: File, headers: Record<string, string>, metodo: 'PUT' | 'POST', onPct: (p: number) => void) =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(metodo, url);
      Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.upload.onprogress = e => { if (e.lengthComputable) onPct(e.loaded / e.total); };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
        ? resolve()
        : reject(Object.assign(new Error(`http ${xhr.status}`), { status: xhr.status }));
      // Sem status = não chegou resposta: rede caiu ou o CORS barrou.
      xhr.onerror = () => reject(Object.assign(new Error('rede'), { status: 0 }));
      xhr.send(body);
    });

  const enviarUm = async (item: ItemFila) => {
    const { file } = item;
    const { data: { session } } = await supabase.auth.getSession();
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const token = session?.access_token || anon;
    const mime = file.type || 'video/mp4';
    const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/drive-upload`
      + `?project_id=${encodeURIComponent(projectId)}&file_name=${encodeURIComponent(file.name)}&mime_type=${encodeURIComponent(mime)}`;
    const onPct = (p: number) => setFila(f => f.map(i => i.id === item.id ? { ...i, pct: p } : i));

    // Caminho principal: pedimos só o endereço da sessão e mandamos os bytes
    // direto pro Google. Assim o arquivo não atravessa a nossa função, que é o
    // que trava com vídeo grande e com vários ao mesmo tempo.
    let sessao: string | null = null;
    try {
      const r = await fetch(`${base}&mode=init&size=${file.size}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, apikey: anon },
      });
      const j = await r.json();
      if (!r.ok || !j?.upload_url) throw Object.assign(new Error(j?.error || 'init'), { status: r.status });
      sessao = j.upload_url as string;
      await put(sessao, file, { 'Content-Type': mime }, 'PUT', onPct);
      return;
    } catch (e: any) {
      // Se o Google não aceitou o envio direto do navegador, cai no caminho
      // antigo (bytes por dentro da nossa função). Mais lento, mas funciona.
      if (e?.status !== 0) throw e;
    }

    // Status 0 quase nunca quer dizer que o arquivo não subiu: o Google não
    // devolve CORS na resposta da sessão, então o navegador cega mesmo quando
    // recebeu tudo. Antes a gente reenviava por reflexo e o projeto ficava com
    // duas cópias do mesmo vídeo. Agora perguntamos ao Google, pelo servidor,
    // se ele já tem o arquivo inteiro — e só reenviamos se faltou pedaço.
    if (sessao) {
      try {
        const p = await fetch(`${base}&mode=probe`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, apikey: anon, 'Content-Type': 'application/json' },
          body: JSON.stringify({ upload_url: sessao, size: file.size }),
        });
        const pj = await p.json();
        if (p.ok && pj?.complete) { onPct(1); return; }
      } catch { /* não deu pra confirmar: segue pro plano B */ }
    }
    await put(base, file, { Authorization: `Bearer ${token}`, apikey: anon, 'Content-Type': mime }, 'POST', onPct);
  };

  /**
   * Sobe a fila, 2 por vez: rápido sem virar briga de banda entre eles.
   * A lista de pendentes vive num ref, não no estado, pra quem for solto no
   * meio do envio entrar na mesma leva em vez de ficar parado esperando.
   */
  const rodarFila = async () => {
    if (rodandoRef.current) return;
    rodandoRef.current = true;
    setUploading(true);
    let enviados = 0, erros = 0;

    const trabalhador = async () => {
      for (;;) {
        const item = pendentesRef.current.shift();
        if (!item) return;
        setFila(f => f.map(i => i.id === item.id ? { ...i, status: 'subindo' } : i));
        try {
          await enviarUm(item);
          enviados++;
          setFila(f => f.map(i => i.id === item.id ? { ...i, status: 'ok', pct: 1 } : i));
        } catch (e: any) {
          erros++;
          setFila(f => f.map(i => i.id === item.id ? { ...i, status: 'erro', erro: String(e?.message || 'falhou') } : i));
        }
      }
    };
    // Enquanto entrar arquivo novo, continua trabalhando.
    while (pendentesRef.current.length) {
      await Promise.all([trabalhador(), trabalhador()]);
    }

    // Uma varredura só no fim, não uma por arquivo.
    if (enviados) {
      await supabase.functions.invoke('review-scan', { body: { project_id: projectId } });
      await fetchVersions();
    }
    if (erros) toast.error(`${erros} arquivo(s) falharam${enviados ? ', os outros subiram' : ''}.`);
    else toast.success(`${enviados} vídeo(s) enviados ✓`);

    rodandoRef.current = false;
    setUploading(false);
    // Deixa a lista na tela um tempinho pra pessoa ver o resultado.
    setTimeout(() => setFila(f => (rodandoRef.current ? f : [])), 6000);
  };

  const enfileirar = (arquivos: FileList | File[] | null) => {
    const todos = Array.from(arquivos || []);
    if (!todos.length) return;
    const videos = todos.filter(ehVideo);
    if (videos.length < todos.length) {
      toast.error(`${todos.length - videos.length} arquivo(s) ignorados, só entram vídeos.`);
    }
    if (!videos.length) return;
    const novos: ItemFila[] = videos.map((file, i) => ({
      id: `${Date.now()}-${i}-${file.name}`, file, pct: 0, status: 'espera',
    }));
    pendentesRef.current.push(...novos);
    setFila(f => [...f.filter(x => x.status !== 'ok'), ...novos]);
    void rodarFila();
  };

  const startRename = (v: VideoVersion) => { setMenuFor(null); setRenaming({ id: v.id, value: v.file_name, orig: v.file_name }); };
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

  // Fecha os menus flutuantes com Esc, ao rolar a página ou redimensionar (são
  // position:fixed, então descolariam do botão).
  useEffect(() => {
    if (!menuFor && !stackMenuFor) return;
    const close = () => { setMenuFor(null); setStackMenuFor(null); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    // Rolagem de dentro do próprio menu não fecha nada. O ouvinte é de captura
    // (pega a rolagem de qualquer elemento), então sem essa checagem a lista de
    // "Empilhar como versão de" se fechava no primeiro deslize e ninguém
    // conseguia alcançar um vídeo que estivesse mais embaixo.
    const onScroll = (e: Event) => {
      const alvo = e.target as Node | null;
      if (alvo && menuElRef.current?.contains(alvo)) return;
      close();
    };
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [menuFor, stackMenuFor]);

  // --- Agrupamento: 1 card por vídeo (grupo); versão atual = maior versão ---
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, VideoVersion[]>();
    for (const v of versions) { const k = v.group_id || v.id; if (!map.has(k)) map.set(k, []); map.get(k)!.push(v); }
    return [...map.entries()].map(([id, vs]) => {
      const sorted = [...vs].sort((a, b) => b.versao - a.versao);
      return { id, versions: sorted, current: sorted[0], count: sorted.length };
    }).sort((a, b) =>
      new Date(b.current.uploaded_at || b.current.created_at).getTime() -
      new Date(a.current.uploaded_at || a.current.created_at).getTime()
    );
  }, [versions]);

  // Veio de uma menção: abre o vídeo citado assim que a lista carregar. Uma vez
  // só, senão fechar o modal faria ele reabrir sem parar.
  const jaAbriuPorLink = useRef(false);
  useEffect(() => {
    if (!abrirVersao || jaAbriuPorLink.current || loading) return;
    const alvo = groups.find(g => g.versions.some(v => v.id === abrirVersao));
    if (!alvo) return;
    jaAbriuPorLink.current = true;
    openReview(alvo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirVersao, groups, loading]);

  const shownGroups = useMemo(() => groups.filter(g => {
    if (statusFilter !== 'all' && g.current.status !== statusFilter) return false;
    if (search.trim()) {
      const t = tasks.find(x => x.id === g.current.task_id)?.titulo || '';
      if (!normTxt(g.current.file_name).includes(normTxt(search)) && !normTxt(t).includes(normTxt(search))) return false;
    }
    return true;
  }), [groups, statusFilter, search, tasks]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    groups.forEach(g => { c[g.current.status] = (c[g.current.status] || 0) + 1; });
    return c;
  }, [groups]);

  // ── Thumbnails automáticas ────────────────────────────────────────────────
  // O Drive não gera thumbnail pra arquivo da service account, então capturamos
  // um frame no navegador (mesma função da revisão interna) e salvamos. Antes
  // isso só acontecia quando alguém ABRIA o vídeo — num projeto com 39 vídeos,
  // quase todos ficavam sem imagem. Agora roda em fila (1 por vez) pros vídeos
  // que estão na tela e ainda não têm thumb, e o resultado fica salvo.
  const thumbTriedRef = useRef<Set<string>>(new Set());
  const [thumbRunning, setThumbRunning] = useState(0);

  useEffect(() => {
    if (!canManage || loading) return;
    let alive = true;

    (async () => {
      const alvo = shownGroups
        .filter(g => !g.current.thumb_url && !thumbTriedRef.current.has(g.current.id))
        .slice(0, 12);   // teto por rodada: não sai baixando 39 vídeos de uma vez
      if (!alvo.length) return;
      setThumbRunning(alvo.length);

      for (const g of alvo) {
        if (!alive) break;
        thumbTriedRef.current.add(g.current.id);
        try {
          // Precisa de um token pra tocar o vídeo (mesma regra do player).
          let token = linksByGroup[g.id]?.token;
          if (!token) {
            const { data } = await supabase.from('review_links')
              .insert([{ video_version_id: g.current.id, group_id: g.id, created_by: profile?.id }])
              .select('id, token, watermark, allow_download').single();
            if (data) { token = (data as any).token; setLinksByGroup(prev => ({ ...prev, [g.id]: data as any })); }
          }
          if (!token) continue;
          const thumb = await captureVideoThumb(`${STREAM_BASE}?token=${encodeURIComponent(token)}`);
          if (!alive) break;
          if (thumb) {
            await supabase.from('video_versions').update({ thumb_url: thumb }).eq('id', g.current.id);
            setVersions(prev => prev.map(v => v.id === g.current.id ? { ...v, thumb_url: thumb } : v));
          }
        } catch { /* segue pro próximo: thumb é enfeite, não pode travar a tela */ }
        finally { if (alive) setThumbRunning(n => Math.max(0, n - 1)); }
      }
      if (alive) setThumbRunning(0);
    })();

    return () => { alive = false; };
  }, [shownGroups, loading, canManage]);

  const linkTask = async (g: Group, taskId: string) => {
    const value = taskId || null;
    const groupId = g.id;
    setVersions(prev => prev.map(v => (v.group_id === groupId ? { ...v, task_id: value } : v)));
    const { error } = await supabase.from('video_versions').update({ task_id: value }).eq('group_id', groupId);
    if (error) { toast.error('Não foi possível vincular a tarefa.'); fetchVersions(); return; }

    if (value) {
      const t = tasks.find(x => x.id === value);
      const next = t?.status ? taskStatusToVideo(t.status, g.current.status) : null;
      if (next && next !== g.current.status) {
        await supabase.from('video_versions')
          .update({ status: next, updated_at: new Date().toISOString() })
          .eq('id', g.current.id);
        toast.success(`Vinculado. O vídeo assumiu o status da tarefa: ${STATUS_UI[next].label}.`);
      } else {
        toast.success('Tarefa vinculada ✓');
      }
    }
    fetchVersions();
  };

  // O link é DO CLIENTE. Antes do aval interno ele não deve nem existir: foi
  // exatamente daí que veio o erro humano de mandar material cru pra fora.
  const FASE_INTERNA: string[] = ['EM_REVISAO_INTERNA', 'ALTERACOES_INTERNAS'];
  const liberadoPraCliente = (st: string) => !FASE_INTERNA.includes(st);

  const transition = async (v: VideoVersion, next: ReviewStatus) => {
    try {
      setBusy(v.id); setMenuFor(null);
      const { error } = await supabase.from('video_versions').update({ status: next, updated_at: new Date().toISOString() }).eq('id', v.id);
      if (error) throw error;
      if (v.task_id) await supabase.from('project_tasks').update({ status: STATUS_TO_TASK[next] }).eq('id', v.task_id);

      // Passou pro cliente: já deixa o link pronto. Assim ninguém precisa
      // lembrar de gerar, e não existe link solto antes da hora.
      let avisoLink = '';
      if (next === 'EM_REVISAO_CLIENTE') {
        const grupo = v.group_id || v.id;
        if (!linksByGroup[grupo]) {
          const { error: eLink } = await supabase.from('review_links')
            .insert([{ video_version_id: v.id, group_id: grupo, created_by: profile?.id }]);
          avisoLink = eLink ? '' : ' Link do cliente criado.';
        }
      }
      toast.success(next === 'APROVADO'
        ? 'Aprovado! Gerando o vFINAL em 02_APROVADO…'
        : `Status atualizado ✓${avisoLink}`);
      fetchVersions();
    } catch (err: any) { toast.error(`Erro: ${err.message}`); }
    finally { setBusy(null); }
  };

  const stackInto = async (source: Group, target: Group) => {
    setStackMenuFor(null); setMenuFor(null); setBusy(source.current.id);
    try {
      let n = target.current.versao;
      const ordered = [...source.versions].sort((a, b) => new Date(a.uploaded_at || a.created_at).getTime() - new Date(b.uploaded_at || b.created_at).getTime());
      for (const v of ordered) { n++; await supabase.from('video_versions').update({ group_id: target.id, versao: n }).eq('id', v.id); }
      // Mantém o link do grupo de destino; o do grupo esvaziado deixa de existir.
      await supabase.from('review_links').delete().eq('group_id', source.id);
      toast.success('Vídeos agrupados ✓');
      await fetchVersions();
    } catch { toast.error('Não foi possível agrupar.'); }
    finally { setBusy(null); }
  };

  const unstack = async (v: VideoVersion) => {
    setMenuFor(null); setBusy(v.id);
    const { error } = await supabase.from('video_versions').update({ group_id: crypto.randomUUID(), versao: 1 }).eq('id', v.id);
    if (error) toast.error('Não foi possível desagrupar.'); else { toast.success('Desagrupado ✓'); await fetchVersions(); }
    setBusy(null);
  };

  // ── Ações de um vídeo: 2 botões visíveis + menu ⋯ (compartilhado grade/lista) ──
  const RowActions = ({ g, compact }: { g: Group; compact?: boolean }) => {
    const v = g.current;
    const link = linksByGroup[g.id];
    const isBusy = busy === v.id;
    const h = compact ? 'h-7' : 'h-8';
    const iconSz = compact ? 'w-3 h-3' : 'w-3.5 h-3.5';
    return (
      <div className={clsx('flex items-center gap-1.5', compact && 'flex-shrink-0')}>
        {v.status === 'APROVADO' && v.approved_file_id ? (
          <a href={driveFileUrl(v.approved_file_id)} target="_blank" rel="noopener noreferrer"
            className={clsx(h, compact ? 'px-2.5' : 'flex-1', 'rounded-lumos bg-green-500/15 border border-green-500/40 text-green-500 text-[11px] font-black flex items-center justify-center gap-1.5 hover:bg-green-500/25 whitespace-nowrap')}>
            <DownloadCloud className={iconSz} /> vFINAL
          </a>
        ) : v.status === 'APROVADO' ? (
          <span className={clsx(h, compact ? 'px-2.5' : 'flex-1', 'rounded-lumos border border-lumos-border text-lumos-text-secondary text-[11px] font-bold flex items-center justify-center gap-1.5 whitespace-nowrap')}>
            <Clock className="w-3 h-3 animate-pulse" /> {compact ? '…' : 'vFINAL…'}
          </span>
        ) : (
          <button type="button" onClick={() => openReview(g)} disabled={isBusy}
            className={clsx(h, compact ? 'px-2.5' : 'flex-1', 'rounded-lumos bg-lumos-yellow/15 border border-lumos-yellow/40 text-lumos-yellow text-[11px] font-black flex items-center justify-center gap-1.5 hover:bg-lumos-yellow/25 disabled:opacity-50 whitespace-nowrap')}>
            <Play className={iconSz} /> Revisar
          </button>
        )}

        {canManage && !liberadoPraCliente(v.status) ? (
          // Em revisão interna não existe link pra copiar. O botão fica visível
          // e travado, dizendo o porquê — some a chance de mandar material cru
          // pro cliente, e a pessoa entende o processo em vez de só ser barrada.
          <button type="button" disabled
            title="O link é do cliente. Aprove internamente primeiro (menu ··· → Aprovado internamente)."
            className={clsx(h, compact ? 'px-2.5' : 'flex-1', 'rounded-lumos border border-lumos-border/60 text-lumos-text-secondary/70 text-[11px] font-black flex items-center justify-center gap-1.5 cursor-not-allowed whitespace-nowrap')}>
            <Lock className={iconSz} /> {compact ? '' : 'Só após aval interno'}
          </button>
        ) : canManage && link ? (
          <button type="button" onClick={() => copyLink(link.token)}
            title="Copia o link do cliente — não muda o status do vídeo"
            className={clsx(h, compact ? 'px-2.5' : 'flex-1', 'rounded-lumos border border-lumos-border text-lumos-text-primary text-[11px] font-black flex items-center justify-center gap-1.5 hover:border-lumos-yellow/50 whitespace-nowrap')}>
            <Copy className={iconSz} /> {compact ? '' : 'Link do cliente'}
          </button>
        ) : canManage ? (
          <button type="button" onClick={() => generateLink(g)} disabled={isBusy}
            className={clsx(h, compact ? 'px-2.5' : 'flex-1', 'rounded-lumos border border-lumos-border text-lumos-text-primary text-[11px] font-black flex items-center justify-center gap-1.5 hover:border-lumos-yellow/50 disabled:opacity-50 whitespace-nowrap')}>
            <Link2 className={iconSz} /> {compact ? '' : 'Gerar link do cliente'}
          </button>
        ) : null}

        {canManage && (
          <div className="flex-shrink-0">
            <button type="button"
              onClick={e => {
                setStackMenuFor(null);
                if (menuFor === g.id) { setMenuFor(null); return; }
                // Posiciona o menu (fixed) abaixo ou acima do botão, conforme o espaço.
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const estH = 360;
                setMenuPos({
                  top: r.bottom + 4 + estH > window.innerHeight - 8 && r.top - estH - 4 > 8 ? r.top - estH - 4 : r.bottom + 4,
                  right: Math.max(8, window.innerWidth - r.right),
                });
                setMenuFor(g.id);
              }}
              className={clsx(h, 'w-8 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:border-lumos-yellow/50 flex items-center justify-center')} title="Mais ações">
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {menuFor === g.id && menuPos && createPortal(<>
              <div className="fixed inset-0 z-[300]" onClick={() => setMenuFor(null)} />
              <div ref={fitMenu} style={{ position: 'fixed', top: menuPos.top, right: menuPos.right }}
                className="z-[301] w-60 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl py-1 max-h-[70vh] overflow-y-auto custom-scrollbar">
                {/* Transições */}
                {v.status === 'EM_REVISAO_INTERNA' && podeAvalInterno && (<>
                  <MenuItem icon={Send} label="Aprovado internamente: enviar ao cliente" onClick={() => transition(v, 'EM_REVISAO_CLIENTE')} />
                  <MenuItem icon={RotateCcw} label="Pedir alteração (interna)" danger onClick={() => transition(v, 'ALTERACOES_INTERNAS')} />
                </>)}
                {v.status === 'EM_REVISAO_CLIENTE' && (<>
                  <MenuItem icon={CircleCheckBig} label="Marcar: cliente aprovou" onClick={() => transition(v, 'APROVADO')} />
                  <MenuItem icon={RotateCcw} label="Marcar: cliente pediu ajustes" danger onClick={() => transition(v, 'ALTERACOES_CLIENTE')} />
                </>)}
                {(v.status === 'ALTERACOES_INTERNAS' || v.status === 'ALTERACOES_CLIENTE') && podeAvalInterno && (<>
                  <MenuItem icon={Play} label="Voltar pra revisão interna" onClick={() => transition(v, 'EM_REVISAO_INTERNA')} />
                  <MenuItem icon={Send} label="Enviar ao cliente" onClick={() => transition(v, 'EM_REVISAO_CLIENTE')} />
                </>)}
                {v.status === 'APROVADO' && (
                  <MenuItem icon={RotateCcw} label="Reabrir (revisão interna)" onClick={() => transition(v, 'EM_REVISAO_INTERNA')} />
                )}
                <div className="h-px bg-lumos-border my-1" />

                {/* Link do cliente */}
                {link && (<>
                  <MenuItem icon={ExternalLink} label="Abrir link do cliente" onClick={() => { setMenuFor(null); window.open(`/revisao/${link.token}`, '_blank'); }} />
                  <MenuItem icon={Droplet} label={link.watermark ? 'Marca d’água: ligada' : 'Marca d’água: desligada'} active={link.watermark} onClick={() => toggleLinkFlag(g.id, 'watermark')} />
                  <MenuItem icon={DownloadCloud} label={link.allow_download ? 'Download: liberado' : 'Download: bloqueado'} active={link.allow_download} onClick={() => toggleLinkFlag(g.id, 'allow_download')} />
                  <div className="h-px bg-lumos-border my-1" />
                </>)}

                {/* Arquivo */}
                <MenuItem icon={ExternalLink} label="Abrir no Google Drive" onClick={() => { setMenuFor(null); window.open(v.drive_web_link || driveFileUrl(v.drive_file_id), '_blank'); }} />
                <MenuItem icon={Pencil} label="Renomear" onClick={() => startRename(v)} />
                {g.count > 1 && <MenuItem icon={Scissors} label="Separar esta versão" onClick={() => unstack(v)} />}
                {groups.length > 1 && (
                  <MenuItem icon={Layers} label="Agrupar como versão de…" onClick={() => { setMenuFor(null); setStackMenuFor(g.id); }} />
                )}
                <div className="h-px bg-lumos-border my-1" />
                <MenuItem icon={Trash2} label="Excluir vídeo" danger onClick={() => { setMenuFor(null); setSelected(new Set([g.id])); setConfirmingDelete(true); }} />
              </div>
            </>, document.body)}

            {stackMenuFor === g.id && menuPos && createPortal(<>
              <div className="fixed inset-0 z-[300]" onClick={() => setStackMenuFor(null)} />
              <div ref={fitMenu} style={{ position: 'fixed', top: menuPos.top, right: menuPos.right }}
                className="z-[301] w-60 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-1 max-h-[70vh] overflow-y-auto custom-scrollbar">
                <p className="text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary/70 px-2 py-1.5">Empilhar como versão de:</p>
                {groups.filter(o => o.id !== g.id).map(o => (
                  <button key={o.id} type="button" onClick={() => stackInto(g, o)}
                    className="w-full text-left px-2 py-1.5 text-[11px] font-semibold text-lumos-text-primary hover:bg-lumos-text-secondary/10 rounded truncate">
                    {o.current.file_name}
                  </button>
                ))}
              </div>
            </>, document.body)}
          </div>
        )}
      </div>
    );
  };

  // ── Card de um vídeo (grade) ─────────────────────────────────────────────
  const VideoCard = ({ g }: { g: Group }) => {
    const v = g.current;
    const isBusy = busy === v.id;
    const linked = tasks.find(t => t.id === v.task_id);
    const meta = [fmtDur(v.duration_ms), v.width ? `${v.width}×${v.height}` : null, v.fps ? String(v.fps) : null, fmtSize(v.size_bytes)].filter(Boolean).join(' · ');
    const totalComments = g.versions.reduce((acc, x) => acc + (counts[x.id] || 0), 0);

    return (
      <div className={clsx('border rounded-lumos overflow-hidden bg-lumos-surface transition-colors flex flex-col',
        selected.has(g.id) ? 'border-lumos-yellow/60' : 'border-lumos-border hover:border-lumos-yellow/30')}>
        {/* Thumb */}
        <button type="button" onClick={() => openReview(g)} disabled={isBusy}
          className="relative aspect-[16/10] bg-lumos-bg/70 flex items-center justify-center group/thumb overflow-hidden">
          {v.thumb_url
            ? <img src={v.thumb_url} alt="" className="w-full h-full object-cover" />
            : <Film className="w-8 h-8 text-lumos-text-secondary/25" />}
          <span className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/25 transition-colors flex items-center justify-center">
            <span className="w-10 h-10 rounded-full bg-lumos-yellow/90 text-black flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity">
              <Play className="w-4 h-4 ml-0.5" fill="currentColor" />
            </span>
          </span>
          <span className="absolute top-2 left-2 flex items-center gap-1">
            <span className="text-[9px] font-black bg-black/60 text-white px-2 py-0.5 rounded-full tracking-wider">{vLabel(v.versao)}</span>
            {g.count > 1 && (
              <span onClick={e => { e.stopPropagation(); toggleGroupOpen(g.id); }}
                className="text-[9px] font-black bg-black/60 text-white px-1.5 py-0.5 rounded-full cursor-pointer hover:bg-black/80" title="Ver versões">
                {g.count} versões
              </span>
            )}
          </span>
          <span className={clsx('absolute top-2 right-2 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border backdrop-blur-sm', STATUS_UI[v.status].color)}>
            {STATUS_UI[v.status].label}
          </span>
          {canManage && (
            <span onClick={e => { e.stopPropagation(); toggleSelect(g.id); }}
              className="absolute bottom-2 left-2 w-5 h-5 rounded bg-black/50 flex items-center justify-center">
              <input type="checkbox" className="accent-lumos-yellow cursor-pointer pointer-events-none" checked={selected.has(g.id)} readOnly />
            </span>
          )}
          {totalComments > 0 && (
            <span className="absolute bottom-2 right-2 text-[9px] font-black bg-black/60 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
              <MessageSquare className="w-2.5 h-2.5" /> {totalComments}
            </span>
          )}
        </button>

        {/* Corpo */}
        <div className="p-3 flex-1 flex flex-col">
          {renaming?.id === v.id ? (
            <input autoFocus value={renaming.value}
              onChange={e => setRenaming(r => r && { ...r, value: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(null); }}
              onBlur={saveRename}
              className="input-lumos h-7 text-xs w-full" />
          ) : (
            <p className="text-[13px] font-bold text-lumos-text-primary truncate" title={v.file_name}>{v.file_name}</p>
          )}
          <p className="text-[10.5px] text-lumos-text-secondary truncate mt-0.5">
            {meta}{meta && (v.uploaded_by || v.uploaded_at) ? ' · ' : ''}{v.uploaded_by || ''}{v.uploaded_by ? ', ' : ''}{fmtDate(v.uploaded_at || v.created_at)}
          </p>

          {/* Tarefa vinculada */}
          <div className="mt-2 min-h-[26px]">
            {canManage ? (
              <div className="flex items-center gap-1.5">
                <Select
                  value={v.task_id || ''}
                  onChange={val => linkTask(g, val)}
                  searchable searchPlaceholder="Buscar tarefa…"
                  placeholder="⚠ Sem tarefa"
                  menuClassName="min-w-[220px]"
                  className={clsx('w-full h-7 px-2 rounded text-[10.5px] font-bold border bg-transparent',
                    v.task_id ? 'border-lumos-border text-lumos-text-secondary hover:border-lumos-yellow/40' : 'border-red-500/40 text-red-400')}
                  options={[{ value: '', label: 'Sem tarefa' }, ...tasks.map(t => ({ value: t.id, label: t.titulo }))]}
                />
              </div>
            ) : (
              <p className="text-[10.5px] text-lumos-text-secondary truncate">
                {linked ? <>Tarefa: <span className="text-lumos-text-primary font-bold">{linked.titulo}</span></> : <span className="text-red-400 font-bold">Sem tarefa</span>}
              </p>
            )}
          </div>

          {/* Decisão do cliente (quando houver) */}
          {v.client_decision && (
            <p className={clsx('text-[10.5px] font-bold mt-2 flex items-center gap-1.5',
              v.client_decision === 'aprovado' ? 'text-green-500' : 'text-red-400')}>
              <UserCheck className="w-3 h-3 flex-shrink-0" />
              {v.client_decision === 'aprovado' ? 'Aprovado por' : 'Ajustes pedidos por'} {v.client_decided_by} · {fmtDate(v.client_decided_at)}
            </p>
          )}

          {/* Ações: 2 visíveis + menu */}
          <div className="mt-3">
            <RowActions g={g} />
          </div>

          {/* Versões (expandido) */}
          {openGroups.has(g.id) && g.count > 1 && (
            <div className="mt-3 pt-2 border-t border-dashed border-lumos-border space-y-1">
              {g.versions.map(ver => (
                <div key={ver.id} className="flex items-center gap-2 text-[10.5px]">
                  <span className="font-black text-lumos-text-primary w-8 flex-shrink-0">{vLabel(ver.versao)}</span>
                  <a href={ver.drive_web_link || driveFileUrl(ver.drive_file_id)} target="_blank" rel="noopener noreferrer"
                    className="text-lumos-text-secondary hover:text-lumos-yellow truncate flex-1">{ver.file_name}</a>
                  {(counts[ver.id] || 0) > 0 && <span className="text-lumos-text-secondary flex items-center gap-0.5 flex-shrink-0"><MessageSquare className="w-2.5 h-2.5" />{counts[ver.id]}</span>}
                  <span className="text-lumos-text-secondary/70 flex-shrink-0">{fmtDate(ver.uploaded_at || ver.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Linha de um vídeo (lista) — mesma informação do card, mais densa ─────
  const VideoRow = ({ g }: { g: Group }) => {
    const v = g.current;
    const linked = tasks.find(t => t.id === v.task_id);
    const meta = [fmtDur(v.duration_ms), v.width ? `${v.width}×${v.height}` : null, fmtSize(v.size_bytes)].filter(Boolean).join(' · ');
    const totalComments = g.versions.reduce((acc, x) => acc + (counts[x.id] || 0), 0);

    return (
      <div className="border-b border-lumos-border/60 last:border-b-0">
      <div className={clsx('flex items-center gap-3 px-3 py-2.5 transition-colors',
        selected.has(g.id) ? 'bg-lumos-yellow/[0.06]' : 'hover:bg-lumos-text-secondary/[0.03]')}>
        {canManage && (
          <input type="checkbox" className="accent-lumos-yellow cursor-pointer flex-shrink-0" checked={selected.has(g.id)} onChange={() => toggleSelect(g.id)} />
        )}

        {/* Thumb pequena */}
        <button type="button" onClick={() => openReview(g)}
          className="relative w-16 h-10 rounded bg-lumos-bg/70 flex items-center justify-center overflow-hidden flex-shrink-0 group/thumb">
          {v.thumb_url ? <img src={v.thumb_url} alt="" className="w-full h-full object-cover" /> : <Film className="w-4 h-4 text-lumos-text-secondary/25" />}
          <span className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/30 transition-colors flex items-center justify-center">
            <Play className="w-3 h-3 text-white opacity-0 group-hover/thumb:opacity-100" fill="currentColor" />
          </span>
        </button>

        {/* Nome + meta */}
        <div className="min-w-0 flex-1 max-w-[260px]">
          {renaming?.id === v.id ? (
            <input autoFocus value={renaming.value}
              onChange={e => setRenaming(r => r && { ...r, value: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(null); }}
              onBlur={saveRename}
              className="input-lumos h-7 text-xs w-full" onClick={e => e.stopPropagation()} />
          ) : (
            <p className="text-[12.5px] font-bold text-lumos-text-primary truncate" title={v.file_name}>{v.file_name}</p>
          )}
          <p className="text-[10px] text-lumos-text-secondary truncate">{meta || '—'}</p>
        </div>

        {/* Versão + comentários */}
        <div className="flex items-center gap-1.5 flex-shrink-0 w-20">
          <span className="text-[9px] font-black bg-lumos-text-secondary/10 text-lumos-text-secondary px-1.5 py-0.5 rounded-full">{vLabel(v.versao)}</span>
          {g.count > 1 && (
            <button type="button" onClick={() => toggleGroupOpen(g.id)} className="text-[9px] font-black text-lumos-text-secondary hover:text-lumos-yellow" title="Ver versões">×{g.count}</button>
          )}
          {totalComments > 0 && (
            <span className="text-[9px] font-bold text-lumos-text-secondary flex items-center gap-0.5"><MessageSquare className="w-2.5 h-2.5" />{totalComments}</span>
          )}
        </div>

        {/* Status */}
        <span className={clsx('text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border whitespace-nowrap flex-shrink-0 w-[132px] text-center', STATUS_UI[v.status].color)}>
          {STATUS_UI[v.status].label}
        </span>

        {/* Tarefa */}
        <div className="w-40 flex-shrink-0">
          {canManage ? (
            <Select
              value={v.task_id || ''}
              onChange={val => linkTask(g, val)}
              searchable searchPlaceholder="Buscar tarefa…"
              placeholder="⚠ Sem tarefa"
              menuClassName="min-w-[220px]"
              className={clsx('w-full h-7 px-2 rounded text-[10.5px] font-bold border bg-transparent',
                v.task_id ? 'border-lumos-border text-lumos-text-secondary hover:border-lumos-yellow/40' : 'border-red-500/40 text-red-400')}
              options={[{ value: '', label: 'Sem tarefa' }, ...tasks.map(t => ({ value: t.id, label: t.titulo }))]}
            />
          ) : (
            <p className="text-[10.5px] text-lumos-text-secondary truncate">
              {linked ? linked.titulo : <span className="text-red-400 font-bold">Sem tarefa</span>}
            </p>
          )}
        </div>

        {/* Decisão do cliente */}
        <div className="w-8 flex-shrink-0 flex justify-center" title={v.client_decision ? `${v.client_decision === 'aprovado' ? 'Aprovado' : 'Ajustes pedidos'} por ${v.client_decided_by} · ${fmtDate(v.client_decided_at)}` : undefined}>
          {v.client_decision && (
            <UserCheck className={clsx('w-3.5 h-3.5', v.client_decision === 'aprovado' ? 'text-green-500' : 'text-red-400')} />
          )}
        </div>

        <RowActions g={g} compact />
      </div>

      {/* Versões (expandido) */}
      {openGroups.has(g.id) && g.count > 1 && (
        <div className="px-4 pb-2.5 pl-[52px] space-y-1 bg-lumos-bg/20">
          {g.versions.map(ver => (
            <div key={ver.id} className="flex items-center gap-2 text-[10.5px]">
              <span className="font-black text-lumos-text-primary w-8 flex-shrink-0">{vLabel(ver.versao)}</span>
              <a href={ver.drive_web_link || driveFileUrl(ver.drive_file_id)} target="_blank" rel="noopener noreferrer"
                className="text-lumos-text-secondary hover:text-lumos-yellow truncate flex-1 max-w-xs">{ver.file_name}</a>
              {(counts[ver.id] || 0) > 0 && <span className="text-lumos-text-secondary flex items-center gap-0.5 flex-shrink-0"><MessageSquare className="w-2.5 h-2.5" />{counts[ver.id]}</span>}
              <span className="text-lumos-text-secondary/70 flex-shrink-0">{fmtDate(ver.uploaded_at || ver.created_at)}</span>
            </div>
          ))}
        </div>
      )}
      </div>
    );
  };

  return (
    <>
    <div className="card p-5 md:p-6 relative"
      onDragOver={e => { if (canManage && !uploading && Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); setFileDragging(true); } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileDragging(false); }}
      onDrop={e => { if (canManage && Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); setFileDragging(false); enfileirar(e.dataTransfer.files); } }}
    >
      {fileDragging && (
        <div className="absolute inset-0 z-40 rounded-lumos border-2 border-dashed border-lumos-yellow bg-lumos-yellow/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <p className="text-sm font-black text-lumos-yellow flex items-center gap-2"><Upload className="w-5 h-5" /> Solte os vídeos aqui pra enviar</p>
        </div>
      )}
      <input ref={fileInputRef} type="file" accept="video/*" multiple className="hidden"
        onChange={e => { enfileirar(e.target.files); e.target.value = ''; }} />

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest flex items-center gap-2">
          <Film className="w-4 h-4 text-lumos-yellow" /> Entregas de vídeo
          {groups.length > 0 && <span className="text-lumos-text-secondary font-bold normal-case tracking-normal">· {groups.length} vídeo{groups.length > 1 ? 's' : ''}</span>}
        </h3>

        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={scanNow} disabled={scanning}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lumos text-[11px] font-bold border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:border-lumos-text-secondary/40 transition-all disabled:opacity-60"
            title="Procura vídeos novos no Drive agora">
            <RefreshCw className={clsx('w-3.5 h-3.5', scanning && 'animate-spin')} /> {scanning ? 'Verificando…' : 'Verificar agora'}
          </button>
          {uploadFolderUrl && (
            <a href={uploadFolderUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lumos text-[11px] font-bold border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary transition-all"
              title="Abre a pasta 06_ENTREGA/01_REVISAO no Google Drive">
              <FolderUp className="w-3.5 h-3.5" /> Drive
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
      </div>

      {/* Busca + filtro por etapa */}
      {groups.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <div className="relative flex-1 min-w-[170px] max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-lumos-text-secondary pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar vídeo ou tarefa…" className="input-lumos w-full h-9 pl-9 text-xs" />
          </div>
          <div className="w-44 flex-shrink-0">
            <Select value={statusFilter} onChange={setStatusFilter} ariaLabel="Filtrar por etapa" menuClassName="min-w-[190px]"
              className={clsx('w-full h-9 px-3 rounded-lumos border bg-lumos-surface text-[11px] font-bold transition-colors',
                statusFilter !== 'all' ? 'border-lumos-yellow/60 text-lumos-yellow' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:border-lumos-yellow/40')}
              options={[{ value: 'all', label: 'Todas as etapas' },
                ...(Object.keys(STATUS_UI) as ReviewStatus[])
                  .filter(s => (statusCounts[s] || 0) > 0)
                  .map(s => ({ value: s, label: `${STATUS_UI[s].label} · ${statusCounts[s]}` }))]} />
          </div>

          {/* Selecionar todos os visíveis (base pra ação em lote) */}
          {canManage && shownGroups.length > 0 && (
            <label className="flex items-center gap-2 h-9 px-3 rounded-lumos border border-lumos-border bg-lumos-surface text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary cursor-pointer flex-shrink-0">
              <input type="checkbox" className="accent-lumos-yellow cursor-pointer"
                checked={selected.size > 0 && shownGroups.every(g => selected.has(g.id))}
                onChange={e => {
                  setConfirmingDelete(false);
                  setSelected(e.target.checked ? new Set(shownGroups.map(g => g.id)) : new Set());
                }} />
              Selecionar {statusFilter !== 'all' || search.trim() ? 'filtrados' : 'todos'}
            </label>
          )}

          {thumbRunning > 0 && (
            <span className="flex items-center gap-1.5 text-[10.5px] font-bold text-lumos-text-secondary flex-shrink-0" title="Gerando as miniaturas dos vídeos que ainda não tinham">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-lumos-yellow" /> gerando miniaturas…
            </span>
          )}
          {/* Grade / Lista */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-lumos border border-lumos-border bg-lumos-surface flex-shrink-0 ml-auto">
            <button type="button" onClick={() => setViewMode('grid')} title="Ver em grade"
              className={clsx('h-8 w-8 rounded flex items-center justify-center transition-colors', viewMode === 'grid' ? 'bg-lumos-yellow/15 text-lumos-yellow' : 'text-lumos-text-secondary hover:text-lumos-text-primary')}>
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => setViewMode('list')} title="Ver em lista"
              className={clsx('h-8 w-8 rounded flex items-center justify-center transition-colors', viewMode === 'list' ? 'bg-lumos-yellow/15 text-lumos-yellow' : 'text-lumos-text-secondary hover:text-lumos-text-primary')}>
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {fila.length > 0 && (
        <div className="mb-4 p-3 rounded-lumos border border-lumos-yellow/30 bg-lumos-yellow/5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-black text-lumos-text-primary uppercase tracking-wide flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5 text-lumos-yellow" />
              {uploading ? 'Enviando' : 'Envio concluído'}
            </span>
            <span className="text-[11px] font-mono font-bold text-lumos-yellow tabular-nums">
              {fila.filter(i => i.status === 'ok').length}/{fila.length}
            </span>
          </div>

          {fila.map(i => (
            <div key={i.id}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[11px] font-bold text-lumos-text-primary truncate flex items-center gap-1.5">
                  {i.status === 'ok' && <Check className="w-3 h-3 text-green-500 flex-shrink-0" />}
                  {i.status === 'erro' && <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />}
                  <span className="truncate">{i.file.name}</span>
                </span>
                <span className={clsx('text-[10.5px] font-mono font-bold flex-shrink-0 tabular-nums',
                  i.status === 'erro' ? 'text-red-500' : i.status === 'ok' ? 'text-green-500' : 'text-lumos-yellow')}>
                  {i.status === 'erro' ? 'falhou' : i.status === 'espera' ? 'na fila' : `${Math.round(i.pct * 100)}%`}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-lumos-text-secondary/20 overflow-hidden">
                <div className={clsx('h-full transition-all', i.status === 'erro' ? 'bg-red-500' : i.status === 'ok' ? 'bg-green-500' : 'bg-lumos-yellow')}
                  style={{ width: `${i.status === 'erro' ? 100 : Math.round(i.pct * 100)}%` }} />
              </div>
            </div>
          ))}

          {fila.some(i => i.status === 'erro') && (
            <button type="button"
              onClick={() => enfileirar(fila.filter(i => i.status === 'erro').map(i => i.file))}
              className="text-[10.5px] font-black uppercase tracking-wide text-lumos-yellow hover:underline">
              Tentar de novo os que falharam
            </button>
          )}
        </div>
      )}

      {canManage && selected.size > 0 && (
        <div className="mb-3 p-2.5 rounded-lumos border border-lumos-yellow/40 bg-lumos-yellow/[0.06]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-black text-lumos-text-primary bg-lumos-yellow/20 rounded-full px-2.5 py-1">
              {selected.size} selecionado{selected.size > 1 ? 's' : ''}
            </span>

            {confirmingDelete ? (
              <>
                <span className="text-[11px] font-bold text-red-400">Excluir e mandar pra lixeira do Drive?</span>
                <button onClick={() => setConfirmingDelete(false)} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary">Cancelar</button>
                <button onClick={deleteSelected} disabled={deleting} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lumos bg-red-500 text-white hover:brightness-110 disabled:opacity-60 flex items-center gap-1">
                  {deleting ? <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Confirmar
                </button>
              </>
            ) : (<>
              {/* Etapa */}
              <div className="w-40 flex-shrink-0">
                <Select value="" onChange={v => batchTransition(v as ReviewStatus)} placeholder="Mover etapa" ariaLabel="Mover etapa em lote" menuClassName="min-w-[200px]"
                  className="w-full h-8 px-2.5 rounded-lumos border border-lumos-border bg-lumos-surface text-[11px] font-bold text-lumos-text-primary hover:border-lumos-yellow/50"
                  options={[
                    { value: 'EM_REVISAO_INTERNA', label: 'Revisão interna' },
                    { value: 'EM_REVISAO_CLIENTE', label: 'Enviar ao cliente' },
                    { value: 'APROVADO', label: 'Cliente aprovou' },
                    { value: 'ALTERACOES_CLIENTE', label: 'Cliente pediu ajustes' },
                    { value: 'ALTERACOES_INTERNAS', label: 'Alteração interna' },
                  ]} />
              </div>

              {/* Tarefa */}
              <div className="w-44 flex-shrink-0">
                <Select value="" onChange={batchLinkTask} placeholder="Vincular tarefa" ariaLabel="Vincular tarefa em lote"
                  searchable searchPlaceholder="Buscar tarefa…" menuClassName="min-w-[240px]"
                  className="w-full h-8 px-2.5 rounded-lumos border border-lumos-border bg-lumos-surface text-[11px] font-bold text-lumos-text-primary hover:border-lumos-yellow/50"
                  options={[{ value: '', label: 'Sem tarefa' }, ...tasks.map(t => ({ value: t.id, label: t.titulo }))]} />
              </div>

              {/* Link do cliente */}
              <div className="w-40 flex-shrink-0">
                <Select value="" placeholder="Link do cliente" ariaLabel="Ações de link em lote" menuClassName="min-w-[210px]"
                  onChange={v => {
                    if (v === 'gerar') batchGenerateLinks();
                    else if (v === 'wm_on') batchLinkFlag('watermark', true);
                    else if (v === 'wm_off') batchLinkFlag('watermark', false);
                    else if (v === 'dl_on') batchLinkFlag('allow_download', true);
                    else if (v === 'dl_off') batchLinkFlag('allow_download', false);
                  }}
                  className="w-full h-8 px-2.5 rounded-lumos border border-lumos-border bg-lumos-surface text-[11px] font-bold text-lumos-text-primary hover:border-lumos-yellow/50"
                  options={[
                    { value: 'gerar', label: 'Gerar links que faltam' },
                    { value: 'wm_on', label: 'Marca d’água: ligar' },
                    { value: 'wm_off', label: 'Marca d’água: desligar' },
                    { value: 'dl_on', label: 'Download: liberar' },
                    { value: 'dl_off', label: 'Download: bloquear' },
                  ]} />
              </div>

              <button onClick={() => setConfirmingDelete(true)} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lumos border border-red-500/40 text-red-400 hover:bg-red-500/10 flex items-center gap-1 flex-shrink-0">
                <Trash2 className="w-3.5 h-3.5" /> Excluir
              </button>
              <button onClick={() => setSelected(new Set())} className="text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary ml-auto flex-shrink-0">
                limpar seleção
              </button>
              {busy === 'batch' && <Loader2 className="w-4 h-4 animate-spin text-lumos-yellow flex-shrink-0" />}
            </>)}
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
      ) : shownGroups.length === 0 ? (
        <p className="text-center py-8 text-xs text-lumos-text-secondary italic">Nenhum vídeo com essa busca/filtro.</p>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {shownGroups.map(g => <VideoCard key={g.id} g={g} />)}
        </div>
      ) : (
        <div className="border border-lumos-border rounded-lumos overflow-hidden">
          {shownGroups.map(g => <VideoRow key={g.id} g={g} />)}
        </div>
      )}
    </div>

    {reviewModal && (
      <InternalReviewModal
        versionId={reviewModal.versionId}
        token={reviewModal.token}
        fileName={reviewModal.fileName}
        versao={reviewModal.versao}
        status={reviewModal.status}
        podeDecidir={podeAvalInterno}
        // Decidir de dentro do player usa a MESMA transição do menu ⋯: status do
        // vídeo, status da tarefa e link do cliente saem de um lugar só. Duas
        // cópias dessa regra viravam duas verdades na primeira mudança.
        onDecidir={async (proximo) => {
          await transition(reviewModal.version, proximo);
          setReviewModal(null);
        }}
        onClose={() => { setReviewModal(null); fetchVersions(); }}
      />
    )}
    </>
  );
}

// Item do menu ⋯ do card
function MenuItem({ icon: Icon, label, onClick, danger, active }: { icon: any; label: string; onClick: () => void; danger?: boolean; active?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={clsx('w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-left transition-colors',
        danger ? 'text-red-400 hover:bg-red-500/10' : active ? 'text-lumos-yellow hover:bg-lumos-yellow/10' : 'text-lumos-text-primary hover:bg-lumos-text-secondary/10')}>
      <Icon className="w-3.5 h-3.5 flex-shrink-0" /> {label}
      {active && <Check className="w-3 h-3 ml-auto" />}
    </button>
  );
}
