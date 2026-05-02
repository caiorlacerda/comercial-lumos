import React, { useEffect, useState } from 'react';
import { ShieldAlert, User, FileText, Users, RefreshCw, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { AuditAction } from '@/hooks/useAuditLog';

interface LogEntry {
  id: string;
  created_at: string;
  action: AuditAction;
  description: string;
  metadata: Record<string, unknown> | null;
  user_id: string;
  user_name?: string;
  user_email?: string;
}

const ACTION_LABELS: Record<AuditAction, string> = {
  budget_created: 'Orçamento criado',
  budget_deleted: 'Orçamento excluído',
  budget_status_changed: 'Status de orçamento alterado',
  client_created: 'Cliente criado',
  client_deleted: 'Cliente excluído',
  user_created: 'Usuário criado',
  user_deactivated: 'Usuário desativado',
  user_activated: 'Usuário ativado',
};

const ACTION_COLORS: Record<AuditAction, string> = {
  budget_created: 'text-green-400 bg-green-500/10 border-green-500/20',
  budget_deleted: 'text-red-400 bg-red-500/10 border-red-500/20',
  budget_status_changed: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  client_created: 'text-green-400 bg-green-500/10 border-green-500/20',
  client_deleted: 'text-red-400 bg-red-500/10 border-red-500/20',
  user_created: 'text-lumos-yellow bg-lumos-yellow/10 border-lumos-yellow/20',
  user_deactivated: 'text-red-400 bg-red-500/10 border-red-500/20',
  user_activated: 'text-green-400 bg-green-500/10 border-green-500/20',
};

const ACTION_ICONS: Record<AuditAction, React.ReactNode> = {
  budget_created: <FileText className="w-3.5 h-3.5" />,
  budget_deleted: <FileText className="w-3.5 h-3.5" />,
  budget_status_changed: <FileText className="w-3.5 h-3.5" />,
  client_created: <User className="w-3.5 h-3.5" />,
  client_deleted: <User className="w-3.5 h-3.5" />,
  user_created: <Users className="w-3.5 h-3.5" />,
  user_deactivated: <Users className="w-3.5 h-3.5" />,
  user_activated: <Users className="w-3.5 h-3.5" />,
};

const PAGE_SIZE = 30;

export default function AuditLog() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterAction, setFilterAction] = useState<AuditAction | ''>('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    fetchLogs(0, true);
  }, [filterAction]);

  async function fetchLogs(pageIndex: number, reset = false) {
    setLoading(true);
    try {
      let query = supabase
        .from('activity_log')
        .select('*, profiles(full_name, email)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE - 1);

      if (filterAction) {
        query = query.eq('action', filterAction);
      }

      const { data, count } = await query;

      const entries: LogEntry[] = (data || []).map((row: any) => ({
        id: row.id,
        created_at: row.created_at,
        action: row.action,
        description: row.description,
        metadata: row.metadata,
        user_id: row.user_id,
        user_name: row.profiles?.full_name ?? '—',
        user_email: row.profiles?.email ?? '',
      }));

      setLogs(reset ? entries : (prev) => [...prev, ...entries]);
      setHasMore((count ?? 0) > (pageIndex + 1) * PAGE_SIZE);
      setPage(pageIndex);
    } finally {
      setLoading(false);
    }
  }

  const filtered = search.trim()
    ? logs.filter(
        (l) =>
          l.description.toLowerCase().includes(search.toLowerCase()) ||
          l.user_name?.toLowerCase().includes(search.toLowerCase()) ||
          l.user_email?.toLowerCase().includes(search.toLowerCase())
      )
    : logs;

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight">Log de Auditoria</h1>
          <p className="text-lumos-text-secondary font-medium mt-1">Histórico de ações realizadas na plataforma.</p>
        </div>
        <button
          onClick={() => fetchLogs(0, true)}
          className="btn-secondary flex items-center gap-2 text-sm"
          disabled={loading}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por descrição ou usuário..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-9 w-full"
          />
        </div>
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value as AuditAction | '')}
          className="input w-56"
        >
          <option value="">Todas as ações</option>
          {Object.entries(ACTION_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      <div className="card overflow-hidden">
        {loading && logs.length === 0 ? (
          <div className="divide-y divide-lumos-border">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4 animate-pulse">
                <div className="w-24 h-5 bg-lumos-border rounded" />
                <div className="w-32 h-5 bg-lumos-border rounded" />
                <div className="flex-1 h-5 bg-lumos-border rounded" />
                <div className="w-28 h-5 bg-lumos-border rounded" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 bg-lumos-border/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <ShieldAlert className="w-6 h-6 text-lumos-text-secondary" />
            </div>
            <p className="text-lumos-text-secondary text-sm">Nenhum registro encontrado.</p>
          </div>
        ) : (
          <div className="divide-y divide-lumos-border">
            {filtered.map((log) => (
              <div key={log.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-lumos-border/10 transition-colors">
                <span className="text-[11px] font-mono text-lumos-text-secondary whitespace-nowrap w-28 shrink-0">
                  {formatDate(log.created_at)}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border whitespace-nowrap shrink-0 ${
                    ACTION_COLORS[log.action] ?? 'text-lumos-text-secondary bg-lumos-border/20 border-lumos-border'
                  }`}
                >
                  {ACTION_ICONS[log.action]}
                  {ACTION_LABELS[log.action] ?? log.action}
                </span>
                <span className="text-sm text-lumos-text-primary flex-1 truncate">{log.description}</span>
                <span className="text-xs text-lumos-text-secondary whitespace-nowrap shrink-0 w-36 text-right truncate">
                  {log.user_name}
                </span>
              </div>
            ))}
          </div>
        )}

        {hasMore && !search && (
          <div className="px-6 py-4 border-t border-lumos-border">
            <button
              onClick={() => fetchLogs(page + 1)}
              disabled={loading}
              className="btn-secondary w-full text-sm"
            >
              {loading ? 'Carregando...' : 'Carregar mais'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
