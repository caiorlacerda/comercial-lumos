import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useLayout } from '@/context/LayoutContext';
import { Mail, Phone, Calendar, Search, Users, Shield } from 'lucide-react';
import { clsx } from 'clsx';
import StatusDot from '@/components/common/StatusDot';
import type { AppUserProfile } from '@/hooks/useAuth';

export default function Equipe() {
  const [users, setUsers] = useState<AppUserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all');
  const { getLiveStatus } = useLayout();

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('app_users')
        .select('*')
        .eq('status', 'ativo')
        .order('full_name', { ascending: true });
      if (error) throw error;
      setUsers(data || []);
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  }

  // Get status and sort order for sorting
  const getUserStatus = (user: AppUserProfile) => {
    return getLiveStatus(user.id);
  };

  const getSortOrder = (status: string) => {
    switch (status) {
      case 'online': return 1;
      case 'busy': return 2;
      case 'away': return 3;
      case 'offline':
      default: return 4;
    }
  };

  // Filter and Sort Users
  const filteredAndSortedUsers = users
    .map(user => ({
      ...user,
      liveStatus: getUserStatus(user)
    }))
    .filter(user => {
      const matchesSearch = 
        user.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (user.job_title && user.job_title.toLowerCase().includes(searchTerm.toLowerCase()));
      
      if (statusFilter === 'all') return matchesSearch;
      if (statusFilter === 'online') return matchesSearch && user.liveStatus !== 'offline';
      if (statusFilter === 'offline') return matchesSearch && user.liveStatus === 'offline';
      return matchesSearch;
    })
    .sort((a, b) => {
      const orderA = getSortOrder(a.liveStatus);
      const orderB = getSortOrder(b.liveStatus);
      if (orderA !== orderB) return orderA - orderB;
      return a.full_name.localeCompare(b.full_name);
    });

  // Calculate status counters
  const totalCount = users.length;
  const onlineCount = users.filter(u => getLiveStatus(u.id) !== 'offline').length;
  const offlineCount = totalCount - onlineCount;

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-lumos-yellow/20 text-lumos-yellow border-lumos-yellow/30';
      case 'producao': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      default: return 'bg-lumos-text-primary/10 text-lumos-text-secondary border-lumos-border';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'online': return 'Online';
      case 'busy': return 'Ocupado';
      case 'away': return 'Ausente';
      case 'offline':
      default: return 'Offline';
    }
  };

  return (
    <div className="space-y-6 font-work-sans">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">Equipe Lumos</h1>
        <p className="text-lumos-text-secondary text-sm">Acompanhe a atividade dos membros do time em tempo real.</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-lumos-text-primary/5 rounded-full">
              <Users className="w-5 h-5 text-lumos-text-primary" />
            </div>
            <div>
              <p className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-wider">Membros Ativos</p>
              <h3 className="text-xl font-bold text-lumos-text-primary mt-0.5">{totalCount}</h3>
            </div>
          </div>
        </div>

        <div className="card p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-500/10 rounded-full">
              <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
            </div>
            <div>
              <p className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-wider">Disponíveis / Ativos</p>
              <h3 className="text-xl font-bold text-green-500 mt-0.5">{onlineCount}</h3>
            </div>
          </div>
        </div>

        <div className="card p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gray-500/10 rounded-full">
              <div className="w-2.5 h-2.5 rounded-full bg-gray-400" />
            </div>
            <div>
              <p className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-wider">Offline</p>
              <h3 className="text-xl font-bold text-lumos-text-secondary mt-0.5">{offlineCount}</h3>
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="card p-4 flex flex-col md:flex-row gap-4 items-center">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
          <input
            type="text"
            placeholder="Buscar por nome ou cargo..."
            className="input-lumos pl-10 w-full"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <button
            onClick={() => setStatusFilter('all')}
            className={clsx(
              "px-4 py-2 rounded-lumos text-xs font-bold transition-all border",
              statusFilter === 'all'
                ? "bg-lumos-yellow text-black border-lumos-yellow"
                : "bg-lumos-surface text-lumos-text-secondary border-lumos-border hover:bg-lumos-bg"
            )}
          >
            Todos
          </button>
          <button
            onClick={() => setStatusFilter('online')}
            className={clsx(
              "px-4 py-2 rounded-lumos text-xs font-bold transition-all border",
              statusFilter === 'online'
                ? "bg-lumos-yellow text-black border-lumos-yellow"
                : "bg-lumos-surface text-lumos-text-secondary border-lumos-border hover:bg-lumos-bg"
            )}
          >
            Ativos no App
          </button>
          <button
            onClick={() => setStatusFilter('offline')}
            className={clsx(
              "px-4 py-2 rounded-lumos text-xs font-bold transition-all border",
              statusFilter === 'offline'
                ? "bg-lumos-yellow text-black border-lumos-yellow"
                : "bg-lumos-surface text-lumos-text-secondary border-lumos-border hover:bg-lumos-bg"
            )}
          >
            Offline
          </button>
        </div>
      </div>

      {/* Grid of Members */}
      {loading ? (
        <div className="card p-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-lumos-yellow mx-auto"></div>
        </div>
      ) : filteredAndSortedUsers.length === 0 ? (
        <div className="card p-12 text-center text-lumos-text-secondary text-sm italic">
          Nenhum membro encontrado com os filtros atuais.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredAndSortedUsers.map((u) => (
            <div
              key={u.id}
              className="card relative flex flex-col items-center text-center p-6 hover:border-lumos-yellow/20 hover:shadow-md transition-all group overflow-hidden"
            >
              {/* Top accent */}
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-lumos-yellow/10 via-lumos-yellow/50 to-lumos-yellow/10 opacity-0 group-hover:opacity-100 transition-opacity" />

              {/* Avatar with Status Dot */}
              <div className="relative w-20 h-20 rounded-full bg-lumos-yellow flex items-center justify-center text-black font-black text-2xl shadow-sm mb-4 ring-4 ring-lumos-yellow/5 flex-shrink-0">
                {u.email && u.full_name ? (
                  <img
                    src={`https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(u.full_name)}&backgroundColor=EFC700&textColor=000000&fontWeight=900`}
                    alt={u.full_name}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  <span>
                    {u.full_name
                      ? u.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                      : '?'}
                  </span>
                )}
                {/* Dynamic Status Dot overlay */}
                <span className="absolute bottom-0 right-0 p-0.5 rounded-full ring-4 ring-lumos-surface bg-lumos-surface">
                  <StatusDot status={u.liveStatus} className="w-3.5 h-3.5" />
                </span>
              </div>

              {/* Name & Job Title */}
              <h3 className="font-bold text-lumos-text-primary tracking-tight truncate w-full px-2" title={u.full_name}>
                {u.full_name}
              </h3>
              <p className="text-xs text-lumos-text-secondary mt-0.5 font-medium truncate w-full px-2">
                {u.job_title || 'Membro do Time'}
              </p>

              {/* Status Badge */}
              <span className={clsx(
                "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider mt-3 border",
                u.liveStatus === 'online' && "bg-green-500/10 text-green-500 border-green-500/20",
                u.liveStatus === 'busy' && "bg-red-500/10 text-red-500 border-red-500/20",
                u.liveStatus === 'away' && "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
                u.liveStatus === 'offline' && "bg-lumos-text-primary/5 text-lumos-text-secondary border-lumos-border"
              )}>
                {getStatusText(u.liveStatus)}
              </span>

              {/* Details separator */}
              <div className="w-full border-t border-lumos-border/50 my-4" />

              {/* Actions / Contacts */}
              <div className="w-full space-y-2.5 text-left text-xs">
                <a
                  href={`mailto:${u.email}`}
                  className="flex items-center gap-2 text-lumos-text-secondary hover:text-lumos-yellow transition-colors group/link"
                >
                  <Mail className="w-4 h-4 text-lumos-text-secondary group-hover/link:text-lumos-yellow flex-shrink-0" />
                  <span className="truncate">{u.email}</span>
                </a>
                
                {u.phone && (
                  <a
                    href={`tel:${u.phone}`}
                    className="flex items-center gap-2 text-lumos-text-secondary hover:text-lumos-yellow transition-colors group/link"
                  >
                    <Phone className="w-4 h-4 text-lumos-text-secondary group-hover/link:text-lumos-yellow flex-shrink-0" />
                    <span>{u.phone}</span>
                  </a>
                )}

                <div className="flex items-center gap-2 text-[10px] text-lumos-text-secondary font-medium pt-1 opacity-70">
                  <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Membro desde {new Date(u.joined_at).toLocaleDateString('pt-BR')}</span>
                </div>
              </div>

              {/* Access Role indicator */}
              <div className="absolute top-3 right-3">
                <span className={clsx(
                  "inline-flex items-center justify-center p-1 rounded-full border",
                  getRoleBadgeColor(u.role)
                )} title={`Nível: ${u.role.toUpperCase()}`}>
                  <Shield className="w-3 h-3" />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
