import { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { MuralFeed, type MuralPost } from '@/components/mural/MuralFeed';
import { getVideoEmbed } from '@/lib/videoEmbed';
import { Megaphone, Send, X, Pin, ImagePlus, Film, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

export default function Mural() {
  const { profile, isAdmin } = useAuth();
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [pinned, setPinned] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setTitle('');
    setContent('');
    setPinned(false);
    setImageUrl(null);
    setVideoUrl('');
    setEditingId(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const startEdit = (post: MuralPost) => {
    setEditingId(post.id);
    setTitle(post.title || '');
    setContent(post.content);
    setPinned(post.pinned);
    setImageUrl(post.image_url || null);
    setVideoUrl(post.video_url || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Selecione uma imagem.'); return; }
    if (file.size > 8 * 1024 * 1024) { toast.error('Imagem muito grande (máx. 8MB).'); return; }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `posts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('mural').upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('mural').getPublicUrl(path);
      setImageUrl(data.publicUrl);
    } catch (err: any) {
      console.error('Erro no upload da imagem:', err);
      toast.error(`Falha no upload: ${err?.message || 'erro'}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const hasContent = !!content.trim() || !!imageUrl || !!videoUrl.trim();
    if (!hasContent || !profile?.id) return;
    setSaving(true);
    try {
      const fields = {
        title: title.trim() || null,
        content: content.trim(),
        image_url: imageUrl,
        video_url: videoUrl.trim() || null,
        pinned,
      };
      if (editingId) {
        const { error } = await supabase
          .from('mural_posts')
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq('id', editingId);
        if (error) throw error;
        toast.success('Recado atualizado.');
      } else {
        const { error } = await supabase
          .from('mural_posts')
          .insert({ author_id: profile.id, ...fields });
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

          {/* Foto */}
          {imageUrl ? (
            <div className="relative">
              <img src={imageUrl} alt="Prévia" className="w-full max-h-72 object-cover rounded-lumos border border-lumos-border" />
              <button
                type="button"
                onClick={() => setImageUrl(null)}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                title="Remover foto"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-lumos border border-lumos-border text-[13px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary hover:border-lumos-text-secondary/40 transition-colors disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              {uploading ? 'Enviando…' : 'Adicionar foto'}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />

          {/* Vídeo por link (YouTube ou Google Drive) */}
          <div>
            <div className="relative">
              <Film className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
              <input
                type="text"
                value={videoUrl}
                onChange={e => setVideoUrl(e.target.value)}
                placeholder="Link de vídeo (YouTube ou Google Drive)"
                className="input-lumos pl-10 w-full h-11"
              />
            </div>
            {videoUrl.trim() && !getVideoEmbed(videoUrl) && (
              <p className="text-[11px] text-amber-600 dark:text-lumos-yellow mt-1">
                Link não reconhecido como YouTube/Drive, vai aparecer como um link clicável. Para o player embutido, use a URL do vídeo no YouTube ou o link de compartilhamento do arquivo no Drive.
              </p>
            )}
          </div>

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
              disabled={(!content.trim() && !imageUrl && !videoUrl.trim()) || saving || uploading}
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
