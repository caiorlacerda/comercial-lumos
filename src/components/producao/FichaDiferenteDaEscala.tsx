import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Users2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import Modal from '@/components/common/Modal';
import { SELECT_DE_MEMBROS, nomeDoMembro, type MembroDiaria } from '@/components/producao/escalaDaDiaria';
import {
  aplicarEscalaNaFicha, assinaturaDaDiferenca, compararFichaComEscala, temDiferenca, type PessoaDaFicha,
} from '@/lib/regrasDaEscala';

/**
 * ORDEM DO DIA × ESCALA DA DIÁRIA. A ficha técnica copia a escala só quando a ordem é criada.
 * Quando as duas ficam diferentes, aparece este aviso com o botão para atualizar a ficha.
 * Nada muda sozinho, e quem está só na ficha só sai se a pessoa marcar: pode ter sido posto à mão.
 */

interface Props {
  ordemId: string;
  diariaId: string;
  ficha: PessoaDaFicha[];
  /** Grava a ficha nova (com a trava de versão da ordem). true = gravou. */
  onAplicar: (ficha: PessoaDaFicha[]) => Promise<boolean>;
}

const chaveIgnorada = (ordemId: string) => `lumos_od_escala_ignorada:${ordemId}`;
const lerIgnorada = (ordemId: string) => { try { return localStorage.getItem(chaveIgnorada(ordemId)); } catch { return null; } };

export default function FichaDiferenteDaEscala({ ordemId, diariaId, ficha, onAplicar }: Props) {
  const toast = useToast();
  const [escala, setEscala] = useState<PessoaDaFicha[] | null>(null);
  const [ignorada, setIgnorada] = useState<string | null>(() => lerIgnorada(ordemId));
  const [aberto, setAberto] = useState(false);
  const [opcoes, setOpcoes] = useState({ entram: true, funcoes: true, tirar: false });
  const [gravando, setGravando] = useState(false);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('diaria_members').select(SELECT_DE_MEMBROS).eq('diaria_id', diariaId);
    if (error) { setEscala(null); return; }
    setEscala(((data as unknown as MembroDiaria[]) || []).map(m => ({ nome: nomeDoMembro(m), funcao: m.funcao || '' })).filter(p => p.nome));
  }, [diariaId]);
  useEffect(() => { void carregar(); }, [carregar]);
  useRealtimeRefetch(['diaria_members'], () => { void carregar(); });

  const guardarIgnorada = (assinatura: string) => {
    setIgnorada(assinatura);
    try { localStorage.setItem(chaveIgnorada(ordemId), assinatura); } catch { /* sem armazenamento: vale só nesta visita */ }
  };

  // Diária sem ninguém escalado não tem o que levar para a ficha (ordens montadas à mão não ficam com aviso).
  if (!escala || escala.length === 0) return null;
  const dif = compararFichaComEscala(ficha, escala);
  if (!temDiferenca(dif) || assinaturaDaDiferenca(dif) === ignorada) return null;

  const resumo = [
    dif.entram.length ? `${dif.entram.length} para entrar` : null,
    dif.funcoes.length ? `${dif.funcoes.length} com função diferente` : null,
    dif.soNaFicha.length ? `${dif.soNaFicha.length} só na ficha` : null,
  ].filter(Boolean).join(' · ');

  const vaiMudar = (opcoes.entram && dif.entram.length > 0) || (opcoes.funcoes && dif.funcoes.length > 0) || (opcoes.tirar && dif.soNaFicha.length > 0);

  const aplicar = async () => {
    const nova = aplicarEscalaNaFicha(ficha, dif, opcoes);
    setGravando(true);
    const ok = await onAplicar(nova);
    setGravando(false);
    if (!ok) return;
    setAberto(false);
    // O que a pessoa escolheu deixar diferente não volta a avisar (só se a escala mudar de novo).
    const resto = compararFichaComEscala(nova, escala);
    if (temDiferenca(resto)) guardarIgnorada(assinaturaDaDiferenca(resto));
    toast.success('Ficha técnica atualizada pela diária ✓');
  };

  const secao = (
    chave: 'entram' | 'funcoes' | 'tirar', titulo: string, linhas: string[], ajuda?: string,
  ) => linhas.length > 0 && (
    <label className="block rounded-lumos border border-lumos-border p-3 cursor-pointer">
      <span className="flex items-center gap-2">
        <input type="checkbox" className="accent-[#EFC700] w-4 h-4" checked={opcoes[chave]}
          onChange={e => setOpcoes(o => ({ ...o, [chave]: e.target.checked }))} />
        <span className="text-xs font-black text-lumos-text-primary">{titulo}</span>
      </span>
      {ajuda && <span className="block mt-1 pl-6 text-[10.5px] text-lumos-text-secondary">{ajuda}</span>}
      <span className="block mt-1.5 pl-6 space-y-0.5">
        {linhas.map(l => <span key={l} className="block text-[11.5px] text-lumos-text-primary break-words">{l}</span>)}
      </span>
    </label>
  );

  return (
    <div className="rounded-lumos border border-lumos-yellow/40 bg-lumos-yellow/[0.07] px-4 py-3 flex items-center gap-3 flex-wrap">
      <Users2 className="w-4 h-4 text-lumos-yellow flex-shrink-0" />
      <p className="min-w-0 flex-1 basis-56 text-[12px] text-lumos-text-primary leading-snug">
        <b>A ficha técnica está diferente da escala da diária:</b> {resumo}.
      </p>
      <button type="button" onClick={() => { setOpcoes({ entram: true, funcoes: true, tirar: false }); setAberto(true); }}
        className="btn-primary h-9 px-4 text-xs font-black flex items-center gap-1.5">
        <RefreshCw className="w-3.5 h-3.5" /> Atualizar equipe pela diária
      </button>
      <button type="button" onClick={() => guardarIgnorada(assinaturaDaDiferenca(dif))}
        className="text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary px-1">Manter como está</button>

      {aberto && (
        <Modal isOpen onClose={() => setAberto(false)} title="Atualizar equipe pela diária" maxWidth="max-w-md">
          <div className="space-y-3">
            {secao('entram', 'Adicionar quem está na escala', dif.entram.map(p => `${p.nome}${p.funcao ? `: ${p.funcao}` : ' (sem função definida)'}`))}
            {secao('funcoes', 'Usar a função da escala', dif.funcoes.map(f => `${f.nome}: ${f.de || 'sem função'} → ${f.para}`))}
            {secao('tirar', 'Tirar quem não está na escala', dif.soNaFicha.map(p => `${p.nome}${p.funcao ? `: ${p.funcao}` : ''}`),
              'Fica desmarcado porque essas pessoas podem ter sido adicionadas à mão nesta ordem do dia.')}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => setAberto(false)} className="text-[11px] font-bold text-lumos-text-secondary px-2">Cancelar</button>
              <button type="button" onClick={aplicar} disabled={!vaiMudar || gravando}
                className="btn-primary h-9 px-5 text-xs font-black disabled:opacity-50 flex items-center gap-1.5">
                {gravando && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Atualizar ficha
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
