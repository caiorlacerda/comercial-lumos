import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { notify } from '@/lib/notifications/notify';
import { NOTIFICATION_EVENTS } from '@/lib/notifications/events';
import UserAvatar from '@/components/common/UserAvatar';
import { Megaphone, Send, Users, Check, Search, Link2 } from 'lucide-react';
import { clsx } from 'clsx';

type Member = {
  id: string;
  full_name: string;
  email: string | null;
  avatar_url: string | null;
  role: string;
};

export default function Comunicados() {
  const { profile } = useAuth();
  const toast = useToast();

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'todos' | 'especificos'>('todos');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('app_users')
        .select('id, full_name, email, avatar_url, role')
        .eq('status', 'ativo')
        .order('full_name');
      if (!error) setMembers((data ?? []) as Member[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter(m =>
      m.full_name.toLowerCase().includes(q) || (m.email ?? '').toLowerCase().includes(q)
    );
  }, [members, search]);

  const toggle = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Destinatários finais (time todo = todos os ativos).
  const recipientIds = useMemo(
    () => (mode === 'todos' ? members.map(m => m.id) : Array.from(selectedIds)),
    [mode, members, selectedIds]
  );

  const canSend = title.trim().length > 0 && message.trim().length > 0 && recipientIds.length > 0 && !sending;

  const handleSend = async () => {
    if (!canSend) return;
    const count = recipientIds.length;
    if (!window.confirm(`Enviar este comunicado para ${count} ${count === 1 ? 'pessoa' : 'pessoas'}? Elas recebem no sino e como notificação push.`)) return;

    setSending(true);
    try {
      await notify({
        userIds: recipientIds,
        event: NOTIFICATION_EVENTS.COMUNICADO,
        title: title.trim(),
        body: message.trim() || undefined,
        link: link.trim() || undefined,
        // Comunicado pra todo mundo = marco do time; pra pessoas específicas = pessoal.
        scope: mode === 'todos' ? 'team' : 'personal',
      });
      toast.success(`Comunicado enviado para ${count} ${count === 1 ? 'pessoa' : 'pessoas'}!`);
      setTitle('');
      setMessage('');
      setLink('');
      setSelectedIds(new Set());
      setMode('todos');
    } catch (err: any) {
      console.error('Erro ao enviar comunicado:', err);
      toast.error(`Falha ao enviar: ${err?.message || 'erro desconhecido'}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 font-work-sans">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-lumos bg-lumos-yellow/10 text-lumos-yellow flex-shrink-0">
          <Megaphone className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-lumos-text-primary tracking-tight">Comunicados</h1>
          <p className="text-lumos-text-secondary text-sm">
            Envie um aviso para o time. Chega no sino e como notificação push no celular de quem tiver ativado.
          </p>
        </div>
      </div>

      {/* Destinatários */}
      <div className="card space-y-4">
        <h3 className="text-xs font-black text-lumos-text-secondary uppercase tracking-widest border-b border-lumos-border/50 pb-2">
          Para quem
        </h3>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setMode('todos')}
            className={clsx(
              'flex items-center justify-center gap-2 h-11 rounded-lumos border text-sm font-bold transition-all',
              mode === 'todos'
                ? 'bg-lumos-yellow/15 text-lumos-yellow border-lumos-yellow/40'
                : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary'
            )}
          >
            <Users className="w-4 h-4" /> Time todo
          </button>
          <button
            onClick={() => setMode('especificos')}
            className={clsx(
              'flex items-center justify-center gap-2 h-11 rounded-lumos border text-sm font-bold transition-all',
              mode === 'especificos'
                ? 'bg-lumos-yellow/15 text-lumos-yellow border-lumos-yellow/40'
                : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary'
            )}
          >
            <Check className="w-4 h-4" /> Pessoas específicas
          </button>
        </div>

        {mode === 'todos' ? (
          <p className="text-[13px] text-lumos-text-secondary px-1">
            Será enviado para <span className="font-bold text-lumos-text-primary">{members.length}</span>{' '}
            {members.length === 1 ? 'pessoa ativa' : 'pessoas ativas'} da equipe.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
              <input
                type="text"
                placeholder="Buscar pessoa..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="input-lumos pl-10 w-full h-10"
              />
            </div>
            <div className="max-h-64 overflow-y-auto -mx-1 divide-y divide-lumos-border/40">
              {loading ? (
                <p className="text-sm text-lumos-text-secondary italic py-6 text-center">Carregando…</p>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-lumos-text-secondary italic py-6 text-center">Ninguém encontrado.</p>
              ) : (
                filtered.map(m => {
                  const on = selectedIds.has(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => toggle(m.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-lumos-text-secondary/[0.03] transition-colors"
                    >
                      <div
                        className={clsx(
                          'w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-all',
                          on ? 'bg-lumos-yellow border-lumos-yellow text-lumos-bg' : 'border-lumos-border'
                        )}
                      >
                        {on && <Check className="w-3.5 h-3.5" />}
                      </div>
                      <UserAvatar user={{ id: m.id, full_name: m.full_name, avatar_url: m.avatar_url } as any} size={32} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-lumos-text-primary truncate">{m.full_name}</p>
                        {m.email && <p className="text-[11px] text-lumos-text-secondary truncate">{m.email}</p>}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            <p className="text-[13px] text-lumos-text-secondary px-1">
              <span className="font-bold text-lumos-text-primary">{selectedIds.size}</span> selecionada(s).
            </p>
          </div>
        )}
      </div>

      {/* Mensagem */}
      <div className="card space-y-4">
        <h3 className="text-xs font-black text-lumos-text-secondary uppercase tracking-widest border-b border-lumos-border/50 pb-2">
          Mensagem
        </h3>
        <div>
          <label className="block text-xs font-bold text-lumos-text-secondary uppercase mb-1">Título</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={80}
            placeholder="Ex: Reunião geral amanhã às 10h"
            className="input-lumos w-full h-11"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-lumos-text-secondary uppercase mb-1">Texto</label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            maxLength={300}
            rows={4}
            placeholder="Escreva o aviso que o time vai receber…"
            className="input-lumos w-full py-3 resize-none"
          />
          <p className="text-[11px] text-lumos-text-secondary/70 text-right mt-1">{message.length}/300</p>
        </div>
        <div>
          <label className="block text-xs font-bold text-lumos-text-secondary uppercase mb-1 flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5" /> Link (opcional)
          </label>
          <input
            type="text"
            value={link}
            onChange={e => setLink(e.target.value)}
            placeholder="Ex: /ordem-do-dia ou uma URL"
            className="input-lumos w-full h-11"
          />
          <p className="text-[11px] text-lumos-text-secondary/70 mt-1">
            Ao tocar na notificação, a pessoa é levada até aqui. Deixe em branco para abrir o app na Home.
          </p>
        </div>
      </div>

      {/* Enviar */}
      <div className="flex items-center justify-between gap-3 sticky bottom-4">
        <span className="text-[13px] text-lumos-text-secondary">
          {recipientIds.length} {recipientIds.length === 1 ? 'destinatário' : 'destinatários'}
        </span>
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="btn-primary h-11 px-6 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg"
        >
          <Send className="w-4 h-4" />
          {sending ? 'Enviando…' : 'Enviar comunicado'}
        </button>
      </div>

      <p className="text-[11px] text-lumos-text-secondary/70 text-center pb-4">
        Enviado por {profile?.full_name}. Todos recebem no sino; quem ativou o push no celular recebe também como notificação.
      </p>
    </div>
  );
}
