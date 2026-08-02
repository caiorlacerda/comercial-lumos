import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Home, Briefcase, Hammer, DollarSign, Settings, Sun, Moon, LogOut, BookOpen,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/context/ThemeContext';
import { useLayout, SectionType } from '@/context/LayoutContext';
import { getVisibleSections, getSectionItems } from '@/lib/navigation';
import { openCommandPalette } from '@/components/common/CommandPalette';
import NotificationBell from '@/components/layout/NotificationBell';
import WorldClock from '@/components/layout/WorldClock';
import SidebarProjectTree from '@/components/layout/SidebarProjectTree';
import StatusDot from '@/components/common/StatusDot';
import LumosSideNav, { type NavSectionMeta, type NavItemMeta } from '@/components/layout/LumosSideNav';
import { clsx } from 'clsx';

// Ícone + rótulo de cada seção no rail. As sub-páginas continuam vindo de
// getSectionItems (fonte única em navigation.ts).
const SECTION_META: Record<SectionType, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  home: { label: 'Início', icon: Home },
  wiki: { label: 'Wiki', icon: BookOpen },
  comercial: { label: 'Comercial', icon: Briefcase },
  producao: { label: 'Produção', icon: Hammer },
  financeiro: { label: 'Financeiro', icon: DollarSign },
  configuracoes: { label: 'Configurações', icon: Settings },
};

export default function DesktopNav() {
  const { can, isAdmin, profile, user, signOut, updatePresenceStatus } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { activeSection, navigateToSection } = useLayout();
  const navigate = useNavigate();
  const location = useLocation();

  const ctx = { can, isAdmin };

  // Rail: Início + seções visíveis por permissão + Wiki na penúltima posição
  // (antes de Configurações), disponível pra todo o time.
  const permissionSections = getVisibleSections(ctx).map((s) => ({
    id: s.id as string,
    label: SECTION_META[s.id].label,
    icon: SECTION_META[s.id].icon,
  }));
  const wikiEntry = { id: 'wiki', label: SECTION_META.wiki.label, icon: SECTION_META.wiki.icon };
  // Insere a Wiki logo antes de "Configurações" (se visível); senão, no fim.
  const cfgIdx = permissionSections.findIndex((s) => s.id === 'configuracoes');
  if (cfgIdx >= 0) permissionSections.splice(cfgIdx, 0, wikiEntry);
  else permissionSections.push(wikiEntry);
  const railSections: NavSectionMeta[] = [
    { id: 'home', label: SECTION_META.home.label, icon: SECTION_META.home.icon },
    ...permissionSections,
  ];

  const items: NavItemMeta[] = activeSection === 'home'
    ? []
    : getSectionItems(activeSection, ctx).map((it) => ({ path: it.path, label: it.label, icon: it.icon, end: it.end }));

  const isItemActive = (item: NavItemMeta) =>
    item.end ? location.pathname === item.path : location.pathname.startsWith(item.path);

  // Colapso: Início sempre recolhido (é a tela cheia); nas demais seções,
  // respeita a preferência manual (lembrada por usuário).
  // Início é tela cheia e a Wiki tem navegação própria (espaços + árvore),
  // então ambas mantêm o painel de detalhe recolhido.
  const [userCollapsed, setUserCollapsed] = useState<boolean>(() => localStorage.getItem('lumos-nav-collapsed') === '1');
  const collapsed = activeSection === 'home' || activeSection === 'wiki' ? true : userCollapsed;
  const setCollapsed = (v: boolean) => {
    setUserCollapsed(v);
    localStorage.setItem('lumos-nav-collapsed', v ? '1' : '0');
  };

  const onSelectSection = (id: string) => {
    // Início e Wiki não têm painel de detalhe (têm navegação própria).
    if (id !== 'home' && id !== 'wiki') setCollapsed(false);   // abrir a seção mostra os itens
    navigateToSection(id as SectionType);
  };

  const logo = (
    <img
      src={theme === 'dark' ? '/logo/Logo-Branco-Alpha.svg' : '/logo/Logo-Preto-Alpha.svg'}
      alt="Lumos"
      className="h-7 w-auto"
    />
  );

  const railFooter = (
    <>
      <WorldClock vertical className="mb-1" />
      <button
        onClick={toggleTheme}
        title="Alternar tema"
        className="flex items-center justify-center rounded-lumos size-11 text-lumos-text-secondary hover:bg-lumos-text-secondary/10 hover:text-lumos-text-primary transition-colors"
      >
        {theme === 'dark' ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
      </button>
      <div className="flex items-center justify-center size-11"><NotificationBell /></div>
      <AvatarMenu
        profile={profile}
        user={user}
        onStatus={(s) => updatePresenceStatus(s)}
        onConfig={() => navigate('/configuracoes')}
        onSignOut={async () => { await signOut(); navigate('/login'); }}
      />
    </>
  );

  const renderItem = (item: NavItemMeta) => {
    // Na Produção, "Projetos" abre a árvore de clientes → projetos.
    if (activeSection === 'producao' && item.path === '/producao') {
      return <SidebarProjectTree />;
    }
    return null; // usa o render padrão do LumosSideNav
  };

  return (
    <LumosSideNav
      logo={logo}
      sections={railSections}
      activeSectionId={activeSection}
      onSelectSection={onSelectSection}
      detailTitle={SECTION_META[activeSection]?.label || ''}
      items={items}
      isItemActive={isItemActive}
      onNavigate={(p) => navigate(p)}
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed(!userCollapsed)}
      onSearch={openCommandPalette}
      railFooter={railFooter}
      renderItem={(item) => renderItem(item)}
    />
  );
}

/* ------------------------- Avatar + menu de perfil ------------------------ */

function AvatarMenu({
  profile, user, onStatus, onConfig, onSignOut,
}: {
  profile: any; user: any;
  onStatus: (s: 'online' | 'busy' | 'away') => void;
  onConfig: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : (user?.email?.charAt(0).toUpperCase() || '?');

  const statusOpt = (s: 'online' | 'busy' | 'away', label: string, dot: string) => {
    const activeS = s === 'online' ? (profile?.presence_status === 'online' || !profile?.presence_status) : profile?.presence_status === s;
    return (
      <button
        onClick={() => { onStatus(s); setOpen(false); }}
        className={clsx('flex items-center gap-2 w-full px-2 py-1 rounded text-xs font-semibold text-left transition-colors',
          activeS ? 'bg-lumos-yellow/10 text-lumos-yellow' : 'text-lumos-text-secondary hover:bg-lumos-text-secondary/5 hover:text-lumos-text-primary')}
      >
        <span className={clsx('w-2 h-2 rounded-full', dot)} />
        {label}
      </button>
    );
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative w-9 h-9 rounded-full bg-lumos-yellow flex items-center justify-center text-black font-black text-xs ring-2 ring-lumos-yellow/20"
        title={profile?.full_name || user?.email}
      >
        {user?.user_metadata?.avatar_url
          ? <img src={user.user_metadata.avatar_url} alt="Avatar" className="w-full h-full rounded-full object-cover" />
          : <span>{initials}</span>}
        <span className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-lumos-surface">
          <StatusDot status={profile?.presence_status || 'online'} />
        </span>
      </button>

      {open && (
        <div className="absolute left-full bottom-0 ml-2 w-56 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl z-[60] py-1.5 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="px-4 py-2 border-b border-lumos-border">
            <p className="text-xs font-bold text-lumos-text-primary truncate">{profile?.full_name || user?.user_metadata?.full_name || 'Usuário'}</p>
            <p className="text-[10px] text-lumos-text-secondary truncate mt-0.5">{profile?.email || user?.email}</p>
          </div>
          <div className="px-3 py-2 border-b border-lumos-border">
            <p className="text-[9px] font-black uppercase tracking-wider text-lumos-text-secondary mb-1.5">Status de Presença</p>
            <div className="space-y-1">
              {statusOpt('online', 'Online', 'bg-green-500')}
              {statusOpt('busy', 'Ocupado', 'bg-red-500')}
              {statusOpt('away', 'Ausente', 'bg-yellow-500')}
            </div>
          </div>
          <div className="py-1">
            <button onClick={() => { onConfig(); setOpen(false); }} className="flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/5 w-full text-left transition-colors">
              <Settings className="w-4 h-4" /> Configurações
            </button>
            <button onClick={() => { setOpen(false); onSignOut(); }} className="flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-red-500 hover:bg-red-500/10 w-full text-left transition-colors">
              <LogOut className="w-4 h-4" /> Sair
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
