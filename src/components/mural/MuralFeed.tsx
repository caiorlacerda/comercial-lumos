import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import UserAvatar from '@/components/common/UserAvatar';
import { Pin, PinOff, Pencil, Trash2, Megaphone } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clsx } from 'clsx';

export type MuralPost = {
  id: string;
  author_id: string | null;
  title: string | null;
  content: string;
  pinned: boolean;
  created_at: string;
  updated_at: string | null;
  author?: { id: string; full_name: string; avatar_url: string | null; role: string } | null;
};

// Feed de recados. Busca sozinho e atualiza em tempo real (postgres_changes).
// `limit` deixa em modo "preview" (Home); `admin` mostra os controles de gestão.
export function MuralFeed({
  limit,
  admin = false,
  onEdit,
  emptyHint,
}: {
  limit?: number;
  admin?: boolean;
  onEdit?: (post: MuralPost) => void;
  emptyHint?: string;
}) {
  const toast = useToast();
  const [posts, setPosts] = useState<MuralPost[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPosts = useCallback(async () => {
    let q = supabase
      .from('mural_posts')
      .select('id, author_id, title, content, pinned, created_at, updated_at, author:app_users(id, full_name, avatar_url, role)')
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false });
    if (limit) q = q.limit(limit);
    const { data, error } = await q;
    if (!error) setPosts((data ?? []) as any);
    setLoading(false);
  }, [limit]);

  useEffect(() => {
    fetchPosts();
    const ch = supabase
      .channel(`mural-${Math.random().toString(36).slice(2, 9)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mural_posts' }, () => fetchPosts())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchPosts]);

  const handleDelete = async (post: MuralPost) => {
    if (!window.confirm('Remover este recado do mural?')) return;
    const { error } = await supabase.from('mural_posts').delete().eq('id', post.id);
    if (error) { toast.error('Erro ao remover.'); return; }
    setPosts(prev => prev.filter(p => p.id !== post.id));
    toast.success('Recado removido.');
  };

  const togglePin = async (post: MuralPost) => {
    const { error } = await supabase.from('mural_posts').update({ pinned: !post.pinned }).eq('id', post.id);
    if (error) { toast.error('Erro ao fixar.'); return; }
    // realtime atualiza; otimista pra ficar instantâneo
    setPosts(prev => prev.map(p => p.id === post.id ? { ...p, pinned: !p.pinned } : p));
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-lumos-surface border border-lumos-border rounded-lumos p-4 animate-pulse">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-lumos-border" />
              <div className="h-3 w-32 rounded bg-lumos-border" />
            </div>
            <div className="h-3 w-full rounded bg-lumos-border mb-2" />
            <div className="h-3 w-2/3 rounded bg-lumos-border" />
          </div>
        ))}
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="bg-lumos-surface border border-dashed border-lumos-border rounded-lumos p-8 text-center">
        <Megaphone className="w-8 h-8 text-lumos-text-secondary/40 mx-auto mb-2" />
        <p className="text-sm text-lumos-text-secondary italic">{emptyHint || 'Nenhum recado no mural ainda.'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {posts.map(post => (
        <article
          key={post.id}
          className={clsx(
            'bg-lumos-surface border rounded-lumos p-4 shadow-sm transition-colors',
            post.pinned ? 'border-lumos-yellow/40' : 'border-lumos-border'
          )}
        >
          <header className="flex items-start gap-3">
            <UserAvatar user={{ id: post.author?.id, full_name: post.author?.full_name || 'Lumos', avatar_url: post.author?.avatar_url } as any} size={38} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-black text-lumos-text-primary truncate">{post.author?.full_name || 'Administração'}</span>
                {post.pinned && (
                  <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-lumos-yellow bg-lumos-yellow/10 border border-lumos-yellow/20 px-1.5 py-0.5 rounded-full">
                    <Pin className="w-2.5 h-2.5" /> Fixado
                  </span>
                )}
              </div>
              <span className="text-[11px] text-lumos-text-secondary">
                {formatDistanceToNow(new Date(post.created_at), { addSuffix: true, locale: ptBR })}
              </span>
            </div>
            {admin && (
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button onClick={() => togglePin(post)} title={post.pinned ? 'Desafixar' : 'Fixar no topo'} className="p-1.5 text-lumos-text-secondary hover:text-lumos-yellow rounded transition-colors">
                  {post.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                </button>
                {onEdit && (
                  <button onClick={() => onEdit(post)} title="Editar" className="p-1.5 text-lumos-text-secondary hover:text-blue-500 rounded transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => handleDelete(post)} title="Remover" className="p-1.5 text-lumos-text-secondary hover:text-red-500 rounded transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </header>

          <div className="mt-3">
            {post.title && <h3 className="text-base font-black text-lumos-text-primary tracking-tight mb-1">{post.title}</h3>}
            <p className="text-sm text-lumos-text-primary/90 leading-relaxed whitespace-pre-wrap break-words">{post.content}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
