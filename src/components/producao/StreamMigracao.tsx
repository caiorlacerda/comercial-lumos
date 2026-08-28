import { useCallback, useEffect, useRef, useState } from 'react';
import { Gauge, Loader2, Play, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';

/**
 * PLAYER RÁPIDO — acompanhamento da migração (só ADM).
 *
 * Cada vídeo ganha uma cópia de reprodução no Cloudflare Stream, que é de onde
 * o player passa a puxar. Enquanto a cópia não fica pronta, aquele vídeo segue
 * tocando pelo caminho antigo, então dá pra migrar aos poucos sem ninguém ficar
 * sem assistir.
 *
 * O envio vai em lotes pequenos de propósito: o Stream busca cada arquivo pela
 * nossa função, e adiantar trabalho não acelera nada, só empilha fila lá.
 */

type Situacao = { total: number; prontos: number; processando: number; comErro: number; naoEnviados: number; prontosSemManifesto?: number };

export default function StreamMigracao() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [s, setS] = useState<Situacao | null>(null);
  const [rodando, setRodando] = useState(false);
  const [indisponivel, setIndisponivel] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pararRef = useRef(false);

  const chamar = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('stream-ingest', { body });
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as any;
  }, []);

  const atualizar = useCallback(async () => {
    try {
      setS(await chamar({ action: 'situacao' }));
      setErro(null);
    } catch (e: any) {
      const msg = String(e?.message || e);
      // Coluna ainda não existe = SQL da migração não rodou. Some da tela em
      // vez de mostrar erro pra quem não tem o que fazer com ele.
      if (/stream_uid|column|schema/i.test(msg)) { setIndisponivel(true); return; }
      // Qualquer outra falha PRECISA aparecer. Sumir calado já custou tempo de
      // procurar um card que nunca ia renderizar.
      setErro(msg.slice(0, 160));
    }
  }, [chamar]);

  useEffect(() => { if (isAdmin) atualizar(); }, [isAdmin, atualizar]);

  // Vídeo pronto mas sem o endereço do manifesto continua tocando pelo caminho
  // lento, e isso não se resolve sozinho. Uma passada de 'conferir' recupera o
  // que falta, então dispara assim que a tela percebe que há o que recuperar.
  const reparou = useRef(false);
  useEffect(() => {
    if (!isAdmin || reparou.current || !s?.prontosSemManifesto) return;
    reparou.current = true;
    (async () => { try { await chamar({ action: 'conferir' }); await atualizar(); } catch { /* tenta na próxima visita */ } })();
  }, [isAdmin, s?.prontosSemManifesto, chamar, atualizar]);

  // Enquanto houver vídeo em conversão, confere sozinho de tempos em tempos.
  useEffect(() => {
    if (!isAdmin || !s?.processando) return;
    const t = setInterval(async () => {
      try { await chamar({ action: 'conferir' }); await atualizar(); } catch { /* tenta de novo depois */ }
    }, 20000);
    return () => clearInterval(t);
  }, [isAdmin, s?.processando, chamar, atualizar]);

  const migrar = async () => {
    setRodando(true);
    pararRef.current = false;
    let enviados = 0;
    try {
      for (;;) {
        if (pararRef.current) break;
        const r = await chamar({ action: 'lote', limite: 10 });
        enviados += r.enviados || 0;
        await chamar({ action: 'conferir' }).catch(() => null);
        await atualizar();
        if (!r.enviados || !r.aindaFaltam) break;
      }
      toast.success(`${enviados} vídeo(s) enviados para o player rápido ✓`);
    } catch (e: any) {
      toast.error(`Parou: ${String(e?.message || e).slice(0, 120)}`);
    } finally {
      setRodando(false);
      atualizar();
    }
  };

  if (!isAdmin || indisponivel) return null;

  if (erro || !s) {
    return (
      <div className="px-4 py-3 border-b border-lumos-border flex items-center gap-3 flex-wrap">
        <Gauge className="w-4 h-4 text-lumos-text-secondary flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-wider text-lumos-text-primary">Player rápido</p>
          <p className="text-[11px] text-lumos-text-secondary">
            {erro ? `Não deu pra ler o andamento: ${erro}` : 'Consultando o andamento...'}
          </p>
        </div>
        <button type="button" onClick={atualizar} title="Tentar de novo"
          className="h-8 w-8 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary flex items-center justify-center">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  const naViaRapida = Math.max(s.prontos - (s.prontosSemManifesto || 0), 0);
  const pct = s.total ? Math.round((naViaRapida / s.total) * 100) : 0;
  const completo = naViaRapida === s.total && s.total > 0;

  return (
    <div className="px-4 py-3 border-b border-lumos-border">
      <div className="flex items-center gap-3 flex-wrap">
        <Gauge className={clsx('w-4 h-4 flex-shrink-0', completo ? 'text-green-500' : 'text-lumos-yellow')} />
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-wider text-lumos-text-primary">Player rápido</p>
          <p className="text-[11px] text-lumos-text-secondary">
            {completo
              ? 'Todos os vídeos já abrem pela via rápida.'
              : `${naViaRapida} de ${s.total} na via rápida${s.processando ? `, ${s.processando} convertendo` : ''}${s.prontosSemManifesto ? `, ${s.prontosSemManifesto} finalizando` : ''}${s.comErro ? `, ${s.comErro} com erro` : ''}.`}
          </p>
        </div>

        <div className="flex-1 min-w-[120px] h-1.5 rounded-full bg-lumos-text-secondary/15 overflow-hidden">
          <div className={clsx('h-full rounded-full transition-all duration-500', completo ? 'bg-green-500' : 'bg-lumos-yellow')}
            style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[11px] font-bold tabular-nums text-lumos-text-secondary">{pct}%</span>

        {!completo && (
          <button type="button" onClick={rodando ? () => { pararRef.current = true; } : migrar}
            className="h-8 px-3 rounded-lumos border border-lumos-border text-[11px] font-bold text-lumos-text-primary hover:border-lumos-yellow/50 flex items-center gap-1.5">
            {rodando
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Parar</>
              : <><Play className="w-3.5 h-3.5" /> Migrar acervo</>}
          </button>
        )}
        <button type="button" onClick={atualizar} title="Atualizar"
          className="h-8 w-8 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary flex items-center justify-center">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {rodando && (
        <p className="text-[10.5px] text-lumos-text-secondary mt-2">
          Pode fechar a página quando quiser: o que já foi enviado continua convertendo do outro lado.
        </p>
      )}
    </div>
  );
}
