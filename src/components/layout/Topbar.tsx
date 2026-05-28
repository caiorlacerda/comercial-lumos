import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Menu, Sun, Moon, LogOut, Settings, User, Bell, ChevronDown } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/context/ThemeContext';
import { useLayout, SectionType } from '@/context/LayoutContext';
import StatusDot from '@/components/common/StatusDot';
import NotificationBell from '@/components/layout/NotificationBell';
import { clsx } from 'clsx';

export default function Topbar() {
  const { signOut, user, profile, isAdmin, can, updatePresenceStatus } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { activeSection, navigateToSection, mobileSidebarOpen, setMobileSidebarOpen } = useLayout();
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  // Section buttons data
  const sections = [
    { id: 'comercial' as SectionType, label: 'Comercial', visible: isAdmin },
    { id: 'producao' as SectionType, label: 'Produção', visible: can('ordem_do_dia') || can('fornecedores') || can('custos_projeto') },
    { id: 'financeiro' as SectionType, label: 'Financeiro', visible: true },
    { id: 'configuracoes' as SectionType, label: 'Configurações', visible: true },
  ];

  const handleStatusChange = async (status: 'online' | 'busy' | 'away') => {
    await updatePresenceStatus(status);
    setDropdownOpen(false);
  };

  const getStatusLabel = (status?: string) => {
    switch (status) {
      case 'busy': return 'Ocupado';
      case 'away': return 'Ausente';
      case 'online':
      default: return 'Online';
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full h-16 bg-lumos-surface/85 backdrop-blur-md border-b border-lumos-border flex items-center justify-between px-4 lg:px-8 transition-colors duration-300">
      {/* Left: Mobile Menu + Logo + Desktop Section Links */}
      <div className="flex items-center gap-6">
        {/* Mobile Menu Toggle */}
        <button
          onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
          className="lg:hidden p-2 rounded-lg text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10 transition-colors"
          aria-label="Toggle Sidebar"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Logo */}
        <Link to="/" className="flex items-center">
          <img
            src={theme === 'dark' ? "/logo/Logotipo-Branco-Alpha.svg" : "/logo/Logotipo-Preto-Alpha.svg"}
            alt="Lumos Logo"
            className="h-7 transition-all duration-300"
          />
        </Link>

        {/* Desktop Section Buttons */}
        <nav className="hidden lg:flex items-center gap-1.5 ml-4">
          {sections.map(
            (sec) =>
              sec.visible && (
                <button
                  key={sec.id}
                  onClick={() => navigateToSection(sec.id)}
                  className={clsx(
                    "px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all",
                    activeSection === sec.id
                      ? "bg-lumos-yellow/15 text-lumos-yellow border border-lumos-yellow/20"
                      : "text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/5 border border-transparent"
                  )}
                >
                  {sec.label}
                </button>
              )
          )}
        </nav>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-4">
        {/* Notification Bell */}
        <NotificationBell />

        {/* Theme Toggle (Compact Icon) */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-full text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-text-secondary/5 transition-all flex items-center justify-center"
          title="Alternar Tema"
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>

        {/* User Profile Menu */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 p-1.5 rounded-full hover:bg-lumos-text-secondary/5 transition-all text-left"
          >
            <div className="relative w-8 h-8 rounded-full bg-lumos-yellow flex items-center justify-center text-black font-black text-xs shadow-sm overflow-visible ring-2 ring-lumos-yellow/20 flex-shrink-0">
              {user?.user_metadata?.avatar_url ? (
                <img src={user.user_metadata.avatar_url} alt="Avatar" className="w-full h-full rounded-full object-cover" />
              ) : (
                <span>
                  {profile?.full_name
                    ? profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                    : user?.email?.charAt(0).toUpperCase()}
                </span>
              )}
              {/* Presence Indicator */}
              <span className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-lumos-surface">
                <StatusDot status={profile?.presence_status || 'online'} />
              </span>
            </div>
            <ChevronDown className="w-4 h-4 text-lumos-text-secondary hidden sm:block" />
          </button>

          {/* User Dropdown */}
          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-lumos-surface border border-lumos-border rounded-lumos shadow-xl z-50 py-1.5 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="px-4 py-2 border-b border-lumos-border">
                <p className="text-xs font-bold text-lumos-text-primary truncate">
                  {profile?.full_name || user?.user_metadata?.full_name || 'Usuário'}
                </p>
                <p className="text-[10px] text-lumos-text-secondary truncate mt-0.5">
                  {profile?.email || user?.email}
                </p>
              </div>

              {/* Status Selectors */}
              <div className="px-3 py-2 border-b border-lumos-border">
                <p className="text-[9px] font-black uppercase tracking-wider text-lumos-text-secondary mb-1.5">
                  Status de Presença
                </p>
                <div className="space-y-1">
                  <button
                    onClick={() => handleStatusChange('online')}
                    className={clsx(
                      "flex items-center gap-2 w-full px-2 py-1 rounded text-xs font-semibold text-left transition-colors",
                      (profile?.presence_status === 'online' || !profile?.presence_status)
                        ? "bg-lumos-yellow/10 text-lumos-yellow"
                        : "text-lumos-text-secondary hover:bg-lumos-text-secondary/5 hover:text-lumos-text-primary"
                    )}
                  >
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    Online
                  </button>
                  <button
                    onClick={() => handleStatusChange('busy')}
                    className={clsx(
                      "flex items-center gap-2 w-full px-2 py-1 rounded text-xs font-semibold text-left transition-colors",
                      profile?.presence_status === 'busy'
                        ? "bg-lumos-yellow/10 text-lumos-yellow"
                        : "text-lumos-text-secondary hover:bg-lumos-text-secondary/5 hover:text-lumos-text-primary"
                    )}
                  >
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    Ocupado
                  </button>
                  <button
                    onClick={() => handleStatusChange('away')}
                    className={clsx(
                      "flex items-center gap-2 w-full px-2 py-1 rounded text-xs font-semibold text-left transition-colors",
                      profile?.presence_status === 'away'
                        ? "bg-lumos-yellow/10 text-lumos-yellow"
                        : "text-lumos-text-secondary hover:bg-lumos-text-secondary/5 hover:text-lumos-text-primary"
                    )}
                  >
                    <span className="w-2 h-2 rounded-full bg-yellow-500" />
                    Ausente
                  </button>
                </div>
              </div>

              {/* Navigation and Logout */}
              <div className="py-1">
                <Link
                  to="/configuracoes"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/5 transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  Configurações
                </Link>
                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    handleSignOut();
                  }}
                  className="flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-red-500 hover:bg-red-500/10 w-full text-left transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sair
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
