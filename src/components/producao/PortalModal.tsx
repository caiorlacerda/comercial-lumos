import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Loader2, RefreshCw, Eye, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Select from '@/components/ui/Select';
import { useConfirm } from '@/components/ui/useConfirm';
import Modal from '@/components/common/Modal';

interface Blocks {
  escopo: boolean; cronograma: boolean; arquivos: boolean; atividade: boolean;
}
interface Portal {
  id: string; token: string; active: boolean; show_financeiro: boolean;
  contact_user_ids: string[]; blocks: Blocks; exige_login: boolean;
  last_opened_at: string | null; opened_count: number; antecedencia_dias: number;
  /** Libera a equipe de cada gravação no portal deste cliente. Só existe
   *  depois da migração 2026093336; antes dela, vem `undefined` e o
   *  interruptor aparece desligado, que é o padrão da coluna. */
  mostrar_equipe: boolean;
  /** Prazo (dias úteis) para o cliente revisar um vídeo; null = sem prazo.
   *  Só existe depois da migração 2026102406; antes dela a chave nem vem na
   *  leitura (`undefined`) e o campo some do modal. */
  prazo_revisao_dias?: number | null;
}
/** Pessoa do lado do cliente, com o que ela alcança. */
interface Pessoa {
  id: string; email: string; nome: string | null; ativo: boolean;
  last_login_at: string | null; projetos: string[];
}

// O que o cliente vê. O link agora é do CLIENTE, então isto vale para todos os
// projetos dele — o que entra ou sai de cada projeto é o interruptor de baixo.
const BLOCOS: { key: keyof Blocks; label: string; desc: string }[] = [
  { key: 'escopo', label: 'Pacote do mês', desc: 'o combinado e quanto já saiu, quando o projeto tem contrato por volume' },
  { key: 'cronograma', label: 'Onde o projeto está', desc: 'roteiro, captação, edição, sua revisão e entrega' },
  { key: 'arquivos', label: 'Arquivos', desc: 'documentos marcados como "Entrega (portal)"' },
  { key: 'atividade', label: 'Últimos dias', desc: 'o que foi entregue e aprovado, em todos os projetos' },
];
const BLOCKS_PADRAO: Blocks = { escopo: true, cronograma: true, arquivos: true, atividade: true };

/** Pendência do cliente inteiro (project_id nulo): vale para todos os projetos dele. */
interface PendenciaCliente { id: string; texto: string; prazo: string | null; concluida_em: string | null }
/** Banco ainda sem a tabela (migração não rodada): a seção some, sem erro. */
const faltaTabela = (e: { code?: string } | null) => e?.code === '42P01' || e?.code === 'PGRST205';

interface Props {
  /** Só para marcar "aberto" na lista, quando o modal vem de dentro de um projeto. */
  projectId?: string | null;
  clientId: string | null;
  clientName: string;
  open: boolean;
  onClose: () => void;
  /** Quem pode virar contato de atendimento. Sem isto, o modal busca sozinho. */
  teamUsers?: { id: string; full_name: string }[];
}

/**
 * O PORTAL É DO CLIENTE, NÃO DO PROJETO.
 *
 * Cliente com seis projetos recebia seis links. Agora é um só, com uma aba por
 * projeto. Por isso o modal se abre pelo cliente na sidebar, e não de dentro de
 * um projeto: tudo aqui vale para o cliente inteiro.
 */
export default function PortalModal({ projectId, clientId, clientName, open, onClose, teamUsers }: Props) {
  const { profile } = useAuth();
  const toast = useToast();
  const { confirm, dialog: dialogoConfirmar } = useConfirm();
  const [portal, setPortal] = useState<Portal | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const portalUrl = (t: string) => `${window.location.origin}/portal/${t}`;

  /**
   * Os projetos do cliente e o que entra no portal.
   *
   * O interruptor existia só pro projeto aberto, então escolher o que o cliente
   * vê exigia abrir projeto por projeto. Agora a escolha inteira é feita daqui.
   */
  const [projetos, setProjetos] = useState<{ id: string; name: string; status: string; portal_visivel: boolean; updated_at: string }[]>([]);

  /** Aberto pela sidebar não há lista de gente à mão, então busca aqui. */
  const [equipe, setEquipe] = useState<{ id: string; full_name: string }[]>(teamUsers || []);
  useEffect(() => {
    if (!open || teamUsers?.length) return;
    (async () => {
      const { data } = await supabase.from('app_users')
        .select('id, full_name, hidden').eq('status', 'ativo').order('full_name');
      setEquipe(((data as any[]) || []).filter(u => !u.hidden));
    })();
  }, [open, teamUsers]);

  const carregarProjetos = useCallback(async () => {
    if (!clientId) { setProjetos([]); return; }
    const { data } = await supabase.from('projects')
      .select('id, name, status, portal_visivel, updated_at')
      .eq('client_id', clientId)
      .order('status')
      .order('created_at', { ascending: false });
    setProjetos((data as any[]) || []);
  }, [clientId]);
  useEffect(() => { if (open) carregarProjetos(); }, [open, carregarProjetos]);

  const trocarVisivel = async (id: string, novo: boolean) => {
    setProjetos(prev => prev.map(p => (p.id === id ? { ...p, portal_visivel: novo } : p)));
    const { error } = await supabase.from('projects').update({ portal_visivel: novo }).eq('id', id);
    if (error) { carregarProjetos(); toast.error('Não foi possível salvar.'); return; }
  };

  /**
   * As pessoas do cliente. Sem projeto marcado, a pessoa vê todos — o caso
   * comum não dá trabalho, e restringir é o que exige um clique.
   */
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [novoEmail, setNovoEmail] = useState('');
  const [novoNome, setNovoNome] = useState('');
  const [abrindoPessoa, setAbrindoPessoa] = useState<string | null>(null);

  const carregarPessoas = useCallback(async () => {
    if (!clientId) { setPessoas([]); return; }
    const { data } = await supabase.from('client_users')
      .select('id, email, nome, ativo, last_login_at').eq('client_id', clientId).order('created_at');
    const lista = (data as any[]) || [];
    const { data: vinc } = lista.length
      ? await supabase.from('client_user_projects').select('client_user_id, project_id').in('client_user_id', lista.map(p => p.id))
      : { data: [] as any[] };
    setPessoas(lista.map(p => ({
      ...p, projetos: (vinc || []).filter((v: any) => v.client_user_id === p.id).map((v: any) => v.project_id),
    })));
  }, [clientId]);
  useEffect(() => { if (open) carregarPessoas(); }, [open, carregarPessoas]);

  const adicionarPessoa = async () => {
    const email = novoEmail.trim().toLowerCase();
    if (!clientId || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast.error('Escreva um e-mail válido.'); return; }
    const { error } = await supabase.from('client_users')
      .insert({ client_id: clientId, email, nome: novoNome.trim() || null, created_by: profile?.id ?? null });
    if (error) {
      toast.error(/duplicate|unique/i.test(error.message) ? 'Esse e-mail já está na lista.' : 'Não foi possível adicionar.');
      return;
    }
    setNovoEmail(''); setNovoNome('');
    carregarPessoas();
  };

  const removerPessoa = async (p: Pessoa) => {
    if (!await confirm({
      title: `Tirar ${p.nome || p.email} do portal`,
      message: 'Ela perde o acesso na próxima vez que entrar. Nada do que ela aprovou é apagado.',
      confirmLabel: 'Tirar', danger: true,
    })) return;
    const { error } = await supabase.from('client_users').delete().eq('id', p.id);
    if (error) { toast.error('Não foi possível tirar.'); return; }
    carregarPessoas();
  };

  const trocarProjetoDaPessoa = async (p: Pessoa, projectId: string, ligar: boolean) => {
    setPessoas(prev => prev.map(x => x.id === p.id
      ? { ...x, projetos: ligar ? [...x.projetos, projectId] : x.projetos.filter(i => i !== projectId) }
      : x));
    const { error } = ligar
      ? await supabase.from('client_user_projects').insert({ client_user_id: p.id, project_id: projectId })
      : await supabase.from('client_user_projects').delete().eq('client_user_id', p.id).eq('project_id', projectId);
    if (error) { toast.error('Não foi possível salvar.'); carregarPessoas(); }
  };

  /**
   * O que precisamos do cliente, valendo para todos os projetos dele
   * (pendências sem projeto). As de um projeto só ficam na página do projeto.
   * Se a tabela ainda não existe no banco, a seção simplesmente não aparece.
   */
  const toastRef = useRef(toast);
  toastRef.current = toast; // o objeto do toast muda a cada render; a ref evita recriar o carregador
  const [pendCliente, setPendCliente] = useState<PendenciaCliente[]>([]);
  const [pendPronta, setPendPronta] = useState(false);
  const [semTabelaPend, setSemTabelaPend] = useState(false);
  const [novaPendTexto, setNovaPendTexto] = useState('');
  const [novaPendPrazo, setNovaPendPrazo] = useState('');
  const [salvandoPend, setSalvandoPend] = useState(false);
  const seqPend = useRef(0);

  const carregarPendCliente = useCallback(async () => {
    const minha = ++seqPend.current; // resposta atrasada não sobrescreve a mais nova
    if (!clientId) { setPendCliente([]); setPendPronta(false); return; }
    const { data, error } = await supabase.from('portal_pendencias')
      .select('id, texto, prazo, concluida_em')
      .eq('client_id', clientId).is('project_id', null).order('created_at');
    if (minha !== seqPend.current) return;
    if (faltaTabela(error)) { setSemTabelaPend(true); return; }
    if (error) { toastRef.current.error('Não foi possível carregar as pendências do cliente.'); setPendCliente([]); setPendPronta(true); return; }
    setSemTabelaPend(false);
    setPendCliente((data as PendenciaCliente[]) || []);
    setPendPronta(true);
  }, [clientId]);
  useEffect(() => {
    if (!open) return;
    setPendCliente([]);
    setPendPronta(false);
    // Falha de rede não pode virar promise sem tratamento.
    carregarPendCliente().catch(() => { toastRef.current.error('Não foi possível carregar as pendências do cliente.'); setPendCliente([]); setPendPronta(true); });
  }, [open, carregarPendCliente]);

  const adicionarPendCliente = async () => {
    if (!novaPendTexto.trim() || !clientId || salvandoPend) return;
    setSalvandoPend(true);
    const { error } = await supabase.from('portal_pendencias').insert({
      client_id: clientId, project_id: null, texto: novaPendTexto.trim().slice(0, 200),
      prazo: novaPendPrazo || null, created_by: profile?.id ?? null,
    });
    setSalvandoPend(false);
    if (error) { toast.error('Não foi possível salvar.'); return; }
    setNovaPendTexto(''); setNovaPendPrazo('');
    carregarPendCliente().catch(() => {});
  };
  const concluirPendCliente = async (id: string) => {
    const { error } = await supabase.from('portal_pendencias').update({ concluida_em: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error('Não foi possível salvar.'); return; }
    carregarPendCliente().catch(() => {});
  };
  const apagarPendCliente = async (p: PendenciaCliente) => {
    if (!await confirm({
      title: 'Apagar pendência',
      message: `Apagar "${p.texto}"? O cliente deixa de ver esse pedido.`,
      confirmLabel: 'Apagar', danger: true,
    })) return;
    const { error } = await supabase.from('portal_pendencias').delete().eq('id', p.id);
    if (error) { toast.error('Não foi possível apagar.'); return; }
    carregarPendCliente().catch(() => {});
  };

  /** Encerrado há mais de 90 dias sai do portal sozinho, mesmo ligado. */
  const foraPorTempo = (p: { status: string; updated_at: string }) =>
    p.status === 'concluido' && Date.now() - new Date(p.updated_at).getTime() > 90 * 86400000;

  const load = useCallback(async () => {
    if (!clientId) { setPortal(null); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from('client_portals')
      .select('*').eq('client_id', clientId).eq('active', true)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    setPortal((data as Portal) || null);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  // Folha de tela cheia: o fundo não rola junto.
  useEffect(() => {
    if (!open) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', aoTeclar);
    return () => { document.body.style.overflow = antes; window.removeEventListener('keydown', aoTeclar); };
  }, [open, onClose]);

  const create = async () => {
    if (!clientId) { toast.error('Sem cliente, não dá para gerar o portal.'); return; }
    setBusy(true);
    const { data, error } = await supabase.from('client_portals')
      .insert([{ client_id: clientId, created_by: profile?.id, contact_user_ids: profile?.id ? [profile.id] : [] }])
      .select('*').single();
    setBusy(false);
    if (error || !data) { toast.error('Não foi possível criar o portal.'); return; }
    setPortal(data as Portal);
    await navigator.clipboard.writeText(portalUrl((data as Portal).token)).catch(() => {});
    toast.success('Portal criado e link copiado ✓');
  };

  const copy = async () => {
    if (!portal) return;
    await navigator.clipboard.writeText(portalUrl(portal.token)).catch(() => {});
    toast.success('Link copiado ✓');
  };

  const patch = async (fields: Partial<Portal>, okMsg: string) => {
    if (!portal) return;
    const prev = portal;
    setPortal({ ...portal, ...fields });
    const { error } = await supabase.from('client_portals').update(fields).eq('id', portal.id);
    if (error) { setPortal(prev); toast.error('Não foi possível salvar.'); return; }
    toast.success(okMsg);
  };

  /**
   * Antecedência: input controlado, não `defaultValue`. Assim, se o `patch`
   * falhar, o campo volta sozinho pro valor de verdade (o `useEffect` segue
   * `portal.antecedencia_dias`, que o `patch` já reverte no erro) em vez de
   * ficar mostrando o número recusado até o modal fechar.
   */
  const [antecedenciaInput, setAntecedenciaInput] = useState('7');
  // Portal salvo antigamente com 0 ou 1 (antes do piso de 2 dias existir):
  // o servidor já aplica o piso na hora de calcular a data mais cedo pedível,
  // então o campo mostra o valor que vale de verdade, não o número cru salvo.
  useEffect(() => { setAntecedenciaInput(String(Math.max(2, portal?.antecedencia_dias ?? 7))); }, [portal?.antecedencia_dias]);

  const salvarAntecedencia = () => {
    if (!portal) return;
    const atual = portal.antecedencia_dias ?? 7;
    const n = Number(antecedenciaInput);
    // Texto ou campo vazio não é "0 dias", é "não digitei nada direito":
    // volta pro valor de verdade sem gravar lixo. Número válido é travado na
    // faixa de 2 a 60, porque `min`/`max` do <input> são só dica visual, e o
    // servidor tem piso de 2 dias mesmo que o portal peça menos.
    const valido = antecedenciaInput.trim() !== '' && Number.isFinite(n);
    const novo = valido ? Math.min(60, Math.max(2, Math.round(n))) : atual;
    setAntecedenciaInput(String(novo));
    if (novo === atual) return; // nada mudou: sem toast, sem chamada à toa
    patch({ antecedencia_dias: novo } as any, 'Antecedência salva.');
  };

  /**
   * Prazo de revisão: mesmo padrão da antecedência (input controlado que volta
   * sozinho ao valor real se o `patch` falhar). Diferenças: campo vazio é um
   * valor válido (sem prazo, grava null) e fora de 1 a 30 é recusado com aviso,
   * em vez de ser ajustado em silêncio.
   */
  const [prazoInput, setPrazoInput] = useState('');
  useEffect(() => { setPrazoInput(portal?.prazo_revisao_dias == null ? '' : String(portal.prazo_revisao_dias)); }, [portal?.prazo_revisao_dias]);

  const salvarPrazo = () => {
    if (!portal) return;
    const atual = portal.prazo_revisao_dias ?? null;
    const texto = prazoInput.trim();
    let novo: number | null = null;
    if (texto !== '') {
      const n = Number(texto);
      if (!Number.isFinite(n) || Math.round(n) < 1 || Math.round(n) > 30) {
        toast.error('O prazo precisa ficar entre 1 e 30 dias úteis. Deixe em branco para não ter prazo.');
        setPrazoInput(atual == null ? '' : String(atual));
        return;
      }
      novo = Math.round(n);
    }
    setPrazoInput(novo == null ? '' : String(novo));
    if (novo === atual) return; // nada mudou: sem toast, sem chamada à toa
    patch({ prazo_revisao_dias: novo }, novo == null ? 'Prazo removido: o cliente não vê data limite.' : 'Prazo salvo.');
  };

  // Revogar = desativa o link atual; gerar de novo cria token novo.
  const revoke = async () => {
    if (!portal) return;
    setBusy(true);
    const { error } = await supabase.from('client_portals').update({ active: false }).eq('id', portal.id);
    setBusy(false);
    if (error) { toast.error('Não foi possível revogar.'); return; }
    setPortal(null);
    toast.success('Link revogado. O cliente perdeu o acesso.');
  };

  if (!open) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Portal de ${clientName || 'cliente'}`}
      maxWidth="max-w-5xl"
      camada="z-[220]"
      portal
      header={(
        <div className="min-w-0">
          <h3 className="text-lg sm:text-xl font-black text-lumos-text-primary tracking-tight truncate">
            Portal de {clientName || 'cliente'}
          </h3>
          <p className="text-[11.5px] text-lumos-text-secondary mt-0.5">
            Um link só, com uma aba por projeto. O cliente acompanha as entregas, vê onde cada
            projeto está e aprova os vídeos por ali.
          </p>
        </div>
      )}
    >
      {dialogoConfirmar}
      <div className="space-y-5">

        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-lumos-yellow" /></div>
        ) : !portal ? (
          <div className="border border-dashed border-lumos-border rounded-lumos p-6 text-center">
            <p className="text-sm font-bold text-lumos-text-primary">
              {clientId ? `${clientName} ainda não tem portal.` : 'Este cliente ainda não existe por aqui.'}
            </p>
            <p className="text-xs text-lumos-text-secondary mt-1">O link é secreto e pode ser revogado a qualquer momento.</p>
            <button onClick={create} disabled={busy}
              className="btn-primary mt-4 px-5 h-10 text-sm font-black inline-flex items-center gap-2 disabled:opacity-60">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Gerar link do portal
            </button>
          </div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-5 lg:gap-6 items-start">
            <div className="space-y-5">
            {/* Link */}
            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Link do cliente</label>
              <div className="flex gap-2 mt-1.5">
                <input readOnly value={portalUrl(portal.token)} className="input-lumos flex-1 h-10 text-xs font-mono" onFocus={e => e.target.select()} />
                <button onClick={copy} className="btn-secondary h-10 px-3" title="Copiar"><Copy className="w-4 h-4" /></button>
                <a href={portalUrl(portal.token)} target="_blank" rel="noopener noreferrer" className="btn-secondary h-10 px-3 flex items-center" title="Abrir">
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
              <p className="text-[10.5px] text-lumos-text-secondary mt-1.5 flex items-center gap-1.5">
                <Eye className="w-3 h-3" />
                {portal.opened_count > 0
                  ? <>aberto {portal.opened_count}× · última vez {portal.last_opened_at ? new Date(portal.last_opened_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''}</>
                  : 'o cliente ainda não abriu'}
              </p>
            </div>

            {/* O que o cliente vê no Dashboard */}
            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">O que o cliente vê</label>
              <div className="mt-1.5 border border-lumos-border rounded-lumos divide-y divide-lumos-border/60">
                {BLOCOS.map(b => {
                  const blocks = { ...BLOCKS_PADRAO, ...(portal.blocks || {}) };
                  const on = blocks[b.key];
                  return (
                    <div key={b.key} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-lumos-text-primary">{b.label}</span>
                        <span className="block text-[10.5px] text-lumos-text-secondary">{b.desc}</span>
                      </span>
                      <button type="button"
                        onClick={() => patch({ blocks: { ...blocks, [b.key]: !on } }, on ? `"${b.label}" oculto pro cliente.` : `"${b.label}" visível pro cliente.`)}
                        className={clsx('w-10 h-5 rounded-full relative transition-colors flex-shrink-0', on ? 'bg-lumos-yellow' : 'bg-lumos-text-secondary/30')}>
                        <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', on ? 'left-5' : 'left-0.5')} />
                      </button>
                    </div>
                  );
                })}
                {/* Financeiro mora aqui junto, é só mais um bloco do dashboard */}
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-lumos-text-primary">Resumo financeiro</span>
                    <span className="block text-[10.5px] text-lumos-text-secondary">Sem valores: só "em dia" ou "pendente" + próximo vencimento.</span>
                  </span>
                  <button type="button" onClick={() => patch({ show_financeiro: !portal.show_financeiro }, portal.show_financeiro ? 'Financeiro oculto.' : 'Financeiro visível no portal.')}
                    className={clsx('w-10 h-5 rounded-full relative transition-colors flex-shrink-0', portal.show_financeiro ? 'bg-lumos-yellow' : 'bg-lumos-text-secondary/30')}>
                    <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', portal.show_financeiro ? 'left-5' : 'left-0.5')} />
                  </button>
                </div>
                {/* Equipe da gravação. Desligado, o nome de quem grava nem sai
                    do banco: a tela do cliente não recebe a lista. */}
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-lumos-text-primary">Equipe da gravação</span>
                    <span className="block text-[10.5px] text-lumos-text-secondary">Nome e função de quem grava, em todos os projetos deste cliente.</span>
                  </span>
                  <button type="button" onClick={() => patch({ mostrar_equipe: !portal.mostrar_equipe } as any, portal.mostrar_equipe ? 'Equipe oculta pro cliente.' : 'Equipe visível pro cliente.')}
                    className={clsx('w-10 h-5 rounded-full relative transition-colors flex-shrink-0', portal.mostrar_equipe ? 'bg-lumos-yellow' : 'bg-lumos-text-secondary/30')}>
                    <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', portal.mostrar_equipe ? 'left-5' : 'left-0.5')} />
                  </button>
                </div>
              </div>
            </div>

            {/* O que aparece dentro do portal */}
            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">
                Projetos que o cliente vê
              </label>
              <div className="mt-1.5 border border-lumos-border rounded-lumos divide-y divide-lumos-border/60 max-h-64 overflow-y-auto custom-scrollbar">
                {projetos.map(p => {
                  const fora = foraPorTempo(p);
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-lumos-text-primary truncate">
                          {p.name.trim()}
                          {p.id === projectId && <span className="ml-1.5 text-[9px] font-black uppercase text-lumos-yellow">aberto</span>}
                        </span>
                        <span className="block text-[10.5px] text-lumos-text-secondary">
                          {p.status === 'concluido'
                            ? (fora ? 'encerrado há mais de 90 dias, já não aparece' : 'encerrado, ainda aparece por 90 dias')
                            : 'ativo'}
                        </span>
                      </span>
                      <button type="button" disabled={fora}
                        onClick={() => trocarVisivel(p.id, !p.portal_visivel)}
                        title={fora ? 'Encerrado há mais de 90 dias: já saiu do portal' : undefined}
                        className={clsx('w-10 h-5 rounded-full relative transition-colors flex-shrink-0',
                          fora ? 'bg-lumos-text-secondary/15 cursor-not-allowed'
                            : p.portal_visivel ? 'bg-lumos-yellow' : 'bg-lumos-text-secondary/30')}>
                        <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all',
                          p.portal_visivel && !fora ? 'left-5' : 'left-0.5')} />
                      </button>
                    </div>
                  );
                })}
                {!projetos.length && (
                  <p className="px-3.5 py-3 text-[11.5px] text-lumos-text-secondary">Este cliente não tem projeto nenhum.</p>
                )}
              </div>
              <p className="text-[10.5px] text-lumos-text-secondary mt-1.5">
                Desligado, o projeto some da lista de abas do cliente. Nada é apagado.
              </p>
            </div>

            {/* O que precisamos do cliente, em todos os projetos dele */}
            {clientId && !semTabelaPend && pendPronta && (
              <div>
                <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">
                  O que precisamos do cliente (vale para todos os projetos)
                </label>
                <div className="mt-1.5 border border-lumos-border rounded-lumos divide-y divide-lumos-border/60">
                  {pendCliente.filter(p => !p.concluida_em).map(p => (
                    <div key={p.id} className="flex items-center gap-2 px-3.5 py-2.5">
                      <span className="flex-1 min-w-0 text-xs font-bold text-lumos-text-primary break-words">
                        {p.texto}{p.prazo && <span className="font-normal text-[10.5px] text-lumos-text-secondary"> · até {p.prazo.split('-').reverse().join('/')}</span>}
                      </span>
                      <button type="button" onClick={() => concluirPendCliente(p.id)}
                        aria-label={`Marcar como feita: "${p.texto}"`} title="Marcar como feita"
                        className="h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary">
                        <Check className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => apagarPendCliente(p)}
                        aria-label={`Apagar: "${p.texto}"`} title="Apagar"
                        className="h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-red-400">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {pendCliente.filter(p => !p.concluida_em).length === 0 && (
                    <p className="px-3.5 py-3 text-[11.5px] text-lumos-text-secondary">Nenhuma pendência em aberto.</p>
                  )}
                  <div className="flex items-end gap-2 px-3.5 py-2.5 flex-wrap">
                    <input value={novaPendTexto} onChange={e => setNovaPendTexto(e.target.value)} maxLength={200}
                      onKeyDown={e => { if (e.key === 'Enter') adicionarPendCliente(); }}
                      placeholder="Ex.: enviar logo em vetor" aria-label="Nova pendência do cliente"
                      className="input-lumos h-10 text-xs flex-1 min-w-[10rem]" />
                    <label className="flex flex-col gap-0.5 text-[10px] font-bold text-lumos-text-secondary">
                      Prazo (opcional)
                      <input type="date" value={novaPendPrazo} onChange={e => setNovaPendPrazo(e.target.value)}
                        aria-label="Prazo (opcional)" title="Prazo (opcional)"
                        className="input-lumos h-10 text-xs" />
                    </label>
                    <button type="button" onClick={adicionarPendCliente} disabled={!novaPendTexto.trim() || salvandoPend}
                      className="btn-primary h-10 px-4 text-xs font-black disabled:opacity-60">
                      {salvandoPend ? 'Salvando…' : 'Adicionar'}
                    </button>
                  </div>
                </div>
                <p className="text-[10.5px] text-lumos-text-secondary mt-1.5">
                  Aparece para o cliente em todos os projetos dele. Pedido de um projeto só vai na página do projeto.
                </p>
              </div>
            )}

            </div>

            <div className="space-y-5">
            {/* Quem entra, e o que cada um alcança */}
            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Quem entra no portal</label>
              <div className="mt-1.5 border border-lumos-border rounded-lumos">
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 border-b border-lumos-border/60">
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-lumos-text-primary">Exigir login por pessoa</span>
                    <span className="block text-[10.5px] text-lumos-text-secondary">
                      Ligado, o link sozinho para de abrir: cada pessoa entra com o e-mail dela e vê só o que você marcar.
                    </span>
                  </span>
                  <button type="button"
                    onClick={() => patch({ exige_login: !portal.exige_login } as any,
                      portal.exige_login ? 'Link aberto de novo pra quem tem o endereço.' : 'Agora só entra quem está na lista.')}
                    className={clsx('w-10 h-5 rounded-full relative transition-colors flex-shrink-0', portal.exige_login ? 'bg-lumos-yellow' : 'bg-lumos-text-secondary/30')}>
                    <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', portal.exige_login ? 'left-5' : 'left-0.5')} />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 border-t border-lumos-border/60">
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-lumos-text-primary">Antecedência para pedir diária</span>
                    <span className="block text-[10.5px] text-lumos-text-secondary">
                      Dias de folga entre hoje e a data que o cliente consegue pedir, no mínimo dois, mesmo que você escolha menos.
                    </span>
                  </span>
                  <input type="number" min={2} max={60} value={antecedenciaInput}
                    onChange={e => setAntecedenciaInput(e.target.value)}
                    onBlur={salvarAntecedencia}
                    className="input-lumos w-16 h-8 text-[11px] text-center py-0 flex-shrink-0" />
                </div>

                {/* Só aparece se a leitura do portal trouxe a coluna: antes da
                    migração 2026102406 a chave não existe e o campo some. */}
                {'prazo_revisao_dias' in portal && (
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 border-t border-lumos-border/60">
                    <span className="min-w-0">
                      <label htmlFor="portal-prazo-revisao" className="block text-xs font-bold text-lumos-text-primary">Prazo para o cliente revisar (dias úteis)</label>
                      <span className="block text-[10.5px] text-lumos-text-secondary">
                        Vídeos esperando o cliente mostram 'Responder até…'. Em branco = sem prazo. Sábado e domingo não contam.
                      </span>
                    </span>
                    <input id="portal-prazo-revisao" type="number" min={1} max={30} step={1} inputMode="numeric" placeholder="sem prazo" value={prazoInput}
                      onChange={e => setPrazoInput(e.target.value)}
                      onBlur={salvarPrazo}
                      className="input-lumos w-16 h-8 text-[11px] text-center py-0 flex-shrink-0" />
                  </div>
                )}

                <div className="divide-y divide-lumos-border/60">
                  {pessoas.map(p => (
                    <div key={p.id} className="px-3.5 py-2.5">
                      <div className="flex items-center gap-3">
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-bold text-lumos-text-primary truncate">{p.nome || p.email}</span>
                          <span className="block text-[10.5px] text-lumos-text-secondary truncate">
                            {p.nome ? `${p.email} · ` : ''}
                            {p.projetos.length ? `${p.projetos.length} projeto(s)` : 'todos os projetos'}
                            {p.last_login_at ? ` · entrou ${new Date(p.last_login_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}` : ' · ainda não entrou'}
                          </span>
                        </span>
                        <button type="button" onClick={() => setAbrindoPessoa(a => (a === p.id ? null : p.id))}
                          className="text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary flex-shrink-0">
                          {abrindoPessoa === p.id ? 'fechar' : 'projetos'}
                        </button>
                        <button type="button" onClick={() => removerPessoa(p)} title="Tirar do portal"
                          className="p-1 text-lumos-text-secondary hover:text-red-400 flex-shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {abrindoPessoa === p.id && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {projetos.filter(x => x.portal_visivel).map(x => {
                            const on = p.projetos.includes(x.id);
                            return (
                              <button key={x.id} type="button"
                                onClick={() => trocarProjetoDaPessoa(p, x.id, !on)}
                                className={clsx('text-[11px] font-bold px-2.5 py-1 rounded-full border transition-colors',
                                  on ? 'bg-lumos-yellow/15 border-lumos-yellow/60 text-lumos-yellow'
                                     : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary')}>
                                {on && '✓ '}{x.name.trim()}
                              </button>
                            );
                          })}
                          <p className="text-[10.5px] text-lumos-text-secondary w-full mt-1">
                            Nenhum marcado: ela vê todos os projetos do portal.
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                  {!pessoas.length && (
                    <p className="px-3.5 py-3 text-[11.5px] text-lumos-text-secondary">
                      Ninguém cadastrado ainda. Enquanto o login estiver desligado, quem tiver o link entra.
                    </p>
                  )}
                </div>

                <div className="flex items-end gap-2 px-3.5 py-2.5 border-t border-lumos-border/60 flex-wrap">
                  <input value={novoEmail} onChange={e => setNovoEmail(e.target.value)}
                    type="email" placeholder="email@cliente.com.br"
                    onKeyDown={e => { if (e.key === 'Enter') adicionarPessoa(); }}
                    className="input-lumos h-9 text-xs flex-1 min-w-[180px]" />
                  <input value={novoNome} onChange={e => setNovoNome(e.target.value)}
                    placeholder="Nome (opcional)"
                    onKeyDown={e => { if (e.key === 'Enter') adicionarPessoa(); }}
                    className="input-lumos h-9 text-xs w-40" />
                  <button onClick={adicionarPessoa} className="btn-primary h-9 px-4 text-xs font-black">Adicionar</button>
                </div>
              </div>
            </div>

            {/* Contatos da aba Atendimento */}
            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Atendimento (quem o cliente pode chamar)</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {equipe.map(u => {
                  const sel = (portal.contact_user_ids || []).includes(u.id);
                  return (
                    <button key={u.id} type="button"
                      onClick={() => {
                        const atuais = portal.contact_user_ids || [];
                        const novos = sel ? atuais.filter(id => id !== u.id) : [...atuais, u.id];
                        patch({ contact_user_ids: novos }, sel ? `${u.full_name.split(' ')[0]} saiu do atendimento.` : `${u.full_name.split(' ')[0]} entrou no atendimento.`);
                      }}
                      className={clsx('text-[11px] font-bold px-3 py-1.5 rounded-full border transition-colors',
                        sel ? 'bg-lumos-yellow/15 border-lumos-yellow/60 text-lumos-yellow' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:border-lumos-yellow/40')}>
                      {sel && '✓ '}{u.full_name}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10.5px] text-lumos-text-secondary mt-1.5">
                {(portal.contact_user_ids || []).length === 0
                  ? 'Sem ninguém selecionado, a aba Atendimento fica vazia.'
                  : `${portal.contact_user_ids.length} pessoa(s) na aba Atendimento do cliente.`}
              </p>
            </div>

            {/* Revogar */}
            <div className="flex items-center justify-between gap-3 pt-1 border-t border-lumos-border/60">
              <p className="text-[10.5px] text-lumos-text-secondary">Revogar desativa este link na hora. Gerar de novo cria um link diferente.</p>
              <button onClick={revoke} disabled={busy}
                className="flex-shrink-0 text-[11px] font-bold text-red-400 border border-red-500/40 rounded-lumos px-3 py-2 hover:bg-red-500/10 disabled:opacity-60 flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Revogar link
              </button>
            </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
