import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarCheck, Clapperboard, CloudRain, Copy, ExternalLink, FolderOpen, Loader2, MapPin, MessageCircle, Trash2, UserPlus, Users2, X } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { hojeLocalISO } from '@/lib/dataSemHora';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';
import SeletorDeLocal from '@/components/producao/SeletorDeLocal';
import { previsaoParaDiaria, type PrevisaoDia } from '@/lib/weather';
import { duracaoDaDiaria, horarioInvalido, viraODia } from '@/lib/horarioDiaria';
import { consultaDeClima, type Local } from '@/lib/locais';
import { linkDoMapa, montarMensagemDaDiaria } from '@/lib/regrasDaEscala';
import {
  AvatarDaPessoa, AvisoDeConflito, ListaDeEscalaveis, SELECT_DE_MEMBROS, chaveDaPessoa, chaveDoMembro, nomeDoMembro,
  useCatalogoDeEscala, useConflitosDoDia, type MembroDiaria, type PessoaCatalogo,
} from '@/components/producao/escalaDaDiaria';

/**
 * PAINEL DA DIÁRIA — tudo de uma diária num lugar só: dados, equipe, previsão do
 * tempo, local, ordem do dia e Google Calendar. É o mesmo nas Diárias do projeto
 * (calendário e cards) e na Agenda da produção.
 *
 * Diária que já existe: a equipe é salva na hora (como nos cards); os dados, no
 * botão Salvar. Diária nova: a equipe escolhida entra junto quando ela é criada.
 */

export interface DiariaDados {
  id?: string; nome?: string; data?: string | null; duracao_horas?: number;
  hora_inicio?: string | null; hora_fim?: string | null;
  local?: string | null; local_id?: string | null; descricao?: string | null;
  google_event_id?: string | null;
}

interface Escolhido { pessoa: PessoaCatalogo; funcao: string }

interface Props {
  projectId: string;
  /** null = diária nova. */
  diariaId: string | null;
  /** Valores de partida da diária nova (ex.: data e hora clicadas no calendário). */
  inicial?: DiariaDados;
  canManage: boolean;
  /** Fora da página do projeto (Agenda): mostra o atalho "Abrir projeto". */
  mostrarProjeto?: boolean;
  onClose: () => void;
  /** Algo mudou no banco (dados, equipe, exclusão): quem abriu recarrega a lista. */
  onMudou: () => void;
}

const CAMPOS: (keyof DiariaDados)[] = ['nome', 'data', 'hora_inicio', 'hora_fim', 'duracao_horas', 'local', 'local_id', 'descricao'];
const assinatura = (d: DiariaDados) => JSON.stringify(CAMPOS.map(c => (c === 'hora_inicio' || c === 'hora_fim') ? (d[c] || '').slice(0, 5) : (d[c] ?? '')));

const dataPorExtenso = (d?: string | null) => {
  if (!d) return 'Data a definir';
  const s = new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const ROTULO = 'text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest';
const ATALHO = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lumos border border-lumos-border text-[11px] font-bold text-lumos-text-primary hover:border-lumos-yellow/60 transition-colors';

export default function DiariaModal({ projectId, diariaId, inicial, canManage, mostrarProjeto, onClose, onMudou }: Props) {
  const { profile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const catalogo = useCatalogoDeEscala(projectId);

  const [id, setId] = useState<string | null>(diariaId);
  const [form, setForm] = useState<DiariaDados>(() => ({ duracao_horas: 10, ...(inicial || {}) }));
  const [salvo, setSalvo] = useState<DiariaDados | null>(null);       // como está no banco
  const [base, setBase] = useState(() => assinatura({ duracao_horas: 10, ...(inicial || {}) }));
  const [carregando, setCarregando] = useState(!!diariaId);
  const [salvando, setSalvando] = useState(false);

  const [membros, setMembros] = useState<MembroDiaria[]>([]);
  const [escolhidos, setEscolhidos] = useState<Escolhido[]>([]);      // diária nova: equipe que entra ao salvar
  const [escalaIndisponivel, setEscalaIndisponivel] = useState(false);
  const [adicionando, setAdicionando] = useState(false);

  const [projeto, setProjeto] = useState<{ nome: string | null; clienteId: string | null; clienteNome: string | null }>({ nome: null, clienteId: null, clienteNome: null });
  const [local, setLocal] = useState<Local | null>(null);
  const [clima, setClima] = useState<PrevisaoDia | null>(null);
  const [ordem, setOrdem] = useState<{ id: string; titulo: string } | null>(null);

  useEffect(() => {
    supabase.from('projects').select('name, client_id, clients(name)').eq('id', projectId).maybeSingle()
      .then(({ data }) => {
        const d = data as any;
        setProjeto({ nome: d?.name ?? null, clienteId: d?.client_id ?? null, clienteNome: (Array.isArray(d?.clients) ? d.clients[0]?.name : d?.clients?.name) ?? null });
      });
  }, [projectId]);

  const carregarEquipe = useCallback(async (dId: string) => {
    const eq = await supabase.from('diaria_members').select(SELECT_DE_MEMBROS).eq('diaria_id', dId);
    if (eq.error) { setEscalaIndisponivel(true); return; }
    setEscalaIndisponivel(false);
    setMembros((eq.data as unknown as MembroDiaria[]) || []);
  }, []);

  // Carrega a diária que já existe (só na abertura: depois o formulário é de quem está digitando).
  useEffect(() => {
    if (!diariaId) return;
    let vivo = true;
    (async () => {
      const { data, error } = await supabase.from('project_diarias').select('*').eq('id', diariaId).maybeSingle();
      if (!vivo) return;
      if (error || !data) { toast.error('Não foi possível abrir a diária.'); onClose(); return; }
      const d = data as DiariaDados;
      setForm(d); setSalvo(d); setBase(assinatura(d)); setCarregando(false);
      carregarEquipe(diariaId);
      // Ordem do dia que nasceu desta diária (a coluna pode não existir antes da migration).
      const od = await supabase.from('ordens_do_dia').select('id, titulo').eq('diaria_id', diariaId).limit(1);
      if (vivo && !od.error) setOrdem((od.data?.[0] as { id: string; titulo: string }) || null);
    })();
    return () => { vivo = false; };
  }, [diariaId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Observações e endereço do local cadastrado (acompanha o que está escolhido no formulário).
  useEffect(() => {
    if (!form.local_id) { setLocal(null); return; }
    let vivo = true;
    supabase.from('locais').select('id, nome, endereco, observacoes, client_id').eq('id', form.local_id).maybeSingle()
      .then(({ data }) => { if (vivo) setLocal((data as Local) || null); });
    return () => { vivo = false; };
  }, [form.local_id]);

  // Previsão do tempo da diária como está salva (não a cada tecla).
  useEffect(() => {
    setClima(null);
    if (!salvo?.local || !salvo.data) return;
    if (salvo.local_id && local?.id !== salvo.local_id) return;   // espera o endereço do local cadastrado
    let vivo = true;
    previsaoParaDiaria(consultaDeClima(salvo.local_id ? local : null, salvo.local) || salvo.local, salvo.data)
      .then(({ dados }) => { if (vivo) setClima(dados); });
    return () => { vivo = false; };
  }, [salvo?.local, salvo?.data, salvo?.local_id, local?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sujo = canManage && !carregando && (assinatura(form) !== base || (!id && escolhidos.length > 0));
  const fechar = () => {
    if (sujo && !confirm('Fechar sem salvar? O que você mudou nesta diária se perde.')) return;
    onClose();
  };
  const irPara = (url: string) => {
    if (sujo && !confirm('Sair sem salvar? O que você mudou nesta diária se perde.')) return;
    onClose();
    navigate(url);
  };

  const mudar = (parte: DiariaDados) => setForm(f => ({ ...f, ...parte }));

  // Conflito segue a data que está no formulário (avisa antes mesmo de salvar a troca de data).
  const conflitos = useConflitosDoDia(carregando ? null : form.data, id, projectId);

  // ── mensagem para WhatsApp: sempre com o que está salvo (a equipe é salva na hora) ──
  const copiarParaWhatsApp = async () => {
    if (!salvo) return;
    const endereco = salvo.local_id && local?.id === salvo.local_id ? local.endereco : null;
    const texto = montarMensagemDaDiaria({
      nome: salvo.nome || 'Diária', projeto: projeto.nome, data: salvo.data,
      horaInicio: salvo.hora_inicio, horaFim: salvo.hora_fim, local: salvo.local, endereco,
      equipe: membros.map(m => ({ nome: nomeDoMembro(m), funcao: m.funcao || '' })),
    });
    try {
      await navigator.clipboard.writeText(texto);
      toast.success(sujo ? 'Mensagem copiada com os dados salvos. As alterações ainda não salvas ficaram de fora.' : 'Mensagem copiada. É só colar no WhatsApp ✓');
    } catch {
      toast.error('Não consegui copiar a mensagem neste navegador.');
    }
  };

  // ── equipe ───────────────────────────────────────────────────────────
  const jaEscalados = new Set(id ? membros.map(chaveDoMembro) : escolhidos.map(e => chaveDaPessoa(e.pessoa)));

  const escalar = async (p: PessoaCatalogo) => {
    if (!id) { setEscolhidos(l => [...l, { pessoa: p, funcao: p.funcao || '' }]); return; }
    const { error } = await supabase.from('diaria_members').insert({
      diaria_id: id,
      user_id: p.tipo === 'user' ? p.id : null,
      freela_id: p.tipo === 'freela' ? p.id : null,
      funcao: p.funcao || null,
      added_by: profile?.id || null,
    });
    if (error) { toast.error(`Não deu pra escalar: ${error.message}`); return; }
    await carregarEquipe(id);
    onMudou();
  };

  const tirar = async (m: MembroDiaria) => {
    const { error } = await supabase.from('diaria_members').delete().eq('id', m.id);
    if (error) { toast.error('Não foi possível remover da escala.'); return; }
    await carregarEquipe(m.diaria_id);
    onMudou();
  };

  const salvarFuncao = async (m: MembroDiaria, funcao: string) => {
    if ((m.funcao || '') === funcao.trim()) return;
    const { error } = await supabase.from('diaria_members').update({ funcao: funcao.trim() || null }).eq('id', m.id);
    if (error) { toast.error('Não foi possível salvar a função.'); return; }
    await carregarEquipe(m.diaria_id);
    onMudou();
  };

  // ── salvar / excluir / duplicar ──────────────────────────────────────
  const salvar = async () => {
    if (!form.nome?.trim()) { toast.error('Dê um nome pra diária.'); return; }
    if (horarioInvalido(form.hora_inicio, form.hora_fim)) { toast.error('Início e fim não podem ser iguais. Se termina de madrugada, ponha o horário do dia seguinte (ex.: 20:00 → 04:00).'); return; }
    setSalvando(true);
    const payload = {
      project_id: projectId,
      nome: form.nome.trim(),
      data: form.data || null,
      hora_inicio: form.hora_inicio || null,
      hora_fim: form.hora_fim || null,
      // com início e fim, a duração sai da conta; senão vale o que digitaram
      duracao_horas: duracaoDaDiaria(form.hora_inicio, form.hora_fim) ?? (Number(form.duracao_horas) || 10),
      local: form.local?.trim() || null,
      local_id: form.local?.trim() ? (form.local_id || null) : null,
      descricao: form.descricao?.trim() || null,
    };
    const gravar = async (pl: Record<string, unknown>) => id
      ? await supabase.from('project_diarias').update(pl).eq('id', id).select('id').maybeSingle()
      : await supabase.from('project_diarias').insert([{ ...pl, created_by: profile?.id || null }]).select('id').single();
    let res = await gravar(payload);
    // Se a migration dos horários ainda não rodou, salva sem eles em vez de quebrar.
    if (res.error && /hora_inicio|hora_fim/.test(res.error.message)) {
      const { hora_inicio: _a, hora_fim: _b, ...semHoras } = payload;
      res = await gravar(semHoras);
      if (!res.error) toast.error('Diária salva sem horário: falta rodar a migração dos horários no banco.');
    }
    // Se a migration dos locais ainda não rodou, salva sem a ligação em vez de quebrar.
    if (res.error && /local_id/.test(res.error.message)) {
      const { local_id: _c, ...semLocalId } = payload;
      res = await gravar(semLocalId);
    }
    if (res.error || !res.data) {
      setSalvando(false);
      toast.error(`Não foi possível salvar a diária${res.error ? `: ${res.error.message}` : '.'}`);
      return;
    }
    const salvaId = (res.data as { id: string }).id;

    // Diária nova: a equipe escolhida entra agora que ela existe.
    if (!id && escolhidos.length > 0) {
      const { error } = await supabase.from('diaria_members').insert(escolhidos.map(e => ({
        diaria_id: salvaId,
        user_id: e.pessoa.tipo === 'user' ? e.pessoa.id : null,
        freela_id: e.pessoa.tipo === 'freela' ? e.pessoa.id : null,
        funcao: e.funcao.trim() || null,
        added_by: profile?.id || null,
      })));
      if (error) toast.error(`Diária criada, mas a equipe não entrou: ${error.message}. Abra a diária e escale de novo.`);
    }

    setSalvando(false);
    onMudou();
    onClose();
    // Diária no calendário da produção: melhor esforço, sem travar o fluxo.
    if (payload.data) {
      supabase.functions.invoke('calendar-diaria', { body: { action: 'upsert', diaria_id: salvaId } })
        .then(({ data: r, error }) => {
          if (error || (r as any)?.error) toast.error('Diária salva, mas o Google Calendar não aceitou. Confere a conexão do calendário.');
          else if ((r as any)?.event_id) { toast.success('Diária no Google Calendar ✓'); onMudou(); }
        });
    }
  };

  const excluir = async () => {
    if (!id) return;
    if (!confirm(`Excluir a diária "${salvo?.nome || form.nome}"?`)) return;
    const { error } = await supabase.from('project_diarias').delete().eq('id', id);
    if (error) { toast.error('Não foi possível excluir.'); return; }
    if (salvo?.google_event_id) void supabase.functions.invoke('calendar-diaria', { body: { action: 'delete', event_id: salvo.google_event_id } });
    onMudou();
    onClose();
  };

  // A cópia leva os dados e a equipe, mas nada é gravado até clicar em Salvar (dá para tirar gente antes).
  const duplicar = () => {
    const equipe: Escolhido[] = membros.map(m => ({
      pessoa: { tipo: m.freela ? 'freela' : 'user', id: (m.freela?.id || m.user?.id)!, nome: nomeDoMembro(m) },
      funcao: m.funcao || '',
    }));
    setEscolhidos(equipe);
    setMembros([]);
    setId(null);
    setSalvo(null);
    setOrdem(null);
    setForm(f => ({ ...f, id: undefined, google_event_id: null, nome: `${f.nome} (cópia)` }));
  };

  const total = id ? membros.length : escolhidos.length;
  const passada = !!salvo?.data && salvo.data < hojeLocalISO();
  const chuva = (clima?.chanceChuva ?? 0) >= 30;
  const horas = salvo?.hora_inicio && salvo.hora_fim
    ? `${salvo.hora_inicio.slice(0, 5)} → ${salvo.hora_fim.slice(0, 5)}${viraODia(salvo.hora_inicio, salvo.hora_fim) ? ' (dia seguinte)' : ''}`
    : null;

  const cabecalho = (
    <div className="min-w-0">
      <p className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary truncate">{projeto.nome || 'Diária de gravação'}</p>
      <h3 className="text-lg font-black text-lumos-text-primary tracking-tight truncate">{id ? (salvo?.nome || 'Diária') : 'Nova diária'}</h3>
      {id && salvo && (
        <p className="text-[11.5px] text-lumos-text-secondary flex items-center gap-2 flex-wrap">
          <span>{dataPorExtenso(salvo.data)}{horas ? ` · ${horas}` : ''}</span>
          {passada && <span className="text-[9px] font-black uppercase text-green-500 border border-green-500/40 rounded-full px-2 py-0.5">Feita</span>}
          {chuva && !passada && <span className="text-[9px] font-black uppercase text-amber-500 border border-amber-500/40 rounded-full px-2 py-0.5">Chuva {clima!.chanceChuva}%</span>}
        </p>
      )}
    </div>
  );

  const rodape = canManage ? (
    <>
      <div className="mr-auto flex items-center gap-2">
        {id && (
          <>
            <button type="button" onClick={excluir} aria-label="Excluir diária" className="text-[11px] font-bold text-red-400 border border-red-500/40 rounded-lumos px-3 h-9 hover:bg-red-500/10 flex items-center gap-1.5">
              <Trash2 className="w-3.5 h-3.5" /> <span className="max-sm:sr-only">Excluir</span>
            </button>
            <button type="button" onClick={duplicar} aria-label="Duplicar diária" className="text-[11px] font-bold text-lumos-text-secondary border border-lumos-border rounded-lumos px-3 h-9 hover:text-lumos-text-primary flex items-center gap-1.5">
              <Copy className="w-3.5 h-3.5" /> <span className="max-sm:sr-only">Duplicar</span>
            </button>
          </>
        )}
      </div>
      <button type="button" onClick={fechar} className="text-[11px] font-bold text-lumos-text-secondary px-2">{sujo ? 'Cancelar' : 'Fechar'}</button>
      <button type="button" onClick={salvar} disabled={salvando || carregando}
        className="btn-primary h-9 px-5 text-xs font-black disabled:opacity-50 flex items-center gap-1.5">
        {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {id ? 'Salvar' : 'Criar diária'}
      </button>
    </>
  ) : undefined;

  return (
    <Modal isOpen portal onClose={fechar} title={id ? 'Diária' : 'Nova diária'} header={cabecalho} footer={rodape}
      maxWidth="max-w-3xl" padding="p-4 sm:p-5" fecharAoClicarFora={!sujo}>
      {carregando ? (
        <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-lumos-text-secondary" /></div>
      ) : (
        <div className="space-y-4">
          {/* Atalhos da diária */}
          {(id || mostrarProjeto) && (
            <div className="flex items-center gap-2 flex-wrap">
              {id && (ordem
                ? <button type="button" onClick={() => irPara(`/ordem-do-dia/${ordem.id}`)} className={ATALHO} title={ordem.titulo}><Clapperboard className="w-3.5 h-3.5" /> Abrir ordem do dia</button>
                : canManage && <button type="button" onClick={() => irPara(`/producao/projetos?projectId=${projectId}&tab=ordemdia`)} className={ATALHO}><Clapperboard className="w-3.5 h-3.5" /> Criar ordem do dia</button>)}
              {salvo?.local && (
                <a href={linkDoMapa(salvo.local)} target="_blank" rel="noopener noreferrer" className={ATALHO}>
                  <MapPin className="w-3.5 h-3.5" /> Abrir no mapa <ExternalLink className="w-3 h-3 text-lumos-text-secondary" />
                </a>
              )}
              {id && salvo && (
                <button type="button" onClick={copiarParaWhatsApp} className={ATALHO}><MessageCircle className="w-3.5 h-3.5" /> Copiar para WhatsApp</button>
              )}
              {mostrarProjeto && (
                <button type="button" onClick={() => irPara(`/producao/projetos?projectId=${projectId}&tab=diarias`)} className={ATALHO}><FolderOpen className="w-3.5 h-3.5" /> Abrir projeto</button>
              )}
              {salvo?.google_event_id && (
                <span className="ml-auto inline-flex items-center gap-1.5 text-[10.5px] font-bold text-green-600 dark:text-green-500"><CalendarCheck className="w-3.5 h-3.5" /> No Google Calendar</span>
              )}
            </div>
          )}

          {clima && !passada && (
            <p className={clsx('rounded-lumos border px-3 py-2 text-[11.5px] flex items-center gap-2',
              chuva ? 'border-amber-500/40 bg-amber-500/[0.07] text-lumos-text-primary' : 'border-lumos-border text-lumos-text-secondary')}>
              {chuva && <CloudRain className="w-4 h-4 text-amber-500 flex-shrink-0" />}
              Previsão: {clima.tempMin}° a {clima.tempMax}° · {clima.chanceChuva}% de chuva{clima.chuvaMm > 0 ? ` · ${clima.chuvaMm.toLocaleString('pt-BR')} mm` : ''}
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
            {/* ── Dados ── */}
            {canManage ? (
              <div className="space-y-3 min-w-0">
                <div>
                  <label className={ROTULO}>Nome</label>
                  <input autoFocus={!id} className="input-lumos w-full h-10 mt-1 text-sm" placeholder='Ex.: "Diária 1, Praia"'
                    value={form.nome || ''} onChange={e => mudar({ nome: e.target.value })} />
                </div>
                <div>
                  <label className={ROTULO}>Data prevista</label>
                  <input type="date" className="input-lumos w-full h-10 mt-1 text-sm"
                    value={form.data || ''} onChange={e => mudar({ data: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={ROTULO}>Início</label>
                    <input type="time" className="input-lumos w-full h-10 mt-1 text-sm"
                      value={(form.hora_inicio || '').slice(0, 5)} onChange={e => mudar({ hora_inicio: e.target.value })} />
                  </div>
                  <div>
                    <label className={ROTULO}>Fim</label>
                    <input type="time" className="input-lumos w-full h-10 mt-1 text-sm"
                      value={(form.hora_fim || '').slice(0, 5)} onChange={e => mudar({ hora_fim: e.target.value })} />
                  </div>
                </div>
                <p className="text-[10px] text-lumos-text-secondary -mt-1">Com horário, o evento entra no Google Calendar como compromisso com hora; sem, vira evento de dia inteiro. Se termina de madrugada, ponha o fim do dia seguinte (ex.: 20:00 → 04:00).</p>
                <SeletorDeLocal
                  clientId={projeto.clienteId}
                  clienteNome={projeto.clienteNome}
                  texto={form.local || ''}
                  localId={form.local_id || null}
                  onChange={(texto, localId) => mudar({ local: texto, local_id: localId })}
                />
                {local?.observacoes && <p className="text-[10.5px] text-lumos-text-secondary whitespace-pre-line leading-snug -mt-1">{local.observacoes}</p>}
                <div>
                  <label className={ROTULO}>Descrição</label>
                  <textarea rows={2} className="input-lumos w-full mt-1 text-sm resize-y" placeholder="O que se grava nessa diária"
                    value={form.descricao || ''} onChange={e => mudar({ descricao: e.target.value })} />
                </div>
              </div>
            ) : (
              <div className="space-y-2 min-w-0 text-[12.5px] text-lumos-text-primary">
                <p className={ROTULO}>Dados</p>
                <p>{dataPorExtenso(form.data)}{horas ? ` · ${horas}` : form.duracao_horas ? ` · ${Number(form.duracao_horas).toLocaleString('pt-BR')} horas` : ''}</p>
                {form.local && <p>{form.local}</p>}
                {local?.observacoes && <p className="text-[11px] text-lumos-text-secondary whitespace-pre-line">{local.observacoes}</p>}
                {form.descricao && <p className="text-lumos-text-secondary whitespace-pre-line">{form.descricao}</p>}
              </div>
            )}

            {/* ── Equipe ── */}
            {/* No celular, numa diária que já existe, a equipe vem primeiro (é o que mais se consulta). */}
            <div className={clsx('min-w-0 rounded-lumos border border-lumos-border p-3 space-y-2', id && 'max-md:order-first')}>
              <div className="flex items-center gap-2">
                <p className={clsx(ROTULO, 'flex items-center gap-1.5')}><Users2 className="w-3.5 h-3.5" /> Equipe da diária{total > 0 && ` · ${total}`}</p>
                {canManage && !escalaIndisponivel && (
                  <button type="button" onClick={() => setAdicionando(a => !a)}
                    className="ml-auto inline-flex items-center gap-1 text-[11px] font-black text-lumos-yellow hover:underline">
                    {adicionando ? <><X className="w-3 h-3" /> Fechar busca</> : <><UserPlus className="w-3 h-3" /> Adicionar</>}
                  </button>
                )}
              </div>

              {canManage && (
                <p className="text-[10px] text-lumos-text-secondary">
                  {id ? 'Mudanças na equipe são salvas na hora.' : 'A equipe entra quando você clicar em Criar diária.'}
                  {!id && !adicionando && escolhidos.some(e => e.pessoa.tipo === 'freela') && ' Fornecedor escalado em diária com data já agenda a cobrança de nota.'}
                </p>
              )}

              {adicionando && canManage && (
                <ListaDeEscalaveis catalogo={catalogo} jaEscalados={jaEscalados} conflitos={conflitos} onEscolher={escalar} alturaMax="max-h-52" />
              )}

              {escalaIndisponivel ? (
                <p className="text-[11px] text-lumos-text-secondary italic">Falta rodar a migration da escala no banco.</p>
              ) : total === 0 ? (
                <p className="text-[11px] text-lumos-text-secondary italic py-2">Ninguém escalado ainda.</p>
              ) : (
                <ul className="divide-y divide-lumos-border/50">
                  {(id
                    ? membros.map(m => ({
                        chave: m.id, pessoa: chaveDoMembro(m), nome: nomeDoMembro(m), fornecedor: !!m.freela, funcao: m.funcao || '',
                        aoSairDaFuncao: (v: string) => { void salvarFuncao(m, v); }, aoTirar: () => { void tirar(m); },
                      }))
                    : escolhidos.map(e => ({
                        chave: chaveDaPessoa(e.pessoa), pessoa: chaveDaPessoa(e.pessoa), nome: e.pessoa.nome, fornecedor: e.pessoa.tipo === 'freela', funcao: e.funcao,
                        aoSairDaFuncao: (v: string) => setEscolhidos(l => l.map(x => chaveDaPessoa(x.pessoa) === chaveDaPessoa(e.pessoa) ? { ...x, funcao: v } : x)),
                        aoTirar: () => setEscolhidos(l => l.filter(x => chaveDaPessoa(x.pessoa) !== chaveDaPessoa(e.pessoa))),
                      }))
                  ).map(l => (
                    <li key={l.chave} className="flex items-center gap-2 py-2">
                      <AvatarDaPessoa nome={l.nome} fornecedor={l.fornecedor} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-lumos-text-primary truncate">{l.nome}
                          <span className="ml-1.5 text-[9px] font-black uppercase text-lumos-text-secondary">{l.fornecedor ? 'Fornecedor' : 'Time'}</span>
                        </p>
                        {canManage ? (
                          <input key={`${l.chave}:${l.funcao}`} defaultValue={l.funcao} placeholder="Função nesta diária"
                            aria-label={`Função de ${l.nome} nesta diária`}
                            onBlur={e => l.aoSairDaFuncao(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                            className="w-full bg-transparent border-0 border-b border-transparent hover:border-lumos-border focus:border-lumos-yellow focus:ring-0 outline-none p-0 text-[11px] text-lumos-text-secondary focus:text-lumos-text-primary" />
                        ) : (
                          l.funcao && <p className="text-[11px] text-lumos-text-secondary truncate">{l.funcao}</p>
                        )}
                        <AvisoDeConflito onde={conflitos.get(l.pessoa)} />
                      </div>
                      {canManage && (
                        <button type="button" onClick={l.aoTirar} title="Tirar da escala" aria-label={`Tirar ${l.nome} da escala`}
                          className="p-1.5 rounded-full text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10 flex-shrink-0">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
