import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays, ChevronLeft, ChevronRight, Clapperboard, ClipboardList, Layers,
  List, LayoutGrid, Loader2, Search, Send, Video,
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Select from '@/components/ui/Select';

/**
 * AGENDA — o calendário geral da produção, no formato do benchmark: tudo que
 * tem data num lugar só (diárias, ordens do dia, prazos de tarefa e entregas
 * ao cliente), com três visualizações (calendário, lista e kanban),
 * granularidade mês/semana/dia, botão Hoje, filtros por tipo e projeto, e o
 * seletor Agenda Geral × Minha Agenda.
 */

type Tipo = 'diaria' | 'ordem' | 'tarefa' | 'entrega';
interface Item {
  id: string;           // id composto tipo:id
  tipo: Tipo;
  titulo: string;
  data: string;         // AAAA-MM-DD
  hora?: string | null; // HH:MM quando existe
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

const p2 = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const hojeIso = () => iso(new Date());
const addDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const domingoDe = (d: Date) => addDias(d, -d.getDay());
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

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
  const [gran, setGran] = useState<'mes' | 'semana' | 'dia'>(() => {
    try { return (localStorage.getItem('lumos_agenda_gran') as any) || 'semana'; } catch { return 'semana'; }
  });
  const [agenda, setAgenda] = useState<'geral' | 'minha'>('geral');
  const [cursor, setCursor] = useState(() => new Date());
  const [tiposAtivos, setTiposAtivos] = useState<Set<Tipo>>(new Set(['diaria', 'ordem', 'tarefa', 'entrega']));
  const [projetoFiltro, setProjetoFiltro] = useState('');
  const [busca, setBusca] = useState('');

  const mudarVisao = (v: typeof visao) => { setVisao(v); try { localStorage.setItem('lumos_agenda_visao', v); } catch { /* ignora */ } };
  const mudarGran = (g: typeof gran) => { setGran(g); try { localStorage.setItem('lumos_agenda_gran', g); } catch { /* ignora */ } };

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
    const [tarefasQ, diariasQ, ordensQ, collabsQ] = await Promise.all([
      buscarTarefas(),
      supabase.from('project_diarias')
        .select('id, nome, data, hora_inicio, project_id, projects(name)'),
      supabase.from('ordens_do_dia')
        .select('id, titulo, data_producao, project_id, projects(name)'),
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
        projeto: d.projects?.name || null, projectId: d.project_id,
        link: `/producao/projetos?projectId=${d.project_id}&tab=diarias`,
      });
    }
    for (const o of (ordensQ.data as any[]) || []) {
      if (!o.data_producao) continue;
      lista.push({
        id: `ordem:${o.id}`, tipo: 'ordem', titulo: o.titulo, data: o.data_producao,
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

  // janela visível conforme a granularidade
  const janela = useMemo(() => {
    if (gran === 'dia') return { ini: new Date(cursor), fim: new Date(cursor) };
    if (gran === 'semana') { const d0 = domingoDe(cursor); return { ini: d0, fim: addDias(d0, 6) }; }
    const primeiro = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const ultimo = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    return { ini: domingoDe(primeiro), fim: addDias(domingoDe(ultimo), 6) };
  }, [cursor, gran]);

  const navegar = (dir: -1 | 1) => setCursor(c => {
    if (gran === 'dia') return addDias(c, dir);
    if (gran === 'semana') return addDias(c, dir * 7);
    return new Date(c.getFullYear(), c.getMonth() + dir, 1);
  });

  const tituloJanela = useMemo(() => {
    if (gran === 'mes') return `${['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'][cursor.getMonth()]} ${cursor.getFullYear()}`;
    if (gran === 'dia') return `${DIAS[cursor.getDay()]}, ${cursor.getDate()} de ${MESES[cursor.getMonth()]} ${cursor.getFullYear()}`;
    const { ini, fim } = janela;
    return `${ini.getDate()} ${MESES[ini.getMonth()]} — ${fim.getDate()} ${MESES[fim.getMonth()]} ${fim.getFullYear()}`;
  }, [cursor, gran, janela]);

  const Chip = ({ i, compacto }: { i: Item; compacto?: boolean }) => {
    const T = TIPOS[i.tipo];
    return (
      <button type="button" onClick={() => navigate(i.link)} title={`${T.label.replace(/s$/, '')} · ${i.titulo}${i.projeto ? ` · ${i.projeto}` : ''}`}
        className={clsx('w-full text-left rounded px-1.5 py-1 border transition-colors hover:brightness-110',
          i.atrasado ? 'bg-red-500/15 text-red-500 border-red-500/40' : T.chip)}>
        <span className={clsx('flex items-center gap-1 font-bold truncate', compacto ? 'text-[9.5px]' : 'text-[10.5px]')}>
          <T.Icon className="w-2.5 h-2.5 flex-shrink-0" />
          {i.hora && <span className="tabular-nums">{i.hora}</span>}
          <span className="truncate">{i.titulo}</span>
        </span>
        {!compacto && i.projeto && <span className="block text-[8.5px] opacity-70 truncate pl-3.5">{i.projeto}</span>}
      </button>
    );
  };

  if (loading) return <div className="min-h-[50vh] grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-lumos-yellow" /></div>;

  const hoje = hojeIso();
  const diasVisiveis: Date[] = [];
  for (let d = new Date(janela.ini); d <= janela.fim; d = addDias(d, 1)) diasVisiveis.push(new Date(d));

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
        <div className="ml-auto flex items-center border border-lumos-border rounded-lumos overflow-hidden">
          {([['calendario', 'Calendário', CalendarDays], ['lista', 'Lista', List], ['kanban', 'Kanban', LayoutGrid]] as const).map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => mudarVisao(key)}
              className={clsx('h-9 px-3.5 text-[11px] font-black uppercase tracking-wide flex items-center gap-1.5 transition-colors',
                visao === key ? 'bg-lumos-yellow text-black' : 'text-lumos-text-secondary hover:text-lumos-text-primary')}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Filtros: tipos + projeto + busca */}
      <div className="flex items-center gap-2 flex-wrap">
        {(Object.keys(TIPOS) as Tipo[]).map(t => {
          const ativo = tiposAtivos.has(t);
          const T = TIPOS[t];
          return (
            <button key={t} type="button"
              onClick={() => setTiposAtivos(prev => { const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n; })}
              className={clsx('h-8 px-3 rounded-full border text-[10.5px] font-black flex items-center gap-1.5 transition-colors',
                ativo ? T.chip : 'border-lumos-border text-lumos-text-secondary/60 hover:text-lumos-text-secondary')}>
              <span className="w-2 h-2 rounded-full" style={{ background: ativo ? T.cor : 'currentColor', opacity: ativo ? 1 : 0.4 }} />
              {T.label}
            </button>
          );
        })}
        <div className="w-52">
          <Select value={projetoFiltro} onChange={setProjetoFiltro} searchable className="input-lumos h-8 w-full text-xs"
            options={[{ value: '', label: 'Todos os projetos' }, ...projetos.map(([id, nome]) => ({ value: id, label: nome }))]} />
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-lumos-text-secondary" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar…"
            className="input-lumos h-8 pl-8 w-44 text-xs" />
        </div>
      </div>

      {/* Navegação temporal (calendário e lista) */}
      {visao !== 'kanban' && (
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => navegar(-1)} className="p-1.5 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary"><ChevronLeft className="w-4 h-4" /></button>
          <button type="button" onClick={() => navegar(1)} className="p-1.5 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary"><ChevronRight className="w-4 h-4" /></button>
          <p className="text-sm font-black text-lumos-text-primary capitalize">{tituloJanela}</p>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={() => setCursor(new Date())}
              className="h-8 px-3 rounded-lumos border border-lumos-border text-[11px] font-black text-lumos-text-secondary hover:text-lumos-text-primary">Hoje</button>
            <div className="flex items-center border border-lumos-border rounded-lumos overflow-hidden">
              {([['mes', 'Mês'], ['semana', 'Semana'], ['dia', 'Dia']] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => mudarGran(key)}
                  className={clsx('h-8 px-3 text-[10.5px] font-black uppercase transition-colors',
                    gran === key ? 'bg-lumos-text-primary/10 text-lumos-text-primary' : 'text-lumos-text-secondary hover:text-lumos-text-primary')}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══════ CALENDÁRIO ═══════ */}
      {visao === 'calendario' && gran !== 'dia' && (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-lumos-border">
            {DIAS.map(d => (
              <div key={d} className="px-2 py-2 text-center text-[9px] font-black uppercase tracking-wider text-lumos-text-secondary">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {diasVisiveis.map((d, idx) => {
              const dIso = iso(d);
              const doDia = porDia.get(dIso) || [];
              const foraDoMes = gran === 'mes' && d.getMonth() !== cursor.getMonth();
              const max = gran === 'mes' ? 3 : 8;
              return (
                <div key={idx} className={clsx('border-b border-r border-lumos-border/60 p-1.5 space-y-1 align-top',
                  gran === 'mes' ? 'min-h-[96px]' : 'min-h-[340px]',
                  foraDoMes && 'opacity-40', dIso === hoje && 'bg-lumos-yellow/[0.05]')}>
                  <p className={clsx('text-[10px] font-black tabular-nums',
                    dIso === hoje ? 'text-lumos-yellow' : 'text-lumos-text-secondary')}>
                    {d.getDate()}{dIso === hoje && ' · hoje'}
                  </p>
                  {doDia.slice(0, max).map(i => <Chip key={i.id} i={i} compacto={gran === 'mes'} />)}
                  {doDia.length > max && (
                    <button type="button" onClick={() => { setCursor(new Date(d)); mudarGran('dia'); }}
                      className="text-[9px] font-black text-lumos-text-secondary hover:text-lumos-yellow">+ {doDia.length - max} mais</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Dia (calendário) e LISTA compartilham o formato de lista por dia */}
      {((visao === 'calendario' && gran === 'dia') || visao === 'lista') && (
        <div className="space-y-3">
          {(visao === 'lista' ? diasVisiveis : [cursor]).map(d => {
            const dIso = iso(d);
            const doDia = porDia.get(dIso) || [];
            if (visao === 'lista' && doDia.length === 0) return null;
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
                        {i.atrasado ? 'Atrasado' : T.label.replace(/s$/, '').replace(' ao cliente', '').replace(' de tarefa', '')}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
          {visao === 'lista' && diasVisiveis.every(d => !(porDia.get(iso(d)) || []).length) && (
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
                          <T.Icon className="w-2.5 h-2.5" /> {T.label.replace(/s$/, '').replace(' ao cliente', '').replace(' de tarefa', '')}
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
