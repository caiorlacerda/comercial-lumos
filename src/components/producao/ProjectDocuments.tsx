import React, { useEffect, useRef, useState } from 'react';
import {
  FileText, FileSpreadsheet, Presentation, File as FileIcon, Link2,
  Upload, Plus, Trash2, ExternalLink, FolderOpen, Loader2, ChevronDown,
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import { useGoogleDrive } from '@/hooks/useGoogleDrive';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';

type Kind = 'file' | 'gdoc' | 'gsheet' | 'gslides' | 'link';

interface Doc {
  id: string;
  project_id: string;
  name: string;
  url: string;
  kind: Kind;
  tag: string;
  drive_file_id: string | null;
  mime_type: string | null;
  created_at: string;
}

const TAGS: { value: string; label: string }[] = [
  { value: 'roteiro', label: 'Roteiro' },
  { value: 'contrato', label: 'Contrato' },
  { value: 'referencia', label: 'Referência' },
  { value: 'entrega', label: 'Entrega' },
  { value: 'outro', label: 'Outro' },
];

// Ícone + cor por tipo de documento.
function kindVisual(kind: Kind, mime?: string | null) {
  if (kind === 'gdoc') return { Icon: FileText, color: 'text-blue-500' };
  if (kind === 'gsheet') return { Icon: FileSpreadsheet, color: 'text-green-500' };
  if (kind === 'gslides') return { Icon: Presentation, color: 'text-amber-500' };
  if (kind === 'link') return { Icon: Link2, color: 'text-lumos-text-secondary' };
  // file: diferencia PDF/planilha pelo mime
  if (mime?.includes('pdf')) return { Icon: FileText, color: 'text-red-500' };
  if (mime?.includes('sheet') || mime?.includes('excel') || mime?.includes('csv')) return { Icon: FileSpreadsheet, color: 'text-green-600' };
  return { Icon: FileIcon, color: 'text-lumos-text-secondary' };
}

function detectKind(url: string): Kind {
  const u = url.toLowerCase();
  if (u.includes('docs.google.com/document')) return 'gdoc';
  if (u.includes('docs.google.com/spreadsheets')) return 'gsheet';
  if (u.includes('docs.google.com/presentation')) return 'gslides';
  if (u.includes('drive.google.com')) return 'file';
  return 'link';
}

const GOOGLE_MIME: Record<string, { mime: string; kind: Kind; label: string }> = {
  document: { mime: 'application/vnd.google-apps.document', kind: 'gdoc', label: 'Documento' },
  spreadsheet: { mime: 'application/vnd.google-apps.spreadsheet', kind: 'gsheet', label: 'Planilha' },
  presentation: { mime: 'application/vnd.google-apps.presentation', kind: 'gslides', label: 'Apresentação' },
};

function googleUrl(kind: Kind, id: string) {
  if (kind === 'gdoc') return `https://docs.google.com/document/d/${id}/edit`;
  if (kind === 'gsheet') return `https://docs.google.com/spreadsheets/d/${id}/edit`;
  if (kind === 'gslides') return `https://docs.google.com/presentation/d/${id}/edit`;
  return `https://drive.google.com/file/d/${id}/view`;
}

interface Props {
  projectId: string;
  driveFolderId?: string | null;
  canManage?: boolean;
}

export default function ProjectDocuments({ projectId, driveFolderId, canManage = true }: Props) {
  const { profile } = useAuth();
  const toast = useToast();
  const { login, isAuthenticated, uploadToDrive, createGoogleFile } = useGoogleDrive();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newMenu, setNewMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Modal de "criar Google file" e de "colar link"
  const [createType, setCreateType] = useState<keyof typeof GOOGLE_MIME | null>(null);
  const [createName, setCreateName] = useState('');
  const [createTag, setCreateTag] = useState('outro');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const [linkTag, setLinkTag] = useState('outro');

  useEffect(() => { fetchDocs(); }, [projectId]);
  useRealtimeRefetch(['project_documents'], () => fetchDocs(true));

  async function fetchDocs(silent = false) {
    if (!silent) setLoading(true);
    const { data } = await supabase
      .from('project_documents')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    setDocs((data as Doc[]) || []);
    setLoading(false);
  }

  const ensureGoogle = () => {
    if (!isAuthenticated()) {
      login();
      toast.info('Conecte sua conta Google e tente novamente.');
      return false;
    }
    if (!driveFolderId) {
      toast.error('Este projeto ainda não tem pasta no Drive. Abra/edite o projeto para sincronizar.');
      return false;
    }
    return true;
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!ensureGoogle()) return;
    try {
      setBusy(true);
      const res = await uploadToDrive(file, file.name, file.type || 'application/octet-stream', driveFolderId!);
      const url = res.webViewLink || googleUrl('file', res.id);
      const { error } = await supabase.from('project_documents').insert([{
        project_id: projectId, name: file.name, url, kind: 'file',
        tag: 'outro', drive_file_id: res.id, mime_type: file.type || null, created_by: profile?.id || null,
      }]);
      if (error) throw error;
      toast.success('Arquivo enviado ao Drive do projeto!');
      fetchDocs(true);
    } catch (err: any) {
      toast.error(err.message || 'Falha ao enviar o arquivo.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    if (!createType) return;
    const { mime, kind } = GOOGLE_MIME[createType];
    if (!createName.trim()) { toast.error('Dê um nome ao arquivo.'); return; }
    if (!ensureGoogle()) return;
    try {
      setBusy(true);
      const res = await createGoogleFile(createName.trim(), mime, driveFolderId!);
      const url = res.webViewLink || googleUrl(kind, res.id);
      const { error } = await supabase.from('project_documents').insert([{
        project_id: projectId, name: createName.trim(), url, kind,
        tag: createTag, drive_file_id: res.id, mime_type: mime, created_by: profile?.id || null,
      }]);
      if (error) throw error;
      setCreateType(null); setCreateName(''); setCreateTag('outro');
      toast.success('Criado na pasta do projeto!');
      fetchDocs(true);
      window.open(url, '_blank', 'noopener');
    } catch (err: any) {
      toast.error(err.message || 'Falha ao criar o arquivo.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddLink = async () => {
    const url = linkUrl.trim();
    if (!url) { toast.error('Cole o link.'); return; }
    const kind = detectKind(url);
    const name = linkName.trim() || url.replace(/^https?:\/\//, '').slice(0, 60);
    try {
      setBusy(true);
      const { error } = await supabase.from('project_documents').insert([{
        project_id: projectId, name, url, kind, tag: linkTag, created_by: profile?.id || null,
      }]);
      if (error) throw error;
      setLinkOpen(false); setLinkUrl(''); setLinkName(''); setLinkTag('outro');
      toast.success('Link salvo no projeto!');
      fetchDocs(true);
    } catch (err: any) {
      toast.error(err.message || 'Falha ao salvar o link.');
    } finally {
      setBusy(false);
    }
  };

  const changeTag = async (id: string, tag: string) => {
    setDocs(prev => prev.map(d => d.id === id ? { ...d, tag } : d));
    await supabase.from('project_documents').update({ tag }).eq('id', id);
  };

  const handleDelete = async (doc: Doc) => {
    setDocs(prev => prev.filter(d => d.id !== doc.id));
    const { error } = await supabase.from('project_documents').delete().eq('id', doc.id);
    if (error) { toast.error('Falha ao remover.'); fetchDocs(true); return; }
    toast.success('Removido da lista. O arquivo continua no Drive.');
  };

  return (
    <div className="bg-lumos-surface border border-lumos-border rounded-lumos overflow-hidden">
      {/* Cabeçalho + ações */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-lumos-border">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-lumos-yellow" />
          <h3 className="text-sm font-black uppercase tracking-tight text-lumos-text-primary">Documentos</h3>
          <span className="text-[11px] text-lumos-text-secondary">{docs.length}</span>
        </div>

        {canManage && (
          <div className="flex items-center gap-2">
            {driveFolderId && (
              <a
                href={`https://drive.google.com/drive/folders/${driveFolderId}`}
                target="_blank" rel="noopener noreferrer"
                className="hidden sm:flex items-center gap-1 text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-yellow"
                title="Abrir a pasta do projeto no Drive"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Pasta no Drive
              </a>
            )}

            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="h-8 px-3 rounded-lumos border border-lumos-border text-xs font-bold text-lumos-text-primary hover:border-lumos-yellow/50 flex items-center gap-1.5 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Subir arquivo
            </button>
            <input ref={fileRef} type="file" className="hidden" onChange={handleUpload}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,image/*,application/pdf" />

            <div className="relative">
              <button
                onClick={() => setNewMenu(v => !v)}
                className="h-8 px-3 rounded-lumos bg-lumos-yellow text-black text-xs font-black flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Novo <ChevronDown className="w-3 h-3" />
              </button>
              {newMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setNewMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 w-52 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl z-20 py-1 animate-in fade-in slide-in-from-top-2 duration-150">
                    {(Object.keys(GOOGLE_MIME) as (keyof typeof GOOGLE_MIME)[]).map(t => {
                      const { kind, label } = GOOGLE_MIME[t];
                      const { Icon, color } = kindVisual(kind);
                      return (
                        <button key={t}
                          onClick={() => { setNewMenu(false); setCreateType(t); setCreateName(''); setCreateTag('outro'); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-lumos-text-primary hover:bg-lumos-text-primary/5"
                        >
                          <Icon className={clsx('w-4 h-4', color)} /> Novo Google {label}
                        </button>
                      );
                    })}
                    <div className="h-px bg-lumos-border my-1" />
                    <button
                      onClick={() => { setNewMenu(false); setLinkOpen(true); setLinkUrl(''); setLinkName(''); setLinkTag('outro'); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-lumos-text-primary hover:bg-lumos-text-primary/5"
                    >
                      <Link2 className="w-4 h-4 text-lumos-text-secondary" /> Colar link
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin text-lumos-yellow mx-auto" /></div>
      ) : docs.length === 0 ? (
        <div className="py-10 text-center text-sm text-lumos-text-secondary">
          Nenhum documento ainda. Suba um arquivo (roteiro, contrato…) ou crie um Google Doc/Planilha/Slides.
        </div>
      ) : (
        <ul className="divide-y divide-lumos-border">
          {docs.map(doc => {
            const { Icon, color } = kindVisual(doc.kind, doc.mime_type);
            return (
              <li key={doc.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-lumos-text-primary/5 group">
                <Icon className={clsx('w-5 h-5 flex-shrink-0', color)} />
                <a href={doc.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1">
                  <span className="text-sm font-bold text-lumos-text-primary group-hover:text-lumos-yellow transition-colors truncate block">{doc.name}</span>
                  <span className="text-[10px] text-lumos-text-secondary uppercase tracking-wider">{new Date(doc.created_at).toLocaleDateString('pt-BR')}</span>
                </a>

                {canManage ? (
                  <select
                    value={doc.tag}
                    onChange={e => changeTag(doc.id, e.target.value)}
                    onClick={e => e.stopPropagation()}
                    className="text-[10px] font-black uppercase tracking-wide bg-lumos-yellow/10 text-amber-600 dark:text-lumos-yellow border border-lumos-yellow/20 rounded px-1.5 py-1 cursor-pointer focus:outline-none"
                  >
                    {TAGS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                ) : (
                  <span className="text-[10px] font-black uppercase tracking-wide bg-lumos-yellow/10 text-amber-600 dark:text-lumos-yellow border border-lumos-yellow/20 rounded px-1.5 py-1">
                    {TAGS.find(t => t.value === doc.tag)?.label || doc.tag}
                  </span>
                )}

                <a href={doc.url} target="_blank" rel="noopener noreferrer" title="Abrir"
                  className="p-1.5 text-lumos-text-secondary hover:text-lumos-yellow transition-colors">
                  <ExternalLink className="w-4 h-4" />
                </a>
                {canManage && (
                  <button onClick={() => handleDelete(doc)} title="Remover da lista"
                    className="p-1.5 text-lumos-text-secondary hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Modal: criar Google file */}
      <Modal isOpen={!!createType} onClose={() => setCreateType(null)}
        title={createType ? `Novo Google ${GOOGLE_MIME[createType].label}` : ''}>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Nome</label>
            <input autoFocus className="input-lumos w-full" value={createName}
              onChange={e => setCreateName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
              placeholder="Ex.: Roteiro v1" />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Etiqueta</label>
            <select className="input-lumos w-full" value={createTag} onChange={e => setCreateTag(e.target.value)}>
              {TAGS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <p className="text-[11px] text-lumos-text-secondary">Cria o arquivo direto na pasta do projeto no Drive e abre numa nova aba.</p>
          <div className="flex gap-3 pt-1">
            <button onClick={() => setCreateType(null)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handleCreate} disabled={busy} className="btn-primary flex-1 h-10 flex items-center justify-center gap-2 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: colar link */}
      <Modal isOpen={linkOpen} onClose={() => setLinkOpen(false)} title="Colar link">
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Link</label>
            <input autoFocus className="input-lumos w-full" value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              placeholder="https://docs.google.com/… ou qualquer URL" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Nome (opcional)</label>
              <input className="input-lumos w-full" value={linkName} onChange={e => setLinkName(e.target.value)} placeholder="Roteiro do cliente" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Etiqueta</label>
              <select className="input-lumos w-full" value={linkTag} onChange={e => setLinkTag(e.target.value)}>
                {TAGS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={() => setLinkOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handleAddLink} disabled={busy} className="btn-primary flex-1 h-10 flex items-center justify-center gap-2 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} Salvar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
