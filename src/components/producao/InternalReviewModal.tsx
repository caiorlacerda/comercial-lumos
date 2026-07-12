import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Maximize, Pencil, MoveUpRight, Square, Eraser, Send, Clock, X, Volume2, VolumeX, Sun, Moon } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import UserAvatar from '@/components/common/UserAvatar';
import { COLORS, SPEEDS, STREAM_BASE, fmtTime, drawShape, type Shape, type Point } from '@/lib/reviewCanvas';

interface TeamComment {
  id: string; author_name: string; is_team: boolean; timecode_ms: number; body: string; created_at: string;
  annotations: { type: string; data: { color?: string; points?: Point[] } }[];
}

interface Props {
  versionId: string;
  token: string;
  fileName: string;
  versao: number;
  projectName?: string;
  onClose: () => void;
}

export default function InternalReviewModal({ versionId, token, fileName, versao, projectName, onClose }: Props) {
  const { profile } = useAuth();
  const toast = useToast();
  const authorName = profile?.full_name || 'Equipe';

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const [comments, setComments] = useState<TeamComment[]>([]);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [ready, setReady] = useState(false);
  // Tema local do player: começa sempre no escuro (melhor pra revisar vídeo)
  const [rtheme, setRtheme] = useState<'dark' | 'light'>('dark');

  const [composing, setComposing] = useState(false);
  const [commentText, setCommentText] = useState('');
  // Equipe (para avatar + status nos comentários, casando pelo nome do autor)
  const [team, setTeam] = useState<{ id: string; full_name: string; avatar_url?: string | null }[]>([]);
  const userByName = useMemo(() => {
    const m: Record<string, { id: string; full_name: string; avatar_url?: string | null }> = {};
    team.forEach(u => { if (u.full_name) m[u.full_name.trim().toLowerCase()] = u; });
    return m;
  }, [team]);

  // Largura do painel de comentários — redimensionável e lembrada por usuário
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const s = Number(localStorage.getItem('lumos-review-panel-w'));
    return s >= 300 && s <= 720 ? s : 360;
  });
  const [tool, setTool] = useState<'draw' | 'arrow' | 'rect' | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [viewingShapes, setViewingShapes] = useState<Shape[]>([]);
  const drawingRef = useRef<Shape | null>(null);
  const [sending, setSending] = useState(false);

  const streamUrl = useMemo(() => `${STREAM_BASE}?token=${encodeURIComponent(token)}`, [token]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('review_comments')
      .select('id, author_name, is_team, timecode_ms, body, created_at, review_annotations(type, data)')
      .eq('video_version_id', versionId)
      .order('timecode_ms', { ascending: true });
    setComments((data || []).map((c: any) => ({ ...c, annotations: (c.review_annotations || []).map((a: any) => ({ type: a.type, data: a.data })) })));
  }, [versionId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    supabase.from('app_users').select('id, full_name, avatar_url').eq('status', 'ativo')
      .then(({ data }) => setTeam(data || []));
  }, []);
  useEffect(() => {
    const ch = supabase.channel(`rc:${versionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'review_comments', filter: `video_version_id=eq.${versionId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [versionId, load]);

  // --- Player ---
  const togglePlay = () => { const v = videoRef.current; if (!v) return; if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); } };
  const changeSpeed = () => { const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; setSpeed(next); if (videoRef.current) videoRef.current.playbackRate = next; };
  const fullscreen = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else wrapRef.current?.requestFullscreen?.(); };
  const seekTo = (ms: number) => { const v = videoRef.current; if (v) { v.currentTime = ms / 1000; setCurrentMs(ms); v.pause(); setPlaying(false); } };
  const toggleMute = () => { const v = videoRef.current; if (!v) return; v.muted = !v.muted; setMuted(v.muted); };
  const setVol = (val: number) => { const v = videoRef.current; if (v) { v.volume = val; v.muted = val === 0; } setVolume(val); setMuted(val === 0); };
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
      submit();
    }
  };

  // --- Canvas ---
  const redraw = useCallback(() => {
    const cv = canvasRef.current, v = videoRef.current; if (!cv || !v) return;
    cv.width = v.clientWidth; cv.height = v.clientHeight;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const sh of (composing ? shapes : viewingShapes)) drawShape(ctx, sh, cv.width, cv.height);
    if (drawingRef.current) drawShape(ctx, drawingRef.current, cv.width, cv.height);
  }, [composing, shapes, viewingShapes]);
  useEffect(() => { redraw(); }, [redraw]);
  useEffect(() => { const onR = () => redraw(); window.addEventListener('resize', onR); return () => window.removeEventListener('resize', onR); }, [redraw]);

  const canvasPoint = (e: React.PointerEvent): Point => { const r = canvasRef.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  const onCanvasDown = (e: React.PointerEvent) => { if (!composing || !tool) return; drawingRef.current = { type: tool, color, points: [canvasPoint(e)] }; };
  const onCanvasMove = (e: React.PointerEvent) => { if (!drawingRef.current) return; const p = canvasPoint(e); if (tool === 'draw') drawingRef.current.points.push(p); else drawingRef.current.points[1] = p; redraw(); };
  const onCanvasUp = () => { const s = drawingRef.current; if (s) { setShapes(prev => [...prev, s]); drawingRef.current = null; } };

  const ensureComposing = () => { if (composing) return; videoRef.current?.pause(); setPlaying(false); setViewingShapes([]); setShapes([]); setComposing(true); };
  const resetComposer = () => { setComposing(false); setShapes([]); setTool(null); setCommentText(''); };

  // Redimensiona o painel de comentários (arrasta a borda esquerda no desktop)
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    let lastW = startW;
    const move = (ev: PointerEvent) => {
      lastW = Math.min(720, Math.max(300, startW + (startX - ev.clientX)));
      setPanelWidth(lastW);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      localStorage.setItem('lumos-review-panel-w', String(Math.round(lastW)));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const submit = async () => {
    if (!commentText.trim() && shapes.length === 0) return;
    setSending(true);
    const { data: c, error } = await supabase.from('review_comments')
      .insert({ video_version_id: versionId, author_name: authorName, is_team: true, timecode_ms: Math.round(currentMs), body: commentText.trim() })
      .select('id').single();
    if (!error && c && shapes.length) {
      await supabase.from('review_annotations').insert(shapes.map(s => ({ comment_id: c.id, type: s.type, data: { color: s.color, points: s.points } })));
    }
    setSending(false);
    if (error) { toast.error('Não foi possível comentar.'); return; }
    resetComposer(); await load();
  };

  const viewComment = (c: TeamComment) => {
    seekTo(c.timecode_ms); setComposing(false);
    setViewingShapes(c.annotations.map(a => ({ type: (a.type as any) || 'draw', color: a.data?.color || COLORS[0], points: a.data?.points || [] })));
  };

  const pct = durationMs > 0 ? Math.min(100, (currentMs / durationMs) * 100) : 0;

  return (
    <div className={clsx('fixed inset-0 z-50 bg-lumos-bg text-lumos-text-primary flex flex-col font-work-sans', rtheme === 'dark' ? 'dark' : 'theme-light')}>
      <header className="h-12 px-4 flex items-center justify-between border-b border-lumos-border bg-lumos-surface/80 flex-shrink-0">
        <span className="text-sm font-black truncate flex items-center gap-2">
          <span className="text-[9px] font-black uppercase tracking-widest bg-purple-500/15 text-purple-400 px-2 py-0.5 rounded-full">Revisão interna</span>
          {projectName ? `${projectName} · ` : ''}v{String(versao).padStart(2, '0')}
          <span className="text-lumos-text-secondary font-bold normal-case tracking-normal hidden md:inline">· {fileName}</span>
        </span>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setRtheme(t => t === 'dark' ? 'light' : 'dark')} title="Tema claro/escuro"
            className="p-2 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-yellow transition-colors">
            {rtheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button onClick={onClose} className="p-2 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary transition-colors"><X className="w-4 h-4" /></button>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Player */}
        <div className="flex-1 p-4 flex flex-col gap-2 min-w-0">
          <div ref={wrapRef} className="relative w-full aspect-video bg-black rounded-lumos overflow-hidden select-none">
            <video ref={videoRef} src={streamUrl} preload="metadata" className="w-full h-full object-contain block"
              onTimeUpdate={e => setCurrentMs(e.currentTarget.currentTime * 1000)}
              onLoadedMetadata={e => { setDurationMs(e.currentTarget.duration * 1000); redraw(); }}
              onLoadedData={() => setReady(true)} onCanPlay={() => setReady(true)}
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onClick={togglePlay} playsInline />
            <canvas ref={canvasRef} className={clsx('absolute inset-0 w-full h-full', composing && tool ? 'cursor-crosshair' : 'pointer-events-none')}
              onPointerDown={onCanvasDown} onPointerMove={onCanvasMove} onPointerUp={onCanvasUp} onPointerLeave={onCanvasUp} />
            {!ready && <div className="absolute inset-0 flex items-center justify-center bg-black pointer-events-none"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-lumos-yellow" /></div>}
          </div>

          {/* Barra de progresso com marcadores */}
          <div className="px-1 pt-1">
            <div ref={barRef} onPointerDown={onBarDown} className="relative h-5 flex items-center cursor-pointer group">
              <div className="absolute left-0 right-0 h-1.5 rounded-full bg-lumos-text-secondary/20" />
              <div className="absolute left-0 h-1.5 rounded-full bg-lumos-yellow" style={{ width: `${pct}%` }} />
              {durationMs > 0 && comments.map(c => (
                <button key={c.id} onClick={e => { e.stopPropagation(); viewComment(c); }} title={`${c.author_name} · ${fmtTime(c.timecode_ms)}`}
                  className="absolute -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-lumos-yellow ring-2 ring-lumos-bg hover:scale-150 transition-transform z-10"
                  style={{ left: `${(c.timecode_ms / durationMs) * 100}%` }} />
              ))}
              <div className="absolute -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-lumos-text-primary shadow opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" style={{ left: `${pct}%` }} />
            </div>
          </div>

          {/* Controles */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={togglePlay} className="p-2 rounded-lumos hover:bg-lumos-text-secondary/10 transition-colors">{playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}</button>
            <div className="flex items-center gap-1.5">
              <button onClick={toggleMute} className="p-2 rounded-lumos hover:bg-lumos-text-secondary/10 transition-colors">{muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}</button>
              <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={e => setVol(Number(e.target.value))} className="w-16 accent-lumos-yellow cursor-pointer" />
            </div>
            <span className="text-xs font-mono font-bold text-lumos-text-secondary tabular-nums">{fmtTime(currentMs)} <span className="opacity-50">/ {durationMs ? fmtTime(durationMs) : '—'}</span></span>
            <div className="flex-1" />
            <button onClick={changeSpeed} className="px-2.5 py-1.5 rounded-lumos hover:bg-lumos-text-secondary/10 text-[11px] font-black transition-colors">{speed}x</button>
            <button onClick={fullscreen} className="p-2 rounded-lumos hover:bg-lumos-text-secondary/10 transition-colors"><Maximize className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Comentários do time — painel redimensionável (largura lembrada) */}
        <aside
          style={{ ['--rpw' as any]: `${panelWidth}px` }}
          className="relative w-full lg:w-[var(--rpw)] flex-shrink-0 border-t lg:border-t-0 lg:border-l border-lumos-border bg-lumos-surface/30 flex flex-col min-h-0"
        >
          {/* Handle de redimensionamento (só desktop) */}
          <div
            onPointerDown={startResize}
            title="Arraste para redimensionar"
            className="hidden lg:block absolute left-0 top-0 h-full w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-lumos-yellow/40 active:bg-lumos-yellow/60 transition-colors z-20"
          />
          <div className="px-4 py-3 border-b border-lumos-border flex items-center justify-between flex-shrink-0">
            <span className="text-[11px] font-black uppercase tracking-widest text-lumos-text-secondary">Comentários do time</span>
            <span className="text-[10px] font-bold text-lumos-text-secondary/70">{comments.length}</span>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2 min-h-[120px]">
            {comments.length === 0 ? (
              <p className="text-xs text-lumos-text-secondary italic text-center py-8">Nenhum comentário ainda. Pause no ponto que quiser e escreva abaixo.</p>
            ) : comments.map(c => (
              <button key={c.id} onClick={() => viewComment(c)} className="w-full text-left p-2.5 rounded-lumos border border-lumos-border/50 hover:border-lumos-yellow/40 hover:bg-lumos-text-secondary/[0.03] transition-all">
                <div className="flex items-start gap-2">
                  <UserAvatar
                    user={userByName[(c.author_name || '').trim().toLowerCase()] || { full_name: c.author_name }}
                    size={24}
                    showStatus={c.is_team}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="text-[11px] font-black text-lumos-text-primary truncate">{c.author_name}{!c.is_team && <span className="ml-1 text-[8px] uppercase text-amber-400">Cliente</span>}</span>
                      <span className="text-[10px] font-mono font-bold text-lumos-yellow flex-shrink-0">{fmtTime(c.timecode_ms)}</span>
                    </div>
                    {c.body && <p className="text-[11px] text-lumos-text-secondary leading-snug whitespace-pre-line break-words">{c.body}</p>}
                    {c.annotations.length > 0 && <span className="text-[9px] text-lumos-text-secondary/60 flex items-center gap-1 mt-1"><Pencil className="w-2.5 h-2.5" /> {c.annotations.length} anotação(ões)</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Compositor */}
          <div className="border-t border-lumos-border p-3 bg-lumos-surface/50 flex-shrink-0 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-lumos-yellow flex items-center gap-1"><Clock className="w-3 h-3" /> em {fmtTime(currentMs)}</span>
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
                {COLORS.map(c => <button key={c} onClick={() => setColor(c)} style={{ background: c }} title="Cor" className={clsx('w-4 h-4 rounded-full border-2', color === c ? 'border-lumos-text-primary' : 'border-transparent')} />)}
              </div>
              <button onClick={() => setShapes([])} className="p-1.5 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-red-400 ml-auto" title="Limpar desenhos"><Eraser className="w-3.5 h-3.5" /></button>
            </div>

            <div className="flex items-end gap-2">
              <textarea value={commentText} onFocus={ensureComposing} onChange={e => setCommentText(e.target.value)}
                onKeyDown={onCommentKey}
                rows={2} placeholder={`Comentar em ${fmtTime(currentMs)}…`} className="input-lumos flex-1 text-xs resize-none min-h-[44px] max-h-28 py-2 leading-snug" />
              <button onClick={submit} disabled={sending || (!commentText.trim() && shapes.length === 0)}
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
