import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { MuralFeed, type MuralPost } from '@/components/mural/MuralFeed';
import { Megaphone, Send, X, Pin } from 'lucide-react';
import { clsx } from 'clsx';

export default function Mural() {
  const { profile, isAdmin } = useAuth();
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [pinned, setPinned] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setTitle('');
    setContent('');
    setPinned(false);
    setEditingId(null);
  };

  const startEdit = (post: MuralPost) => {
    setEditingId(post.id);
    setTitle(post.title || '');
    setContent(post.content);
    setPinned(post.pinned);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !profile?.id) return;
    setSaving(true);
    try {
      if (editingId) {
        const { error } = await supabase
          .from('mural_posts')
          .update({ title: title.trim() || null, content: content.trim(), pinned, updated_at: new Date().toISOString() })
          .eq('id', editingId);
        if (error) throw error;
        toast.success('Recado atualizado.');
      } else {
        const { error } = await supabase
          .from('mural_posts')
          .insert({ author_id: profile.id, title: title.trim() || null, content: content.trim(), pinned });
        if (error) throw error;
        toast.success('Recado publicado no mural!');
      }
      resetForm();
    } catch (err: any) {
      console.error('Erro ao salvar recado:', err);
      toast.error(`Falha ao publicar: ${err?.message || 'erro desconhecido'}`);
    } finally {
      setSaving(false);
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
          <h1 className="text-2xl font-black text-lumos-text-primary tracking-tight">Mural de Recados</h1>
          <p className="text-lumos-text-secondary text-sm">
            {isAdmin ? 'Publique avisos que ficam fixos no feed de todo o time.' : 'Avisos e informações da administração para o time.'}
          </p>
        </div>
      </div>

      {/* Composer (só admin) */}
      {isAdmin && (
        <form onSubmit={handleSubmit} className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-lumos-text-secondary uppercase tracking-widest">
              {editingId ? 'Editar recado' : 'Novo recado'}
            </h3>
            {editingId && (
              <button type="button" onClick={resetForm} className="text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary flex items-center gap-1">
                <X className="w-3.5 h-3.5" /> Cancelar edição
              </button>
            )}
          </div>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={100}
            placeholder="Título (opcional)"
            className="input-lumos w-full h-11 font-bold"
          />
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={4}
            placeholder="Escreva o recado para o time…"
            className="input-lumos w-full py-3 resize-none"
          />
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setPinned(v => !v)}
              className={clsx(
                'inline-flex items-center gap-1.5 h-9 px-3 rounded-full border text-[11px] font-bold transition-colors',
                pinned ? 'bg-lumos-yellow/15 text-lumos-yellow border-lumos-yellow/40' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary'
              )}
            >
              <Pin className="w-3.5 h-3.5" /> {pinned ? 'Fixado no topo' : 'Fixar no topo'}
            </button>
            <button
              type="submit"
              disabled={!content.trim() || saving}
              className="btn-primary h-10 px-5 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
              {saving ? 'Publicando…' : editingId ? 'Salvar' : 'Publicar'}
            </button>
          </div>
        </form>
      )}

      {/* Feed */}
      <MuralFeed admin={isAdmin} onEdit={isAdmin ? startEdit : undefined} />
    </div>
  );
}
