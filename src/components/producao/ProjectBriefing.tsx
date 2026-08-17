import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, Loader2, Pencil, Plus, X } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';

/**
 * Briefing estruturado do projeto, nas 7 categorias do benchmark, em sanfona.
 * Card e Grupo vivem FORA do componente da página de propósito: definidos
 * inline, cada tecla digitada re-renderizava o pai, remontava o textarea e o
 * cursor voltava pro início — o texto saía invertido. Aqui o estado local de
 * edição sobrevive às re-renderizações do pai.
 */

interface Sections {
  resumo: string; sobre_projeto: string;
  cliente: string; mercado: string; concorrentes: string[]; diferencial: string;
  objetivos: string; mensagem: string;
  publico: string; canais: string[];
  aparecer: string[]; dos: string[]; donts: string[];
  narrativa: string; mood: string[]; sentimento: string; estetica: string[]; referencias: string[];
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

// Card editável (texto corrido ou lista, 1 item por linha). Estado próprio.
function Card({ titulo, dica, valor, lista, cor, destaque, canManage, onSave }: {
  titulo: string; dica: string; valor: string | string[];
  lista?: boolean; cor?: 'ok' | 'bad'; destaque?: boolean; canManage: boolean;
  onSave: (v: string | string[]) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [draft, setDraft] = useState('');
  const tem = Array.isArray(valor) ? valor.length > 0 : !!valor.trim();
  const salvar = () => {
    setEditando(false);
    onSave(lista ? draft.split('\n').map(s => s.trim()).filter(Boolean) : draft.trim());
  };
  return (
    <div className={clsx('card p-4', destaque && tem && 'border-lumos-yellow/50 bg-lumos-yellow/[0.04]')}>
      <div className="flex items-center gap-2 mb-2">
        <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">{titulo}</p>
        {canManage && !editando && (
          <button type="button" onClick={() => { setDraft(Array.isArray(valor) ? valor.join('\n') : valor); setEditando(true); }}
            className="ml-auto p-1 rounded text-lumos-text-secondary hover:text-lumos-yellow" title="Editar">
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </div>
      {editando ? (
        <div>
          <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)}
            rows={Math.max(3, draft.split('\n').length + 1)}
            placeholder={lista ? 'Um item por linha' : dica}
            className="input-lumos w-full text-[13px] leading-relaxed resize-y" />
          <div className="flex gap-2 mt-2">
            <button type="button" onClick={salvar} className="bg-lumos-yellow text-black text-[10.5px] font-black rounded px-3 py-1.5 flex items-center gap-1"><Check className="w-3 h-3" /> Salvar</button>
            <button type="button" onClick={() => setEditando(false)} className="text-[10.5px] font-bold text-lumos-text-secondary px-2">Cancelar</button>
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
}

// Cabeçalho de categoria da sanfona, com contador de seções preenchidas.
function Grupo({ n, titulo, cheios, total, aberto, onToggle, children }: {
  n: string; titulo: string; cheios: number; total: number; aberto: boolean;
  onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="card overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-lumos-text-primary/[0.03] transition-colors">
        <span className="text-[10px] font-black text-lumos-yellow tabular-nums">{n}</span>
        <h4 className="text-[12.5px] font-black uppercase tracking-wider text-lumos-text-primary">{titulo}</h4>
        <span className={clsx('text-[10px] font-bold tabular-nums rounded-full px-2 py-0.5',
          cheios > 0 ? 'bg-lumos-yellow/15 text-lumos-yellow' : 'bg-lumos-text-secondary/10 text-lumos-text-secondary')}>
          {cheios}/{total}
        </span>
        <ChevronDown className={clsx('w-4 h-4 text-lumos-text-secondary ml-auto transition-transform flex-shrink-0', aberto && 'rotate-180')} />
      </button>
      {aberto && <div className="px-3 pb-3 space-y-3 border-t border-lumos-border/60 pt-3">{children}</div>}
    </div>
  );
}

interface Props { projectId: string; canManage: boolean }

export default function ProjectBriefing({ projectId, canManage }: Props) {
  const { profile } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [sec, setSec] = useState<Sections>(VAZIO);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const toggleGrupo = (n: string) => setAbertos(prev => {
    const novo = new Set(prev);
    if (novo.has(n)) novo.delete(n); else novo.add(n);
    return novo;
  });

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
  const salvarCampo = (campo: keyof Sections) => (v: string | string[]) =>
    void persist({ ...sec, [campo]: v } as Sections);

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

  const temValor = (campo: keyof Sections) => {
    const v = sec[campo] as unknown;
    return Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.trim().length > 0;
  };
  const cheios = (campos: (keyof Sections)[]) => campos.filter(temValor).length;
  const vazio = !(Object.keys(sec) as (keyof Sections)[]).some(temValor);

  return (
    <div className="space-y-2.5">
      {vazio && (
        <div className="rounded-lumos border border-amber-500/50 bg-amber-500/10 px-4 py-3">
          <p className="text-[12.5px] text-amber-800 dark:text-amber-200">
            <b>Briefing vazio.</b> Abra cada categoria e preencha com o lápis dos cards, é o que a equipe consulta antes de criar, orçar e gravar. Com conteúdo aqui, a etapa "Briefing preenchido" do Status marca sozinha.
          </p>
        </div>
      )}

      <Grupo n="01" titulo="Contexto geral" cheios={cheios(['resumo', 'sobre_projeto'])} total={2} aberto={abertos.has('01')} onToggle={() => toggleGrupo('01')}>
        <Card titulo="Resumo executivo" dica="O projeto em um parágrafo: o que é, pra quem, por quê." valor={sec.resumo} canManage={canManage} onSave={salvarCampo('resumo')} />
        <Card titulo="Sobre o projeto" dica="A história do pedido: como chegou, o que o cliente imagina, o pano de fundo." valor={sec.sobre_projeto} canManage={canManage} onSave={salvarCampo('sobre_projeto')} />
      </Grupo>

      <Grupo n="02" titulo="Sobre a marca e mercado" cheios={cheios(['cliente', 'mercado', 'concorrentes', 'diferencial'])} total={4} aberto={abertos.has('02')} onToggle={() => toggleGrupo('02')}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          <Card titulo="O cliente" dica="Quem é a marca, o que vende, como fala." valor={sec.cliente} canManage={canManage} onSave={salvarCampo('cliente')} />
          <Card titulo="Mercado" dica="O momento do setor e a oportunidade que esse filme ataca." valor={sec.mercado} canManage={canManage} onSave={salvarCampo('mercado')} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          <Card titulo="Concorrentes" dica="Quem disputa a mesma atenção, e o que andam fazendo." valor={sec.concorrentes} lista canManage={canManage} onSave={salvarCampo('concorrentes')} />
          <Card titulo="Diferencial" dica="O que só essa marca tem, e o filme precisa gritar." valor={sec.diferencial} canManage={canManage} onSave={salvarCampo('diferencial')} />
        </div>
      </Grupo>

      <Grupo n="03" titulo="Direcionamento estratégico" cheios={cheios(['objetivos', 'mensagem'])} total={2} aberto={abertos.has('03')} onToggle={() => toggleGrupo('03')}>
        <Card titulo="Objetivos" dica="O que o cliente quer alcançar com esse filme." valor={sec.objetivos} canManage={canManage} onSave={salvarCampo('objetivos')} />
        <Card titulo="Mensagem principal" dica="A frase que resume o que o filme precisa dizer." valor={sec.mensagem} destaque canManage={canManage} onSave={salvarCampo('mensagem')} />
      </Grupo>

      <Grupo n="04" titulo="Público e distribuição" cheios={cheios(['publico', 'canais'])} total={2} aberto={abertos.has('04')} onToggle={() => toggleGrupo('04')}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          <Card titulo="Público-alvo" dica="Quem precisa ser tocado por esse filme." valor={sec.publico} canManage={canManage} onSave={salvarCampo('publico')} />
          <Card titulo="Canais de veiculação" dica="Onde vai rodar: TV, YouTube, Reels, TikTok, OOH…" valor={sec.canais} lista canManage={canManage} onSave={salvarCampo('canais')} />
        </div>
      </Grupo>

      <Grupo n="05" titulo="Diretrizes criativas" cheios={cheios(['aparecer', 'dos', 'donts'])} total={3} aberto={abertos.has('05')} onToggle={() => toggleGrupo('05')}>
        <Card titulo="Precisa aparecer" dica="O que não pode faltar em tela: produto, marca, locação, pessoas." valor={sec.aparecer} lista canManage={canManage} onSave={salvarCampo('aparecer')} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          <Card titulo="Do's" dica="O que buscar: tom, estética, momentos." valor={sec.dos} lista cor="ok" canManage={canManage} onSave={salvarCampo('dos')} />
          <Card titulo="Don'ts" dica="O que evitar a qualquer custo." valor={sec.donts} lista cor="bad" canManage={canManage} onSave={salvarCampo('donts')} />
        </div>
      </Grupo>

      <Grupo n="06" titulo="Direção criativa" cheios={cheios(['narrativa', 'mood', 'estetica', 'sentimento', 'referencias'])} total={5} aberto={abertos.has('06')} onToggle={() => toggleGrupo('06')}>
        <Card titulo="Narrativa" dica="O arco da história: começo, meio e fim em poucas linhas." valor={sec.narrativa} canManage={canManage} onSave={salvarCampo('narrativa')} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          <Card titulo="Mood e linguagem" dica="Adjetivos do filme: solar, cru, elegante, acelerado…" valor={sec.mood} lista canManage={canManage} onSave={salvarCampo('mood')} />
          <Card titulo="Estética" dica="Fotografia, luz, paleta, proporções." valor={sec.estetica} lista canManage={canManage} onSave={salvarCampo('estetica')} />
        </div>
        <Card titulo="Sentimento esperado" dica="O que a pessoa tem que sentir ao terminar de assistir." valor={sec.sentimento} destaque canManage={canManage} onSave={salvarCampo('sentimento')} />
        <Card titulo="Referências" dica="Filmes, campanhas e links que inspiram este projeto." valor={sec.referencias} lista canManage={canManage} onSave={salvarCampo('referencias')} />
      </Grupo>

      <Grupo n="07" titulo="Riscos e pontos críticos" cheios={cheios(['atencao', 'confirmar'])} total={2} aberto={abertos.has('07')} onToggle={() => toggleGrupo('07')}>
        <Card titulo="Pontos de atenção" dica="Riscos e cuidados: logística, clima, restrições do cliente." valor={sec.atencao} lista canManage={canManage} onSave={salvarCampo('atencao')} />

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
      </Grupo>
    </div>
  );
}
