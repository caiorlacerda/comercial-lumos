import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronRight, ChevronDown, Layers, Plus } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';

// Paleta de bolinhas por cliente (estilo Momentum) — cor determinística pelo nome
const DOT_COLORS = [
  'bg-green-400', 'bg-purple-400', 'bg-orange-400',
  'bg-blue-400', 'bg-pink-400', 'bg-teal-400',
];
const dotColorFor = (name: string) => {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return DOT_COLORS[sum % DOT_COLORS.length];
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

export default function SidebarProjectTree() {
  const navigate = useNavigate();
  const location = useLocation();

  const [clients, setClients] = useState<TreeClient[]>([]);
  const [noClientProjects, setNoClientProjects] = useState<TreeProject[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [projRes, cliRes] = await Promise.all([
          supabase.from('projects').select('id, name, client_id').eq('status', 'ativo').order('name'),
          supabase.from('clients').select('id, name').order('name'),
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
      } catch (err) {
        console.error('Erro ao carregar árvore de projetos:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const openProject = (projectId: string) => {
    navigate(`/producao/projetos?projectId=${projectId}`);
  };

  const isAllActive = location.pathname === '/producao/projetos';

  return (
    <div className="mt-6 pt-4 border-t border-lumos-border/40">
      <h3 className="px-3 text-[10px] font-bold tracking-widest text-lumos-text-secondary mb-2 opacity-50 uppercase">
        Projetos
      </h3>

      {/* Todos os Projetos */}
      <button
        onClick={() => navigate('/producao/projetos')}
        className={clsx(
          'w-full flex items-center gap-3 px-3 py-2 rounded-lumos text-sm font-bold transition-all',
          isAllActive
            ? 'bg-lumos-yellow/10 text-lumos-yellow'
            : 'text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-text-secondary/5'
        )}
      >
        <Layers className="w-4 h-4 flex-shrink-0" />
        Todos os Projetos
      </button>

      {loading ? (
        <div className="px-3 py-2 space-y-1.5 animate-pulse">
          {[0, 1, 2].map(i => <div key={i} className="h-4 bg-lumos-border/30 rounded" />)}
        </div>
      ) : (
        <div className="space-y-0.5 mt-0.5">
          {clients.map(client => {
            const isOpen = expanded[client.id] ?? false;
            return (
              <div key={client.id}>
                <button
                  onClick={() => setExpanded(prev => ({ ...prev, [client.id]: !isOpen }))}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lumos text-xs font-bold text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/5 transition-all group"
                >
                  {isOpen
                    ? <ChevronDown className="w-3 h-3 flex-shrink-0 opacity-60" />
                    : <ChevronRight className="w-3 h-3 flex-shrink-0 opacity-60" />}
                  <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', dotColorFor(client.name))} />
                  <span className="truncate flex-1 text-left">{client.name}</span>
                  <span className="text-[9px] font-black opacity-40">{client.projects.length}</span>
                </button>

                {isOpen && (
                  <div className="ml-[26px] border-l border-lumos-border/40 pl-2 space-y-0.5 py-0.5">
                    {client.projects.map(proj => (
                      <button
                        key={proj.id}
                        onClick={() => openProject(proj.id)}
                        title={proj.name}
                        className="w-full text-left px-2 py-1.5 rounded text-[11px] font-semibold text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-text-secondary/5 transition-all truncate block"
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
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lumos text-xs font-bold text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/5 transition-all"
              >
                {(expanded.__none__ ?? false)
                  ? <ChevronDown className="w-3 h-3 flex-shrink-0 opacity-60" />
                  : <ChevronRight className="w-3 h-3 flex-shrink-0 opacity-60" />}
                <span className="w-2 h-2 rounded-full flex-shrink-0 bg-neutral-400" />
                <span className="truncate flex-1 text-left">Sem cliente</span>
                <span className="text-[9px] font-black opacity-40">{noClientProjects.length}</span>
              </button>
              {(expanded.__none__ ?? false) && (
                <div className="ml-[26px] border-l border-lumos-border/40 pl-2 space-y-0.5 py-0.5">
                  {noClientProjects.map(proj => (
                    <button
                      key={proj.id}
                      onClick={() => openProject(proj.id)}
                      title={proj.name}
                      className="w-full text-left px-2 py-1.5 rounded text-[11px] font-semibold text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-text-secondary/5 transition-all truncate block"
                    >
                      {proj.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {clients.length === 0 && noClientProjects.length === 0 && (
            <p className="px-3 py-2 text-[10px] text-lumos-text-secondary/50 italic">Nenhum projeto ativo.</p>
          )}

          {/* Novo projeto */}
          <button
            onClick={() => navigate('/producao/projetos')}
            className="w-full flex items-center gap-2 px-3 py-1.5 mt-1 rounded-lumos text-[11px] font-bold text-lumos-text-secondary/60 hover:text-lumos-yellow transition-all"
          >
            <Plus className="w-3.5 h-3.5 flex-shrink-0" />
            Novo projeto
          </button>
        </div>
      )}
    </div>
  );
}
