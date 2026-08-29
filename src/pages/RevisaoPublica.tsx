import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Play, Pause, Maximize, Download, Pencil, MoveUpRight,
  Square, Eraser, Send, Clock, Check, Sun, Moon, Volume2, VolumeX, Info, X,
  MoreVertical, Trash2, AlertTriangle, RotateCcw, ChevronDown,
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useVideoFonte } from '@/hooks/useVideoFonte';
import { useConfirm } from '@/components/ui/useConfirm';

const LOGO = { dark: '/logo/Logotipo-Branco-Alpha.svg', light: '/logo/Logotipo-Preto-Alpha.svg' };

// ---------------------------------------------------------------------------
type Point = { x: number; y: number }; // normalizados 0–1
type Shape = { type: 'draw' | 'arrow' | 'rect'; color: string; points: Point[] };
interface Annotation { type: string; data: { color?: string; points?: Point[] } }
interface Comment {
  id: string; author_name: string; is_team: boolean; timecode_ms: number;
  body: string; resolved: boolean; created_at: string; annotations: Annotation[];
  viewer_id: string | null; edited_at: string | null; // dono do comentário + marca de edição
}
interface ReviewData {
  link: { token: string; watermark: boolean; allow_download: boolean };
  video: {
    id: string; versao: number; file_name: string; status: string; project_name: string;
    width: number | null; height: number | null; duration_ms: number | null;
    size_bytes: number | null; mime_type: string | null; created_at: string;
    client_decision: string | null; client_decided_by: string | null; client_decided_at: string | null;
  };
  comments: Comment[];
  /** O que o cliente pediu nas versões anteriores deste mesmo vídeo. */
  historico?: { versao: number; criada_em: string; comments: Comment[] }[];
}

const STREAM_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/review-stream`;
const SPEEDS = [1, 1.25, 1.5, 1.75, 2];
import { timecode, estimarFps, COLORS, drawShape } from '@/lib/reviewCanvas';

const LOGO_WATERMARK = '/logo/Logo-Branco-Alpha.svg';


const fmtSize = (b: number | null) => b ? `${(b / 1048576).toFixed(1)} MB` : '—';

// ---------------------------------------------------------------------------
export default function RevisaoPublica() {
  const { token = '' } = useParams();
  // Tema local da revisão: começa sempre no escuro (melhor pra visualizar vídeo)
  // e é independente do tema global do app.
  const [rtheme, setRtheme] = useState<'dark' | 'light'>('dark');
  const theme = rtheme;
  const toggleTheme = () => setRtheme(t => (t === 'dark' ? 'light' : 'dark'));
  const themeClass = rtheme === 'dark' ? 'dark' : 'theme-light';
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // O identificador do espectador é POR LINK (cada link tem seus comentários),
  // mas o NOME é da pessoa, não do link. Guardando por link, cada vídeo novo
  // fazia o cliente digitar tudo de novo — atrito à toa, num público que já
  // estava desconfiado de "mais um cadastro".
  const NOME_SALVO = 'rev_nome';
  const [viewerId, setViewerId] = useState<string | null>(() => localStorage.getItem(`rev_viewer_${token}`));
  const [viewerName, setViewerName] = useState<string>(
    () => localStorage.getItem(`rev_name_${token}`) || localStorage.getItem(NOME_SALVO) || ''
  );
  const [nameInput, setNameInput] = useState(() => localStorage.getItem(NOME_SALVO) || '');
  const [entrandoSozinho, setEntrandoSozinho] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [fps, setFps] = useState(25);
  const fpsMedido = useRef(false);
  const [durationMs, setDurationMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const [ready, setReady] = useState(false);
  const [videoUnsupported, setVideoUnsupported] = useState(false);
  const [menuQualidade, setMenuQualidade] = useState(false);
  const [verHistorico, setVerHistorico] = useState<number | null>(null);
  const { confirm, dialog: dialogoConfirmar } = useConfirm();
  // Erro passageiro (comentário que não foi). Não pode usar setError: aquele
  // estado troca a página inteira por uma tela de erro, e perder o vídeo por
  // causa de um comentário que falhou seria pior que o problema.
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 5000);
    return () => clearTimeout(t);
  }, [aviso]);
  // Quem da Lumos abriu o link do cliente. A outra metade da confusão: o
  // atendimento manda ESTE link pro time revisar internamente, e aí o comentário
  // da equipe entra registrado como se fosse do cliente. Silencioso e chato de
  // desfazer, então a página avisa em vez de deixar acontecer.
  const [souDaLumos, setSouDaLumos] = useState<{ nome: string; projetoId: string | null } | null>(null);

  // Composição de comentário (box fixo)
  const [composing, setComposing] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [tool, setTool] = useState<'draw' | 'arrow' | 'rect' | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [viewingShapes, setViewingShapes] = useState<Shape[]>([]);
  const drawingRef = useRef<Shape | null>(null);
  const [sending, setSending] = useState(false);

  const streamUrl = useMemo(() => `${STREAM_BASE}?token=${encodeURIComponent(token)}`, [token]);
  // Cliente também merece a via rápida: é quem costuma estar na pior internet.
  const hlsUrl = (data as any)?.video?.stream_status === 'pronto'
    ? ((data as any)?.video?.stream_hls || null) : null;
  const { qualidades, qualidadeAtual, trocarQualidade, viaCdn } = useVideoFonte(videoRef, hlsUrl, streamUrl);

  const load = useCallback(async () => {
    const { data: res, error: err } = await supabase.rpc('get_public_review', { p_token: token });
    if (err || !res || (res as any).error) {
      // Fase interna não é erro de link: é o processo. O cliente merece saber
      // que o vídeo existe e está em ajustes, sem ver o material cru.
      setError((res as any)?.error === 'em_revisao_interna'
        ? 'Este vídeo está em ajustes com a equipe da Lumos. Assim que estiver pronto, você é avisado e este mesmo link volta a funcionar.'
        : 'Link inválido ou expirado.');
      setLoading(false); return;
    }
    setData(res as ReviewData);
    setDurationMs(prev => prev || (res as ReviewData).video.duration_ms || 0);
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!data?.video?.id) return;
    let vivo = true;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess?.session?.user?.id;
      if (!uid) return;
      const { data: perfil } = await supabase.from('app_users')
        .select('full_name, status').eq('auth_user_id', uid).maybeSingle();
      if (!vivo || perfil?.status !== 'ativo') return;
      const { data: vv } = await supabase.from('video_versions')
        .select('project_id').eq('id', data.video.id).maybeSingle();
      if (vivo) setSouDaLumos({ nome: perfil.full_name || 'Equipe', projetoId: vv?.project_id ?? null });
    })();
    return () => { vivo = false; };
  }, [data?.video?.id]);

  const identify = async (nomeDireto?: string) => {
    const nome = (nomeDireto ?? nameInput).trim();
    if (!nome) return;
    const { data: vid, error: err } = await supabase.rpc('review_identify', { p_token: token, p_name: nome });
    if (err) { setError('Não foi possível entrar. Tente novamente.'); return; }
    localStorage.setItem(`rev_viewer_${token}`, vid as string);
    localStorage.setItem(`rev_name_${token}`, nome);
    localStorage.setItem(NOME_SALVO, nome);   // vale pro próximo vídeo também
    setViewerId(vid as string);
    setViewerName(nome);
  };

  // Já sabemos quem é? Entra direto. A pessoa continua podendo trocar de nome
  // depois, então nada fica preso a um chute.
  useEffect(() => {
    if (viewerId || !data || entrandoSozinho) return;
    const salvo = localStorage.getItem(NOME_SALVO);
    if (!salvo) return;
    setEntrandoSozinho(true);
    identify(salvo).finally(() => setEntrandoSozinho(false));
  }, [viewerId, data, entrandoSozinho]);

  // --- Decisão do cliente (aprovar / pedir ajustes) ---
  const [deciding, setDeciding] = useState(false);
  const [askChanges, setAskChanges] = useState(false);
  const decision = data?.video.client_decision ?? null;

  // Fase interna: o mesmo link serve à revisão do time, com a decisão certa.
  // A revisão interna acontece DENTRO da plataforma, com login e permissão.
  // Esta página é do cliente e só do cliente: era daqui que saía o risco de um
  // link repassado por engano virar aprovação interna feita por gente de fora.

  const decide = async (kind: 'aprovado' | 'ajustes') => {
    if (!viewerId || deciding) return;
    setDeciding(true);
    const { data: res, error: err } = await supabase.rpc('review_decide', {
      p_token: token, p_viewer_id: viewerId, p_decision: kind,
    });
    setDeciding(false);
    if (err || !(res as any)?.ok) {
      setError((res as any)?.error === 'em_revisao_interna'
        ? 'Este vídeo ainda está em revisão interna da Lumos.'
        : 'Não foi possível registrar. Tente novamente.');
      return;
    }
    setAskChanges(false);
    await load();
  };

  // --- Player ---
  const togglePlay = () => {
    const v = videoRef.current; if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); }
  };
  const changeSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next); if (videoRef.current) videoRef.current.playbackRate = next;
  };
  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else playerRef.current?.requestFullscreen?.();
  };
  useEffect(() => {
    const onFs = () => { setIsFs(!!document.fullscreenElement); setTimeout(() => redraw(), 60); };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const seekTo = (ms: number) => { const v = videoRef.current; if (v) { v.currentTime = ms / 1000; setCurrentMs(ms); v.pause(); setPlaying(false); } };

  const toggleMute = () => { const v = videoRef.current; if (!v) return; const m = !v.muted; v.muted = m; setMuted(m); };
  const setVol = (val: number) => { const v = videoRef.current; if (v) { v.volume = val; v.muted = val === 0; } setVolume(val); setMuted(val === 0); };

  // Barra de progresso: clicar/arrastar para navegar
  const seekFromClientX = (clientX: number) => {
    const r = barRef.current?.getBoundingClientRect(); if (!r || durationMs <= 0) return;
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const v = videoRef.current; if (v) { v.currentTime = (frac * durationMs) / 1000; setCurrentMs(frac * durationMs); }
  };
  const onBarDown = (e: React.PointerEvent) => {
    seekFromClientX(e.clientX);
    const move = (ev: PointerEvent) => seekFromClientX(ev.clientX);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  // Pula alguns segundos sem pausar (mantém o estado de play atual)
  const seekRelative = (deltaSec: number) => {
    const v = videoRef.current; if (!v) return;
    v.currentTime = Math.min(v.duration || Infinity, Math.max(0, v.currentTime + deltaSec));
    setCurrentMs(v.currentTime * 1000);
  };
  // Aumenta/diminui a velocidade dentro dos passos de SPEEDS (lê a taxa ao vivo)
  const bumpSpeed = (dir: 1 | -1) => {
    const v = videoRef.current; if (!v) return;
    const idx = SPEEDS.indexOf(v.playbackRate);
    const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, (idx < 0 ? 0 : idx) + dir))];
    v.playbackRate = next; setSpeed(next);
  };

  // Atalhos de teclado do player (ignora quando digitando em campos)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft': e.preventDefault(); seekRelative(e.shiftKey ? -10 : -5); break;
        case 'ArrowRight': e.preventDefault(); seekRelative(e.shiftKey ? 10 : 5); break;
        case 'ArrowUp': e.preventDefault(); bumpSpeed(1); break;
        case 'ArrowDown': e.preventDefault(); bumpSpeed(-1); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Canvas: desenho de anotações ---
  const redraw = useCallback(() => {
    const cv = canvasRef.current, v = videoRef.current; if (!cv || !v) return;
    cv.width = v.clientWidth; cv.height = v.clientHeight;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const all = composing ? shapes : viewingShapes;
    for (const sh of all) drawShape(ctx, sh, cv.width, cv.height);
    if (drawingRef.current) drawShape(ctx, drawingRef.current, cv.width, cv.height);
  }, [composing, shapes, viewingShapes]);

  useEffect(() => { redraw(); }, [redraw]);
  useEffect(() => {
    const onResize = () => redraw(); window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [redraw]);

  const canvasPoint = (e: React.PointerEvent): Point => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const onCanvasDown = (e: React.PointerEvent) => {
    if (!composing || !tool) return;
    drawingRef.current = { type: tool, color, points: [canvasPoint(e)] };
  };
  const onCanvasMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const p = canvasPoint(e);
    if (tool === 'draw') drawingRef.current.points.push(p);
    else drawingRef.current.points[1] = p;
    redraw();
  };
  const onCanvasUp = () => {
    // Captura o shape ANTES de zerar o ref — o updater do setState roda depois,
    // então usar drawingRef.current lá dentro inseriria null (e drawShape quebra).
    const shape = drawingRef.current;
    if (shape) { setShapes(prev => [...prev, shape]); drawingRef.current = null; }
  };

  // Entra em modo de composição (pausa e limpa anotações de leitura)
  const ensureComposing = () => {
    if (composing) return;
    if (videoRef.current) { videoRef.current.pause(); setPlaying(false); }
    setViewingShapes([]); setShapes([]); setComposing(true);
  };
  const resetComposer = () => { setComposing(false); setShapes([]); setTool(null); setCommentText(''); };

  // Enter envia o comentário; Shift/Cmd/Ctrl+Enter quebra linha
  const onCommentKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      e.preventDefault();
      const ta = e.currentTarget; const s = ta.selectionStart, en = ta.selectionEnd;
      setCommentText(commentText.slice(0, s) + '\n' + commentText.slice(en));
      requestAnimationFrame(() => { try { ta.selectionStart = ta.selectionEnd = s + 1; } catch { /* noop */ } });
    } else {
      e.preventDefault();
      submitComment();
    }
  };

  const submitComment = async () => {
    if (!commentText.trim() && shapes.length === 0) return;
    setSending(true);
    const annotations = shapes.map(s => ({ type: s.type, data: { color: s.color, points: s.points } }));
    const { error: err } = await supabase.rpc('review_add_comment', {
      p_token: token, p_viewer_id: viewerId, p_timecode_ms: Math.round(currentMs), p_body: commentText.trim(), p_annotations: annotations,
    });
    setSending(false);
    if (err) { setAviso('Não deu pra enviar seu comentário. Tente de novo.'); return; }
    resetComposer();
    await load();
  };

  const viewComment = (c: Comment) => {
    seekTo(c.timecode_ms);
    setComposing(false);
    const shs: Shape[] = c.annotations.map(a => ({ type: (a.type as any) || 'draw', color: a.data?.color || COLORS[0], points: a.data?.points || [] }));
    setViewingShapes(shs);
  };

  // --- Editar/excluir o PRÓPRIO comentário ---------------------------------
  // Dono = viewer_id do comentário igual ao meu. A checagem real acontece no
  // banco (RPCs SECURITY DEFINER), aqui é só a interface.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const isMine = (c: Comment) => !!viewerId && !c.is_team && c.viewer_id === viewerId;

  const startEdit = (c: Comment) => { setMenuFor(null); setEditingId(c.id); setEditText(c.body || ''); };
  const cancelEdit = () => { setEditingId(null); setEditText(''); };

  const saveEdit = async (c: Comment) => {
    if (!editText.trim()) return;
    setSavingEdit(true);
    const { error: err } = await supabase.rpc('review_update_comment', {
      p_token: token, p_viewer_id: viewerId, p_comment_id: c.id, p_body: editText.trim(),
    });
    setSavingEdit(false);
    if (err) { setAviso('Não deu pra editar o comentário.'); return; }
    cancelEdit();
    await load();
  };

  const removeComment = async (c: Comment) => {
    setMenuFor(null);
    if (!await confirm({ title: 'Excluir comentário', message: 'Não dá para desfazer.', confirmLabel: 'Excluir', danger: true })) return;
    const { error: err } = await supabase.rpc('review_delete_comment', {
      p_token: token, p_viewer_id: viewerId, p_comment_id: c.id,
    });
    if (err) { setAviso('Não deu pra excluir o comentário.'); return; }
    setViewingShapes([]);
    await load();
  };

  // --- Render ---
  if (loading) return <Centered className={themeClass}><div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-lumos-yellow" /></Centered>;
  if (error) return <Centered className={themeClass}><p className="text-red-500 font-bold text-sm">{error}</p></Centered>;
  if (!data) return null;

  // Identificação
  if (!viewerId) {
    return (
      <Centered className={themeClass}>
        <div className="w-full max-w-sm bg-lumos-surface border border-lumos-border rounded-lumos p-8 shadow-2xl">
          <div className="flex flex-col items-center text-center mb-6">
            <img src="/logo-lumos.png" alt="Lumos" className="h-8 mb-4" onError={e => (e.currentTarget.style.display = 'none')} />
            <h1 className="text-lg font-black text-lumos-text-primary">Revisão de vídeo</h1>
            <p className="text-xs text-lumos-text-secondary mt-1">{data.video.project_name} · v{String(data.video.versao).padStart(2, '0')}</p>
          </div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary mb-2">Seu nome</label>
          <input
            autoFocus value={nameInput} onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && identify()}
            placeholder="Como você se chama?" className="input-lumos w-full h-11 text-sm mb-4"
          />
          <button onClick={() => identify()} disabled={!nameInput.trim()} className="btn-primary w-full h-11 text-sm font-black uppercase tracking-widest">
            Entrar
          </button>
          <p className="text-[10px] text-lumos-text-secondary/60 text-center mt-4">Ao entrar, seu nome fica registrado nesta revisão.</p>
        </div>
      </Centered>
    );
  }

  const specs: [string, string][] = [
    ['Projeto', data.video.project_name],
    ['Arquivo', data.video.file_name],
    ['Versão', `v${String(data.video.versao).padStart(2, '0')}`],
    ['Resolução', data.video.width ? `${data.video.width}×${data.video.height}` : '—'],
    ['Duração', durationMs ? timecode(durationMs, fps) : '—'],
    ['Formato', (data.video.mime_type || '').split('/')[1]?.toUpperCase() || '—'],
    ['Tamanho', fmtSize(data.video.size_bytes)],
  ];
  const pct = durationMs > 0 ? Math.min(100, (currentMs / durationMs) * 100) : 0;

  // No desktop a tela inteira cabe na viewport (sem rolar para achar os controles):
  // altura travada e o vídeo ocupa só a altura que sobra. No mobile segue o fluxo
  // normal, empilhado e rolável.
  return (
    <div className={clsx('min-h-dvh lg:h-dvh lg:overflow-hidden flex flex-col bg-lumos-bg text-lumos-text-primary font-work-sans', themeClass)}>
      {dialogoConfirmar}
      {aviso && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[400] px-4 py-2.5 rounded-lumos bg-lumos-surface border border-red-500/40 shadow-2xl">
          <p className="text-[12px] font-bold text-red-400">{aviso}</p>
        </div>
      )}
      {/* Alguém da Lumos abriu o link do cliente. Não é proibido — dá pra querer
          conferir o que o cliente está vendo — mas precisa ficar explícito, senão
          a equipe revisa por aqui e os comentários entram como se fossem do
          cliente. Daí o atalho pra revisão interna do lado. */}
      {souDaLumos && (
        <div className="flex-shrink-0 px-4 py-2 bg-amber-500/15 border-b border-amber-500/40 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11.5px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>
              {souDaLumos.nome}, esta é a <b>visão do cliente</b>. O que você comentar aqui entra como comentário <b>do cliente</b>.
            </span>
          </p>
          <a href={souDaLumos.projetoId ? `/producao/projetos?projectId=${souDaLumos.projetoId}` : '/producao'}
            className="h-7 px-3 rounded-lumos bg-amber-500 text-black text-[11px] font-black flex items-center gap-1.5 hover:brightness-95 flex-shrink-0">
            Revisar internamente
          </a>
        </div>
      )}

      {/* Header (sem logo) */}
      <header className="h-14 flex-shrink-0 px-4 flex items-center justify-between border-b border-lumos-border bg-lumos-surface/80 relative z-30">
        <div className="flex items-center gap-3 min-w-0">
          <img src={theme === 'dark' ? LOGO.dark : LOGO.light} alt="Lumos" className="h-7 transition-all duration-300 flex-shrink-0" />
          <span className="text-sm font-black truncate border-l border-lumos-border pl-3">
            {data.video.project_name} <span className="text-lumos-text-secondary font-bold">· v{String(data.video.versao).padStart(2, '0')}</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Quem a plataforma acha que você é. Fica visível porque agora o nome
              é reaproveitado entre links: se alguém pegar o computador do colega,
              precisa ser óbvio em nome de quem o comentário vai sair. */}
          {viewerName && (
            <button type="button"
              onClick={async () => {
                if (!await confirm({ title: 'Trocar de nome', message: `Você está comentando como "${viewerName}". Quer entrar com outro nome?`, confirmLabel: 'Trocar' })) return;
                localStorage.removeItem(NOME_SALVO);
                localStorage.removeItem(`rev_viewer_${token}`);
                localStorage.removeItem(`rev_name_${token}`);
                setViewerId(null); setViewerName(''); setNameInput('');
              }}
              title="Trocar de nome"
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lumos border border-lumos-border text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary transition-colors max-w-[180px]">
              <span className="truncate">{viewerName}</span>
              <span className="text-lumos-text-secondary/60 flex-shrink-0">trocar</span>
            </button>
          )}

          {/* Info (nome, resolução, tamanho, versão… tudo num lugar só) */}
          <div className="relative">
            <button onClick={() => setShowInfo(s => !s)}
              className={clsx('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lumos text-[11px] font-bold border transition-colors', showInfo ? 'border-lumos-yellow text-lumos-yellow' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary')}>
              <Info className="w-3.5 h-3.5" /> Info
            </button>
            {showInfo && (
              <div className="absolute right-0 top-12 w-64 p-4 rounded-lumos bg-lumos-surface border border-lumos-border shadow-2xl grid grid-cols-2 gap-x-4 gap-y-2.5 z-40">
                {specs.map(([k, v]) => (
                  <div key={k} className={clsx('flex flex-col', (k === 'Projeto' || k === 'Arquivo') && 'col-span-2')}>
                    <span className="text-[8px] font-black uppercase tracking-widest text-lumos-text-secondary/60">{k}</span>
                    <span className="text-[11px] font-bold text-lumos-text-primary break-words">{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Tema claro/escuro */}
          <button onClick={toggleTheme} title="Tema claro/escuro"
            className="p-2 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary transition-colors">
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
          <span className="text-[10px] text-lumos-text-secondary ml-1 hidden sm:inline">Você: <b className="text-lumos-text-primary">{viewerName}</b></span>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row lg:flex-1 lg:min-h-0" onClick={() => showInfo && setShowInfo(false)}>
        {/* Player */}
        <div ref={playerRef} className={clsx('flex-1 flex flex-col min-w-0 lg:min-h-0', isFs ? 'bg-black' : 'p-4 gap-2')}>
          {/* Área do vídeo: no desktop ocupa a altura que sobra (depois do header e dos
              controles) e o box 16:9 é limitado por max-h-full, então nunca empurra os
              controles para fora da tela. No mobile segue o fluxo normal (sem esticar). */}
          <div className="lg:flex-1 lg:min-h-0 flex items-center justify-center">
          <div ref={wrapRef} className={clsx('relative bg-black overflow-hidden select-none', isFs ? 'flex-1 min-h-0 w-full flex items-center justify-center' : 'w-full aspect-video max-h-full rounded-lumos')}>
            {/* object-contain: vídeo vertical (9:16) entra inteiro no player 16:9, com
                barras pretas nas laterais. Com object-cover ele era cortado/ampliado. */}
            <video
              ref={videoRef} preload="metadata"
              className={clsx('block', isFs ? 'max-h-full max-w-full w-auto h-auto object-contain' : 'w-full h-full object-contain')}
              onTimeUpdate={e => setCurrentMs(e.currentTarget.currentTime * 1000)}
              onLoadedMetadata={e => { setDurationMs(e.currentTarget.duration * 1000); redraw(); }}
              onLoadedData={e => { setReady(true); if (e.currentTarget.videoWidth === 0) setVideoUnsupported(true); }}
              onCanPlay={e => { setReady(true); if (e.currentTarget.videoWidth === 0) setVideoUnsupported(true); }}
              onError={() => { setReady(true); setVideoUnsupported(true); }}
              onPlay={e => { setPlaying(true); if (!fpsMedido.current) { fpsMedido.current = true; estimarFps(e.currentTarget, setFps); } }} onPause={() => setPlaying(false)}
              onClick={togglePlay} playsInline
            />
            {!ready && !videoUnsupported && (
              <div className="absolute inset-0 flex items-center justify-center bg-black pointer-events-none">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-lumos-yellow" />
              </div>
            )}
            {videoUnsupported && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 text-center px-6 z-10">
                <AlertTriangle className="w-8 h-8 text-lumos-yellow" />
                <p className="text-sm font-bold text-white max-w-sm">Não foi possível exibir este vídeo no seu navegador.</p>
                <p className="text-xs text-white/60 max-w-sm leading-relaxed">Pode ser um formato não suportado. Tente outro navegador (Chrome) ou peça à produtora uma versão em MP4.</p>
                {data.link.allow_download && (
                  <a href={`${streamUrl}&download=1`} download className="btn-primary h-9 px-4 flex items-center gap-2 text-xs font-black uppercase tracking-widest rounded-lumos">
                    Baixar o arquivo
                  </a>
                )}
              </div>
            )}
            {/* Marca d'água = logo Lumos + nome (atribuição) */}
            {data.link.watermark && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
                <div className="absolute inset-0 flex flex-wrap gap-x-14 gap-y-12 -rotate-[30deg] scale-150 opacity-[0.11]">
                  {Array.from({ length: 40 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-1.5 whitespace-nowrap">
                      <img src={LOGO_WATERMARK} alt="" className="h-3.5 w-auto" />
                      <span className="text-white text-[9px] font-bold">{viewerName}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Canvas de anotações */}
            <canvas
              ref={canvasRef}
              className={clsx('absolute inset-0 w-full h-full', composing && tool ? 'cursor-crosshair' : 'pointer-events-none')}
              onPointerDown={onCanvasDown} onPointerMove={onCanvasMove} onPointerUp={onCanvasUp} onPointerLeave={onCanvasUp}
            />
          </div>
          </div>

          {/* Barra de progresso com marcadores de comentário */}
          <div className={clsx('flex-shrink-0 pt-1', isFs ? 'px-4' : 'px-1')}>
            <div ref={barRef} onPointerDown={onBarDown} className="relative h-5 flex items-center cursor-pointer group">
              <div className="absolute left-0 right-0 h-1.5 rounded-full bg-lumos-text-secondary/20" />
              <div className="absolute left-0 h-1.5 rounded-full bg-lumos-yellow" style={{ width: `${pct}%` }} />
              {/* marcadores */}
              {durationMs > 0 && data.comments.map(c => (
                <button key={c.id} onClick={e => { e.stopPropagation(); viewComment(c); }}
                  title={`${c.author_name} · ${timecode(c.timecode_ms, fps)}${c.body ? ` — ${c.body}` : ''}`}
                  className="absolute -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-lumos-yellow ring-2 ring-lumos-bg hover:scale-150 transition-transform z-10"
                  style={{ left: `${(c.timecode_ms / durationMs) * 100}%` }} />
              ))}
              {/* cabeça do scrubber */}
              <div className="absolute -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-lumos-text-primary shadow opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                style={{ left: `${pct}%` }} />
            </div>
          </div>

          {/* Controles (estilo Frame.io) */}
          <div className={clsx('flex-shrink-0 flex items-center gap-2 flex-wrap', isFs && 'px-4 pb-3')}>
            <button onClick={togglePlay} className="p-2 rounded-lumos hover:bg-lumos-text-secondary/10 transition-colors">
              {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>
            {/* Volume */}
            <div className="flex items-center gap-1.5">
              <button onClick={toggleMute} className="p-2 rounded-lumos hover:bg-lumos-text-secondary/10 transition-colors">
                {muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume}
                onChange={e => setVol(Number(e.target.value))} className="w-16 accent-lumos-yellow cursor-pointer" />
            </div>
            <span className="text-xs font-mono font-bold text-lumos-text-secondary tabular-nums">
              {timecode(currentMs, fps)} <span className="opacity-50">/ {durationMs ? timecode(durationMs, fps) : '—'}</span>
            </span>
            <div className="flex-1" />
            <button onClick={changeSpeed} className="px-2.5 py-1.5 rounded-lumos hover:bg-lumos-text-secondary/10 text-[11px] font-black transition-colors">{speed}x</button>

            {viaCdn && qualidades.length > 1 && (
              <div className="relative">
                <button type="button" onClick={() => setMenuQualidade(o => !o)}
                  className="px-2.5 py-1.5 rounded-lumos hover:bg-lumos-text-secondary/10 text-[11px] font-black transition-colors text-lumos-text-primary">
                  {qualidadeAtual === -1 ? 'AUTO' : (qualidades.find(q => q.id === qualidadeAtual)?.rotulo || 'AUTO')}
                </button>
                {menuQualidade && (
                  <>
                    <div className="fixed inset-0 z-[300]" onClick={() => setMenuQualidade(false)} />
                    <div className="absolute bottom-full right-0 mb-2 z-[301] w-28 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-1">
                      <button type="button" onClick={() => { trocarQualidade(-1); setMenuQualidade(false); }}
                        className={clsx('w-full text-left px-2 py-1.5 text-[11px] font-bold rounded hover:bg-lumos-text-secondary/10',
                          qualidadeAtual === -1 ? 'text-lumos-yellow' : 'text-lumos-text-primary')}>
                        Automática
                      </button>
                      {qualidades.map(q => (
                        <button key={q.id} type="button" onClick={() => { trocarQualidade(q.id); setMenuQualidade(false); }}
                          className={clsx('w-full text-left px-2 py-1.5 text-[11px] font-bold rounded hover:bg-lumos-text-secondary/10',
                            qualidadeAtual === q.id ? 'text-lumos-yellow' : 'text-lumos-text-primary')}>
                          {q.rotulo}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {data.link.allow_download && (
              <a href={`${streamUrl}&download=1`} download className="p-2 rounded-lumos hover:bg-lumos-text-secondary/10 transition-colors" title="Baixar arquivo"><Download className="w-4 h-4" /></a>
            )}
            <button onClick={fullscreen} className="p-2 rounded-lumos hover:bg-lumos-text-secondary/10 transition-colors"><Maximize className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Comentários */}
        <aside className={clsx('w-full lg:w-[380px] flex-shrink-0 border-t lg:border-t-0 lg:border-l border-lumos-border bg-lumos-surface/30 flex flex-col lg:h-full lg:min-h-0', isFs && 'hidden')}>

          {/* Decisão do cliente. A fase interna nem chega aqui: o backend
              devolve "em_revisao_interna" e a página mostra o aviso. */}
          {viewerId && (
            <div className="px-3 py-3 border-b border-lumos-border">
              {data.video.status === 'ALTERACOES_INTERNAS' ? (
                <div className="rounded-lumos border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[12px] font-bold text-amber-500 flex items-start gap-2">
                  <RotateCcw className="w-4 h-4 flex-shrink-0 mt-px" />
                  <span>Alterações solicitadas na revisão interna. Nova versão a caminho.</span>
                </div>
              ) : decision === 'aprovado' ? (
                <div className="rounded-lumos border border-green-500/40 bg-green-500/10 px-3 py-2.5 text-[12px] font-bold text-green-500 flex items-start gap-2">
                  <Check className="w-4 h-4 flex-shrink-0 mt-px" />
                  <span>Vídeo aprovado por {data.video.client_decided_by}. A equipe da Lumos já foi avisada.</span>
                </div>
              ) : decision === 'ajustes' ? (
                <div className="rounded-lumos border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[12px] font-bold text-amber-500 flex items-start gap-2">
                  <RotateCcw className="w-4 h-4 flex-shrink-0 mt-px" />
                  <div className="min-w-0">
                    <p>Ajustes solicitados por {data.video.client_decided_by}.</p>
                    <button onClick={() => decide('aprovado')} disabled={deciding}
                      className="mt-1 text-[11px] font-bold underline underline-offset-2 hover:text-green-500 disabled:opacity-60">
                      Mudou de ideia? Aprovar assim mesmo
                    </button>
                  </div>
                </div>
              ) : askChanges ? (
                <div className="rounded-lumos border border-lumos-border px-3 py-2.5">
                  <p className="text-[12px] font-bold text-lumos-text-primary">Comente no vídeo o que precisa mudar e confirme.</p>
                  <p className="text-[11px] text-lumos-text-secondary mt-0.5">A equipe recebe seus comentários junto com o pedido.</p>
                  <div className="flex gap-2 mt-2.5">
                    <button onClick={() => setAskChanges(false)}
                      className="flex-1 h-8 rounded-lumos border border-lumos-border text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary">Cancelar</button>
                    <button onClick={() => decide('ajustes')} disabled={deciding}
                      className="flex-1 h-8 rounded-lumos bg-amber-500 text-black text-[11px] font-black hover:brightness-95 disabled:opacity-60">
                      {deciding ? 'Enviando…' : 'Confirmar ajustes'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => decide('aprovado')} disabled={deciding}
                    className="flex-1 h-10 rounded-lumos bg-green-500 text-white text-[12.5px] font-black flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-60">
                    <Check className="w-4 h-4" /> {deciding ? 'Enviando…' : 'Aprovar vídeo'}
                  </button>
                  <button onClick={() => setAskChanges(true)} disabled={deciding}
                    className="flex-1 h-10 rounded-lumos border border-lumos-border text-lumos-text-primary text-[12.5px] font-black flex items-center justify-center gap-2 hover:border-amber-500/60 disabled:opacity-60">
                    <RotateCcw className="w-4 h-4" /> Pedir ajustes
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="px-4 py-3 border-b border-lumos-border flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-widest text-lumos-text-secondary">Comentários</span>
            <span className="text-[10px] font-bold text-lumos-text-secondary/70">{data.comments.length}</span>
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2 min-h-[120px]">
            {data.comments.length === 0 ? (
              <p className="text-xs text-lumos-text-secondary italic text-center py-8">Nenhum comentário ainda. Pause no ponto que quiser e escreva abaixo.</p>
            ) : (
              data.comments.map(c => (
                <div
                  key={c.id}
                  onClick={() => editingId !== c.id && viewComment(c)}
                  className={clsx(
                    'relative w-full text-left p-2.5 rounded-lumos border transition-all',
                    editingId === c.id
                      ? 'border-lumos-yellow/60 bg-lumos-text-secondary/[0.03]'
                      : 'border-lumos-border/50 hover:border-lumos-yellow/40 hover:bg-lumos-text-secondary/[0.03] cursor-pointer'
                  )}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] font-black text-lumos-text-primary truncate">
                      {c.author_name}{c.is_team && <span className="ml-1 text-[8px] uppercase text-lumos-yellow">Lumos</span>}
                    </span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-[10px] font-mono font-bold text-lumos-yellow flex items-center gap-1">
                        {c.resolved && <Check className="w-3 h-3 text-green-500" />}{timecode(c.timecode_ms, fps)}
                      </span>

                      {/* Três pontinhos: só no MEU comentário */}
                      {isMine(c) && editingId !== c.id && (
                        <div className="relative">
                          <button
                            onClick={e => { e.stopPropagation(); setMenuFor(m => (m === c.id ? null : c.id)); }}
                            title="Opções"
                            className="p-0.5 rounded text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10 transition-colors"
                          >
                            <MoreVertical className="w-3.5 h-3.5" />
                          </button>
                          {menuFor === c.id && (
                            <>
                              {/* clique fora fecha */}
                              <div className="fixed inset-0 z-40" onClick={e => { e.stopPropagation(); setMenuFor(null); }} />
                              <div className="absolute right-0 top-6 z-50 w-32 py-1 rounded-lumos bg-lumos-surface border border-lumos-border shadow-2xl">
                                <button
                                  onClick={e => { e.stopPropagation(); startEdit(c); }}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10"
                                >
                                  <Pencil className="w-3 h-3" /> Editar
                                </button>
                                <button
                                  onClick={e => { e.stopPropagation(); removeComment(c); }}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold text-red-500 hover:bg-red-500/10"
                                >
                                  <Trash2 className="w-3 h-3" /> Excluir
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {editingId === c.id ? (
                    <div onClick={e => e.stopPropagation()} className="space-y-1.5">
                      <textarea
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        rows={2}
                        autoFocus
                        className="input-lumos w-full text-[11px] resize-none min-h-[44px] max-h-28 py-1.5 leading-snug"
                      />
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => saveEdit(c)}
                          disabled={savingEdit || !editText.trim()}
                          className="btn-primary h-7 px-3 text-[10px] font-black uppercase tracking-widest rounded-lumos disabled:opacity-40"
                        >
                          {savingEdit ? 'Salvando…' : 'Salvar'}
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="h-7 px-3 rounded-lumos border border-lumos-border text-[10px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {c.body && <p className="text-[11px] text-lumos-text-secondary leading-snug whitespace-pre-line break-words">{c.body}</p>}
                      <div className="flex items-center gap-2 mt-1">
                        {c.annotations.length > 0 && (
                          <span className="text-[9px] text-lumos-text-secondary/60 flex items-center gap-1"><Pencil className="w-2.5 h-2.5" /> {c.annotations.length} anotação(ões)</span>
                        )}
                        {c.edited_at && <span className="text-[9px] text-lumos-text-secondary/50 italic">editado</span>}
                      </div>
                    </>
                  )}
                </div>
              ))
            )}

            {/* Histórico: o que este cliente pediu nas versões anteriores.
                Serve pra ele conferir se foi atendido, em vez de ter que
                lembrar de cabeça ou repetir o pedido. Só leitura: o comentário
                pertence a outro corte, e o tempo dele não bate com este. */}
            {!!data.historico?.length && (
              <div className="pt-3 mt-1 border-t border-lumos-border/60 space-y-1.5">
                <p className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary/70 px-0.5">
                  O que você pediu antes
                </p>
                {data.historico.map(h => (
                  <div key={h.versao} className="rounded-lumos border border-lumos-border/50 overflow-hidden">
                    <button type="button"
                      onClick={() => setVerHistorico(x => (x === h.versao ? null : h.versao))}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-lumos-text-secondary/[0.04]">
                      <span className="text-[11px] font-bold text-lumos-text-primary">
                        v{String(h.versao).padStart(2, '0')}
                        <span className="ml-1.5 font-normal text-lumos-text-secondary">
                          {h.comments.length} {h.comments.length === 1 ? 'pedido' : 'pedidos'}
                        </span>
                      </span>
                      <ChevronDown className={clsx('w-3.5 h-3.5 text-lumos-text-secondary transition-transform',
                        verHistorico === h.versao && 'rotate-180')} />
                    </button>
                    {verHistorico === h.versao && (
                      <div className="px-2.5 pb-2.5 space-y-1.5">
                        {h.comments.map(c => (
                          <div key={c.id} className="rounded border border-lumos-border/40 bg-lumos-text-secondary/[0.03] p-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10.5px] font-bold text-lumos-text-secondary truncate">{c.author_name}</span>
                              <span className="text-[10px] font-mono font-bold text-lumos-text-secondary/70 flex items-center gap-1 flex-shrink-0">
                                {c.resolved && <Check className="w-3 h-3 text-green-500" />}
                                {timecode(c.timecode_ms, fps)}
                              </span>
                            </div>
                            {c.body && (
                              <p className="text-[11px] text-lumos-text-secondary/90 leading-snug whitespace-pre-line break-words mt-0.5">
                                {c.body}
                              </p>
                            )}
                          </div>
                        ))}
                        <p className="text-[9.5px] text-lumos-text-secondary/60 leading-snug pt-0.5">
                          Tempos referentes à v{String(h.versao).padStart(2, '0')}, que era um corte diferente deste.
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Compositor — mesma diagramação da revisão interna (InternalReviewModal) */}
          <div className="border-t border-lumos-border p-3 bg-lumos-surface/50 flex-shrink-0 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-lumos-yellow flex items-center gap-1">
                <Clock className="w-3 h-3" /> em {timecode(currentMs, fps)}
              </span>
              {composing && (
                <button onClick={resetComposer} title="Cancelar anotação" className="text-[10px] font-bold flex items-center gap-1 text-lumos-text-secondary hover:text-red-400 transition-colors">
                  <X className="w-3 h-3" /> Cancelar
                </button>
              )}
            </div>

            {/* Ferramentas de anotação — sempre visíveis */}
            <div className="flex items-center gap-1.5 flex-wrap p-2 bg-lumos-bg/40 rounded-lumos">
              {([['draw', Pencil], ['arrow', MoveUpRight], ['rect', Square]] as const).map(([t, Icon]) => (
                <button key={t} onClick={() => { ensureComposing(); setTool(tool === t ? null : t); }}
                  title={t === 'draw' ? 'Desenho livre' : t === 'arrow' ? 'Seta' : 'Retângulo'}
                  className={clsx('p-1.5 rounded-lumos border transition-colors', tool === t ? 'bg-lumos-yellow/15 border-lumos-yellow text-lumos-yellow' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary')}>
                  <Icon className="w-3.5 h-3.5" />
                </button>
              ))}
              <div className="flex items-center gap-1 ml-1">
                {COLORS.map(c => (
                  <button key={c} onClick={() => setColor(c)} style={{ background: c }} title="Cor"
                    className={clsx('w-4 h-4 rounded-full border-2', color === c ? 'border-lumos-text-primary' : 'border-transparent')} />
                ))}
              </div>
              <button onClick={() => setShapes([])} className="p-1.5 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-red-400 ml-auto" title="Limpar desenhos"><Eraser className="w-3.5 h-3.5" /></button>
            </div>

            <div className="flex items-end gap-2">
              <textarea
                value={commentText} onFocus={ensureComposing} onChange={e => setCommentText(e.target.value)}
                onKeyDown={onCommentKey}
                rows={2} placeholder={`Comentar em ${timecode(currentMs, fps)}…`}
                className="input-lumos flex-1 text-xs resize-none min-h-[44px] max-h-28 py-2 leading-snug"
              />
              <button onClick={submitComment} disabled={sending || (!commentText.trim() && shapes.length === 0)}
                className="btn-primary h-11 w-11 flex-shrink-0 flex items-center justify-center rounded-lumos disabled:opacity-40">
                {sending ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[9px] text-lumos-text-secondary/50 px-0.5">Enter envia · Shift+Enter quebra linha</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Centered({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx('min-h-screen bg-lumos-bg flex items-center justify-center p-4 font-work-sans', className)}>{children}</div>;
}

