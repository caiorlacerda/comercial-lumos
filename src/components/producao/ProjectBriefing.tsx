import { useCallback, useEffect, useState } from 'react';
import { Check, FileText, FolderOpen, Loader2, Pencil, Plus, X } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import ProjectDocuments from '@/components/producao/ProjectDocuments';

/**
 * Briefing estruturado do projeto, nas 7 categorias do benchmark:
 * Contexto geral · Marca e mercado · Direcionamento estratégico · Público e
 * distribuição · Diretrizes criativas · Direção criativa · Riscos e pontos
 * críticos. Edição seção a seção, tudo em project_briefings.sections (jsonb).
 * Sub-abas: Geral (o briefing) e Arquivos (os documentos do projeto).
 */

interface Sections {
  // Contexto geral
  resumo: string; sobre_projeto: string;
  // Sobre a marca e mercado
  cliente: string; mercado: string; concorrentes: string[]; diferencial: string;
  // Direcionamento estratégico
  objetivos: string; mensagem: string;
  // Público e distribuição
  publico: string; canais: string[];
  // Diretrizes criativas
  aparecer: string[]; dos: string[]; donts: string[];
  // Direção criativa
  narrativa: string; mood: string[]; sentimento: string; estetica: string[]; referencias: string[];
  // Riscos e pontos críticos
  atencao: string[];
  confirmar: { t: string; done: boolean }[];
}
const VAZIO: Sections = {
  resumo: '', sobre_projeto: '', cliente: '', mercado: '', concorrentes: [], diferencial: '',
  objetivos: '', mensagem: '', publico: '', canais: [],
  aparecer: [], dos: [], donts: [],
  narrativa: '', mood: [], sentimento: '', estetica: [], referencias: [],
  atencao: [], confirmar: [],
};

interface Props {
  projectId: string;
  driveFolderId?: string | null;
  canManage: boolean;
}

export default function ProjectBriefing({ projectId, driveFolderId, canManage }: Props) {
  const { profile } = useAuth();
  const toast = useToast();
  const [subAba, setSubAba] = useState<'geral' | 'arquivos'>('geral');
  const [loading, setLoading] = useState(true);
  const [sec, setSec] = useState<Sections>(VAZIO);
  const [editando, setEditando] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('project_briefings')
      .select('sections').eq('project_id', projectId).maybeSingle();
    setSec({ ...VAZIO, ...((data?.sections as Partial<Sections>) || {}) });
    setLoading(false);
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const persist = async (novo: Sections) => {
    setSec(novo);
    const { error } = await supabase.from('project_briefings').upsert({
      project_id: projectId, sections: novo, updated_by: profile?.id || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'project_id' });
    if (error) toast.error('Não foi possível salvar o briefing.');
  };

  const LISTAS = ['concorrentes', 'canais', 'aparecer', 'dos', 'donts', 'mood', 'estetica', 'referencias', 'atencao'];
  const abrir = (campo: string, valor: string | string[]) => {
    if (!canManage) return;
    setEditando(campo);
    setDraft(Array.isArray(valor) ? valor.join('\n') : valor);
  };
  const salvar = () => {
    if (!editando) return;
    const novo = { ...sec } as any;
    if (LISTAS.includes(editando)) novo[editando] = draft.split('\n').map(s => s.trim()).filter(Boolean);
    else novo[editando] = draft.trim();
    setEditando(null);
    void persist(novo as Sections);
  };

  const toggleConfirmar = (i: number) => {
    if (!canManage) return;
    void persist({ ...sec, confirmar: sec.confirmar.map((c, j) => j === i ? { ...c, done: !c.done } : c) });
  };
  const addConfirmar = () => {
    const t = prompt('O que precisa ser confirmado com o cliente?');
    if (!t?.trim()) return;
    void persist({ ...sec, confirmar: [...sec.confirmar, { t: t.trim(), done: false }] });
  };
  const rmConfirmar = (i: number) => {
    void persist({ ...sec, confirmar: sec.confirmar.filter((_, j) => j !== i) });
  };

  if (loading) return <div className="card p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-lumos-yellow" /></div>;

  const vazio = !Object.entries(sec).some(([, v]) => Array.isArray(v) ? v.length : typeof v === 'string' && v.trim());

  // Card editável: texto corrido ou lista (1 item por linha).
  const Card = ({ campo, titulo, dica, lista, destaque, cor }: {
    campo: keyof Sections; titulo: string; dica: string; lista?: boolean; destaque?: boolean;
    cor?: 'ok' | 'bad';
  }) => {
    const valor = sec[campo] as string | string[];
    const tem = Array.isArray(valor) ? valor.length > 0 : !!(valor as string).trim();
    const emEdicao = editando === campo;
    return (
      <div className={clsx('card p-4', destaque && tem && 'border-lumos-yellow/50 bg-lumos-yellow/[0.04]')}>
        <div className="flex items-center gap-2 mb-2">
          <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">{titulo}</p>
          {canManage && !emEdicao && (
            <button type="button" onClick={() => abrir(campo, valor)}
              className="ml-auto p-1 rounded text-lumos-text-secondary hover:text-lumos-yellow" title="Editar">
              <Pencil className="w-3 h-3" />
            </button>
          )}
        </div>
        {emEdicao ? (
          <div>
            <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)}
              rows={Math.max(3, draft.split('\n').length + 1)}
              placeholder={lista ? 'Um item por linha' : dica}
              className="input-lumos w-full text-[13px] leading-relaxed resize-y" />
            <div className="flex gap-2 mt-2">
              <button type="button" onClick={salvar} className="bg-lumos-yellow text-black text-[10.5px] font-black rounded px-3 py-1.5 flex items-center gap-1"><Check className="w-3 h-3" /> Salvar</button>
              <button type="button" onClick={() => setEditando(null)} className="text-[10.5px] font-bold text-lumos-text-secondary px-2">Cancelar</button>
              {lista && <span className="ml-auto text-[10px] text-lumos-text-secondary self-center">um item por linha</span>}
            </div>
          </div>
        ) : !tem ? (
          <p className="text-[12px] text-lumos-text-secondary italic">{dica}</p>
        ) : lista ? (
          <ul className="space-y-1">
            {(valor as string[]).map((item, i) => (
              <li key={i} className="text-[12.5px] leading-snug flex gap-2 text-lumos-text-primary">
                <span className={clsx('mt-[7px] w-1.5 h-1.5 rounded-full flex-shrink-0',
                  cor === 'bad' ? 'bg-red-400' : cor === 'ok' ? 'bg-green-500' : 'bg-lumos-yellow')} />
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <p className={clsx('text-[13px] leading-relaxed whitespace-pre-wrap text-lumos-text-primary', destaque && 'font-bold italic')}>{valor as string}</p>
        )}
      </div>
    );
  };

  // Título de categoria, o esqueleto do benchmark.
  const Grupo = ({ n, titulo }: { n: string; titulo: string }) => (
    <div className="flex items-baseline gap-2.5 pt-2">
      <span className="text-[10px] font-black text-lumos-yellow tabular-nums">{n}</span>
      <h4 className="text-[13px] font-black uppercase tracking-wider text-lumos-text-primary">{titulo}</h4>
      <span className="flex-1 h-px bg-lumos-border" />
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Sub-abas do briefing */}
      <div className="flex gap-1 border-b border-lumos-border">
        {([['geral', 'Geral', FileText], ['arquivos', 'Arquivos', FolderOpen]] as const).map(([key, label, Icon]) => (
          <button key={key} type="button" onClick={() => setSubAba(key)}
            className={clsx('px-3.5 py-2 text-[11px] font-black uppercase tracking-wider border-b-2 flex items-center gap-1.5 transition-colors',
              subAba === key ? 'border-lumos-yellow text-lumos-yellow' : 'border-transparent text-lumos-text-secondary hover:text-lumos-text-primary')}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {subAba === 'arquivos' ? (
        <ProjectDocuments projectId={projectId} driveFolderId={driveFolderId} canManage={canManage} />
      ) : (
        <>
          {vazio && (
            <div className="rounded-lumos border border-amber-500/50 bg-amber-500/10 px-4 py-3">
              <p className="text-[12.5px] text-amber-800 dark:text-amber-200">
                <b>Briefing vazio.</b> Preencha as seções com o lápis de cada card, é o que a equipe consulta antes de criar, orçar e gravar. Com conteúdo aqui, a etapa "Briefing preenchido" do Status marca sozinha.
              </p>
            </div>
          )}

          <Grupo n="01" titulo="Contexto geral" />
          <Card campo="resumo" titulo="Resumo executivo" dica="O projeto em um parágrafo: o que é, pra quem, por quê." />
          <Card campo="sobre_projeto" titulo="Sobre o projeto" dica="A história do pedido: como chegou, o que o cliente imagina, o pano de fundo." />

          <Grupo n="02" titulo="Sobre a marca e mercado" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
            <Card campo="cliente" titulo="O cliente" dica="Quem é a marca, o que vende, como fala." />
            <Card campo="mercado" titulo="Mercado" dica="O momento do setor e a oportunidade que esse filme ataca." />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
            <Card campo="concorrentes" titulo="Concorrentes" dica="Quem disputa a mesma atenção, e o que andam fazendo." lista />
            <Card campo="diferencial" titulo="Diferencial" dica="O que só essa marca tem, e o filme precisa gritar." />
          </div>

          <Grupo n="03" titulo="Direcionamento estratégico" />
          <Card campo="objetivos" titulo="Objetivos" dica="O que o cliente quer alcançar com esse filme." />
          <Card campo="mensagem" titulo="Mensagem principal" dica="A frase que resume o que o filme precisa dizer." destaque />

          <Grupo n="04" titulo="Público e distribuição" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
            <Card campo="publico" titulo="Público-alvo" dica="Quem precisa ser tocado por esse filme." />
            <Card campo="canais" titulo="Canais de veiculação" dica="Onde vai rodar: TV, YouTube, Reels, TikTok, OOH…" lista />
          </div>

          <Grupo n="05" titulo="Diretrizes criativas" />
          <Card campo="aparecer" titulo="Precisa aparecer" dica="O que não pode faltar em tela: produto, marca, locação, pessoas." lista />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
            <Card campo="dos" titulo="Do's" dica="O que buscar: tom, estética, momentos." lista cor="ok" />
            <Card campo="donts" titulo="Don'ts" dica="O que evitar a qualquer custo." lista cor="bad" />
          </div>

          <Grupo n="06" titulo="Direção criativa" />
          <Card campo="narrativa" titulo="Narrativa" dica="O arco da história: começo, meio e fim em poucas linhas." />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
            <Card campo="mood" titulo="Mood e linguagem" dica="Adjetivos do filme: solar, cru, elegante, acelerado…" lista />
            <Card campo="estetica" titulo="Estética" dica="Fotografia, luz, paleta, proporções." lista />
          </div>
          <Card campo="sentimento" titulo="Sentimento esperado" dica="O que a pessoa tem que sentir ao terminar de assistir." destaque />
          <Card campo="referencias" titulo="Referências" dica="Filmes, campanhas e links que inspiram este projeto." lista />

          <Grupo n="07" titulo="Riscos e pontos críticos" />
          <Card campo="atencao" titulo="Pontos de atenção" dica="Riscos e cuidados: logística, clima, restrições do cliente." lista />

          <div className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">Informações a confirmar</p>
              {sec.confirmar.some(c => !c.done) && (
                <span className="text-[9.5px] font-black bg-lumos-yellow text-black rounded-full px-2 py-0.5 tabular-nums">
                  {sec.confirmar.filter(c => !c.done).length} pendente{sec.confirmar.filter(c => !c.done).length > 1 ? 's' : ''}
                </span>
              )}
              {canManage && (
                <button type="button" onClick={addConfirmar} className="ml-auto p-1 rounded text-lumos-text-secondary hover:text-lumos-yellow" title="Adicionar pergunta">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {sec.confirmar.length === 0 ? (
              <p className="text-[12px] text-lumos-text-secondary italic">Perguntas abertas pro cliente, pra nada ficar combinado só de boca.</p>
            ) : (
              <ul className="space-y-1.5">
                {sec.confirmar.map((c, i) => (
                  <li key={i} className="flex items-start gap-2.5 group">
                    <button type="button" onClick={() => toggleConfirmar(i)} disabled={!canManage}
                      className={clsx('w-[18px] h-[18px] rounded border-2 grid place-items-center flex-shrink-0 mt-[1px]',
                        c.done ? 'bg-green-600 border-green-600 text-white' : 'border-lumos-text-secondary/40')}>
                      {c.done && <Check className="w-3 h-3" />}
                    </button>
                    <span className={clsx('text-[12.5px] leading-snug flex-1', c.done ? 'line-through text-lumos-text-secondary' : 'text-lumos-text-primary')}>{c.t}</span>
                    {canManage && (
                      <button type="button" onClick={() => rmConfirmar(i)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-lumos-text-secondary hover:text-red-400" title="Remover">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
