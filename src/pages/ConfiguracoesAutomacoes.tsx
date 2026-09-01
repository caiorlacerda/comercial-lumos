import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  ArrowLeft, AlertTriangle, Bot, Check, Eye, Headset, Loader2, RefreshCw, Users2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';

/**
 * CONFIGURAÇÕES → AUTOMAÇÕES
 *
 * O app faz dezenas de coisas sozinho, e até aqui quem participava de cada uma
 * estava escrito no código: mudar o time era mudar código e fazer deploy. Esta
 * página mexe na tabela `automacoes` (migração 2026093340), onde os gatilhos
 * leem se devem rodar e com quem.
 *
 * Duas coisas que não podem se perder de vista:
 *
 * · Quem são os revisores fixos continua em `app_users.revisor_fixo`, o dado
 *   que já existe e que a ficha da pessoa em Usuários também edita. Aqui é só
 *   mais um lugar de onde mexer nele. Duas listas para a mesma verdade é como
 *   nasce divergência.
 * · Quem é o atendimento é marca do PROJETO (`project_members.e_atendimento`),
 *   não da pessoa: ela é o atendimento de um projeto e não de outro. Por isso
 *   essa escolha vive na aba Equipe do projeto, e aqui só se liga e desliga.
 *
 * A página tem que aguentar um banco onde a migração ainda não rodou: nesse
 * caso ela avisa o que falta, mostra o catálogo em leitura e não quebra nada.
 */

type Config = { user_ids?: string[] };
interface Linha { chave: string; ativa: boolean; config: Config }
interface Pessoa { id: string; full_name: string; job_title: string | null; revisor_fixo?: boolean }
interface Gatilho { gatilho: string; tabela: string; funcao: string; descricao: string | null }

/** Quem participa é escolhido aqui, na aba Equipe do projeto, ou em lugar nenhum. */
type Quem = 'revisores' | 'projeto' | 'lista' | null;

const CATALOGO: { chave: string; titulo: string; faz: string; quem: Quem }[] = [
  {
    chave: 'revisor_fixo',
    titulo: 'Revisor fixo acompanha toda revisão interna',
    faz: 'Quando um vídeo entra na revisão, quem for revisor fixo entra sozinho como colaborador da tarefa e recebe o aviso, sem precisar ser chamado. Sai sozinho quando a versão atual de todos os formatos da tarefa está aprovada, e quem foi posto à mão na tarefa nunca sai.',
    quem: 'revisores',
  },
  {
    chave: 'atendimento_com_cliente',
    titulo: 'Atendimento acompanha o vídeo que foi pro cliente',
    faz: 'Quando um vídeo passa para a revisão do cliente, quem estiver marcado como atendimento naquele projeto entra como colaborador da tarefa e recebe o aviso. Sai junto com o revisor fixo, quando todos os formatos da tarefa estão aprovados: enquanto o cliente pede alteração, o atendimento continua na tarefa.',
    quem: 'projeto',
  },
  {
    chave: 'recusado_volta_pro_editor',
    titulo: 'Vídeo recusado volta pro editor',
    faz: 'Vídeo que vai para alteração, interna ou do cliente, devolve a tarefa para quem subiu aquela versão. Se o nome de quem subiu não bater em exatamente uma pessoa ativa, o responsável fica como está.',
    quem: null,
  },
  {
    chave: 'pedido_diaria_avisa',
    titulo: 'Cliente pediu diária pelo portal',
    faz: 'Quando um cliente pede uma data de gravação pelo portal, o time é avisado na hora, com link para a aba de diárias do projeto.',
    quem: 'lista',
  },
  {
    chave: 'cliente_abriu_portal_avisa',
    titulo: 'Cliente abriu o portal',
    faz: 'Quando um cliente abre o portal, o time é avisado, no máximo uma vez por hora por cliente. Desligada, o portal abre igual e a contagem de aberturas continua sendo guardada.',
    quem: null,
  },
];

/** Erro de tabela ou função que ainda não existe no banco. */
function faltaNoBanco(err: { code?: string; message?: string } | null) {
  if (!err) return false;
  const code = err.code || '';
  const msg = err.message || '';
  return code === '42P01' || code === '42883' || code.startsWith('PGRST20')
    || /schema cache|does not exist|não existe/i.test(msg);
}

export default function ConfiguracoesAutomacoes() {
  const { profile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [carregando, setCarregando] = useState(true);
  const [semMigracao, setSemMigracao] = useState(false);
  const [linhas, setLinhas] = useState<Record<string, Linha>>({});
  const [salvando, setSalvando] = useState<string | null>(null);

  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [revisorOk, setRevisorOk] = useState(false);

  const [gatilhos, setGatilhos] = useState<Gatilho[]>([]);
  const [gatilhosAviso, setGatilhosAviso] = useState<string | null>(null);
  const [verGatilhos, setVerGatilhos] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);

    // 1) Estado das automações. Banco sem a tabela: a página avisa e segue.
    const { data: autos, error: erroAutos } = await supabase
      .from('automacoes').select('chave, ativa, config');
    if (erroAutos) {
      if (faltaNoBanco(erroAutos)) {
        setSemMigracao(true);
      } else {
        console.error('Erro ao ler automações:', erroAutos);
        toast.error('Não foi possível ler as automações.');
      }
      setLinhas({});
    } else {
      setSemMigracao(false);
      const mapa: Record<string, Linha> = {};
      for (const a of autos || []) {
        mapa[a.chave] = { chave: a.chave, ativa: !!a.ativa, config: (a.config || {}) as Config };
      }
      setLinhas(mapa);
    }

    // 2) O time, para as duas escolhas de gente. select('*') porque pedir
    //    revisor_fixo pelo nome derrubaria a consulta num banco atrasado.
    const { data: users, error: erroUsers } = await supabase
      .from('app_users').select('*').eq('status', 'ativo').order('full_name');
    if (erroUsers) {
      console.error('Erro ao ler o time:', erroUsers);
      toast.error('Não foi possível carregar a lista de pessoas.');
    } else {
      setPessoas((users || []).map(u => ({
        id: u.id, full_name: u.full_name, job_title: (u as any).job_title || null,
        revisor_fixo: (u as any).revisor_fixo ?? false,
      })));
      setRevisorOk(!!users?.length && 'revisor_fixo' in users[0]);
    }

    setCarregando(false);
    // Sem `toast` nas dependências de propósito: o contexto devolve um objeto
    // novo a cada render, e a carga entraria em laço infinito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // 3) A lista que a página só mostra, lida do catálogo do Postgres.
  const carregarGatilhos = useCallback(async () => {
    const { data, error } = await supabase.rpc('automacoes_do_banco');
    if (error) {
      setGatilhos([]);
      setGatilhosAviso(faltaNoBanco(error)
        ? 'A lista lida do banco chega junto com a migração 2026093340.'
        : 'Não foi possível ler os gatilhos do banco agora.');
      if (!faltaNoBanco(error)) console.error('Erro ao ler gatilhos:', error);
      return;
    }
    setGatilhosAviso(null);
    setGatilhos((data || []) as Gatilho[]);
  }, []);

  useEffect(() => { if (verGatilhos) carregarGatilhos(); }, [verGatilhos, carregarGatilhos]);

  const ativa = (chave: string) => linhas[chave]?.ativa ?? true; // ausente = ligada

  const alternar = async (chave: string) => {
    if (semMigracao) return;
    const nova = !ativa(chave);
    setSalvando(chave);
    const { error } = await supabase.from('automacoes').upsert({
      chave, ativa: nova, updated_at: new Date().toISOString(), updated_by: profile?.id ?? null,
    }, { onConflict: 'chave' });
    setSalvando(null);
    if (error) {
      console.error('Erro ao salvar automação:', error);
      toast.error(error.code === '42501'
        ? 'Só administradores mudam automação.'
        : 'Não foi possível salvar. Tente de novo.');
      return;
    }
    setLinhas(l => ({ ...l, [chave]: { chave, ativa: nova, config: l[chave]?.config || {} } }));
    toast.success(nova ? 'Automação ligada ✓' : 'Automação desligada');
  };

  const salvarConfig = async (chave: string, config: Config) => {
    if (semMigracao) return;
    setSalvando(chave);
    const { error } = await supabase.from('automacoes').upsert({
      chave, ativa: ativa(chave), config: config as any,
      updated_at: new Date().toISOString(), updated_by: profile?.id ?? null,
    }, { onConflict: 'chave' });
    setSalvando(null);
    if (error) {
      console.error('Erro ao salvar quem participa:', error);
      toast.error(error.code === '42501'
        ? 'Só administradores mudam automação.'
        : 'Não foi possível salvar quem participa.');
      return;
    }
    setLinhas(l => ({ ...l, [chave]: { chave, ativa: ativa(chave), config } }));
  };

  // Revisor fixo mexe em app_users.revisor_fixo, o dado que já existe.
  const alternarRevisor = async (p: Pessoa) => {
    const nova = !p.revisor_fixo;
    setSalvando('revisor_fixo');
    const { error } = await supabase.from('app_users')
      .update({ revisor_fixo: nova }).eq('id', p.id);
    setSalvando(null);
    if (error) {
      console.error('Erro ao mudar revisor fixo:', error);
      toast.error('Não foi possível mudar o revisor fixo.');
      return;
    }
    setPessoas(list => list.map(x => x.id === p.id ? { ...x, revisor_fixo: nova } : x));
    toast.success(nova
      ? `${p.full_name.split(' ')[0]} passa a acompanhar toda revisão ✓`
      : `${p.full_name.split(' ')[0]} não acompanha mais toda revisão`);
  };

  const Interruptor = ({ chave }: { chave: string }) => (
    <button
      type="button"
      onClick={() => alternar(chave)}
      disabled={semMigracao || salvando === chave}
      aria-label={ativa(chave) ? 'Desligar automação' : 'Ligar automação'}
      className={clsx(
        'relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50',
        ativa(chave) ? 'bg-lumos-yellow' : 'bg-lumos-border',
        semMigracao ? 'cursor-not-allowed' : 'cursor-pointer',
      )}
    >
      <span className={clsx(
        'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
        ativa(chave) ? 'translate-x-4 bg-black' : 'translate-x-0',
      )} />
    </button>
  );

  const Chip = ({ ligado, texto, sub, onClick, disabled }: {
    ligado: boolean; texto: string; sub?: string | null; onClick: () => void; disabled?: boolean;
  }) => (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className={clsx(
        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] font-bold transition-colors disabled:opacity-50',
        ligado
          ? 'bg-lumos-yellow/15 text-lumos-yellow border-lumos-yellow/30'
          : 'text-lumos-text-secondary border-lumos-border hover:border-lumos-yellow/40 hover:text-lumos-text-primary',
      )}
    >
      {ligado && <Check className="w-3 h-3 flex-shrink-0" />}
      <span className="truncate max-w-[9rem]">{texto}</span>
      {sub && <span className="text-[9px] font-black uppercase opacity-60 hidden sm:inline">{sub}</span>}
    </button>
  );

  const QuemParticipa = ({ chave, quem }: { chave: string; quem: Quem }) => {
    if (quem === null) return null;

    if (quem === 'projeto') {
      return (
        <div className="pt-3 border-t border-lumos-border/50">
          <p className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary mb-1.5">
            Quem participa
          </p>
          <p className="text-[12px] text-lumos-text-secondary flex items-start gap-1.5">
            <Headset className="w-3.5 h-3.5 text-lumos-yellow flex-shrink-0 mt-0.5" />
            <span>
              Quem é o atendimento muda de projeto para projeto, então a marca fica lá: abra o projeto, aba Equipe, e
              marque "Atendimento" na pessoa. Aqui só se liga e desliga a automação.
            </span>
          </p>
        </div>
      );
    }

    if (quem === 'revisores') {
      return (
        <div className="pt-3 border-t border-lumos-border/50">
          <p className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary mb-1.5">
            Quem são os revisores fixos
          </p>
          {!revisorOk ? (
            <p className="text-[12px] text-lumos-text-secondary italic">
              A marca de revisor fixo ainda não existe neste banco.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {pessoas.map(p => (
                  <Chip
                    key={p.id}
                    ligado={!!p.revisor_fixo}
                    texto={p.full_name}
                    sub={p.job_title}
                    disabled={salvando === 'revisor_fixo'}
                    onClick={() => alternarRevisor(p)}
                  />
                ))}
              </div>
              <p className="text-[10.5px] text-lumos-text-secondary mt-2">
                É a mesma marca que aparece na ficha da pessoa em Usuários, não uma lista à parte.
              </p>
            </>
          )}
        </div>
      );
    }

    // quem === 'lista': escolha guardada em automacoes.config.user_ids
    const escolhidos = linhas[chave]?.config?.user_ids || [];
    const alternarPessoa = (id: string) => {
      const novos = escolhidos.includes(id) ? escolhidos.filter(x => x !== id) : [...escolhidos, id];
      salvarConfig(chave, { ...(linhas[chave]?.config || {}), user_ids: novos });
    };
    return (
      <div className="pt-3 border-t border-lumos-border/50">
        <p className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary mb-1.5">
          Quem é avisado
        </p>
        <div className="flex flex-wrap gap-1.5">
          {pessoas.map(p => (
            <Chip
              key={p.id}
              ligado={escolhidos.includes(p.id)}
              texto={p.full_name}
              sub={p.job_title}
              disabled={semMigracao || salvando === chave}
              onClick={() => alternarPessoa(p.id)}
            />
          ))}
        </div>
        <p className="text-[10.5px] text-lumos-text-secondary mt-2">
          {escolhidos.length === 0
            ? 'Ninguém escolhido: o aviso continua indo para administradores e gestão de produção, como sempre foi.'
            : `${escolhidos.length} ${escolhidos.length === 1 ? 'pessoa avisada' : 'pessoas avisadas'}, e só ${escolhidos.length === 1 ? 'ela' : 'elas'}.`}
        </p>
      </div>
    );
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 font-work-sans pb-10">
      {/* Cabeçalho */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-lumos-bg rounded-full text-lumos-text-secondary transition-colors cursor-pointer"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-black text-lumos-text-primary tracking-tight">Automações</h1>
          <p className="text-lumos-text-secondary mt-1 font-medium text-sm">
            O que o app faz sozinho, e com quem. Mudar aqui vale na hora, sem deploy.
          </p>
        </div>
      </div>

      {semMigracao && (
        <div className="card border-amber-500/30 bg-amber-500/5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-black text-lumos-text-primary">A migração ainda não rodou</p>
            <p className="text-[13px] text-lumos-text-secondary mt-1">
              Rode <code className="font-mono text-[12px] text-lumos-yellow">supabase/migrations/2026093340_automacoes.sql</code> no
              Supabase para poder ligar e desligar por aqui. Até lá tudo continua como está hoje: automação que não está na
              tabela é tratada como ligada, e nada deixa de funcionar.
            </p>
            <button onClick={carregar} className="btn-secondary h-8 px-3 text-xs mt-3 inline-flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Conferir de novo
            </button>
          </div>
        </div>
      )}

      {carregando ? (
        <div className="card p-12 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-lumos-yellow mx-auto" />
        </div>
      ) : (
        <div className="space-y-3">
          {CATALOGO.map(a => (
            <div key={a.chave} className="card space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Bot className={clsx('w-4 h-4 flex-shrink-0', ativa(a.chave) ? 'text-lumos-yellow' : 'text-lumos-text-secondary')} />
                    <h2 className="text-sm font-black text-lumos-text-primary">{a.titulo}</h2>
                  </div>
                  <p className="text-[13px] text-lumos-text-secondary mt-1.5 leading-relaxed">{a.faz}</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <Interruptor chave={a.chave} />
                  <span className={clsx('text-[9px] font-black uppercase tracking-wide',
                    ativa(a.chave) ? 'text-lumos-yellow' : 'text-lumos-text-secondary')}>
                    {ativa(a.chave) ? 'Ligada' : 'Desligada'}
                  </span>
                </div>
              </div>
              <QuemParticipa chave={a.chave} quem={a.quem} />
            </div>
          ))}

          {/* O resto do que o app faz sozinho, lido do banco */}
          <div className="card space-y-3">
            <button
              type="button"
              onClick={() => setVerGatilhos(v => !v)}
              className="w-full flex items-center gap-2 text-left cursor-pointer"
            >
              <Eye className="w-4 h-4 text-lumos-yellow flex-shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-black text-lumos-text-primary">
                  O resto do que o app faz sozinho
                </span>
                <span className="block text-[12px] text-lumos-text-secondary mt-0.5">
                  Lido do catálogo do banco, não de uma lista escrita à mão. Só para ver, mudar exige código.
                </span>
              </span>
              <span className="ml-auto text-[10px] font-black uppercase text-lumos-text-secondary flex-shrink-0">
                {verGatilhos ? 'Esconder' : 'Ver'}
              </span>
            </button>

            {verGatilhos && (
              gatilhosAviso ? (
                <p className="text-[12px] text-lumos-text-secondary italic">{gatilhosAviso}</p>
              ) : gatilhos.length === 0 ? (
                <p className="text-[12px] text-lumos-text-secondary italic">Nenhum gatilho encontrado.</p>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary">
                    {gatilhos.length} gatilhos no banco
                  </p>
                  {gatilhos.map(g => (
                    <div key={`${g.tabela}.${g.gatilho}`} className="border border-lumos-border/60 rounded-lumos p-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Users2 className="w-3 h-3 text-lumos-text-secondary flex-shrink-0" />
                        <span className="font-mono text-[11px] text-lumos-text-primary break-all">{g.gatilho}</span>
                        <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-lumos-yellow/10 text-lumos-yellow">
                          {g.tabela}
                        </span>
                      </div>
                      <p className="text-[11.5px] text-lumos-text-secondary mt-1">
                        {g.descricao || <span className="italic opacity-70">Sem descrição no banco ainda.</span>}
                      </p>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
