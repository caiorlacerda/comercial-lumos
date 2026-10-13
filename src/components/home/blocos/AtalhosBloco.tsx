import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { NAV_SECTIONS, getSectionItems } from '@/lib/navigation';

/** Atalhos para as telas a que a pessoa tem acesso (os 8 primeiros). */
export default function AtalhosBloco() {
  const navigate = useNavigate();
  const { can, isAdmin } = useAuth();
  const ctx = useMemo(() => ({ can, isAdmin }), [can, isAdmin]);

  // Filter dynamic visible navigation items as shortcuts
  const shortcuts = useMemo(() => {
    const visibleShortcuts: { label: string; path: string; icon: any }[] = [];
    NAV_SECTIONS.forEach(sec => {
      if (sec.visibleWhen(ctx)) {
        const items = getSectionItems(sec.id, ctx);
        items.forEach(item => {
          // Exclude configuration details and raw list pages to keep it clean
          if (item.path !== '/configuracoes' && item.path !== '/financeiro/configuracao') {
            visibleShortcuts.push({ label: item.label, path: item.path, icon: item.icon });
          }
        });
      }
    });
    return visibleShortcuts.slice(0, 8); // Display top 8 shortcuts
  }, [ctx]);

  return (
    <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-3.5 space-y-3.5 shadow-sm">
      <h2 className="text-[11px] uppercase tracking-[3px] text-lumos-text-primary flex items-center gap-3 border-b border-lumos-border/50 pb-2.5">
        <span className="block h-2 w-2 bg-lumos-yellow" /> Atalhos Rápidos
      </h2>

      {shortcuts.length === 0 ? (
        <p className="text-xs text-lumos-text-secondary italic text-center py-4">Nenhum atalho disponível.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {shortcuts.map(shortcut => (
            <button
              key={shortcut.path}
              onClick={() => navigate(shortcut.path)}
              className="flex flex-col items-center justify-center p-3 rounded border border-lumos-border bg-lumos-bg/35 hover:bg-lumos-yellow/5 hover:border-lumos-yellow/20 transition-all text-center gap-1.5 group cursor-pointer"
            >
              <shortcut.icon className="w-4 h-4 text-lumos-text-secondary group-hover:text-lumos-yellow transition-all" />
              <span className="text-[10px] font-black uppercase tracking-wider text-lumos-text-primary group-hover:text-lumos-yellow transition-all leading-none">
                {shortcut.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
