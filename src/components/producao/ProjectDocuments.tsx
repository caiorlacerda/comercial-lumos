import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

// Categorias = subpastas reais no Drive do projeto. Ao subir/criar, o arquivo
// vai direto pra pasta certa (00_GERAL / 01_ROTEIRO / 02_PRODUCAO).
const CATEGORIES: { value: string; label: string; folder: string }[] = [
  { value: 'geral', label: 'Geral', folder: '00_GERAL' },
  { value: 'roteiro', label: 'Roteiro', folder: '01_ROTEIRO' },
  { value: 'producao', label: 'Produção', folder: '02_PRODUCAO' },
];
const catLabel = (v: string) => CATEGORIES.find(c => c.value === v)?.label || v;
const catFolderName = (v: string) => CATEGORIES.find(c => c.value === v)?.folder;
// Abas de filtro: "Todos" + as categorias.
const FILTERS = [{ value: 'todos', label: 'Todos' }, ...CATEGORIES.map(c => ({ value: c.value, label: c.label }))];

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
  const { ensureAuth, uploadToDrive, createGoogleFile, listFiles, createFolder, moveFileToFolder } = useGoogleDrive();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [folderId, setFolderId] = useState<string | null>(driveFolderId ?? null);
  const [activeCat, setActiveCat] = useState('todos'); // aba ativa: filtra a lista E define o destino do upload
  const [newMenu, setNewMenu] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const novoBtnRef = useRef<HTMLButtonElement>(null);
  // Cache dos IDs das subpastas por categoria (evita relookup a cada upload).
  const subfolderCache = useRef<Record<string, string>>({});

  // Destino do upload: a aba ativa; em "Todos", cai em Geral por padrão.
  const uploadTarget = activeCat === 'todos' ? 'geral' : activeCat;
  const visibleDocs = activeCat === 'todos' ? docs : docs.filter(d => d.tag === activeCat);

  // Modal de "criar Google file" e de "colar link"
  const [createType, setCreateType] = useState<keyof typeof GOOGLE_MIME | null>(null);
  const [createName, setCreateName] = useState('');
  const [createTag, setCreateTag] = useState('geral');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const [linkTag, setLinkTag] = useState('geral');

  useEffect(() => { fetchDocs(); }, [projectId]);
  useRealtimeRefetch(['project_documents'], () => fetchDocs(true));

  // Mantém o folderId em dia: usa o da prop; se vier vazio, confere no banco
  // (pode ter sido provisionado depois sem o pai ter recarregado).
  useEffect(() => {
    if (driveFolderId) { setFolderId(driveFolderId); return; }
    supabase.from('projects').select('drive_folder_id').eq('id', projectId).single()
      .then(({ data }) => { if (data?.drive_folder_id) setFolderId(data.drive_folder_id); });
  }, [projectId, driveFolderId]);

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

  // Garante a pasta do projeto no Drive: se ainda não existe, provisiona sob
  // demanda (um "toque" no projeto dispara o trigger que chama a edge function)
  // e aguarda o drive_folder_id aparecer.
  const ensureFolder = async (): Promise<string | null> => {
    if (folderId) return folderId;
    toast.info('Criando a pasta do projeto no Drive…');
    const { error } = await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId);
    if (error) { toast.error('Não foi possível iniciar a criação da pasta.'); return null; }
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const { data } = await supabase.from('projects').select('drive_folder_id').eq('id', projectId).single();
      if (data?.drive_folder_id) { setFolderId(data.drive_folder_id); toast.success('Pasta do projeto criada no Drive!'); return data.drive_folder_id; }
    }
    toast.error('A pasta está sendo criada, tente de novo em instantes.');
    return null;
  };

  // Login Google + pasta pronta. Retorna o folderId.
  //
  // A ordem importa: o popup do Google PRECISA abrir logo após o clique (a
  // "user activation" do navegador). Como criar a pasta pode levar segundos, se
  // deixássemos o popup pro final ele seria bloqueado. Por isso autentica
  // primeiro (dentro do gesto) e só então provisiona a pasta.
  const ensureReady = async (): Promise<string | null> => {
    const ok = await ensureAuth();
    if (!ok) { toast.error('Não foi possível conectar a conta Google.'); return null; }
    const fid = await ensureFolder();
    if (!fid) return null;
    return fid;
  };

  // Resolve o ID da subpasta da categoria (00_GERAL/01_ROTEIRO/02_PRODUCAO)
  // dentro da pasta do projeto. Acha por nome; se não existir, cria. Se algo
  // falhar, cai pra pasta raiz do projeto (upload nunca fica travado).
  const getCategoryFolder = async (cat: string, projectFolderId: string): Promise<string> => {
    const name = catFolderName(cat);
    if (!name) return projectFolderId;
    const key = `${projectFolderId}:${cat}`;
    if (subfolderCache.current[key]) return subfolderCache.current[key];
    try {
      const res = await listFiles(`'${projectFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${name}' and trashed = false`);
      let id: string | undefined = res.files?.[0]?.id;
      if (!id) id = (await createFolder(name, projectFolderId)).id;
      subfolderCache.current[key] = id!;
      return id!;
    } catch {
      return projectFolderId;
    }
  };

  const uploadFile = async (file: File, targetFolderId: string, cat: string) => {
    try {
      setBusy(true);
      const res = await uploadToDrive(file, file.name, file.type || 'application/octet-stream', targetFolderId);
      const url = res.webViewLink || googleUrl('file', res.id);
      const { error } = await supabase.from('project_documents').insert([{
        project_id: projectId, name: file.name, url, kind: 'file',
        tag: cat, drive_file_id: res.id, mime_type: file.type || null, created_by: profile?.id || null,
      }]);
      if (error) throw error;
      toast.success(`"${file.name}" enviado para ${catLabel(cat)}!`);
      fetchDocs(true);
    } catch (err: any) {
      toast.error(err.message || 'Falha ao enviar o arquivo.');
    } finally {
      setBusy(false);
    }
  };

  // Sobe 1+ arquivos (input ou drag-and-drop) na categoria escolhida; prepara
  // pasta+auth e resolve a subpasta uma vez, depois envia em sequência.
  const uploadFiles = async (files: File[], cat: string) => {
    if (files.length === 0) return;
    const fid = await ensureReady();
    if (!fid) return;
    const target = await getCategoryFolder(cat, fid);
    for (const f of files) await uploadFile(f, target, cat);
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    void uploadFiles(files, uploadTarget);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!canManage) return;
    const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    void uploadFiles(files, uploadTarget);
  };

  // Re-categoriza um documento: atualiza a etiqueta e, se for arquivo do Drive,
  // move fisicamente pra subpasta da nova categoria.
  const recategorize = async (doc: Doc, newCat: string) => {
    if (newCat === doc.tag) return;
    const isDriveFile = !!doc.drive_file_id && !!catFolderName(newCat);
    // Auth primeiro (dentro do gesto do select) se for mexer no Drive.
    if (isDriveFile) {
      const ok = await ensureAuth();
      if (!ok) { toast.error('Conecte o Google para mover no Drive.'); return; }
    }
    setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, tag: newCat } : d));
    const { error } = await supabase.from('project_documents').update({ tag: newCat }).eq('id', doc.id);
    if (error) { toast.error('Falha ao mudar a categoria.'); fetchDocs(true); return; }
    if (isDriveFile && folderId) {
      try {
        const target = await getCategoryFolder(newCat, folderId);
        await moveFileToFolder(doc.drive_file_id!, target);
        toast.success(`Movido para ${catLabel(newCat)}.`);
      } catch {
        toast.error('Categoria salva, mas não consegui mover no Drive.');
      }
    }
  };

  const handleCreate = async () => {
    if (!createType) return;
    const { mime, kind } = GOOGLE_MIME[createType];
    if (!createName.trim()) { toast.error('Dê um nome ao arquivo.'); return; }
    const fid = await ensureReady();
    if (!fid) return;
    try {
      setBusy(true);
      const target = await getCategoryFolder(createTag, fid);
      const res = await createGoogleFile(createName.trim(), mime, target);
      const url = res.webViewLink || googleUrl(kind, res.id);
      const { error } = await supabase.from('project_documents').insert([{
        project_id: projectId, name: createName.trim(), url, kind,
        tag: createTag, drive_file_id: res.id, mime_type: mime, created_by: profile?.id || null,
      }]);
      if (error) throw error;
      setCreateType(null); setCreateName(''); setCreateTag('geral');
      toast.success(`Criado em ${catLabel(createTag)}!`);
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
      setLinkOpen(false); setLinkUrl(''); setLinkName(''); setLinkTag('geral');
      toast.success('Link salvo no projeto!');
      fetchDocs(true);
    } catch (err: any) {
      toast.error(err.message || 'Falha ao salvar o link.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (doc: Doc) => {
    setDocs(prev => prev.filter(d => d.id !== doc.id));
    const { error } = await supabase.from('project_documents').delete().eq('id', doc.id);
    if (error) { toast.error('Falha ao remover.'); fetchDocs(true); return; }
    toast.success('Removido da lista. O arquivo continua no Drive.');
  };

  return (
    <div
      className={clsx('relative bg-lumos-surface border rounded-lumos overflow-hidden transition-colors', dragOver ? 'border-lumos-yellow' : 'border-lumos-border')}
      onDragOver={canManage ? (e) => { e.preventDefault(); if (!dragOver) setDragOver(true); } : undefined}
      onDragLeave={canManage ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); } : undefined}
      onDrop={canManage ? onDrop : undefined}
    >
      {/* Overlay de drag-and-drop */}
      {dragOver && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-lumos-yellow/10 border-2 border-dashed border-lumos-yellow rounded-lumos pointer-events-none">
          <div className="flex items-center gap-2 text-sm font-black text-lumos-yellow uppercase tracking-wide">
            <Upload className="w-5 h-5" /> Solte para enviar ao Drive
          </div>
        </div>
      )}

      {/* Cabeçalho + ações */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-lumos-border">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-lumos-yellow" />
          <h3 className="text-sm font-black uppercase tracking-tight text-lumos-text-primary">Documentos</h3>
          <span className="text-[11px] text-lumos-text-secondary">{docs.length}</span>
        </div>

        {canManage && (
          <div className="flex items-center gap-2">
            {folderId && (
              <a
                href={`https://drive.google.com/drive/folders/${folderId}`}
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
              title={`Subir para ${catLabel(uploadTarget)}`}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Subir arquivo
            </button>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={handleUpload}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,image/*,application/pdf" />

            <button
              ref={novoBtnRef}
              onClick={() => {
                const r = novoBtnRef.current?.getBoundingClientRect();
                if (r) setMenuPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
                setNewMenu(v => !v);
              }}
              className="h-8 px-3 rounded-lumos bg-lumos-yellow text-black text-xs font-black flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Novo <ChevronDown className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Abas de filtro: Todos + categorias. A aba ativa filtra a lista e é o
          destino dos uploads. */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-lumos-border overflow-x-auto">
        {FILTERS.map(f => {
          const count = f.value === 'todos' ? docs.length : docs.filter(d => d.tag === f.value).length;
          const active = activeCat === f.value;
          return (
            <button key={f.value} type="button" onClick={() => setActiveCat(f.value)}
              className={clsx('h-7 px-3 rounded-full text-[11px] font-black uppercase tracking-tight transition-colors flex items-center gap-1.5 whitespace-nowrap',
                active ? 'bg-lumos-yellow text-black' : 'text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-primary/5')}>
              {f.label}
              <span className={clsx('text-[9px] font-bold', active ? 'text-black/60' : 'text-lumos-text-secondary/60')}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Menu "Novo" (portal, pra não ser cortado pelo overflow do card) */}
      {newMenu && menuPos && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setNewMenu(false)} />
          <div style={{ top: menuPos.top, right: menuPos.right }}
            className="fixed w-52 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl z-[61] py-1 animate-in fade-in slide-in-from-top-2 duration-150">
            {(Object.keys(GOOGLE_MIME) as (keyof typeof GOOGLE_MIME)[]).map(t => {
              const { kind, label } = GOOGLE_MIME[t];
              const { Icon, color } = kindVisual(kind);
              return (
                <button key={t}
                  onClick={() => { setNewMenu(false); setCreateType(t); setCreateName(''); setCreateTag(uploadTarget); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-lumos-text-primary hover:bg-lumos-text-primary/5"
                >
                  <Icon className={clsx('w-4 h-4', color)} /> Novo Google {label}
                </button>
              );
            })}
            <div className="h-px bg-lumos-border my-1" />
            <button
              onClick={() => { setNewMenu(false); setLinkOpen(true); setLinkUrl(''); setLinkName(''); setLinkTag(uploadTarget); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-lumos-text-primary hover:bg-lumos-text-primary/5"
            >
              <Link2 className="w-4 h-4 text-lumos-text-secondary" /> Colar link
            </button>
          </div>
        </>,
        document.body,
      )}

      {/* Lista */}
      {loading ? (
        <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin text-lumos-yellow mx-auto" /></div>
      ) : visibleDocs.length === 0 ? (
        <div className="py-10 text-center text-sm text-lumos-text-secondary">
          {docs.length === 0
            ? 'Nenhum documento ainda. Escolha a categoria e arraste arquivos aqui, suba um ou crie um Google Doc/Planilha/Slides.'
            : `Nenhum documento em ${catLabel(activeCat)}.`}
        </div>
      ) : (
        <ul className="divide-y divide-lumos-border">
          {visibleDocs.map(doc => {
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
                    value={CATEGORIES.some(c => c.value === doc.tag) ? doc.tag : ''}
                    onChange={e => recategorize(doc, e.target.value)}
                    onClick={e => e.stopPropagation()}
                    title="Mudar categoria (move o arquivo no Drive)"
                    className="text-[10px] font-black uppercase tracking-wide bg-lumos-yellow/10 text-amber-600 dark:text-lumos-yellow border border-lumos-yellow/20 rounded px-1.5 py-1 cursor-pointer focus:outline-none"
                  >
                    {!CATEGORIES.some(c => c.value === doc.tag) && <option value="" disabled>{catLabel(doc.tag)}</option>}
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                ) : (
                  <span className="text-[10px] font-black uppercase tracking-wide bg-lumos-yellow/10 text-amber-600 dark:text-lumos-yellow border border-lumos-yellow/20 rounded px-1.5 py-1">
                    {catLabel(doc.tag)}
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
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Categoria</label>
            <select className="input-lumos w-full" value={createTag} onChange={e => setCreateTag(e.target.value)}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <p className="text-[11px] text-lumos-text-secondary">Cria o arquivo na subpasta {catFolderName(createTag)} do projeto no Drive e abre numa nova aba.</p>
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
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Categoria</label>
              <select className="input-lumos w-full" value={linkTag} onChange={e => setLinkTag(e.target.value)}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
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
