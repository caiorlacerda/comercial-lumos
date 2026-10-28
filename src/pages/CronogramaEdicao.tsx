import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, addWeeks, isToday, subWeeks, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clsx } from 'clsx';
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Clapperboard, Copy, GripVertical, Pencil, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, pointerWithin, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import { useBarraDeCarregamento } from '@/lib/progressoDeCarregamento';
import { gravarCache, lerCache } from '@/lib/cacheDeTela';
import { EsqueletoPagina } from '@/components/ui/Esqueleto';
import { useConfirm } from '@/components/ui/useConfirm';
import Modal from '@/components/common/Modal';
import Select from '@/components/ui/Select';
import UserAvatar from '@/components/common/UserAvatar';
import CelulaCronograma, { ItemFlutuante } from '@/components/cronograma/CelulaCronograma';
import VincularItemModal, { type Vinculo } from '@/components/cronograma/VincularItemModal';
import { type ItemAutomatico, automaticosDaCelula, buscarAutomaticos } from '@/lib/cronogramaAutomatico';
import AgendaDaSemana from '@/components/cronograma/AgendaDaSemana';
import {
  type Item, type Linha, type Semana, type TipoItem, type TipoLinha,
  SELECT_ITEM, TIPOS, diasDaSemana, iso, nomeDaLinha, rotuloDaSemana, segundaDe, tipoPadraoDaLinha, dataDeIso,
} from '@/lib/cronograma';

/**
 * CRONOGRAMA DA EQUIPE — o que cada pessoa faz em cada dia da semana, no formato da planilha
 * "LUMOS | Cronograma da equipe". Admin e Gestão de Produção editam (e o banco também exige isso);
 * o resto do time só vê. As mudanças aparecem na hora para quem estiver com a tela aberta.
 *
 * (O antigo Cronograma de Edição, de prazos por tarefa, continua em /producao/cronograma-prazos.)
 */

const GRADE = '176px repeat(5, minmax(172px, 1fr)) repeat(2, 76px)';
const COLUNAS_FIXAS = 'sticky left-0 z-10';

interface Dados { semana: Semana | null; linhas: Linha[]; itens: Item[]; anterior: string | null }

export default function CronogramaEdicao() {
  const { profile, isAdmin } = useAuth();
  const toast = useToast();
  const { confirm, dialog: dialogoConfirmar } = useConfirm();
  const podeEditar = isAdmin || profile?.role === 'producao';

  const [inicio, setInicio] = useState<Date>(() => segundaDe(new Date()));
  const chave = iso(inicio);
  const [dados, setDados] = useState<Dados | null>(() => lerCache<Dados>(`cronograma:${iso(segundaDe(new Date()))}`) ?? null);
  const [carregando, setCarregando] = useState(() => !lerCache(`cronograma:${iso(segundaDe(new Date()))}`));
  useBarraDeCarregamento(carregando);
  const [criando, setCriando] = useState(false);
  const [levarItens, setLevarItens] = useState(true);
  const [novaLinha, setNovaLinha] = useState(false);
  const [vinculando, setVinculando] = useState<Item | null>(null);
  // O que está sendo arrastado (um item ou uma linha) e a célula onde o item cairia.
  const [arrastando, setArrastando] = useState<{ tipo: 'item' | 'linha'; id: string; largura: number } | null>(null);
  const [celulaAlvo, setCelulaAlvo] = useState<string | null>(null);
  // Duas visões dos MESMOS itens: "Por pessoa" (a grade da planilha, onde se edita) e "Por dia"
  // (agenda da semana, com filtro por pessoa). A escolha fica guardada neste navegador.
  const [visao, setVisao] = useState<'pessoa' | 'dia'>(() => {
    try { return localStorage.getItem('lumos_cronograma_visao') === 'dia' ? 'dia' : 'pessoa'; } catch { return 'pessoa'; }
  });
  const mudarVisao = (v: 'pessoa' | 'dia') => { setVisao(v); try { localStorage.setItem('lumos_cronograma_visao', v); } catch { /* sem armazenamento */ } };
  const [filtroLinha, setFiltroLinha] = useState('');
  useEffect(() => { setFiltroLinha(''); }, [chave]);

  const dias = useMemo(() => diasDaSemana(inicio), [inicio]);

  const carregar = useCallback(async (silencioso = false) => {
    const cacheKey = `cronograma:${chave}`;
    if (!silencioso && !lerCache(cacheKey)) setCarregando(true);
    const { data: s, error: es } = await supabase.from('cronograma_semanas')
      .select('id, inicio, projetos_andamento, projetos_iniciar').eq('inicio', chave).maybeSingle();
    if (es) { setDados(null); setCarregando(false); toast.error('Não foi possível carregar o cronograma. A migração já rodou?'); return; }

    let novo: Dados;
    if (!s) {
      // Semana ainda não criada: descobre de qual semana existente dá pra copiar.
      const { data: ant } = await supabase.from('cronograma_semanas').select('inicio')
        .lt('inicio', chave).order('inicio', { ascending: false }).limit(1);
      novo = { semana: null, linhas: [], itens: [], anterior: (ant && ant[0]?.inicio) || null };
    } else {
      const { data: ls } = await supabase.from('cronograma_linhas')
        .select('id, semana_id, ordem, tipo, user_id, nome, user:app_users(id, full_name, avatar_url, job_title)')
        .eq('semana_id', s.id).order('ordem').order('created_at');
      const linhas = ((ls as unknown) as Linha[]) || [];
      const ids = linhas.map(l => l.id);
      const { data: its } = ids.length
        ? await supabase.from('cronograma_itens').select(SELECT_ITEM)
            .in('linha_id', ids).order('ordem').order('created_at')
        : { data: [] as Item[] };
      novo = { semana: s as Semana, linhas, itens: (its as Item[]) || [], anterior: null };
    }
    setDados(novo);
    gravarCache(cacheKey, novo);
    setCarregando(false);
  }, [chave]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { carregar(); }, [carregar]);
  useRealtimeRefetch(['cronograma_semanas', 'cronograma_linhas', 'cronograma_itens'], () => carregar(true));

  // Diárias e entregas da semana, que aparecem sozinhas nas linhas Externas e Entregas (nada é gravado).
  const [automaticos, setAutomaticos] = useState<ItemAutomatico[]>([]);
  const temSemana = !!dados?.semana;
  const carregarAutomaticos = useCallback(async () => {
    if (!temSemana) { setAutomaticos([]); return; }
    try { setAutomaticos(await buscarAutomaticos(chave)); } catch { setAutomaticos([]); }
  }, [chave, temSemana]);
  useEffect(() => { carregarAutomaticos(); }, [carregarAutomaticos]);
  useRealtimeRefetch(['project_diarias', 'project_tasks'], carregarAutomaticos);

  // ── Criar a semana ─────────────────────────────────────────────────────
  const criarSemana = async (copiarDe: string | null) => {
    setCriando(true);
    const { error } = await supabase.rpc('cronograma_criar_semana', {
      p_inicio: chave, p_copiar_de: copiarDe, p_com_itens: copiarDe ? levarItens : false,
    });
    setCriando(false);
    if (error && !/semana_ja_existe/.test(error.message)) { toast.error('Não foi possível criar a semana.'); return; }
    await carregar(true);
  };

  // ── Itens (otimista: a tela muda na hora e o banco acompanha) ──────────
  const mutar = (fn: (d: Dados) => Dados) => setDados(prev => (prev ? fn(prev) : prev));

  const adicionarItem = async (linha: Linha, dia: string, texto: string, tipo: TipoItem) => {
    const doDia = (dados?.itens || []).filter(i => i.linha_id === linha.id && i.dia === dia);
    const ordem = doDia.reduce((m, i) => Math.max(m, i.ordem), 0) + 1;
    const { data, error } = await supabase.from('cronograma_itens')
      .insert({ linha_id: linha.id, dia, texto, tipo, ordem, created_by: profile?.id ?? null })
      .select(SELECT_ITEM).single();
    if (error || !data) { toast.error('Não foi possível salvar o item.'); return; }
    mutar(d => ({ ...d, itens: d.itens.some(i => i.id === data.id) ? d.itens : [...d.itens, data as unknown as Item] }));
  };

  const atualizarItem = async (id: string, patch: Partial<Pick<Item, 'texto' | 'tipo'>>) => {
    mutar(d => ({ ...d, itens: d.itens.map(i => (i.id === id ? { ...i, ...patch } : i)) }));
    const { error } = await supabase.from('cronograma_itens').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error('Não foi possível salvar a mudança.'); carregar(true); }
  };

  const removerItem = async (id: string) => {
    mutar(d => ({ ...d, itens: d.itens.filter(i => i.id !== id) }));
    const { error } = await supabase.from('cronograma_itens').delete().eq('id', id);
    if (error) { toast.error('Não foi possível remover.'); carregar(true); }
  };

  const vincularItem = async (id: string, v: Vinculo | null) => {
    mutar(d => ({ ...d, itens: d.itens.map(i => (i.id === id
      ? { ...i, project_id: v?.project.id ?? null, task_id: v?.task?.id ?? null, project: v?.project ?? null, task: v?.task ?? null }
      : i)) }));
    const { error } = await supabase.from('cronograma_itens')
      .update({ project_id: v?.project.id ?? null, task_id: v?.task?.id ?? null, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error('Não foi possível salvar o vínculo.'); carregar(true); }
  };

  // ── Linhas ─────────────────────────────────────────────────────────────
  const adicionarLinha = async (nova: { tipo: TipoLinha; user_id?: string | null; nome?: string | null }) => {
    if (!dados?.semana) return;
    const pessoas = dados.linhas.filter(l => l.tipo === 'pessoa');
    const ordem = nova.tipo === 'pessoa'
      ? pessoas.reduce((m, l) => Math.max(m, l.ordem), 0) + 1
      : dados.linhas.reduce((m, l) => Math.max(m, l.ordem), 0) + 1;
    const { error } = await supabase.from('cronograma_linhas')
      .insert({ semana_id: dados.semana.id, ordem, tipo: nova.tipo, user_id: nova.user_id ?? null, nome: nova.nome ?? null });
    if (error) { toast.error('Não foi possível adicionar a linha.'); return; }
    setNovaLinha(false);
    carregar(true);
  };

  const renomearLinha = async (linha: Linha, nome: string) => {
    const limpo = nome.trim();
    if (!limpo || limpo === (linha.nome || '')) return;
    mutar(d => ({ ...d, linhas: d.linhas.map(l => (l.id === linha.id ? { ...l, nome: limpo } : l)) }));
    const { error } = await supabase.from('cronograma_linhas').update({ nome: limpo }).eq('id', linha.id);
    if (error) { toast.error('Não foi possível renomear.'); carregar(true); }
  };

  // Arrastar: as linhas (pela alça) e cada item (pelo próprio item) usam o mesmo DndContext.
  // Mouse com 6px de folga (para o clique ainda editar o texto) e, no toque, segurar um instante.
  const sensores = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Linha só enxerga linhas; item só enxerga itens e células (e prefere o item sob o mouse).
  const colisao: CollisionDetection = useCallback(args => {
    const ehLinha = args.active.data.current?.tipo === 'linha';
    const alvos = args.droppableContainers.filter(c => (c.data.current?.tipo === 'linha') === ehLinha);
    if (ehLinha) return closestCenter({ ...args, droppableContainers: alvos });
    const sob = pointerWithin({ ...args, droppableContainers: alvos });
    const sobItem = sob.filter(c => alvos.find(a => a.id === c.id)?.data.current?.tipo === 'item');
    return sobItem.length ? sobItem : sob;
  }, []);

  const celulaDe = (over: DragOverEvent['over']) => {
    const d = over?.data.current;
    return d && (d.tipo === 'item' || d.tipo === 'celula') ? `${d.linhaId}|${d.dia}` : null;
  };
  const aoComecarArrasto = (e: DragStartEvent) => {
    const tipo = e.active.data.current?.tipo === 'linha' ? 'linha' : 'item';
    setArrastando({ tipo, id: String(e.active.id), largura: e.active.rect.current.initial?.width ?? 160 });
  };
  const aoArrastarSobre = (e: DragOverEvent) => setCelulaAlvo(arrastando?.tipo === 'item' ? celulaDe(e.over) : null);
  const aoTerminarArrasto = (e: DragEndEvent) => {
    const tipo = arrastando?.tipo;
    setArrastando(null); setCelulaAlvo(null);
    if (tipo === 'linha') aoSoltarLinha(e); else aoSoltarItem(e);
  };

  // Soltar um item: ele vai para a posição sobre a qual caiu (ou para o fim da célula vazia/solta),
  // no mesmo dia, em outro dia ou na linha de outra pessoa. Renumera a célula de destino inteira.
  const aoSoltarItem = async (e: DragEndEvent) => {
    if (!dados || !e.over) return;
    const ativo = dados.itens.find(i => i.id === e.active.id);
    const alvo = e.over.data.current;
    if (!ativo || !alvo || (alvo.tipo !== 'item' && alvo.tipo !== 'celula')) return;
    const linhaId: string = alvo.linhaId, dia: string = alvo.dia;
    const mesmaCelula = ativo.linha_id === linhaId && ativo.dia === dia;

    const celula = itensDe(linhaId, dia);
    let novaOrdem: Item[];
    if (alvo.tipo === 'celula') {
      novaOrdem = [...celula.filter(i => i.id !== ativo.id), ativo];
    } else if (mesmaCelula) {
      const de = celula.findIndex(i => i.id === ativo.id), para = celula.findIndex(i => i.id === e.over!.id);
      if (de < 0 || para < 0) return;
      novaOrdem = arrayMove(celula, de, para);
    } else {
      // Em outra célula: entra antes ou depois do item sobre o qual caiu, conforme a metade em que o mouse está.
      const resto = celula.filter(i => i.id !== ativo.id);
      const pos = resto.findIndex(i => i.id === e.over!.id);
      const topo = e.active.rect.current.translated;
      const abaixo = !!topo && topo.top + topo.height / 2 > e.over.rect.top + e.over.rect.height / 2;
      const idx = pos < 0 ? resto.length : pos + (abaixo ? 1 : 0);
      novaOrdem = [...resto.slice(0, idx), ativo, ...resto.slice(idx)];
    }

    const novos = novaOrdem.map((i, ordem) => ({ ...i, linha_id: linhaId, dia, ordem }));
    const mudou = novos.filter(n => {
      const antes = dados.itens.find(i => i.id === n.id);
      return !antes || antes.linha_id !== n.linha_id || antes.dia !== n.dia || antes.ordem !== n.ordem;
    });
    if (!mudou.length) return;
    mutar(d => ({ ...d, itens: d.itens.map(i => novos.find(n => n.id === i.id) ?? i) }));
    const agora = new Date().toISOString();
    const res = await Promise.all(mudou.map(n =>
      supabase.from('cronograma_itens').update({ linha_id: n.linha_id, dia: n.dia, ordem: n.ordem, updated_at: agora }).eq('id', n.id)));
    if (res.some(r => r.error)) { toast.error('Não foi possível mover o item.'); carregar(true); }
  };

  // Arrastar uma linha para reordenar: a linha solta vira a posição nova e as outras renumeram.
  // Renumera todas (e não só troca duas) porque linhas com "ordem" repetida não mudariam de lugar.
  const aoSoltarLinha = async (e: DragEndEvent) => {
    if (!dados || !e.over || e.active.id === e.over.id) return;
    const ordenadas = [...dados.linhas].sort((a, b) => a.ordem - b.ordem);
    const de = ordenadas.findIndex(l => l.id === e.active.id);
    const para = ordenadas.findIndex(l => l.id === e.over!.id);
    if (de < 0 || para < 0) return;
    const novas = arrayMove(ordenadas, de, para).map((l, idx) => ({ ...l, ordem: idx }));
    mutar(d => ({ ...d, linhas: novas }));
    const mudou = novas.filter(n => dados.linhas.find(l => l.id === n.id)?.ordem !== n.ordem);
    const res = await Promise.all(mudou.map(n => supabase.from('cronograma_linhas').update({ ordem: n.ordem }).eq('id', n.id)));
    if (res.some(r => r.error)) { toast.error('Não foi possível reordenar.'); carregar(true); }
  };

  const removerLinha = async (linha: Linha) => {
    const n = (dados?.itens || []).filter(i => i.linha_id === linha.id).length;
    const ok = await confirm({
      title: 'Remover esta linha?',
      message: `${nomeDaLinha(linha)}${n ? `\n\nOs ${n} itens dela nesta semana também saem.` : ''}`,
      confirmLabel: 'Remover', danger: true,
    });
    if (!ok) return;
    mutar(d => ({ ...d, linhas: d.linhas.filter(l => l.id !== linha.id), itens: d.itens.filter(i => i.linha_id !== linha.id) }));
    const { error } = await supabase.from('cronograma_linhas').delete().eq('id', linha.id);
    if (error) { toast.error('Não foi possível remover a linha.'); carregar(true); }
  };

  // ── Rodapé (projetos) ─────────────────────────────────────────────────
  const salvarProjetos = async (campo: 'projetos_andamento' | 'projetos_iniciar', texto: string) => {
    if (!dados?.semana || texto === dados.semana[campo]) return;
    mutar(d => ({ ...d, semana: d.semana ? { ...d.semana, [campo]: texto } : d.semana }));
    const { error } = await supabase.from('cronograma_semanas')
      .update({ [campo]: texto, updated_at: new Date().toISOString() }).eq('id', dados.semana.id);
    if (error) { toast.error('Não foi possível salvar.'); carregar(true); }
  };

  const itensDe = (linhaId: string, dia: string) =>
    (dados?.itens || []).filter(i => i.linha_id === linhaId && i.dia === dia).sort((a, b) => a.ordem - b.ordem);
  const automaticosDe = (linha: Linha, dia: string): ItemAutomatico[] =>
    linha.tipo === 'externas' || linha.tipo === 'entregas'
      ? automaticosDaCelula(automaticos, linha.tipo, dia, itensDe(linha.id, dia).map(i => i.texto))
      : [];

  // Preenche "Projetos em andamento" com os projetos ativos da plataforma (o texto segue livre depois).
  const preencherProjetosAtivos = async () => {
    if (!dados?.semana) return;
    const { data, error } = await supabase.from('projects').select('name').eq('status', 'ativo').order('name');
    if (error) { toast.error('Não foi possível buscar os projetos.'); return; }
    const nomes = ((data as { name: string }[]) || []).map(p => (p.name || '').trim()).filter(Boolean);
    if (!nomes.length) { toast.info('Não há projetos ativos.'); return; }
    const atual = dados.semana.projetos_andamento.trim();
    if (atual) {
      const ok = await confirm({
        title: 'Trocar a lista pelos projetos ativos?',
        message: `Hoje ${nomes.length === 1 ? 'há 1 projeto ativo' : `são ${nomes.length} projetos ativos`}. A lista desta semana será substituída por ${nomes.length === 1 ? 'ele' : 'eles'}, e você pode ajustar o texto depois.`,
        confirmLabel: 'Trocar',
      });
      if (!ok) return;
    }
    await salvarProjetos('projetos_andamento', nomes.join('\n'));
  };
  const linhasOrdenadas = useMemo(() => [...(dados?.linhas || [])].sort((a, b) => a.ordem - b.ordem), [dados?.linhas]);
  const semana = dados?.semana ?? null;
  const ehEstaSemana = chave === iso(segundaDe(new Date()));

  return (
    <div className="space-y-4 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight flex items-center gap-2">
            <CalendarRange className="w-6 h-6 text-lumos-yellow" /> Cronograma da equipe
          </h1>
          <p className="text-lumos-text-secondary text-sm">O que cada pessoa faz em cada dia da semana.{!podeEditar && ' Só a gestão edita; você acompanha por aqui.'}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center border border-lumos-border rounded-lumos overflow-hidden">
            {([['pessoa', 'Por pessoa', Users], ['dia', 'Por dia', CalendarDays]] as const).map(([k, rotulo, Icone]) => (
              <button key={k} type="button" onClick={() => mudarVisao(k)} aria-pressed={visao === k}
                className={clsx('h-8 px-3 text-[11px] font-black uppercase tracking-wide flex items-center gap-1.5 transition-colors',
                  visao === k ? 'bg-lumos-yellow text-black' : 'text-lumos-text-secondary hover:text-lumos-text-primary')}>
                <Icone className="w-3.5 h-3.5" /> {rotulo}
              </button>
            ))}
          </div>
          <button onClick={() => setInicio(w => subWeeks(w, 1))} aria-label="Semana anterior"
            className="p-1.5 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-yellow"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={() => setInicio(segundaDe(new Date()))} disabled={ehEstaSemana}
            className="h-8 px-3 text-[11px] font-bold rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-yellow disabled:opacity-40">Hoje</button>
          <span className="text-[11px] font-black uppercase text-amber-600 dark:text-lumos-yellow bg-lumos-yellow/10 px-2.5 py-1.5 rounded whitespace-nowrap min-w-[120px] text-center">
            {rotuloDaSemana(inicio)}
          </span>
          <button onClick={() => setInicio(w => addWeeks(w, 1))} aria-label="Próxima semana"
            className="p-1.5 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-yellow"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      {carregando || !dados ? (
        <EsqueletoPagina />
      ) : !semana ? (
        <div className="card p-10 text-center space-y-4">
          <Clapperboard className="w-8 h-8 text-lumos-text-secondary/40 mx-auto" />
          <div>
            <p className="text-sm font-bold text-lumos-text-primary">A semana de {rotuloDaSemana(inicio)} ainda não foi criada.</p>
            <p className="text-xs text-lumos-text-secondary mt-1">
              {podeEditar ? 'Comece de uma semana em branco ou copie a anterior.' : 'A gestão ainda não montou esta semana.'}
            </p>
          </div>
          {podeEditar && (
            <div className="flex flex-col items-center gap-3">
              {dados.anterior && (
                <>
                  <button disabled={criando} onClick={() => criarSemana(dados.anterior)}
                    className="btn-primary h-10 px-5 text-xs font-black flex items-center gap-2 disabled:opacity-50">
                    <Copy className="w-4 h-4" /> Copiar a semana de {rotuloDaSemana(dataDeIso(dados.anterior))}
                  </button>
                  <label className="flex items-center gap-2 text-[11px] font-bold text-lumos-text-secondary cursor-pointer">
                    <input type="checkbox" className="accent-lumos-yellow" checked={levarItens} onChange={e => setLevarItens(e.target.checked)} />
                    Levar também os itens (se desmarcar, vão só as linhas)
                  </label>
                </>
              )}
              <button disabled={criando} onClick={() => criarSemana(null)}
                className={clsx('h-10 px-5 text-xs font-black rounded-lumos border border-lumos-border text-lumos-text-primary hover:border-lumos-yellow/50 disabled:opacity-50')}>
                Começar uma semana em branco
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {visao === 'dia' ? (
            <AgendaDaSemana linhas={linhasOrdenadas} itens={dados.itens} dias={dias} automaticosDe={automaticosDe} filtroLinha={filtroLinha} onFiltro={setFiltroLinha} />
          ) : (
          <div className="card !p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <div className="min-w-[1080px]">
                {/* Cabeçalho: dias */}
                <div className="grid bg-lumos-yellow/10 border-b border-lumos-border" style={{ gridTemplateColumns: GRADE }}>
                  <div className={clsx(COLUNAS_FIXAS, 'bg-lumos-surface/95 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary')}>Pessoa</div>
                  {dias.map(d => (
                    <div key={d.iso} className={clsx('px-2 py-2 text-center border-l border-lumos-border/60', d.fimDeSemana && 'bg-lumos-text-secondary/[0.07]', isToday(d.data) && 'bg-lumos-yellow/20')}>
                      <p className="text-[10px] font-black uppercase text-lumos-text-secondary">{format(d.data, d.fimDeSemana ? 'EEE' : 'EEEE', { locale: ptBR })}</p>
                      <p className={clsx('text-[11px] font-bold', isToday(d.data) ? 'text-amber-600 dark:text-lumos-yellow' : 'text-lumos-text-primary')}>{format(d.data, 'dd/MM')}</p>
                    </div>
                  ))}
                </div>

                {/* Linhas */}
                {linhasOrdenadas.length === 0 && (
                  <p className="px-4 py-8 text-center text-sm text-lumos-text-secondary">Nenhuma linha ainda. {podeEditar ? 'Use “Adicionar linha”.' : ''}</p>
                )}
                <DndContext sensors={sensores} collisionDetection={colisao} onDragStart={aoComecarArrasto} onDragOver={aoArrastarSobre}
                  onDragEnd={aoTerminarArrasto} onDragCancel={() => { setArrastando(null); setCelulaAlvo(null); }}>
                  <SortableContext items={linhasOrdenadas.map(l => l.id)} strategy={verticalListSortingStrategy}>
                    {linhasOrdenadas.map(l => (
                      <LinhaDoCronograma key={l.id} linha={l} dias={dias} podeEditar={podeEditar}
                        itensDe={itensDe} automaticosDe={automaticosDe} celulaAlvo={celulaAlvo} onAdicionar={adicionarItem} onAtualizar={atualizarItem} onRemover={removerItem}
                        onVincular={setVinculando} onDesvincular={id => vincularItem(id, null)} onRenomear={renomearLinha} onRemoverLinha={removerLinha} />
                    ))}
                  </SortableContext>
                  <DragOverlay dropAnimation={null}>
                    {arrastando?.tipo === 'item' && (() => {
                      const it = dados.itens.find(i => i.id === arrastando.id);
                      return it ? <div style={{ width: arrastando.largura }}><ItemFlutuante item={it} /></div> : null;
                    })()}
                  </DragOverlay>
                </DndContext>
              </div>
            </div>
            {podeEditar && (
              <div className="px-3 py-2 border-t border-lumos-border/60">
                <button onClick={() => setNovaLinha(true)} className="text-[11px] font-black uppercase tracking-wide text-lumos-yellow hover:underline flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> Adicionar linha
                </button>
              </div>
            )}
          </div>
          )}

          {/* Rodapé: projetos + legenda */}
          <div className="grid md:grid-cols-2 gap-3">
            {([['projetos_andamento', 'Projetos em andamento'], ['projetos_iniciar', 'Projetos a iniciar']] as const).map(([campo, titulo]) => (
              <div key={campo} className="card space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary flex items-center gap-1.5"><Pencil className="w-3 h-3" /> {titulo}</p>
                  {podeEditar && campo === 'projetos_andamento' && (
                    <button type="button" onClick={preencherProjetosAtivos}
                      className="text-[10px] font-black uppercase tracking-wide text-lumos-yellow hover:underline flex items-center gap-1">
                      <RefreshCw className="w-3 h-3" /> Atualizar com projetos ativos
                    </button>
                  )}
                </div>
                {podeEditar ? (
                  <textarea key={`${semana.id}-${campo}-${semana[campo]}`} defaultValue={semana[campo]} rows={4}
                    placeholder="Um projeto por linha…"
                    onBlur={e => salvarProjetos(campo, e.target.value)}
                    className="input-lumos w-full text-xs leading-snug resize-y" />
                ) : (
                  <p className="text-xs text-lumos-text-primary whitespace-pre-line min-h-[24px]">{semana[campo] || <span className="text-lumos-text-secondary/60">—</span>}</p>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 flex-wrap text-[11px] text-lumos-text-secondary">
            <span className="font-black uppercase tracking-widest text-[10px]">Legenda</span>
            {TIPOS.map(t => (
              <span key={t.id} className="flex items-center gap-1.5 font-bold text-lumos-text-primary">
                <span className={clsx('w-3 h-3 rounded border', t.caixa)} /> {t.label}
              </span>
            ))}
            <span className="flex items-center gap-1.5 font-bold text-lumos-text-primary"><span className="w-3 h-3 rounded bg-lumos-text-secondary/20" /> Fim de semana</span>
          </div>
        </>
      )}

      {novaLinha && dados?.semana && (
        <NovaLinhaModal
          linhas={dados.linhas}
          onClose={() => setNovaLinha(false)}
          onAdicionar={adicionarLinha}
        />
      )}
      {vinculando && (
        <VincularItemModal item={vinculando} onClose={() => setVinculando(null)}
          onSalvar={async v => { await vincularItem(vinculando.id, v); setVinculando(null); }} />
      )}
      {dialogoConfirmar}
    </div>
  );
}

// ── Uma linha da grade (arrastável pela alça à esquerda) ─────────────────────
// Fica FORA da página de propósito: declarada dentro, seria recriada a cada atualização de estado.
function LinhaDoCronograma({ linha: l, dias, podeEditar, itensDe, automaticosDe, celulaAlvo, onAdicionar, onAtualizar, onRemover, onVincular, onDesvincular, onRenomear, onRemoverLinha }: {
  linha: Linha;
  dias: ReturnType<typeof diasDaSemana>;
  podeEditar: boolean;
  itensDe: (linhaId: string, dia: string) => Item[];
  automaticosDe: (linha: Linha, dia: string) => ItemAutomatico[];
  celulaAlvo: string | null;
  onAdicionar: (linha: Linha, dia: string, texto: string, tipo: TipoItem) => void;
  onAtualizar: (id: string, patch: Partial<Pick<Item, 'texto' | 'tipo'>>) => void;
  onRemover: (id: string) => void;
  onVincular: (item: Item) => void;
  onDesvincular: (id: string) => void;
  onRenomear: (linha: Linha, nome: string) => void;
  onRemoverLinha: (linha: Linha) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: l.id, data: { tipo: 'linha' }, disabled: !podeEditar });

  return (
    <div ref={setNodeRef}
      style={{ gridTemplateColumns: GRADE, transform: CSS.Transform.toString(transform), transition, position: 'relative', zIndex: isDragging ? 20 : undefined }}
      className={clsx('group/linha grid border-b border-lumos-border/60 last:border-b-0', isDragging && 'bg-lumos-surface shadow-xl ring-1 ring-lumos-yellow/50 opacity-95')}>
      <div className={clsx(COLUNAS_FIXAS, 'px-1.5 py-2 flex items-start gap-1 min-w-0 border-r border-lumos-border/60',
        l.tipo === 'entregas' ? 'bg-orange-500/20' : l.tipo === 'externas' ? 'bg-sky-500/15' : 'bg-lumos-surface/95')}>
        {podeEditar && (
          <button ref={setActivatorNodeRef} {...attributes} {...listeners} type="button" title="Arraste para mudar a ordem"
            className="mt-0.5 p-0.5 rounded text-lumos-text-secondary/50 hover:text-lumos-yellow cursor-grab active:cursor-grabbing touch-none flex-shrink-0">
            <GripVertical className="w-4 h-4" />
          </button>
        )}
        {l.tipo === 'pessoa' && l.user ? <UserAvatar user={l.user} size={26} /> : null}
        <div className="min-w-0 flex-1 pl-0.5">
          {podeEditar && !l.user ? (
            <input defaultValue={nomeDaLinha(l)} key={`${l.id}-${l.nome}`}
              onBlur={e => onRenomear(l, e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="w-full bg-transparent text-xs font-black text-lumos-text-primary outline-none border-b border-transparent focus:border-lumos-yellow" />
          ) : (
            <p className="text-xs font-black text-lumos-text-primary truncate" title={nomeDaLinha(l)}>{nomeDaLinha(l)}</p>
          )}
          {l.user?.job_title && <p className="text-[10px] text-lumos-text-secondary truncate">{l.user.job_title}</p>}
        </div>
        {podeEditar && (
          <button onClick={() => onRemoverLinha(l)} title="Remover linha"
            className="opacity-0 group-hover/linha:opacity-100 focus:opacity-100 p-0.5 text-lumos-text-secondary hover:text-red-500 transition-opacity flex-shrink-0">
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
      {dias.map(d => (
        <div key={d.iso} className={clsx('border-l border-lumos-border/60 flex flex-col', isToday(d.data) && 'bg-lumos-yellow/[0.05]')}>
          <CelulaCronograma
            linhaId={l.id} dia={d.iso} destaque={celulaAlvo === `${l.id}|${d.iso}`}
            itens={itensDe(l.id, d.iso)} automaticos={automaticosDe(l, d.iso)} podeEditar={podeEditar} tipoPadrao={tipoPadraoDaLinha(l)} fimDeSemana={d.fimDeSemana}
            onAdicionar={(texto, tipo) => onAdicionar(l, d.iso, texto, tipo)}
            onAtualizar={onAtualizar} onRemover={onRemover} onVincular={onVincular} onDesvincular={onDesvincular} />
        </div>
      ))}
    </div>
  );
}

// ── Adicionar linha: pessoa da plataforma, nome livre ou linha especial ──────
function NovaLinhaModal({ linhas, onClose, onAdicionar }: {
  linhas: Linha[];
  onClose: () => void;
  onAdicionar: (nova: { tipo: TipoLinha; user_id?: string | null; nome?: string | null }) => void;
}) {
  const [pessoas, setPessoas] = useState<{ id: string; full_name: string; job_title: string | null }[]>([]);
  const [userId, setUserId] = useState('');
  const [nome, setNome] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    supabase.from('app_users').select('id, full_name, job_title').eq('status', 'ativo').eq('hidden', false).order('full_name')
      .then(({ data }) => setPessoas((data as any[]) || []));
  }, []);

  const jaTem = new Set(linhas.filter(l => l.user_id).map(l => l.user_id));
  const faltam = (['criacao', 'externas', 'entregas'] as TipoLinha[]).filter(t => !linhas.some(l => l.tipo === t));
  const ROTULOS: Record<string, string> = { criacao: 'Criação', externas: 'Externas', entregas: 'Entregas' };

  const enviar = async (nova: Parameters<typeof onAdicionar>[0]) => { setSalvando(true); await onAdicionar(nova); setSalvando(false); };

  return (
    <Modal isOpen onClose={onClose} title="Adicionar linha">
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Pessoa da plataforma</label>
          <div className="flex gap-2">
            <div className="flex-1">
              <Select value={userId} onChange={setUserId} searchable placeholder="Escolha uma pessoa" className="input-lumos w-full"
                options={pessoas.filter(p => !jaTem.has(p.id)).map(p => ({ value: p.id, label: p.full_name + (p.job_title ? ` · ${p.job_title}` : '') }))} />
            </div>
            <button disabled={!userId || salvando} onClick={() => enviar({ tipo: 'pessoa', user_id: userId })}
              className="btn-primary h-10 px-4 text-xs font-black disabled:opacity-50">Adicionar</button>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Nome livre (freela sem login)</label>
          <div className="flex gap-2">
            <input className="input-lumos flex-1" value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Freela 01"
              onKeyDown={e => { if (e.key === 'Enter' && nome.trim()) enviar({ tipo: 'pessoa', nome: nome.trim() }); }} />
            <button disabled={!nome.trim() || salvando} onClick={() => enviar({ tipo: 'pessoa', nome: nome.trim() })}
              className="btn-primary h-10 px-4 text-xs font-black disabled:opacity-50">Adicionar</button>
          </div>
        </div>
        {faltam.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Linha especial</label>
            <div className="flex gap-2 flex-wrap">
              {faltam.map(t => (
                <button key={t} disabled={salvando} onClick={() => enviar({ tipo: t, nome: ROTULOS[t] })}
                  className="h-9 px-4 text-xs font-black rounded-lumos border border-lumos-border text-lumos-text-primary hover:border-lumos-yellow/50 disabled:opacity-50">{ROTULOS[t]}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
