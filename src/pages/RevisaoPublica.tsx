import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Play, Pause, Maximize, Download, MessageSquarePlus, Pencil, MoveUpRight,
  Square, Eraser, Send, Film, Clock, Check,
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';

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

const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h > 0 ? `${h}:` : '') + `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};
const fmtSize = (b: number | null) => b ? `${(b / 1048576).toFixed(1)} MB` : '—';

// ---------------------------------------------------------------------------
export default function RevisaoPublica() {
  const { token = '' } = useParams();
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [viewerId, setViewerId] = useState<string | null>(() => localStorage.getItem(`rev_viewer_${token}`));
  const [viewerName, setViewerName] = useState<string>(() => localStorage.getItem(`rev_name_${token}`) || '');
  const [nameInput, setNameInput] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [speed, setSpeed] = useState(1);

  // Composição de novo comentário
  const [composing, setComposing] = useState(false);
  const [commentText, setCommentText] = useState('');
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
  const fullscreen = () => wrapRef.current?.requestFullscreen?.();
  const seekTo = (ms: number) => { const v = videoRef.current; if (v) { v.currentTime = ms / 1000; v.pause(); setPlaying(false); } };

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
    if (drawingRef.current) { setShapes(prev => [...prev, drawingRef.current!]); drawingRef.current = null; }
  };

  const startComposing = () => {
    if (videoRef.current) { videoRef.current.pause(); setPlaying(false); }
    setViewingShapes([]); setShapes([]); setComposing(true); setTool(null); setCommentText('');
  };
  const cancelComposing = () => { setComposing(false); setShapes([]); setTool(null); setCommentText(''); };

  const submitComment = async () => {
    if (!commentText.trim() && shapes.length === 0) return;
    setSending(true);
    const annotations = shapes.map(s => ({ type: s.type, data: { color: s.color, points: s.points } }));
    const { error: err } = await supabase.rpc('review_add_comment', {
      p_token: token, p_viewer_id: viewerId, p_timecode_ms: Math.round(currentMs), p_body: commentText.trim(), p_annotations: annotations,
    });
    setSending(false);
    if (err) { alert('Erro ao enviar comentário. Tente de novo.'); return; }
    cancelComposing();
    await load();
  };

  const viewComment = (c: Comment) => {
    seekTo(c.timecode_ms);
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

  const specs = [
    ['Projeto', data.video.project_name],
    ['Versão', `v${String(data.video.versao).padStart(2, '0')}`],
    ['Resolução', data.video.width ? `${data.video.width}×${data.video.height}` : '—'],
    ['Duração', data.video.duration_ms ? fmtTime(data.video.duration_ms) : '—'],
    ['Formato', (data.video.mime_type || '').split('/')[1]?.toUpperCase() || '—'],
    ['Tamanho', fmtSize(data.video.size_bytes)],
  ];

  return (
    <div className="min-h-screen bg-lumos-bg text-lumos-text-primary font-work-sans">
      <header className="h-12 px-4 flex items-center justify-between border-b border-lumos-border bg-lumos-surface/80">
        <span className="text-sm font-black flex items-center gap-2"><Film className="w-4 h-4 text-lumos-yellow" /> {data.video.project_name} · v{String(data.video.versao).padStart(2, '0')}</span>
        <span className="text-[10px] text-lumos-text-secondary">Você: <b className="text-lumos-text-primary">{viewerName}</b></span>
      </header>

      <div className="flex flex-col lg:flex-row">
        {/* Player */}
        <div className="flex-1 p-4 space-y-3">
          <div ref={wrapRef} className="relative bg-black rounded-lumos overflow-hidden select-none">
            <video
              ref={videoRef} src={streamUrl} className="w-full max-h-[70vh] block"
              onTimeUpdate={e => setCurrentMs(e.currentTarget.currentTime * 1000)}
              onLoadedMetadata={() => redraw()} onClick={togglePlay} playsInline
            />
            {/* Marca d'água */}
            {data.link.watermark && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
                <div className="absolute inset-0 flex flex-wrap gap-x-16 gap-y-10 -rotate-[30deg] scale-150 opacity-[0.13]">
                  {Array.from({ length: 40 }).map((_, i) => (
                    <span key={i} className="text-white text-[11px] font-bold whitespace-nowrap">
                      {viewerName} · {new Date().toLocaleDateString('pt-BR')}
                    </span>
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

          {/* Controles */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={togglePlay} className="p-2 rounded-lumos bg-lumos-surface border border-lumos-border hover:border-lumos-yellow/40">
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <span className="text-xs font-mono font-bold text-lumos-text-secondary w-24">{fmtTime(currentMs)}{data.video.duration_ms ? ` / ${fmtTime(data.video.duration_ms)}` : ''}</span>
            <button onClick={changeSpeed} className="px-2.5 py-2 rounded-lumos bg-lumos-surface border border-lumos-border hover:border-lumos-yellow/40 text-[11px] font-black">{speed}x</button>
            <button onClick={fullscreen} className="p-2 rounded-lumos bg-lumos-surface border border-lumos-border hover:border-lumos-yellow/40"><Maximize className="w-4 h-4" /></button>
            {data.link.allow_download && (
              <a href={streamUrl} target="_blank" rel="noopener noreferrer" className="p-2 rounded-lumos bg-lumos-surface border border-lumos-border hover:border-lumos-yellow/40" title="Baixar"><Download className="w-4 h-4" /></a>
            )}
            <div className="flex-1" />
            {!composing && (
              <button onClick={startComposing} className="btn-primary h-9 px-3 text-xs font-bold flex items-center gap-1.5">
                <MessageSquarePlus className="w-4 h-4" /> Comentar em {fmtTime(currentMs)}
              </button>
            )}
          </div>

          {/* Barra de ferramentas de anotação (ao compor) */}
          {composing && (
            <div className="flex items-center gap-2 flex-wrap p-2 bg-lumos-surface border border-lumos-border rounded-lumos">
              {([['draw', Pencil], ['arrow', MoveUpRight], ['rect', Square]] as const).map(([t, Icon]) => (
                <button key={t} onClick={() => setTool(tool === t ? null : t)}
                  className={clsx('p-2 rounded-lumos border transition-colors', tool === t ? 'bg-lumos-yellow/15 border-lumos-yellow text-lumos-yellow' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary')}>
                  <Icon className="w-4 h-4" />
                </button>
              ))}
              <div className="flex items-center gap-1 ml-1">
                {COLORS.map(c => (
                  <button key={c} onClick={() => setColor(c)} style={{ background: c }}
                    className={clsx('w-5 h-5 rounded-full border-2', color === c ? 'border-lumos-text-primary' : 'border-transparent')} />
                ))}
              </div>
              <button onClick={() => setShapes([])} className="p-2 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-red-400" title="Limpar desenhos"><Eraser className="w-4 h-4" /></button>
            </div>
          )}
        </div>

        {/* Comentários */}
        <aside className="w-full lg:w-[360px] border-t lg:border-t-0 lg:border-l border-lumos-border bg-lumos-surface/30 flex flex-col max-h-[calc(100vh-3rem)]">
          {/* Specs */}
          <div className="p-4 border-b border-lumos-border grid grid-cols-2 gap-x-4 gap-y-1.5">
            {specs.map(([k, v]) => (
              <div key={k} className="flex flex-col">
                <span className="text-[8px] font-black uppercase tracking-widest text-lumos-text-secondary/60">{k}</span>
                <span className="text-[11px] font-bold text-lumos-text-primary truncate">{v}</span>
              </div>
            ))}
          </div>

          {/* Compositor */}
          {composing && (
            <div className="p-3 border-b border-lumos-border bg-lumos-yellow/[0.03]">
              <p className="text-[10px] font-black uppercase tracking-widest text-lumos-yellow mb-1.5 flex items-center gap-1"><Clock className="w-3 h-3" /> {fmtTime(currentMs)}</p>
              <textarea value={commentText} onChange={e => setCommentText(e.target.value)} rows={3}
                placeholder="Escreva seu comentário… (desenhe no vídeo se quiser)" className="input-lumos w-full text-xs resize-none" autoFocus />
              <div className="flex items-center gap-2 mt-2">
                <button onClick={cancelComposing} className="btn-secondary flex-1 h-8 text-xs">Cancelar</button>
                <button onClick={submitComment} disabled={sending} className="btn-primary flex-1 h-8 text-xs font-bold flex items-center justify-center gap-1.5">
                  {sending ? <span className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : <><Send className="w-3.5 h-3.5" /> Enviar</>}
                </button>
              </div>
            </div>
          )}

          {/* Lista */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
            {data.comments.length === 0 ? (
              <p className="text-xs text-lumos-text-secondary italic text-center py-8">Nenhum comentário ainda. Pause no ponto que quiser e clique em “Comentar”.</p>
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
