import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { ChevronRight, ChevronDown, Plus, Trash2, FileText } from 'lucide-react';
import { useWiki, type WikiPage } from '@/context/WikiContext';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/components/ui/useConfirm';

// Árvore de páginas da Wiki. Renderiza no painel de navegação do app (desktop) e
// num aside no tablet — sempre a MESMA árvore, alimentada pelo WikiContext.
export default function WikiTree() {
  const { pages, createPage, deletePage } = useWiki();
  const { pageId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const tree = useMemo(() => {
    const byParent = new Map<string | null, WikiPage[]>();
    for (const p of pages) {
      const k = p.parent_id;
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k)!.push(p);
    }
    return byParent;
  }, [pages]);

  const toggleExpand = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const onDelete = async (p: WikiPage) => {
    const kids = pages.filter(x => x.parent_id === p.id).length;
    if (!(await confirm({ title: 'Excluir página', message: kids ? `Excluir "${p.title}" e suas ${kids} sub-página(s)? Não dá pra desfazer.` : `Excluir "${p.title}"? Não dá pra desfazer.`, confirmLabel: 'Excluir', danger: true }))) return;
    const ok = await deletePage(p);
    if (!ok) { toast.error('Não foi possível excluir.'); return; }
    if (pageId === p.id) navigate('/wiki', { replace: true });
    toast.success('Página excluída.');
  };

  const renderNodes = (parentId: string | null, depth = 0) => {
    const nodes = tree.get(parentId) || [];
    return nodes.map(p => {
      const kids = tree.get(p.id) || [];
      const isOpen = expanded.has(p.id);
      const isActive = p.id === pageId;
      return (
        <div key={p.id}>
          <div
            className={clsx('group flex items-center gap-1.5 rounded-lumos pr-1.5 text-[13.5px] transition-colors',
              isActive ? 'bg-lumos-yellow/[0.12] text-lumos-yellow font-bold' : 'text-lumos-text-secondary hover:bg-white/[0.05] hover:text-lumos-text-primary')}
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            <button type="button" onClick={() => kids.length && toggleExpand(p.id)} className="w-4 flex-shrink-0 flex items-center justify-center text-lumos-text-secondary/70">
              {kids.length ? (isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />) : <span className="w-3.5" />}
            </button>
            <button type="button" onClick={() => navigate(`/wiki/${p.id}`)} className="flex-1 min-w-0 text-left py-1.5 flex items-center gap-1.5">
              <span className="flex-shrink-0">{p.icon || <FileText className="w-3.5 h-3.5 opacity-60" />}</span>
              <span className="truncate">{p.title}</span>
            </button>
            <button type="button" onClick={() => createPage(p.id)} title="Nova sub-página" className="w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white/10 flex-shrink-0"><Plus className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => onDelete(p)} title="Excluir" className="w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 flex-shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
          {isOpen && kids.length > 0 && renderNodes(p.id, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {dialog}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-2">
        {renderNodes(null)}
        <button onClick={() => createPage(null)} className="mt-2 w-full flex items-center gap-2 px-3 py-2 rounded-lumos border border-dashed border-lumos-border text-lumos-text-secondary hover:border-lumos-yellow/40 hover:text-lumos-yellow text-[12.5px] font-bold transition-colors">
          <Plus className="w-3.5 h-3.5" /> Nova página
        </button>
      </div>
    </div>
  );
}
