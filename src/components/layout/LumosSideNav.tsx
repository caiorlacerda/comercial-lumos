import React from 'react';
import { clsx } from 'clsx';
import { ChevronsLeft, Search } from 'lucide-react';

// Curva de mola suave — dá o "fluido" na expansão/colapso do painel.
const SPRING = 'cubic-bezier(0.25, 1.1, 0.4, 1)';

export interface NavSectionMeta {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}
export interface NavItemMeta {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
}

interface Props {
  logo: React.ReactNode;
  sections: NavSectionMeta[];            // já filtradas por permissão
  activeSectionId: string;
  onSelectSection: (id: string) => void;
  detailTitle: string;
  items: NavItemMeta[];                   // itens da seção ativa
  isItemActive: (item: NavItemMeta) => boolean;
  onNavigate: (path: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSearch?: () => void;
  railFooter?: React.ReactNode;           // tema / notificações / avatar
  renderItem?: (item: NavItemMeta) => React.ReactNode; // p/ casos especiais (árvore de projetos)
  panelBody?: React.ReactNode;            // substitui a lista de itens (ex.: árvore da Wiki)
}

/* --------------------------------- Rail ---------------------------------- */

function RailButton({
  active, label, onClick, children,
}: { active?: boolean; label: string; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={clsx(
        'group relative flex items-center justify-center rounded-lumos size-11 min-w-11 transition-colors',
        active
          ? 'bg-lumos-yellow/15 text-lumos-yellow'
          : 'text-lumos-text-secondary hover:bg-lumos-text-secondary/10 hover:text-lumos-text-primary'
      )}
    >
      {/* Indicador de seção ativa (barrinha à esquerda) */}
      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-full bg-lumos-yellow" />}
      {children}
      {/* Tooltip no hover */}
      <span className="pointer-events-none absolute left-full ml-2 z-50 whitespace-nowrap rounded-md bg-lumos-text-primary px-2 py-1 text-[11px] font-bold text-lumos-bg opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        {label}
      </span>
    </button>
  );
}

/* -------------------------------- Component ------------------------------ */

export default function LumosSideNav({
  logo, sections, activeSectionId, onSelectSection,
  detailTitle, items, isItemActive, onNavigate,
  collapsed, onToggleCollapse, onSearch, railFooter, renderItem, panelBody,
}: Props) {
  return (
    <div className="relative flex h-full">
      {/* ---------------- Rail de ícones (sempre visível) ---------------- */}
      <aside className="lumos-nav-surface flex w-16 flex-col items-center gap-1.5 border-r border-lumos-border py-3 flex-shrink-0">
        {/* Logo */}
        <div className="mb-2 flex size-10 items-center justify-center">{logo}</div>

        {/* Ícones de seção */}
        <div className="flex flex-1 flex-col items-center gap-1.5 w-full px-2">
          {sections.map((sec) => (
            <RailButton
              key={sec.id}
              active={activeSectionId === sec.id}
              label={sec.label}
              onClick={() => onSelectSection(sec.id)}
            >
              <sec.icon className="w-[18px] h-[18px]" />
            </RailButton>
          ))}
        </div>

        {/* Rodapé do rail: tema / notificações / avatar */}
        {railFooter && (
          <div className="flex flex-col items-center gap-1.5 w-full px-2 pt-2">
            {railFooter}
          </div>
        )}
      </aside>

      {/* ---------------- Painel de detalhe (expansível) ---------------- */}
      <div
        className={clsx('lumos-nav-surface border-r border-lumos-border overflow-hidden flex flex-col', collapsed ? 'w-0' : 'w-60')}
        style={{ transition: `width 380ms ${SPRING}` }}
      >
        <div className="w-60 flex flex-col h-full">
          {/* Cabeçalho: título da seção + colapsar */}
          <div className="flex items-center justify-between h-14 px-4 border-b border-lumos-border/60 flex-shrink-0">
            <h2 className="text-sm font-black uppercase tracking-wider text-lumos-text-primary truncate">{detailTitle}</h2>
            <button
              type="button"
              onClick={onToggleCollapse}
              title="Recolher"
              aria-label="Recolher painel"
              className="flex items-center justify-center rounded-md size-8 text-lumos-text-secondary hover:bg-lumos-text-secondary/10 hover:text-lumos-text-primary transition-colors flex-shrink-0"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
          </div>

          {/* Busca */}
          {onSearch && (
            <div className="px-3 pt-3 flex-shrink-0">
              <button
                type="button"
                onClick={onSearch}
                className="flex items-center gap-2 w-full h-9 px-3 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:border-lumos-yellow/40 hover:text-lumos-text-primary transition-all"
              >
                <Search className="w-4 h-4 flex-shrink-0" />
                <span className="text-xs font-semibold">Buscar</span>
                <kbd className="ml-auto text-[9px] font-black uppercase tracking-wider opacity-60">⌘K</kbd>
              </button>
            </div>
          )}

          {/* Corpo do painel: conteúdo custom (ex.: árvore da Wiki) ou a lista de itens */}
          {panelBody ? (
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{panelBody}</div>
          ) : (
          <nav className="flex-1 overflow-y-auto custom-scrollbar px-3 py-3 space-y-1">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-[11px] text-lumos-text-secondary/60">Sem itens nesta seção.</p>
            ) : (
              items.map((item) => {
                // renderItem pode devolver um nó custom (ex.: árvore de projetos);
                // se devolver null/undefined, cai no botão padrão.
                const custom = renderItem?.(item);
                if (custom) return <React.Fragment key={item.path}>{custom}</React.Fragment>;
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => onNavigate(item.path)}
                    className={clsx(
                      'relative flex items-center gap-3 w-full px-3 py-2.5 rounded-lumos text-sm font-bold transition-colors text-left',
                      isItemActive(item)
                        ? 'bg-lumos-yellow/10 text-lumos-yellow'
                        : 'text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/5'
                    )}
                  >
                    {isItemActive(item) && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full bg-lumos-yellow" />}
                    <item.icon className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })
            )}
          </nav>
          )}

          {/* Rodapé */}
          <div className="p-3 border-t border-lumos-border/50 flex-shrink-0 text-center">
            <p className="text-[9px] text-lumos-text-secondary font-semibold uppercase tracking-widest opacity-40">
              Produtora Lumos © {new Date().getFullYear()}
            </p>
          </div>
        </div>
      </div>

      {/* Botão flutuante pra reabrir quando colapsado — só quando a seção tem
          painel de detalhe (itens). Em Início/Wiki (sem itens, navegação própria)
          não faz sentido: a seta ficava órfã ao lado do logo. */}
      {collapsed && items.length > 0 && (
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Expandir painel"
          aria-label="Expandir painel"
          className="absolute left-16 top-3 z-40 flex items-center justify-center rounded-r-lumos h-8 w-5 bg-lumos-surface border border-l-0 border-lumos-border text-lumos-text-secondary hover:text-lumos-yellow transition-colors"
        >
          <ChevronsLeft className="w-3.5 h-3.5 rotate-180" />
        </button>
      )}
    </div>
  );
}
