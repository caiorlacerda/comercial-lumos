import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Play, Pause, Maximize, Download, Pencil, MoveUpRight,
  Square, Eraser, Send, Clock, Check, Sun, Moon, Volume2, VolumeX, Info, X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/context/ThemeContext';

const LOGO = { dark: '/logo/Logotipo-Branco-Alpha.svg', light: '/logo/Logotipo-Preto-Alpha.svg' };

// ---------------------------------------------------------------------------
type Point = { x: number; y: number }; // normalizados 0–1
type Shape = { type: 'draw' | 'arrow' | 'rect'; color: string; points: Point[] };
interface Annotation { type: string; data: { color?: string; points?: Point[] } }
interface Comment {
  id: string; author_name: string; is_team: boolean; timecode_ms: number;
  body: string; resolved: boolean; created_at: string; annotations: Annotation[];
}
interface ReviewData {
  link: { token: string; watermark: boolean; allow_download: boolean };
  video: {
    id: string; versao: number; file_name: string; status: string; project_name: string;
    width: number | null; height: number | null; duration_ms: number | null;
    size_bytes: number | null; mime_type: string | null; created_at: string;
  };
  comments: Comment[];
}

const STREAM_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/review-stream`;
const SPEEDS = [1, 1.25, 1.5, 1.75, 2];
const COLORS = ['#EFC700', '#ef4444', '#3b82f6', '#22c55e', '#ffffff'];
const LOGO_WATERMARK = '/logo/Logo-Branco-Alpha.svg';

const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h > 0 ? `${h}:` : '') + `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};
const fmtSize = (b: number | null) => b ? `${(b / 1048576).toFixed(1)} MB` : '—';

// ---------------------------------------------------------------------------
export default function RevisaoPublica() {
  const { token = '' } = useParams();
  const { theme, toggleTheme } = useTheme();
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [viewerId, setViewerId] = useState<string | null>(() => localStorage.getItem(`rev_viewer_${token}`));
  const [viewerName, setViewerName] = useState<string>(() => localStorage.getItem(`rev_name_${token}`) || '');
  const [nameInput, setNameInput] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [isFs, setIsFs] = useState(false);

  // Composição de comentário (box fixo)
  const [composing, setComposing] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [showTools, setShowTools] = useState(false);
  const [tool, setTool] = useState<'draw' | 'arrow' | 'rect' | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [viewingShapes, setViewingShapes] = useState<Shape[]>([]);
  const drawingRef = useRef<Shape | null>(null);
  const [sending, setSending] = useState(false);

  const streamUrl = useMemo(() => `${STREAM_BASE}?token=${encodeURIComponent(token)}`, [token]);

  const load = useCallback(async () => {
    const { data: res, error: err } = await supabase.rpc('get_public_review', { p_token: token });
    if (err || !res || (res as any).error) { setError('Link inválido ou expirado.'); setLoading(false); return; }
    setData(res as ReviewData);
    setDurationMs(prev => prev || (res as ReviewData).video.duration_ms || 0);
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const identify = async () => {
    if (!nameInput.trim()) return;
    const { data: vid, error: err } = await supabase.rpc('review_identify', { p_token: token, p_name: nameInput.trim() });
    if (err) { setError('Não foi possível entrar. Tente novamente.'); return; }
    localStorage.setItem(`rev_viewer_${token}`, vid as string);
    localStorage.setItem(`rev_name_${token}`, nameInput.trim());
    setViewerId(vid as string);
    setViewerName(nameInput.trim());
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
  const resetComposer = () => { setComposing(false); setShapes([]); setTool(null); setShowTools(false); setCommentText(''); };

  const submitComment = async () => {
    if (!commentText.trim() && shapes.length === 0) return;
    setSending(true);
    const annotations = shapes.map(s => ({ type: s.type, data: { color: s.color, points: s.points } }));
    const { error: err } = await supabase.rpc('review_add_comment', {
      p_token: token, p_viewer_id: viewerId, p_timecode_ms: Math.round(currentMs), p_body: commentText.trim(), p_annotations: annotations,
    });
    setSending(false);
    if (err) { alert('Erro ao enviar comentário. Tente de novo.'); return; }
    resetComposer();
    await load();
  };

  const viewComment = (c: Comment) => {
    seekTo(c.timecode_ms);
    setComposing(false);
    const shs: Shape[] = c.annotations.map(a => ({ type: (a.type as any) || 'draw', color: a.data?.color || COLORS[0], points: a.data?.points || [] }));
    setViewingShapes(shs);
  };

  // --- Render ---
  if (loading) return <Centered><div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-lumos-yellow" /></Centered>;
  if (error) return <Centered><p className="text-red-500 font-bold text-sm">{error}</p></Centered>;
  if (!data) return null;

  // Identificação
  if (!viewerId) {
    return (
      <Centered>
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
          <button onClick={identify} disabled={!nameInput.trim()} className="btn-primary w-full h-11 text-sm font-black uppercase tracking-widest">
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
    ['Duração', durationMs ? fmtTime(durationMs) : '—'],
    ['Formato', (data.video.mime_type || '').split('/')[1]?.toUpperCase() || '—'],
    ['Tamanho', fmtSize(data.video.size_bytes)],
  ];
  const pct = durationMs > 0 ? Math.min(100, (currentMs / durationMs) * 100) : 0;

  return (
    <div className="min-h-screen bg-lumos-bg text-lumos-text-primary font-work-sans">
      {/* Header (sem logo) */}
      <header className="h-14 px-4 flex items-center justify-between border-b border-lumos-border bg-lumos-surface/80 relative z-30">
        <div className="flex items-center gap-3 min-w-0">
          <img src={theme === 'dark' ? LOGO.dark : LOGO.light} alt="Lumos" className="h-7 transition-all duration-300 flex-shrink-0" />
          <span className="text-sm font-black truncate border-l border-lumos-border pl-3">
            {data.video.project_name} <span className="text-lumos-text-secondary font-bold">· v{String(data.video.versao).padStart(2, '0')}</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
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

      <div className="flex flex-col lg:flex-row" onClick={() => showInfo && setShowInfo(false)}>
        {/* Player */}
        <div ref={playerRef} className={clsx('flex-1 flex flex-col min-w-0', isFs ? 'bg-black' : 'p-4 gap-2')}>
          <div ref={wrapRef} className={clsx('relative bg-black overflow-hidden select-none', isFs ? 'flex-1 min-h-0 flex items-center justify-center' : 'rounded-lumos')}>
            <video
              ref={videoRef} src={streamUrl}
              className={clsx('block', isFs ? 'max-h-full max-w-full w-auto h-auto object-contain' : 'w-full max-h-[68vh] mx-auto')}
              onTimeUpdate={e => setCurrentMs(e.currentTarget.currentTime * 1000)}
              onLoadedMetadata={e => { setDurationMs(e.currentTarget.duration * 1000); redraw(); }}
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
              onClick={togglePlay} playsInline
            />
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

          {/* Barra de progresso com marcadores de comentário */}
          <div className={clsx('pt-1', isFs ? 'px-4' : 'px-1')}>
            <div ref={barRef} onPointerDown={onBarDown} className="relative h-5 flex items-center cursor-pointer group">
              <div className="absolute left-0 right-0 h-1.5 rounded-full bg-lumos-text-secondary/20" />
              <div className="absolute left-0 h-1.5 rounded-full bg-lumos-yellow" style={{ width: `${pct}%` }} />
              {/* marcadores */}
              {durationMs > 0 && data.comments.map(c => (
                <button key={c.id} onClick={e => { e.stopPropagation(); viewComment(c); }}
                  title={`${c.author_name} · ${fmtTime(c.timecode_ms)}${c.body ? ` — ${c.body}` : ''}`}
                  className="absolute -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-lumos-yellow ring-2 ring-lumos-bg hover:scale-150 transition-transform z-10"
                  style={{ left: `${(c.timecode_ms / durationMs) * 100}%` }} />
              ))}
              {/* cabeça do scrubber */}
              <div className="absolute -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-lumos-text-primary shadow opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                style={{ left: `${pct}%` }} />
            </div>
          </div>

          {/* Controles (estilo Frame.io) */}
          <div className={clsx('flex items-center gap-2 flex-wrap', isFs && 'px-4 pb-3')}>
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
              {fmtTime(currentMs)} <span className="opacity-50">/ {durationMs ? fmtTime(durationMs) : '—'}</span>
            </span>
            <div className="flex-1" />
            <button onClick={changeSpeed} className="px-2.5 py-1.5 rounded-lumos hover:bg-lumos-text-secondary/10 text-[11px] font-black transition-colors">{speed}x</button>
            {data.link.allow_download && (
              <a href={`${streamUrl}&download=1`} download className="p-2 rounded-lumos hover:bg-lumos-text-secondary/10 transition-colors" title="Baixar arquivo"><Download className="w-4 h-4" /></a>
            )}
            <button onClick={fullscreen} className="p-2 rounded-lumos hover:bg-lumos-text-secondary/10 transition-colors"><Maximize className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Comentários */}
        <aside className={clsx('w-full lg:w-[380px] border-t lg:border-t-0 lg:border-l border-lumos-border bg-lumos-surface/30 flex flex-col lg:max-h-[calc(100vh-3.5rem)]', isFs && 'hidden')}>
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
                <button key={c.id} onClick={() => viewComment(c)} className="w-full text-left p-2.5 rounded-lumos border border-lumos-border/50 hover:border-lumos-yellow/40 hover:bg-lumos-text-secondary/[0.03] transition-all">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] font-black text-lumos-text-primary truncate">{c.author_name}{c.is_team && <span className="ml-1 text-[8px] uppercase text-lumos-yellow">Lumos</span>}</span>
                    <span className="text-[10px] font-mono font-bold text-lumos-yellow flex items-center gap-1">{c.resolved && <Check className="w-3 h-3 text-green-500" />}{fmtTime(c.timecode_ms)}</span>
                  </div>
                  {c.body && <p className="text-[11px] text-lumos-text-secondary leading-snug">{c.body}</p>}
                  {c.annotations.length > 0 && <span className="text-[9px] text-lumos-text-secondary/60 flex items-center gap-1 mt-1"><Pencil className="w-2.5 h-2.5" /> {c.annotations.length} anotação(ões)</span>}
                </button>
              ))
            )}
          </div>

          {/* Compositor fixo (sempre visível) */}
          <div className="border-t border-lumos-border p-3 bg-lumos-surface/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-lumos-yellow flex items-center gap-1">
                <Clock className="w-3 h-3" /> em {fmtTime(currentMs)}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => { ensureComposing(); setShowTools(s => !s); if (!showTools && !tool) setTool('draw'); }}
                  className={clsx('text-[10px] font-bold flex items-center gap-1 px-2 py-1 rounded-full border transition-colors', showTools ? 'border-lumos-yellow text-lumos-yellow' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary')}>
                  <Pencil className="w-3 h-3" /> Anotar
                </button>
                {composing && (
                  <button onClick={resetComposer} title="Cancelar" className="p-1 rounded-full text-lumos-text-secondary hover:text-red-400"><X className="w-3.5 h-3.5" /></button>
                )}
              </div>
            </div>

            {/* Ferramentas de anotação */}
            {showTools && (
              <div className="flex items-center gap-1.5 mb-2 flex-wrap p-2 bg-lumos-bg/40 rounded-lumos">
                {([['draw', Pencil], ['arrow', MoveUpRight], ['rect', Square]] as const).map(([t, Icon]) => (
                  <button key={t} onClick={() => { ensureComposing(); setTool(tool === t ? null : t); }}
                    className={clsx('p-1.5 rounded-lumos border transition-colors', tool === t ? 'bg-lumos-yellow/15 border-lumos-yellow text-lumos-yellow' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary')}>
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                ))}
                <div className="flex items-center gap-1 ml-1">
                  {COLORS.map(c => (
                    <button key={c} onClick={() => setColor(c)} style={{ background: c }}
                      className={clsx('w-4 h-4 rounded-full border-2', color === c ? 'border-lumos-text-primary' : 'border-transparent')} />
                  ))}
                </div>
                <button onClick={() => setShapes([])} className="p-1.5 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-red-400 ml-auto" title="Limpar desenhos"><Eraser className="w-3.5 h-3.5" /></button>
              </div>
            )}

            <div className="flex items-end gap-2">
              <textarea
                value={commentText} onFocus={ensureComposing} onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitComment(); }}
                rows={1} placeholder={`Comentar em ${fmtTime(currentMs)}…`}
                className="input-lumos flex-1 text-xs resize-none min-h-[40px] max-h-28 py-2.5"
              />
              <button onClick={submitComment} disabled={sending || (!commentText.trim() && shapes.length === 0)}
                className="btn-primary h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-lumos disabled:opacity-40">
                {sending ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-lumos-bg flex items-center justify-center p-4 font-work-sans">{children}</div>;
}

function drawShape(ctx: CanvasRenderingContext2D, sh: Shape, w: number, h: number) {
  ctx.strokeStyle = sh.color; ctx.fillStyle = sh.color; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const pts = sh.points.map(p => ({ x: p.x * w, y: p.y * h }));
  if (pts.length === 0) return;
  if (sh.type === 'draw') {
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    pts.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
  } else if (pts.length >= 2) {
    const [a, b] = [pts[0], pts[1]];
    if (sh.type === 'rect') {
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    } else { // arrow
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      const ang = Math.atan2(b.y - a.y, b.x - a.x), head = 14;
      ctx.beginPath(); ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 6), b.y - head * Math.sin(ang - Math.PI / 6));
      ctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 6), b.y - head * Math.sin(ang + Math.PI / 6));
      ctx.closePath(); ctx.fill();
    }
  }
}
