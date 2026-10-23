import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, FolderOpen, Search, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { formatBudgetCode } from '@/utils/formatters';

/**
 * ESCOLHER UM PROJETO NO CELULAR.
 *
 * No computador e no iPad o menu lateral tem a árvore clientes → projetos. No celular esse menu não
 * existe, e as pílulas do topo só levavam às páginas (Projetos, Agenda, Equipamentos…), nunca a um
 * projeto específico. Esta pílula abre uma folha com busca e a lista agrupada por cliente; dentro de
 * um projeto ela mostra o nome dele e serve para trocar de projeto sem voltar à lista.
 */
interface Item { id: string; name: string; code: string | null; status: string; client_id: string | null; client: string }

// Lista guardada por um minuto: abrir a folha várias vezes não refaz a consulta.
let cache: { itens: Item[]; ts: number } | null = null;
const VALIDADE_MS = 60_000;

async function carregar(): Promise<Item[]> {
  if (cache && Date.now() - cache.ts < VALIDADE_MS) return cache.itens;
  const [proj, cli] = await Promise.all([
    supabase.from('projects').select('id, name, code, status, client_id').in('status', ['ativo', 'concluido']).order('name'),
    supabase.from('clients').select('id, name'),
  ]);
  const nomeCliente = new Map<string, string>(((cli.data as any[]) || []).map(c => [c.id, c.name]));
  const itens: Item[] = ((proj.data as any[]) || []).map(p => ({
    id: p.id, name: p.name, code: p.code, status: p.status, client_id: p.client_id,
    client: (p.client_id && nomeCliente.get(p.client_id)) || 'Sem cliente',
  }));
  cache = { itens, ts: Date.now() };
  return itens;
}

/** Tira acento e caixa para a busca achar "Orcamento" em "Orçamento". */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function SeletorDeProjeto() {
  const location = useLocation();
  const navigate = useNavigate();
  const atualId = new URLSearchParams(location.search).get('projectId');
  const [aberto, setAberto] = useState(false);
  const [itens, setItens] = useState<Item[]>([]);
  const [busca, setBusca] = useState('');
  const [encerrados, setEncerrados] = useState(false);

  // Carrega a lista ao abrir a folha e, dentro de um projeto, para mostrar o nome na pílula.
  useEffect(() => {
    if (!aberto && !atualId) return;
    let vivo = true;
    carregar().then(l => { if (vivo) setItens(l); }).catch(() => { /* sem rede: a pílula fica só "Projeto" */ });
    return () => { vivo = false; };
  }, [aberto, atualId]);

  const atual = atualId ? itens.find(i => i.id === atualId) : undefined;

  const grupos = useMemo(() => {
    const t = norm(busca.trim());
    const lista = itens
      .filter(i => encerrados || i.status !== 'concluido')
      .filter(i => !t || norm(`${i.name} ${i.code ?? ''} ${i.client}`).includes(t));
    const porCliente = new Map<string, Item[]>();
    lista.forEach(i => { (porCliente.get(i.client) ?? porCliente.set(i.client, []).get(i.client)!).push(i); });
    return [...porCliente.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  }, [itens, busca, encerrados]);

  const abrir = (id: string) => {
    setAberto(false);
    setBusca('');
    navigate(`/producao/projetos?projectId=${id}`);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className={clsx(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all flex-shrink-0 cursor-pointer max-w-[200px]',
          atual ? 'bg-lumos-yellow text-black' : 'bg-lumos-surface text-lumos-text-secondary border border-lumos-border',
        )}
      >
        <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate">{atual ? atual.name : 'Escolher projeto'}</span>
        <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
      </button>

      <BottomSheet open={aberto} onOpenChange={o => { setAberto(o); if (!o) setBusca(''); }} title="Escolher projeto">
        <div className="space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-lumos-text-secondary pointer-events-none" />
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por projeto, código ou cliente…"
              className="input-lumos w-full h-11 pl-10 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-lumos-text-secondary select-none">
            <input type="checkbox" checked={encerrados} onChange={e => setEncerrados(e.target.checked)} className="accent-[#efc700]" />
            Mostrar projetos encerrados
          </label>

          {itens.length === 0 ? (
            <p className="py-8 text-center text-sm text-lumos-text-secondary">Carregando…</p>
          ) : grupos.length === 0 ? (
            <p className="py-8 text-center text-sm text-lumos-text-secondary">Nenhum projeto encontrado.</p>
          ) : (
            <div className="space-y-4 max-h-[55vh] overflow-y-auto -mx-1 px-1">
              {grupos.map(([cliente, projs]) => (
                <div key={cliente}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary mb-1.5 px-1">{cliente}</p>
                  <div className="space-y-1">
                    {projs.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => abrir(p.id)}
                        className={clsx(
                          'w-full flex items-center gap-2 text-left px-3 py-2.5 rounded-lumos border transition-colors',
                          p.id === atualId
                            ? 'border-lumos-yellow/50 bg-lumos-yellow/10'
                            : 'border-lumos-border hover:bg-lumos-text-secondary/5',
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-lumos-text-primary truncate">{p.name}</span>
                          {p.code && <span className="block text-[10.5px] text-lumos-text-secondary">{formatBudgetCode(p.code)}{p.status === 'concluido' ? ' · encerrado' : ''}</span>}
                        </span>
                        {p.id === atualId && <Check className="w-4 h-4 text-lumos-yellow flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </BottomSheet>
    </>
  );
}
