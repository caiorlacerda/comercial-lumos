import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CalendarOff, Loader2, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';
import { useConfirm } from '@/components/ui/useConfirm';

/**
 * A agenda de diárias que a produtora fecha por conta própria, GLOBAL: vale
 * para a produtora inteira, não para um projeto. Duas formas, as duas somem
 * do calendário de TODOS os clientes em TODOS os portais:
 * - Datas pontuais (`agenda_bloqueios`, estado `bloqueado` em `portal_agenda`).
 * - Dias da semana inteiros (`agenda_semana_fechada`, ex.: fechar todo
 *   domingo) — regra PERMANENTE, ao contrário da data avulsa. Existe desde a
 *   migração 2026093334; sem ela a tabela não existe e a leitura dá erro.
 * Por isso mora num modal à parte, aberto de dentro de um projeto só por
 * conveniência, e a copy deixa isso explícito nas duas seções.
 */

interface Bloqueio {
  data: string;
  motivo: string | null;
  criado_por: string | null;
  created_at: string;
}

interface DiaFechado {
  dia_semana: number;
  motivo: string | null;
  criado_por: string | null;
  created_at: string;
}

interface Props { isOpen: boolean; onClose: () => void; canManage: boolean }

const fmtData = (d: string) => {
  const s = new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const hoje = () => new Date().toISOString().slice(0, 10);

/** 0 = domingo, igual ao `dia_semana` da tabela (EXTRACT(DOW)). */
const NOME_DIA_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

export default function BloqueiosDeAgenda({ isOpen, onClose, canManage }: Props) {
  const { profile } = useAuth();
  const toast = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [bloqueios, setBloqueios] = useState<Bloqueio[]>([]);
  const [erro, setErro] = useState(false);
  const [data, setData] = useState('');
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);

  const [loadingSemana, setLoadingSemana] = useState(true);
  const [diasFechados, setDiasFechados] = useState<DiaFechado[]>([]);
  const [erroSemana, setErroSemana] = useState(false);
  const [salvandoDia, setSalvandoDia] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: rows, error } = await supabase.from('agenda_bloqueios')
      .select('data, motivo, criado_por, created_at')
      .gte('data', hoje())
      .order('data', { ascending: true });
    // Falha aqui não pode virar "lista vazia": isso diria pra tela que está
    // tudo liberado quando na verdade só não deu pra saber.
    setErro(!!error);
    setBloqueios(error ? [] : (rows as Bloqueio[]) || []);
    setLoading(false);
  }, []);

  const loadSemana = useCallback(async () => {
    setLoadingSemana(true);
    const { data: rows, error } = await supabase.from('agenda_semana_fechada')
      .select('dia_semana, motivo, criado_por, created_at')
      .order('dia_semana', { ascending: true });
    // Mesma regra da leitura de datas: erro (inclusive tabela que ainda não
    // existe, antes da migração 2026093334 rodar) não pode virar "nenhum dia
    // fechado" — isso é o pior desfecho possível aqui.
    setErroSemana(!!error);
    setDiasFechados(error ? [] : (rows as DiaFechado[]) || []);
    setLoadingSemana(false);
  }, []);

  useEffect(() => { if (isOpen) { load(); loadSemana(); } }, [isOpen, load, loadSemana]);

  // O Modal comum (compartilhado por outras telas) fecha pelo X e pelo
  // clique fora, mas não trata Esc. A janela do cliente fecha pelos três:
  // aqui fica igual, só nesta tela, sem mexer no componente compartilhado.
  useEffect(() => {
    if (!isOpen) return;
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [isOpen, onClose]);

  const alternarDiaSemana = async (diaSemana: number, fechadoAgora: boolean) => {
    if (!canManage || salvandoDia !== null) return;
    setSalvandoDia(diaSemana);
    if (fechadoAgora) {
      const { error } = await supabase.from('agenda_semana_fechada').delete().eq('dia_semana', diaSemana);
      setSalvandoDia(null);
      if (error) { toast.error(`Não foi possível reabrir ${NOME_DIA_SEMANA[diaSemana]}.`); return; }
      toast.success(`${NOME_DIA_SEMANA[diaSemana]} reaberto, para a produtora inteira.`);
      loadSemana();
    } else {
      const { error } = await supabase.from('agenda_semana_fechada')
        .insert({ dia_semana: diaSemana, criado_por: profile?.id || null });
      setSalvandoDia(null);
      if (error) { toast.error(`Não foi possível fechar ${NOME_DIA_SEMANA[diaSemana]}.`); return; }
      toast.success(`${NOME_DIA_SEMANA[diaSemana]} fechado, para a produtora inteira, toda semana.`);
      loadSemana();
    }
  };

  const adicionar = async () => {
    if (!data) { toast.error('Escolha uma data.'); return; }
    setSalvando(true);
    const { error } = await supabase.from('agenda_bloqueios')
      .insert({ data, motivo: motivo.trim() || null, criado_por: profile?.id || null });
    setSalvando(false);
    if (error) {
      toast.error(/duplicate|unique/i.test(error.message) ? 'Essa data já está bloqueada.' : 'Não foi possível bloquear a data.');
      return;
    }
    setData('');
    setMotivo('');
    toast.success('Data fechada para todos os clientes ✓');
    load();
  };

  const remover = async (b: Bloqueio) => {
    if (!await confirm({
      title: 'Reabrir esta data',
      message: `${fmtData(b.data)} volta a ficar pedível por qualquer cliente no portal.`,
      confirmLabel: 'Reabrir',
    })) return;
    const { error } = await supabase.from('agenda_bloqueios').delete().eq('data', b.data);
    if (error) { toast.error('Não foi possível reabrir a data.'); return; }
    toast.success('Data reaberta.');
    load();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Agenda bloqueada" maxWidth="max-w-lg">
      <div className="space-y-6">
        {confirmDialog}

        {/* ── Dias da semana fechados: regra permanente, pra produtora
            inteira, diferente da data avulsa aqui embaixo. ──────────── */}
        <div className="space-y-3">
          <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">
            Dias da semana fechados
          </label>
          <div className="rounded-lumos border border-amber-500/40 bg-amber-500/[0.07] px-3.5 py-3 flex items-start gap-2.5">
            <CalendarOff className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-[11.5px] leading-snug text-lumos-text-primary">
              Fechar um dia aqui vale para a produtora inteira, em todos os portais, e é regra
              permanente: toda semana, sem data de volta. Diferente de bloquear uma data avulsa,
              que é só aquele dia.
            </p>
          </div>

          {loadingSemana ? (
            <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-lumos-yellow" /></div>
          ) : erroSemana ? (
            <div className="rounded-lumos border border-red-500/40 bg-red-500/[0.06] px-3.5 py-3 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs font-bold text-lumos-text-primary">Não foi possível carregar os dias fechados.</p>
                <p className="text-[11px] text-lumos-text-secondary mt-0.5">
                  Pode ter dia fechado que não está aparecendo aqui. Tente de novo antes de confiar na lista.
                </p>
                <button type="button" onClick={loadSemana} className="text-[11px] font-bold text-lumos-yellow hover:underline mt-1.5">
                  Tentar de novo
                </button>
              </div>
            </div>
          ) : (
            <div className="border border-lumos-border rounded-lumos divide-y divide-lumos-border/60">
              {NOME_DIA_SEMANA.map((nomeDia, i) => {
                const fechado = diasFechados.some(d => d.dia_semana === i);
                return (
                  <div key={i} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <span className="text-xs font-bold text-lumos-text-primary">{nomeDia}</span>
                    {canManage ? (
                      <button type="button" disabled={salvandoDia !== null}
                        onClick={() => alternarDiaSemana(i, fechado)}
                        title={fechado ? `Reabrir ${nomeDia}` : `Fechar ${nomeDia}`}
                        className={clsx('w-10 h-5 rounded-full relative transition-colors flex-shrink-0 disabled:opacity-60',
                          fechado ? 'bg-lumos-yellow' : 'bg-lumos-text-secondary/30')}>
                        <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', fechado ? 'left-5' : 'left-0.5')} />
                      </button>
                    ) : (
                      <span className={clsx('text-[10.5px] font-bold', fechado ? 'text-amber-500' : 'text-lumos-text-secondary')}>
                        {fechado ? 'fechado' : 'aberto'}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Datas pontuais bloqueadas ────────────────────────────── */}
        <div className="space-y-3">
        <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">
          Datas pontuais bloqueadas
        </label>
        <div className="rounded-lumos border border-amber-500/40 bg-amber-500/[0.07] px-3.5 py-3 flex items-start gap-2.5">
          <CalendarOff className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-[11.5px] leading-snug text-lumos-text-primary">
            Bloquear uma data fecha o dia para a produtora inteira, não só para este projeto.
            Ela some do calendário de todos os clientes, em todos os portais.
          </p>
        </div>

        {canManage && (
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-shrink-0">
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Data</label>
              <input type="date" min={hoje()} value={data} onChange={e => setData(e.target.value)}
                className="input-lumos h-9 mt-1 text-xs w-[145px]" />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Motivo, opcional</label>
              <input value={motivo} onChange={e => setMotivo(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') adicionar(); }}
                placeholder="Ex.: feriado, equipe de folga" className="input-lumos h-9 mt-1 text-xs w-full" />
            </div>
            <button type="button" onClick={adicionar} disabled={salvando}
              className="btn-primary h-9 px-4 text-xs font-black disabled:opacity-60 flex items-center gap-1.5 flex-shrink-0">
              {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Bloquear
            </button>
          </div>
        )}

        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-lumos-yellow" /></div>
        ) : erro ? (
          <div className="rounded-lumos border border-red-500/40 bg-red-500/[0.06] px-3.5 py-3 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-lumos-text-primary">Não foi possível carregar as datas bloqueadas.</p>
              <p className="text-[11px] text-lumos-text-secondary mt-0.5">
                Pode ter data bloqueada que não está aparecendo aqui. Tente de novo antes de confiar na lista.
              </p>
              <button type="button" onClick={load} className="text-[11px] font-bold text-lumos-yellow hover:underline mt-1.5">
                Tentar de novo
              </button>
            </div>
          </div>
        ) : bloqueios.length === 0 ? (
          <p className="text-xs text-lumos-text-secondary italic text-center py-4">Nenhuma data futura bloqueada.</p>
        ) : (
          <div className="border border-lumos-border rounded-lumos divide-y divide-lumos-border/60 max-h-80 overflow-y-auto custom-scrollbar">
            {bloqueios.map(b => (
              <div key={b.data} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-lumos-text-primary truncate">{fmtData(b.data)}</span>
                  {b.motivo && <span className="block text-[10.5px] text-lumos-text-secondary truncate">{b.motivo}</span>}
                </span>
                {canManage && (
                  <button type="button" onClick={() => remover(b)} title="Reabrir data"
                    className="p-1.5 text-lumos-text-secondary hover:text-red-400 flex-shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
    </Modal>
  );
}
