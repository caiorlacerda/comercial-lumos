import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays, Clapperboard, ClipboardList, Layers,
  List, LayoutGrid, Loader2, Search, Send, Video,
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Select from '@/components/ui/Select';
import CalendarioEventos, { BarraDoCalendario } from '@/components/agenda/CalendarioEventos';
import { useDiasFechados } from '@/components/agenda/useDiasFechados';
import {
  DIAS_LONGOS as DIAS, MESES_CURTOS as MESES, addDias, diasDaJanela, domingoDe, hojeIso, isoDe as iso,
  type EventoCal, type Granularidade,
} from '@/components/agenda/calendario';

/**
 * AGENDA — o calendário geral da produção, no formato do benchmark: tudo que
 * tem data num lugar só (diárias, ordens do dia, prazos de tarefa e entregas
 * ao cliente), com três visualizações (calendário, lista e kanban),
 * granularidade mês/semana/dia, botão Hoje, filtros por tipo e projeto, e o
 * seletor Agenda Geral × Minha Agenda. O calendário é o mesmo das Diárias do
 * projeto (src/components/agenda): Semana e Dia em grade de horas.
 */

type Tipo = 'diaria' | 'ordem' | 'tarefa' | 'entrega';
interface Item {
  id: string;           // id composto tipo:id
  tipo: Tipo;
  titulo: string;
  data: string;         // AAAA-MM-DD
  hora?: string | null; // HH:MM quando existe
  duracaoMin?: number | null; // duração planejada (diárias), quando não há hora de fim
  horaFim?: string | null; // HH:MM do fim, quando existe (menor que o início = dia seguinte)
  projeto?: string | null;
  projectId?: string | null;
  respId?: string | null;
  link: string;
  atrasado?: boolean;
}

const TIPOS: Record<Tipo, { label: string; cor: string; chip: string; Icon: any }> = {
  diaria:  { label: 'Diárias',  cor: '#EFC700', chip: 'bg-lumos-yellow/15 text-lumos-yellow border-lumos-yellow/40', Icon: Video },
  ordem:   { label: 'Ordens do dia', cor: '#a855f7', chip: 'bg-purple-500/15 text-purple-500 border-purple-500/40', Icon: Clapperboard },
  tarefa:  { label: 'Prazos de tarefa', cor: '#38bdf8', chip: 'bg-sky-500/15 text-sky-500 border-sky-500/40', Icon: ClipboardList },
  entrega: { label: 'Entregas ao cliente', cor: '#f87171', chip: 'bg-red-500/15 text-red-500 border-red-500/40', Icon: Send },
};

const ROTULO_CURTO = (t: Tipo) => TIPOS[t].label.replace(/s$/, '').replace(' ao cliente', '').replace(' de tarefa', '');

export default function Agenda() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [itens, setItens] = useState<Item[]>([]);
  const [minhasTarefas, setMinhasTarefas] = useState<Set<string>>(new Set());

  // preferências de exibição (persistem por navegador)
  const [visao, setVisao] = useState<'calendario' | 'lista' | 'kanban'>(() => {
    try { return (localStorage.getItem('lumos_agenda_visao') as any) || 'calendario'; } catch { return 'calendario'; }
  });
  const [gran, setGran] = useState<Granularidade>(() => {
    try { return (localStorage.getItem('lumos_agenda_gran') as any) || 'semana'; } catch { return 'semana'; }
  });
  const [agenda, setAgenda] = useState<'geral' | 'minha'>('geral');
  const [cursor, setCursor] = useState(() => new Date());
  const diaFechado = useDiasFechados();
  const [tiposAtivos, setTiposAtivos] = useState<Set<Tipo>>(new Set(['diaria', 'ordem', 'tarefa', 'entrega']));
  const [projetoFiltro, setProjetoFiltro] = useState('');
  const [busca, setBusca] = useState('');

  const mudarVisao = (v: typeof visao) => { setVisao(v); try { localStorage.setItem('lumos_agenda_visao', v); } catch { /* ignora */ } };
  const mudarGran = (g: Granularidade) => { setGran(g); try { localStorage.setItem('lumos_agenda_gran', g); } catch { /* ignora */ } };

  const load = useCallback(async () => {
    // hora_entrega pode ainda não existir no banco (migration pendente) — cai
    // pro select sem a coluna em vez de deixar a Agenda vazia.
    const buscarTarefas = async () => {
      const q = await supabase.from('project_tasks')
        .select('id, titulo, status, data_fim, hora_entrega, data_entrega_cliente, responsavel_id, project_id, projects(name)')
        .is('deleted_at', null);
      if (!q.error) return q;
      return supabase.from('project_tasks')
        .select('id, titulo, status, data_fim, data_entrega_cliente, responsavel_id, project_id, projects(name)')
        .is('deleted_at', null);
    };
    // Horário de fim das diárias e das ODs: se a coluna não existir, cai pro select antigo.
    const comPlanoB = async (tabela: string, completo: string, simples: string) => {
      const q = await supabase.from(tabela).select(completo);
      return q.error ? supabase.from(tabela).select(simples) : q;
    };
    const [tarefasQ, diariasQ, ordensQ, collabsQ] = await Promise.all([
      buscarTarefas(),
      comPlanoB('project_diarias', 'id, nome, data, hora_inicio, hora_fim, duracao_horas, project_id, projects(name)', 'id, nome, data, hora_inicio, project_id, projects(name)'),
      comPlanoB('ordens_do_dia', 'id, titulo, data_producao, hora_inicio, hora_fim, project_id, projects(name)', 'id, titulo, data_producao, project_id, projects(name)'),
      profile?.id
        ? supabase.from('task_collaborators').select('task_id').eq('user_id', profile.id)
        : Promise.resolve({ data: [] as { task_id: string }[] }),
    ]);

    const hoje = hojeIso();
    const ABERTAS = ['na_fila', 'roteiro', 'captacao', 'em_progresso', 'revisao_interna', 'revisao_cliente', 'alteracoes'];
    const lista: Item[] = [];

    for (const t of (tarefasQ.data as any[]) || []) {
      const aberta = ABERTAS.includes(t.status);
      if (t.data_fim) lista.push({
        id: `tarefa:${t.id}`, tipo: 'tarefa', titulo: t.titulo, data: t.data_fim,
        hora: t.hora_entrega ? String(t.hora_entrega).slice(0, 5) : null,
        projeto: t.projects?.name || null, projectId: t.project_id, respId: t.responsavel_id,
        link: `/producao/projetos?projectId=${t.project_id}&taskId=${t.id}`,
        atrasado: aberta && t.data_fim < hoje,
      });
      if (t.data_entrega_cliente) lista.push({
        id: `entrega:${t.id}`, tipo: 'entrega', titulo: t.titulo, data: t.data_entrega_cliente,
        projeto: t.projects?.name || null, projectId: t.project_id, respId: t.responsavel_id,
        link: `/producao/projetos?projectId=${t.project_id}&taskId=${t.id}`,
        atrasado: aberta && t.data_entrega_cliente < hoje,
      });
    }
    for (const d of (diariasQ.data as any[]) || []) {
      if (!d.data) continue;
      lista.push({
        id: `diaria:${d.id}`, tipo: 'diaria', titulo: d.nome, data: d.data,
        hora: d.hora_inicio ? String(d.hora_inicio).slice(0, 5) : null,
        horaFim: d.hora_fim ? String(d.hora_fim).slice(0, 5) : null,
        duracaoMin: d.duracao_horas ? Math.round(Number(d.duracao_horas) * 60) : null,
        projeto: d.projects?.name || null, projectId: d.project_id,
        link: `/producao/projetos?projectId=${d.project_id}&tab=diarias`,
      });
    }
    for (const o of (ordensQ.data as any[]) || []) {
      if (!o.data_producao) continue;
      lista.push({
        id: `ordem:${o.id}`, tipo: 'ordem', titulo: o.titulo, data: o.data_producao,
        hora: o.hora_inicio ? String(o.hora_inicio).slice(0, 5) : null,
        horaFim: o.hora_fim ? String(o.hora_fim).slice(0, 5) : null,
        projeto: o.projects?.name || null, projectId: o.project_id,
        link: `/ordem-do-dia/${o.id}`,
      });
    }
    setItens(lista);
    setMinhasTarefas(new Set(((collabsQ.data as any[]) || []).map(c => c.task_id)));
    setLoading(false);
  }, [profile?.id]);
  useEffect(() => { load(); }, [load]);

  // projetos presentes (pro filtro)
  const projetos = useMemo(() => {
    const m = new Map<string, string>();
    itens.forEach(i => { if (i.projectId && i.projeto) m.set(i.projectId, i.projeto); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [itens]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return itens.filter(i => {
      if (!tiposAtivos.has(i.tipo)) return false;
      if (projetoFiltro && i.projectId !== projetoFiltro) return false;
      if (agenda === 'minha') {
        const minha = i.respId === profile?.id
          || (i.tipo !== 'diaria' && i.tipo !== 'ordem' && minhasTarefas.has(i.id.split(':')[1]));
        if (!minha) return false;
      }
      if (q && !`${i.titulo} ${i.projeto || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [itens, tiposAtivos, projetoFiltro, agenda, busca, profile?.id, minhasTarefas]);

  const porDia = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of filtrados) {
      if (!m.has(i.data)) m.set(i.data, []);
      m.get(i.data)!.push(i);
    }
    for (const l of m.values()) l.sort((a, b) => (a.hora || '99').localeCompare(b.hora || '99') || a.titulo.localeCompare(b.titulo));
    return m;
  }, [filtrados]);

  // Itens no formato do calendário. Cor sólida por tipo; atrasado vira vermelho; o que já passou fica mais apagado.
  const eventos = useMemo<EventoCal[]>(() => {
    const hoje = hojeIso();
    return filtrados.map(i => {
      const T = TIPOS[i.tipo];
      return {
        id: i.id, titulo: i.titulo, data: i.data, hora: i.hora, horaFim: i.horaFim,
        // Prazo é um ponto no tempo (30 min na grade); diária e OD usam o fim, ou a duração planejada.
        duracaoPadraoMin: i.tipo === 'tarefa' ? 30 : (i.duracaoMin ?? 60),
        cor: i.atrasado ? '#ef4444' : T.cor,
        Icon: T.Icon,
        subtitulo: i.projeto,
        detalhes: [ROTULO_CURTO(i.tipo)],
        selo: i.atrasado ? 'Atrasado' : null,
        passado: !i.atrasado && i.data < hoje,
      };
    });
  }, [filtrados]);
  const porId = useMemo(() => new Map(filtrados.map(i => [i.id, i])), [filtrados]);

  if (loading) return <div className="min-h-[50vh] grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-lumos-yellow" /></div>;

  const hoje = hojeIso();
  const diasVisiveis = diasDaJanela(cursor, gran);

  return (
    <div className="space-y-4 font-work-sans pb-16">
      {/* Cabeçalho: título + seletor de agenda */}
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight font-heading">Agenda</h1>
            <Select value={agenda} onChange={v => setAgenda(v as any)} className="input-lumos h-8 text-xs font-bold px-3"
              options={[
                { value: 'geral', label: '● Agenda Geral, todo o time' },
                { value: 'minha', label: '🔒 Minha Agenda, só o que é meu' },
              ]} />
          </div>
          <p className="text-lumos-text-secondary text-sm mt-0.5">Diárias, ordens do dia, prazos e entregas, tudo com data num lugar só.</p>
        </div>

        {/* Visualização: calendário / lista / kanban */}
        <div className="segmentado-lumos ml-auto flex items-center border border-lumos-border rounded-lumos overflow-hidden">
          {([['calendario', 'Calendário', CalendarDays], ['lista', 'Lista', List], ['kanban', 'Kanban', LayoutGrid]] as const).map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => mudarVisao(key)} aria-pressed={visao === key}
              className={clsx('segmento-lumos h-9 px-3.5 text-[11px] font-black uppercase tracking-wide flex items-center gap-1.5 transition-colors',
                visao === key ? 'bg-lumos-yellow text-black' : 'text-lumos-text-secondary hover:text-lumos-text-primary')}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Filtros: tipos + projeto + busca */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* No celular os tipos viram uma fileira que rola, em vez de ocupar 3 linhas */}
        <div className="flex items-center gap-2 max-md:w-full max-md:overflow-x-auto max-md:flex-nowrap no-scrollbar">
        {(Object.keys(TIPOS) as Tipo[]).map(t => {
          const ativo = tiposAtivos.has(t);
          const T = TIPOS[t];
          return (
            <button key={t} type="button" aria-pressed={ativo}
              onClick={() => setTiposAtivos(prev => { const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n; })}
              className={clsx('chip-lumos h-8 px-3 rounded-full border text-[10.5px] font-black flex items-center gap-1.5 transition-colors flex-shrink-0 whitespace-nowrap',
                ativo ? T.chip : 'border-lumos-border text-lumos-text-secondary/60 hover:text-lumos-text-secondary')}>
              <span className="w-2 h-2 rounded-full" style={{ background: ativo ? T.cor : 'currentColor', opacity: ativo ? 1 : 0.4 }} />
              {T.label}
            </button>
          );
        })}
        </div>
        <div className="w-52 max-md:flex-1">
          <Select value={projetoFiltro} onChange={setProjetoFiltro} searchable className="input-lumos h-8 w-full text-xs"
            options={[{ value: '', label: 'Todos os projetos' }, ...projetos.map(([id, nome]) => ({ value: id, label: nome }))]} />
        </div>
        <div className="relative ml-auto max-md:ml-0 max-md:flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-lumos-text-secondary" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar…"
            className="input-lumos h-8 pl-8 w-44 max-md:w-full text-xs" />
        </div>
      </div>

      {/* Navegação temporal (calendário e lista) */}
      {visao !== 'kanban' && (
        <BarraDoCalendario cursor={cursor} gran={gran} onCursor={setCursor} onGran={mudarGran} />
      )}

      {/* ═══════ CALENDÁRIO: mês, e semana/dia em grade de horas ═══════ */}
      {visao === 'calendario' && (
        <CalendarioEventos
          eventos={eventos} gran={gran} cursor={cursor}
          diaFechado={diaFechado}
          onEscolherDia={d => { setCursor(d); mudarGran('dia'); }}
          onAbrir={e => { const i = porId.get(e.id); if (i) navigate(i.link); }}
        />
      )}

      {/* LISTA: um cartão por dia */}
      {visao === 'lista' && (
        <div className="space-y-3">
          {diasVisiveis.map(d => {
            const dIso = iso(d);
            const doDia = porDia.get(dIso) || [];
            if (doDia.length === 0) return null;
            return (
              <div key={dIso} className="card overflow-hidden">
                <p className={clsx('px-4 py-2 text-[10px] font-black uppercase tracking-widest border-b border-lumos-border',
                  dIso === hoje ? 'text-lumos-yellow' : 'text-lumos-text-secondary')}>
                  {DIAS[d.getDay()]}, {d.getDate()} de {MESES[d.getMonth()]}{dIso === hoje && ' · hoje'}
                </p>
                {doDia.length === 0 ? (
                  <p className="text-center text-xs text-lumos-text-secondary italic py-6">Nada com data pra este dia.</p>
                ) : doDia.map(i => {
                  const T = TIPOS[i.tipo];
                  return (
                    <button key={i.id} type="button" onClick={() => navigate(i.link)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-lumos-text-primary/5 border-b border-lumos-border/40 last:border-0">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: i.atrasado ? '#ef4444' : T.cor }} />
                      {i.hora && <span className="text-[11px] font-black tabular-nums text-lumos-text-primary flex-shrink-0">{i.hora}</span>}
                      <span className="text-[12.5px] font-bold text-lumos-text-primary truncate flex-1">{i.titulo}</span>
                      {i.projeto && <span className="text-[10.5px] text-lumos-text-secondary truncate max-w-[200px]">{i.projeto}</span>}
                      <span className={clsx('text-[9px] font-black uppercase px-2 py-0.5 rounded-full border flex-shrink-0',
                        i.atrasado ? 'bg-red-500/15 text-red-500 border-red-500/40' : T.chip)}>
                        {i.atrasado ? 'Atrasado' : ROTULO_CURTO(i.tipo)}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
          {diasVisiveis.every(d => !(porDia.get(iso(d)) || []).length) && (
            <div className="card p-8 text-center">
              <CalendarDays className="w-8 h-8 text-lumos-text-secondary/30 mx-auto mb-3" />
              <p className="text-sm font-bold text-lumos-text-primary">Nada com data neste período.</p>
            </div>
          )}
        </div>
      )}

      {/* ═══════ KANBAN por horizonte de tempo ═══════ */}
      {visao === 'kanban' && (() => {
        const fimSemana = iso(addDias(domingoDe(new Date()), 6));
        const colunas: { key: string; label: string; cor: string; filtro: (i: Item) => boolean }[] = [
          { key: 'atrasado', label: 'Atrasadas', cor: '#ef4444', filtro: i => !!i.atrasado },
          { key: 'hoje', label: 'Hoje', cor: '#EFC700', filtro: i => i.data === hoje && !i.atrasado },
          { key: 'semana', label: 'Esta semana', cor: '#38bdf8', filtro: i => i.data > hoje && i.data <= fimSemana },
          { key: 'depois', label: 'Mais pra frente', cor: '#94a3b8', filtro: i => i.data > fimSemana },
        ];
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 items-start">
            {colunas.map(c => {
              const doGrupo = filtrados.filter(c.filtro).sort((a, b) => a.data.localeCompare(b.data) || (a.hora || '99').localeCompare(b.hora || '99'));
              return (
                <div key={c.key} className="card p-3 space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2 px-1">
                    <span className="w-2 h-2 rounded-full" style={{ background: c.cor }} />
                    <span className="text-lumos-text-primary">{c.label}</span>
                    <span className="ml-auto text-lumos-text-secondary tabular-nums">{doGrupo.length}</span>
                  </p>
                  {doGrupo.length === 0 ? (
                    <p className="text-[11px] text-lumos-text-secondary italic px-1 py-3">Nada por aqui.</p>
                  ) : doGrupo.slice(0, 40).map(i => {
                    const T = TIPOS[i.tipo];
                    return (
                      <button key={i.id} type="button" onClick={() => navigate(i.link)}
                        className="w-full text-left card !bg-lumos-bg/40 p-2.5 hover:border-lumos-yellow/40 transition-colors">
                        <span className="flex items-center gap-1.5 text-[9px] font-black uppercase" style={{ color: i.atrasado ? '#ef4444' : T.cor }}>
                          <T.Icon className="w-2.5 h-2.5" /> {ROTULO_CURTO(i.tipo)}
                          <span className="ml-auto text-lumos-text-secondary tabular-nums normal-case">
                            {new Date(i.data + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}{i.hora ? ` · ${i.hora}` : ''}
                          </span>
                        </span>
                        <span className="block text-[12px] font-bold text-lumos-text-primary mt-1 leading-snug">{i.titulo}</span>
                        {i.projeto && <span className="block text-[10px] text-lumos-text-secondary truncate mt-0.5">{i.projeto}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })()}

      <p className="text-[10.5px] text-lumos-text-secondary flex items-center gap-1.5">
        <Layers className="w-3 h-3" /> A agenda se alimenta sozinha: diárias e ordens do dia dos projetos, prazos e entregas das tarefas. Clicar em qualquer item leva direto pra ele.
      </p>
    </div>
  );
}
