import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronRight, ChevronDown, ClipboardList, Layers, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';

// Cores disponíveis para clientes. A chave é o que fica salvo no banco
// (client_colors.color); a classe é só apresentação.
export const CLIENT_COLOR_OPTIONS: { key: string; className: string; label: string }[] = [
  { key: 'green', className: 'bg-green-400', label: 'Verde' },
  { key: 'purple', className: 'bg-purple-400', label: 'Roxo' },
  { key: 'orange', className: 'bg-orange-400', label: 'Laranja' },
  { key: 'blue', className: 'bg-blue-400', label: 'Azul' },
  { key: 'pink', className: 'bg-pink-400', label: 'Rosa' },
  { key: 'teal', className: 'bg-teal-400', label: 'Verde-água' },
  { key: 'red', className: 'bg-red-400', label: 'Vermelho' },
  { key: 'yellow', className: 'bg-yellow-400', label: 'Amarelo' },
  { key: 'indigo', className: 'bg-indigo-400', label: 'Índigo' },
  { key: 'neutral', className: 'bg-neutral-400', label: 'Cinza' },
];

const classForColorKey = (key: string) =>
  CLIENT_COLOR_OPTIONS.find(c => c.key === key)?.className || 'bg-neutral-400';

// Fallback automático: cor determinística pelo nome (quando não há cor salva)
const AUTO_COLORS = CLIENT_COLOR_OPTIONS.slice(0, 6).map(c => c.className);
const autoColorFor = (name: string) => {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return AUTO_COLORS[sum % AUTO_COLORS.length];
};

interface TreeProject {
  id: string;
  name: string;
  client_id: string | null;
}

interface TreeClient {
  id: string;
  name: string;
  projects: TreeProject[];
}

// Item "Projetos" da sidebar de Produção: um dropdown (como no Momentum) que
// expande para "Todos os Projetos" (Visão Geral) + árvore de clientes →
// projetos ativos. Botão direito num cliente abre o seletor de cor.
export default function SidebarProjectTree() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { isAdmin } = useAuth();

  const [open, setOpen] = useState(true);
  const [clients, setClients] = useState<TreeClient[]>([]);
  const [noClientProjects, setNoClientProjects] = useState<TreeProject[]>([]);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [colorMenu, setColorMenu] = useState<{ x: number; y: number; clientId: string } | null>(null);
  // Menu de contexto (botão direito) no projeto + exclusão definitiva (admin)
  const [projMenu, setProjMenu] = useState<{ x: number; y: number; id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [projRes, cliRes, colorRes] = await Promise.all([
          supabase.from('projects').select('id, name, client_id').eq('status', 'ativo').order('name'),
          supabase.from('clients').select('id, name').order('name'),
          supabase.from('client_colors').select('client_id, color'),
        ]);
        if (cancelled) return;

        const projects = (projRes.data as TreeProject[]) || [];
        const byClient: Record<string, TreeProject[]> = {};
        const orphans: TreeProject[] = [];
        projects.forEach(p => {
          if (p.client_id) (byClient[p.client_id] = byClient[p.client_id] || []).push(p);
          else orphans.push(p);
        });

        // Só clientes com projetos ativos aparecem na árvore
        const tree: TreeClient[] = ((cliRes.data as { id: string; name: string }[]) || [])
          .filter(c => byClient[c.id]?.length)
          .map(c => ({ ...c, projects: byClient[c.id] }));

        setClients(tree);
        setNoClientProjects(orphans);

        // Cores personalizadas (tabela pode não existir ainda — ignora erro)
        if (!colorRes.error && colorRes.data) {
          const map: Record<string, string> = {};
          (colorRes.data as { client_id: string; color: string }[]).forEach(r => { map[r.client_id] = r.color; });
          setColors(map);
        }
      } catch (err) {
        console.error('Erro ao carregar árvore de projetos:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fecha o menu de cor com Esc
  useEffect(() => {
    if (!colorMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setColorMenu(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [colorMenu]);

  const dotClassFor = (client: TreeClient) =>
    colors[client.id] ? classForColorKey(colors[client.id]) : autoColorFor(client.name);

  const setClientColor = async (clientId: string, colorKey: string | null) => {
    setColorMenu(null);
    const previous = colors[clientId];

    // Otimista
    setColors(prev => {
      const next = { ...prev };
      if (colorKey) next[clientId] = colorKey;
      else delete next[clientId];
      return next;
    });

    try {
      if (colorKey) {
        const { error } = await supabase
          .from('client_colors')
          .upsert({ client_id: clientId, color: colorKey, updated_at: new Date().toISOString() }, { onConflict: 'client_id' });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('client_colors').delete().eq('client_id', clientId);
        if (error) throw error;
      }
    } catch (err: any) {
      console.error('Erro ao salvar cor do cliente:', err);
      toast.error('Não foi possível salvar a cor do cliente.');
      // Rollback
      setColors(prev => {
        const next = { ...prev };
        if (previous) next[clientId] = previous;
        else delete next[clientId];
        return next;
      });
    }
  };

  const openProject = (projectId: string) => {
    navigate(`/producao/projetos?projectId=${projectId}`);
  };

  const openProjMenu = (e: React.MouseEvent, proj: TreeProject) => {
    if (!isAdmin) return;
    e.preventDefault();
    setProjMenu({ x: e.clientX, y: e.clientY, id: proj.id, name: proj.name });
  };

  // Exclui o projeto DEFINITIVAMENTE (tarefas, comentários e registro
  // financeiro caem por cascade; a pasta do Drive não é apagada).
  const handleDeleteProject = async () => {
    if (!confirmDelete) return;
    const { id, name } = confirmDelete;
    try {
      setDeleting(true);
      const { error } = await supabase.from('projects').delete().eq('id', id);
      if (error) throw error;

      // Remove da árvore local; some o cliente que ficar sem projetos ativos
      setClients(prev => prev
        .map(c => ({ ...c, projects: c.projects.filter(p => p.id !== id) }))
        .filter(c => c.projects.length > 0));
      setNoClientProjects(prev => prev.filter(p => p.id !== id));

      toast.success(`Projeto "${name}" excluído.`);
      setConfirmDelete(null);
      // Se estava vendo esse projeto, sai para a Visão Geral
      navigate('/producao');
    } catch (err: any) {
      console.error('Erro ao excluir projeto:', err);
      toast.error(`Erro ao excluir: ${err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  // "Todos os Projetos" = Visão Geral (/producao)
  const isOverviewActive = location.pathname === '/producao';
  const isHeaderActive = isOverviewActive || location.pathname === '/producao/projetos';
  // Projeto aberto no momento (vem na URL). Usado para destacar na árvore.
  const activeProjectId = new URLSearchParams(location.search).get('projectId');

  // Ao abrir um projeto, expande automaticamente o cliente dele para que o
  // item destacado fique visível (inclusive ao entrar por link direto).
  useEffect(() => {
    if (!activeProjectId) return;
    const client = clients.find(c => c.projects.some(p => p.id === activeProjectId));
    if (client) setExpanded(prev => (prev[client.id] ? prev : { ...prev, [client.id]: true }));
    else if (noClientProjects.some(p => p.id === activeProjectId))
      setExpanded(prev => (prev.__none__ ? prev : { ...prev, __none__: true }));
  }, [activeProjectId, clients, noClientProjects]);

  return (
    <div>
      {/* Item "Projetos" (header do dropdown) */}
      <button
        onClick={() => setOpen(prev => !prev)}
        className={clsx(
          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lumos text-sm font-bold transition-all',
          isHeaderActive
            ? 'bg-lumos-yellow/10 text-lumos-yellow'
            : 'text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-text-secondary/5'
        )}
      >
        <ClipboardList className="w-4 h-4 flex-shrink-0" />
        <span className="flex-1 text-left">Projetos</span>
        {open
          ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
          : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="ml-3 pl-2 border-l border-lumos-border/40 space-y-0.5 py-1">
          {/* Todos os Projetos → Visão Geral */}
          <button
            onClick={() => navigate('/producao')}
            className={clsx(
              'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lumos text-xs font-bold transition-all',
              isOverviewActive
                ? 'bg-lumos-yellow/10 text-lumos-yellow'
                : 'text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-text-secondary/5'
            )}
          >
            <Layers className="w-3.5 h-3.5 flex-shrink-0" />
            Todos os Projetos
          </button>

          {loading ? (
            <div className="px-2.5 py-2 space-y-1.5 animate-pulse">
              {[0, 1, 2].map(i => <div key={i} className="h-3.5 bg-lumos-border/30 rounded" />)}
            </div>
          ) : (
            <>
              {clients.map(client => {
                const isOpen = expanded[client.id] ?? false;
                return (
                  <div key={client.id}>
                    <button
                      onClick={() => setExpanded(prev => ({ ...prev, [client.id]: !isOpen }))}
                      onContextMenu={e => {
                        e.preventDefault();
                        setColorMenu({ x: e.clientX, y: e.clientY, clientId: client.id });
                      }}
                      title={`${client.name} — botão direito para escolher a cor`}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lumos text-xs font-bold text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/5 transition-all"
                    >
                      {isOpen
                        ? <ChevronDown className="w-3 h-3 flex-shrink-0 opacity-60" />
                        : <ChevronRight className="w-3 h-3 flex-shrink-0 opacity-60" />}
                      <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', dotClassFor(client))} />
                      <span className="truncate flex-1 text-left">{client.name}</span>
                      <span className="text-[9px] font-black opacity-40">{client.projects.length}</span>
                    </button>

                    {isOpen && (
                      <div className="ml-[22px] border-l border-lumos-border/40 pl-2 space-y-0.5 py-0.5">
                        {client.projects.map(proj => (
                          <button
                            key={proj.id}
                            onClick={() => openProject(proj.id)}
                            onContextMenu={e => openProjMenu(e, proj)}
                            title={isAdmin ? `${proj.name} — botão direito para excluir` : proj.name}
                            className={clsx(
                              'w-full text-left px-2 py-1.5 rounded text-[11px] font-semibold transition-all truncate block',
                              proj.id === activeProjectId
                                ? 'bg-lumos-yellow/10 text-lumos-yellow'
                                : 'text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-text-secondary/5'
                            )}
                          >
                            {proj.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Projetos sem cliente */}
              {noClientProjects.length > 0 && (
                <div>
                  <button
                    onClick={() => setExpanded(prev => ({ ...prev, __none__: !(prev.__none__ ?? false) }))}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lumos text-xs font-bold text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/5 transition-all"
                  >
                    {(expanded.__none__ ?? false)
                      ? <ChevronDown className="w-3 h-3 flex-shrink-0 opacity-60" />
                      : <ChevronRight className="w-3 h-3 flex-shrink-0 opacity-60" />}
                    <span className="w-2 h-2 rounded-full flex-shrink-0 bg-neutral-400" />
                    <span className="truncate flex-1 text-left">Sem cliente</span>
                    <span className="text-[9px] font-black opacity-40">{noClientProjects.length}</span>
                  </button>
                  {(expanded.__none__ ?? false) && (
                    <div className="ml-[22px] border-l border-lumos-border/40 pl-2 space-y-0.5 py-0.5">
                      {noClientProjects.map(proj => (
                        <button
                          key={proj.id}
                          onClick={() => openProject(proj.id)}
                          onContextMenu={e => openProjMenu(e, proj)}
                          title={isAdmin ? `${proj.name} — botão direito para excluir` : proj.name}
                          className={clsx(
                            'w-full text-left px-2 py-1.5 rounded text-[11px] font-semibold transition-all truncate block',
                            proj.id === activeProjectId
                              ? 'bg-lumos-yellow/10 text-lumos-yellow'
                              : 'text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-text-secondary/5'
                          )}
                        >
                          {proj.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {clients.length === 0 && noClientProjects.length === 0 && (
                <p className="px-2.5 py-2 text-[10px] text-lumos-text-secondary/50 italic">Nenhum projeto ativo.</p>
              )}

              {/* Novo projeto → abre o modal de criação direto */}
              <button
                onClick={() => navigate('/producao/projetos?new=1')}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lumos text-[11px] font-bold text-lumos-text-secondary/60 hover:text-lumos-yellow transition-all"
              >
                <Plus className="w-3.5 h-3.5 flex-shrink-0" />
                Novo projeto
              </button>
            </>
          )}
        </div>
      )}

      {/* Menu de cor (botão direito no cliente) */}
      {colorMenu && (
        <>
          <div className="fixed inset-0 z-[190]" onClick={() => setColorMenu(null)} onContextMenu={e => { e.preventDefault(); setColorMenu(null); }} />
          <div
            className="fixed z-[200] bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-3 animate-in fade-in zoom-in-95 duration-100"
            style={{ left: Math.min(colorMenu.x, window.innerWidth - 200), top: Math.min(colorMenu.y, window.innerHeight - 140) }}
          >
            <p className="text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary mb-2">Cor do cliente</p>
            <div className="grid grid-cols-5 gap-1.5">
              {CLIENT_COLOR_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  title={opt.label}
                  onClick={() => setClientColor(colorMenu.clientId, opt.key)}
                  className={clsx(
                    'w-6 h-6 rounded-full transition-transform hover:scale-110 border-2',
                    opt.className,
                    colors[colorMenu.clientId] === opt.key ? 'border-lumos-text-primary' : 'border-transparent'
                  )}
                />
              ))}
            </div>
            <button
              onClick={() => setClientColor(colorMenu.clientId, null)}
              className="mt-2.5 w-full flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-lumos-text-secondary hover:text-lumos-yellow transition-colors py-1 border-t border-lumos-border/40 pt-2"
            >
              <RotateCcw className="w-3 h-3" /> Automática
            </button>
          </div>
        </>
      )}

      {/* Menu de contexto do projeto (botão direito) */}
      {projMenu && (
        <>
          <div className="fixed inset-0 z-[190]" onClick={() => setProjMenu(null)} onContextMenu={e => { e.preventDefault(); setProjMenu(null); }} />
          <div
            className="fixed z-[200] bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl py-1.5 min-w-[190px] animate-in fade-in zoom-in-95 duration-100"
            style={{ left: Math.min(projMenu.x, window.innerWidth - 210), top: Math.min(projMenu.y + 4, window.innerHeight - 80) }}
          >
            <button
              onClick={() => { setConfirmDelete({ id: projMenu.id, name: projMenu.name }); setProjMenu(null); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-bold text-red-400 hover:bg-red-500/10 transition-colors text-left"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Excluir projeto…
            </button>
          </div>
        </>
      )}

      {/* Confirmação de exclusão definitiva */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-lumos-surface border border-red-500/30 rounded-lumos shadow-2xl p-6 space-y-4 text-lumos-text-primary text-center">
            <div className="mx-auto w-12 h-12 bg-red-500/10 border border-red-500/20 text-red-500 rounded-full flex items-center justify-center">
              <Trash2 className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-base font-bold uppercase tracking-tight text-lumos-text-primary">
                Excluir "{confirmDelete.name}"?
              </h3>
              <p className="text-xs text-lumos-text-secondary leading-relaxed">
                Esta ação é <span className="font-bold text-red-400">definitiva</span> e apaga junto:
              </p>
              <ul className="text-xs text-lumos-text-secondary text-left mx-auto max-w-[280px] space-y-1 pt-1">
                <li>• Todas as <b>tarefas</b> e <b>comentários</b> do projeto</li>
                <li>• O <b>registro financeiro</b> vinculado (projetos_financeiro)</li>
              </ul>
              <p className="text-[11px] text-lumos-text-secondary/70 leading-relaxed pt-1.5">
                A pasta no <b>Google Drive não</b> é apagada. Custos já lançados permanecem no financeiro (vinculados ao orçamento).
              </p>
            </div>
            <div className="flex items-center justify-center gap-2.5 pt-3">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="btn-secondary text-xs w-full py-2.5 font-bold"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteProject}
                disabled={deleting}
                className="w-full py-2.5 text-xs font-bold rounded-lumos bg-red-500 hover:bg-red-600 text-white transition-all flex items-center justify-center gap-2"
              >
                {deleting
                  ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : 'Sim, excluir definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
