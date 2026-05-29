import React, { useEffect, useState } from 'react';
import {
  Receipt,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  DollarSign,
  Upload,
  ChevronRight,
  Trash2,
  Search,
  Check,
  AlertTriangle,
  FolderPlus
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useGoogleDrive } from '@/hooks/useGoogleDrive';
import Modal from '@/components/common/Modal';
import { useToast } from '@/context/ToastContext';

const CurrencyInput = ({ value, onChange, className }: any) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/\D/g, "");
    const numberValue = rawValue ? parseInt(rawValue) / 100 : 0;
    onChange(numberValue);
  };
  const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  return <input type="text" className={className} value={formattedValue} onChange={handleChange} />;
};

const StatusBadge = ({ status }: { status: string }) => {
  const configs: any = {
    pendente: { color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', label: 'Pendente', icon: Clock },
    aprovado: { color: 'bg-yellow-500/20 text-lumos-yellow border-lumos-yellow/30', label: 'Aprovado', icon: CheckCircle2 },
    pago: { color: 'bg-green-500/20 text-green-400 border-green-500/30', label: 'Pago', icon: DollarSign },
    rejeitado: { color: 'bg-red-500/20 text-red-400 border-red-500/30', label: 'Rejeitado', icon: XCircle },
  };
  const config = configs[status] || configs.pendente;
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${config.color}`}>
      <Icon className="w-2.5 h-2.5 mr-1" /> {config.label.toUpperCase()}
    </span>
  );
};

export default function Reembolso() {
  const { profile, isAdmin } = useAuth();
  const toast = useToast();
  const { login, isAuthenticated, uploadToDrive, listFiles, createFolder } = useGoogleDrive();
  const [reimbursements, setReimbursements] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    description: '',
    amount: 0,
    expense_date: new Date().toISOString().split('T')[0],
    project_id: '',
    payment_method: 'pix',
    notes: '',
    attachment: null as File | null
  });
  const [uploading, setUploading] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchDeleteModalOpen, setIsBatchDeleteModalOpen] = useState(false);

  useEffect(() => {
    fetchReimbursements();
    fetchProjects();
    fetchClients();
  }, [profile, isAdmin]);

  async function fetchProjects() {
    const { data } = await supabase
      .from('projects')
      .select('id, name, code, client:clients(id, name)')
      .order('created_at', { ascending: false });
    setProjects(data || []);
  }

  async function fetchClients() {
    const { data } = await supabase.from('clients').select('id, name').order('name');
    setClients(data || []);
  }

  async function fetchReimbursements() {
    try {
      setLoading(true);
      let query = supabase.from('reimbursements').select('*, requester:app_users!requester_id(full_name), project:projects(name)');
      if (!isAdmin) query = query.eq('requester_id', profile?.id);
      const { data, error } = await query.order('created_at', { ascending: false });
      setReimbursements(data || []);
    } catch (error) { console.error(error); } finally { setLoading(false); }
  }

  const getOrCreatePath = async (employeeName: string) => {
    const rootId = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID || '1-Q38vOIfw-CoDxYtBa82-tvhKa1-Xiks';
    const month = new Date().toISOString().split('-').slice(0, 2).join('-');

    const findFolder = async (name: string, parentId: string) => {
      const res = await listFiles(`name = '${name}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
      return res.files[0]?.id;
    };

    try {
      let reembolsosId = await findFolder('Reembolsos', rootId);
      if (!reembolsosId) reembolsosId = (await createFolder('Reembolsos', rootId)).id;

      let employeeId = await findFolder(employeeName, reembolsosId);
      if (!employeeId) employeeId = (await createFolder(employeeName, reembolsosId)).id;

      let monthId = await findFolder(month, employeeId);
      if (!monthId) monthId = (await createFolder(month, employeeId)).id;

      return monthId;
    } catch (error: any) {
      if (error.message?.includes('File not found')) {
        throw new Error(`A pasta raiz do Google Drive (ID: ${rootId}) não foi encontrada ou sua conta Google não tem permissão para acessá-la. Certifique-se de que fez login com o e-mail corporativo correto da Lumos.`);
      }
      throw error;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    
    try {
      setUploading(true);
      let attachmentData = null;

      if (formData.attachment) {
        if (!isAuthenticated()) {
          login();
          setUploading(false);
          return;
        }

        const folderId = await getOrCreatePath(profile.full_name || 'Desconhecido');
        const file = formData.attachment;
        const uploadRes = await uploadToDrive(file, file.name, file.type, folderId);
        
        attachmentData = [{
          name: file.name,
          drive_file_id: uploadRes.id,
          url: `https://drive.google.com/file/d/${uploadRes.id}/view`,
          uploaded_at: new Date().toISOString()
        }];
      }

      const { error } = await supabase.from('reimbursements').insert([{
        requester_id: profile.id,
        description: formData.description,
        amount: formData.amount,
        expense_date: formData.expense_date,
        project_id: formData.project_id === 'interno' ? null : (formData.project_id || null),
        payment_method: formData.payment_method,
        notes: formData.project_id === 'interno' ? `${formData.notes}\n[Gasto Interno]`.trim() : formData.notes,
        attachments: formData.project_id === 'interno' && attachmentData
          ? attachmentData.map((a: any) => ({ ...a, interno: true })) 
          : attachmentData,
        status: 'pendente'
      }]);
      if (error) throw error;
      setIsModalOpen(false);
      fetchReimbursements();
      resetForm();
    } catch (error: any) {
      console.error(error);
      toast.error(error.message);
    } finally {
      setUploading(false);
    }
  };

  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [showCreateProjectForm, setShowCreateProjectForm] = useState(false);
  const [newProjectData, setNewProjectData] = useState({ code: '', name: '', client_id: '' });

  // Inicia o formulário de criação tentando inferir código e nome do que foi digitado
  // Aceita formatos como "#192 - Nome", "192 — Nome", "192 Nome" ou apenas "Nome"
  const openCreateProjectForm = (rawInput: string) => {
    const trimmed = rawInput.trim();
    const match = trimmed.match(/^#?\s*(\d+)\s*[-—–:]\s*(.+)$/) || trimmed.match(/^#?\s*(\d+)\s+(.+)$/);
    if (match) {
      setNewProjectData({ code: match[1].trim(), name: match[2].trim(), client_id: '' });
    } else {
      setNewProjectData({ code: '', name: trimmed, client_id: '' });
    }
    setShowCreateProjectForm(true);
  };

  const createNewProject = async () => {
    const { code, name, client_id } = newProjectData;
    if (!name.trim()) {
      toast.error('Informe o nome do projeto');
      return;
    }
    try {
      setIsCreatingProject(true);

      const insertPayload: any = {
        name: name.trim(),
        created_by: profile?.id,
      };
      if (code.trim()) insertPayload.code = code.trim();
      if (client_id) insertPayload.client_id = client_id;

      const { data, error } = await supabase
        .from('projects')
        .insert([insertPayload])
        .select('id, name, code, client:clients(id, name)')
        .single();
      if (error) throw error;

      setProjects(prev => [data, ...prev]);
      setFormData({ ...formData, project_id: data.id });
      setProjectSearch(data.code ? `#${data.code} — ${data.name}` : data.name);
      setShowProjectDropdown(false);
      setShowCreateProjectForm(false);
      setNewProjectData({ code: '', name: '', client_id: '' });
      toast.success(`Projeto "${data.name}" criado!`);
    } catch (err: any) {
      toast.error(`Erro ao criar projeto: ${err.message}`);
    } finally {
      setIsCreatingProject(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      const { error } = await supabase.from('reimbursements').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      
      if (status === 'aprovado') {
        const item = reimbursements.find(r => r.id === id);
        if (item) {
          await supabase.from('payables').insert([{
            description: `Reembolso — ${item.requester?.full_name || 'Funcionário'}`,
            amount: item.amount,
            due_date: new Date().toISOString().split('T')[0],
            category: 'outro',
            notes: item.description,
            created_by: profile?.id
          }]);
        }
      }

      fetchReimbursements();
    } catch (error: any) { toast.error(error.message); }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      const { error } = await supabase.from('reimbursements').delete().eq('id', deletingId);
      if (error) throw error;
      setIsDeleteModalOpen(false);
      setDeletingId(null);
      fetchReimbursements();
    } catch (error: any) { toast.error(error.message); }
  };

  const handleBatchStatus = async (status: string) => {
    const toUpdate = reimbursements.filter(r => selectedIds.has(r.id));
    if (toUpdate.length === 0) return;

    try {
      const ids = toUpdate.map(r => r.id);
      const { error } = await supabase.from('reimbursements').update({ 
        status, 
        updated_at: new Date().toISOString() 
      }).in('id', ids);
      if (error) throw error;

      if (status === 'aprovado') {
        const payables = toUpdate.map(item => ({
          description: `Reembolso — ${item.requester?.full_name || 'Funcionário'}`,
          amount: item.amount,
          due_date: new Date().toISOString().split('T')[0],
          category: 'outro',
          notes: item.description,
          created_by: profile?.id
        }));
        await supabase.from('payables').insert(payables);
      }

      setSelectedIds(new Set());
      fetchReimbursements();
    } catch (error: any) { toast.error(error.message); }
  };

  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    try {
      const { error } = await supabase.from('reimbursements').delete().in('id', ids);
      if (error) throw error;
      setIsBatchDeleteModalOpen(false);
      setSelectedIds(new Set());
      fetchReimbursements();
    } catch (error: any) { toast.error(error.message); }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === reimbursements.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(reimbursements.map(r => r.id)));
    }
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const resetForm = () => {
    setFormData({ description: '', amount: 0, expense_date: new Date().toISOString().split('T')[0], project_id: '', payment_method: 'pix', notes: '', attachment: null });
    setProjectSearch('');
  };

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">{isAdmin ? 'Gestão de Reembolsos' : 'Meus Reembolsos'}</h1>
          <p className="text-lumos-text-secondary text-sm">{isAdmin ? 'Autorize as solicitações da equipe ou crie seus próprios pedidos.' : 'Solicite e acompanhe seus pedidos.'}</p>
        </div>
        <button onClick={() => { resetForm(); setIsModalOpen(true); }} className="btn-primary h-10 px-6 flex items-center gap-2">
          <Plus className="w-4 h-4" /> Nova Solicitação
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-lumos-text-primary/5 border-b border-lumos-border text-[10px] font-bold text-lumos-text-secondary uppercase">
                {isAdmin && (
                  <th className="px-6 py-4 w-10">
                    <div 
                      onClick={toggleSelectAll}
                      className={clsx(
                        "w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all",
                        selectedIds.size === reimbursements.length && reimbursements.length > 0
                          ? "bg-lumos-yellow border-lumos-yellow text-lumos-bg"
                          : "border-lumos-border hover:border-lumos-yellow/50"
                      )}
                    >
                      {selectedIds.size === reimbursements.length && reimbursements.length > 0 && <Check className="w-3.5 h-3.5" />}
                    </div>
                  </th>
                )}
                {isAdmin && <th className="px-6 py-4">Funcionário</th>}
                <th className="px-6 py-4">Data</th>
                <th className="px-6 py-4">Descrição</th>
                <th className="px-6 py-4">Valor</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lumos-border">
              {loading ? (
                <tr><td colSpan={isAdmin ? 7 : 5} className="py-12 text-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-lumos-yellow mx-auto"></div></td></tr>
              ) : reimbursements.length === 0 ? (
                <tr><td colSpan={isAdmin ? 7 : 5} className="py-12 text-center text-lumos-text-secondary text-sm italic">Nenhum reembolso.</td></tr>
              ) : (
                reimbursements.map((r) => (
                  <tr 
                    key={r.id} 
                    className={clsx(
                      "hover:bg-lumos-text-primary/5 transition-colors cursor-pointer group",
                      selectedIds.has(r.id) && "bg-lumos-yellow/[0.03]"
                    )}
                    onClick={() => !isAdmin && r.status === 'pendente' ? null : null}
                  >
                    {isAdmin && (
                      <td className="px-6 py-4">
                        <div 
                          onClick={(e) => toggleSelect(r.id, e)}
                          className={clsx(
                            "w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all",
                            selectedIds.has(r.id)
                              ? "bg-lumos-yellow border-lumos-yellow text-lumos-bg"
                              : "border-lumos-border group-hover:border-lumos-yellow/50 opacity-0 group-hover:opacity-100",
                            selectedIds.size > 0 && "opacity-100"
                          )}
                        >
                          {selectedIds.has(r.id) && <Check className="w-3.5 h-3.5" />}
                        </div>
                      </td>
                    )}
                    {isAdmin && <td className="px-6 py-4 text-sm font-bold text-lumos-text-primary">{r.requester?.full_name}</td>}
                    <td className="px-6 py-4 text-sm text-lumos-text-secondary">{new Date(r.expense_date).toLocaleDateString('pt-BR')}</td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-lumos-text-primary">{r.description}</span>
                        {r.project && (
                          <span className="text-[10px] text-lumos-yellow font-bold uppercase tracking-widest">Projeto: {r.project.name}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-lumos-text-primary">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.amount)}</td>
                    <td className="px-6 py-4 text-center"><StatusBadge status={r.status} /></td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {isAdmin ? (
                          <>
                            {r.status === 'pendente' && (
                              <>
                                <button onClick={() => updateStatus(r.id, 'aprovado')} title="Aprovar" className="p-1.5 text-green-500 hover:bg-green-500/10 rounded transition-colors"><CheckCircle2 className="w-4 h-4" /></button>
                                <button onClick={() => updateStatus(r.id, 'rejeitado')} title="Rejeitar" className="p-1.5 text-red-500 hover:bg-red-500/10 rounded transition-colors"><XCircle className="w-4 h-4" /></button>
                              </>
                            )}
                            {r.status === 'aprovado' && <button onClick={() => updateStatus(r.id, 'pago')} className="btn-primary text-[10px] px-2 py-1 h-auto">Pagar</button>}
                            <button onClick={() => { setDeletingId(r.id); setIsDeleteModalOpen(true); }} title="Excluir" className="p-1.5 text-lumos-text-secondary hover:text-red-500 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
                          </>
                        ) : (
                          <>
                            {r.status === 'pendente' && (
                              <button onClick={() => { setDeletingId(r.id); setIsDeleteModalOpen(true); }} title="Excluir" className="p-1.5 text-lumos-text-secondary hover:text-red-500 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
                            )}
                            <button className="p-1.5 text-lumos-text-secondary"><ChevronRight className="w-4 h-4" /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Batch Action Bar */}
      {isAdmin && selectedIds.size > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-8 duration-500">
          <div className="bg-lumos-surface border border-lumos-yellow/20 shadow-[0_20px_50px_rgba(0,0,0,0.5)] rounded-full px-6 py-4 flex items-center gap-6 backdrop-blur-xl">
            <div className="flex items-center gap-3 pr-6 border-r border-lumos-border">
              <div className="w-8 h-8 rounded-full bg-lumos-yellow/20 flex items-center justify-center font-black text-lumos-yellow text-sm">
                {selectedIds.size}
              </div>
              <span className="text-sm font-bold text-lumos-text-primary uppercase tracking-tight">
                {selectedIds.size === 1 ? 'Item selecionado' : 'Itens selecionados'}
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <button 
                onClick={() => handleBatchStatus('aprovado')}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 text-green-500 font-black text-[10px] uppercase hover:bg-green-500 hover:text-white transition-all active:scale-95"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Aprovar
              </button>

              <button 
                onClick={() => handleBatchStatus('rejeitado')}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/10 text-red-500 font-black text-[10px] uppercase hover:bg-red-500 hover:text-white transition-all active:scale-95"
              >
                <XCircle className="w-3.5 h-3.5" />
                Rejeitar
              </button>

              <button 
                onClick={() => handleBatchStatus('pago')}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-lumos-yellow text-lumos-bg font-black text-[10px] uppercase hover:scale-105 active:scale-95 transition-all"
              >
                <DollarSign className="w-3.5 h-3.5" />
                Marcar Pago
              </button>
              
              <button 
                onClick={() => setIsBatchDeleteModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/10 text-red-500 font-black text-[10px] uppercase hover:bg-red-500 hover:text-white transition-all active:scale-95"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Excluir
              </button>

              <button 
                onClick={() => setSelectedIds(new Set())}
                className="p-2 text-lumos-text-secondary hover:text-lumos-text-primary transition-colors text-xs font-bold uppercase"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Delete Confirmation Modal */}
      <Modal
        isOpen={isBatchDeleteModalOpen}
        onClose={() => setIsBatchDeleteModalOpen(false)}
        title="Excluir Solicitações"
      >
        <div className="space-y-4">
          <div className="flex gap-4 items-start">
            <div className="p-3 bg-red-500/10 rounded-full flex-shrink-0">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <div className="space-y-1">
              <p className="text-lumos-text-primary font-bold">Confirma a exclusão em lote?</p>
              <p className="text-xs text-lumos-text-secondary">Você selecionou {selectedIds.size} solicitações de reembolso para exclusão permanente. Esta ação não pode ser desfeita.</p>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setIsBatchDeleteModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handleBatchDelete} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lumos flex-1 transition-all">Sim, Excluir</button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Solicitar Reembolso">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase">Descrição</label>
            <input required type="text" className="input-lumos w-full" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
          </div>
          <div className="space-y-2 relative">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Projeto (Opcional)</label>
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-lumos-text-secondary" />
                <input 
                  type="text" 
                  className="input-lumos w-full pl-9 h-10 text-sm" 
                  placeholder="Pesquisar por código ou nome..."
                  value={projectSearch}
                  onFocus={() => setShowProjectDropdown(true)}
                  onChange={(e) => {
                    setProjectSearch(e.target.value);
                    setShowProjectDropdown(true);
                  }}
                />
              </div>

              {showProjectDropdown && !showCreateProjectForm && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowProjectDropdown(false)}></div>
                  <div className="absolute top-full left-0 right-0 mt-1 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl z-20 max-h-60 overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200">
                    <button
                      type="button"
                      onClick={() => {
                        setFormData({ ...formData, project_id: 'interno' });
                        setProjectSearch('#000 — Produtora Lumos');
                        setShowProjectDropdown(false);
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-lumos-yellow/10 border-b border-lumos-border transition-colors group"
                    >
                      <p className="text-xs font-black text-lumos-yellow uppercase tracking-tighter">#000 — Produtora Lumos</p>
                      <p className="text-[10px] text-lumos-text-secondary italic group-hover:text-lumos-yellow/70 transition-colors">Gasto interno administrativo</p>
                    </button>
                    {projects
                      .filter(b =>
                        b.name.toLowerCase().includes(projectSearch.toLowerCase()) ||
                        (b.code && b.code.toLowerCase().includes(projectSearch.toLowerCase()))
                      )
                      .map(b => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => {
                            setFormData({ ...formData, project_id: b.id });
                            setProjectSearch(b.code ? `#${b.code} — ${b.name}` : b.name);
                            setShowProjectDropdown(false);
                          }}
                          className="w-full text-left px-4 py-2.5 hover:bg-lumos-text-primary/5 transition-colors border-b border-lumos-border/50 last:border-0"
                        >
                          <p className="text-xs font-bold text-lumos-text-primary">{b.code ? `#${b.code} — ${b.name}` : b.name}</p>
                          {b.client?.name && <p className="text-[10px] text-lumos-text-secondary">{b.client.name}</p>}
                        </button>
                      ))}
                    {/* Opção de criar novo projeto quando há texto digitado */}
                    {projectSearch.trim() &&
                      !projects.some(b => b.name.toLowerCase() === projectSearch.toLowerCase()) &&
                      projectSearch !== '#000 — Produtora Lumos' && (
                      <button
                        type="button"
                        onClick={() => openCreateProjectForm(projectSearch)}
                        className="w-full text-left px-4 py-3 hover:bg-lumos-yellow/10 border-t border-lumos-border transition-colors group flex items-center gap-3"
                      >
                        <div className="p-1.5 bg-lumos-yellow/10 rounded text-lumos-yellow flex-shrink-0">
                          <FolderPlus className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <p className="text-xs font-black text-lumos-yellow">
                            Criar projeto "{projectSearch}"
                          </p>
                          <p className="text-[10px] text-lumos-text-secondary">Preencher dados do novo projeto</p>
                        </div>
                      </button>
                    )}
                  </div>
                </>
              )}

              {/* Mini-formulário de criação de novo projeto */}
              {showCreateProjectForm && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowCreateProjectForm(false)}></div>
                  <div className="absolute top-full left-0 right-0 mt-1 bg-lumos-surface border border-lumos-yellow/40 rounded-lumos shadow-2xl z-20 p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center gap-2 pb-2 border-b border-lumos-border">
                      <div className="p-1.5 bg-lumos-yellow/10 rounded text-lumos-yellow">
                        <FolderPlus className="w-3.5 h-3.5" />
                      </div>
                      <p className="text-xs font-black text-lumos-yellow uppercase tracking-widest">Novo Projeto</p>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Código</label>
                        <input
                          type="text"
                          className="input-lumos w-full h-9 text-sm"
                          placeholder="192"
                          value={newProjectData.code}
                          onChange={e => setNewProjectData({ ...newProjectData, code: e.target.value })}
                        />
                      </div>
                      <div className="col-span-2 space-y-1">
                        <label className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Nome do projeto *</label>
                        <input
                          type="text"
                          required
                          className="input-lumos w-full h-9 text-sm"
                          placeholder="Sicredi | Social Show"
                          value={newProjectData.name}
                          onChange={e => setNewProjectData({ ...newProjectData, name: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Cliente</label>
                      <select
                        className="input-lumos w-full h-9 text-sm"
                        value={newProjectData.client_id}
                        onChange={e => setNewProjectData({ ...newProjectData, client_id: e.target.value })}
                      >
                        <option value="">Selecione (opcional)</option>
                        {clients.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowCreateProjectForm(false)}
                        className="btn-secondary flex-1 h-9 text-xs"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={isCreatingProject || !newProjectData.name.trim()}
                        onClick={createNewProject}
                        className="btn-primary flex-1 h-9 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isCreatingProject ? 'Criando...' : 'Criar Projeto'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase">Valor (R$)</label>
              <CurrencyInput className="input-lumos w-full font-bold" value={formData.amount} onChange={(val: number) => setFormData({...formData, amount: val})} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Data</label>
              <input required type="date" className="input-lumos w-full" value={formData.expense_date} onChange={e => setFormData({...formData, expense_date: e.target.value})} />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Comprovante</label>
            <div className="relative group">
              <input 
                type="file" 
                className="hidden" 
                id="receipt-upload" 
                onChange={e => setFormData({...formData, attachment: e.target.files?.[0] || null})}
                accept="image/*,application/pdf"
              />
              <label 
                htmlFor="receipt-upload" 
                className={`flex items-center justify-center gap-2 p-4 border-2 border-dashed rounded-lumos cursor-pointer transition-all ${formData.attachment ? 'border-green-500/50 bg-green-500/5' : 'border-lumos-border hover:border-lumos-yellow/50 hover:bg-lumos-yellow/5'}`}
              >
                {formData.attachment ? (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                    <span className="text-xs font-bold text-lumos-text-primary truncate max-w-[200px]">{formData.attachment.name}</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5 text-lumos-text-secondary" />
                    <span className="text-xs font-bold text-lumos-text-secondary">Selecione o comprovante (PDF ou Imagem)</span>
                  </>
                )}
              </label>
            </div>
            {isAuthenticated() ? (
              <p className="text-[10px] text-green-500 flex items-center gap-1"><CheckCircle2 className="w-2 h-2" /> Google Drive Conectado</p>
            ) : (
              <p className="text-[10px] text-lumos-text-secondary italic">Você precisará autorizar o Google Drive ao enviar.</p>
            )}
          </div>
          <div className="pt-4 flex gap-3">
            <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" disabled={uploading} className="btn-primary flex-1 h-10 flex items-center justify-center gap-2">
              {uploading ? <><div className="animate-spin rounded-full h-4 w-4 border-2 border-white/20 border-t-white"></div> Enviando...</> : 'Enviar'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} title="Excluir Solicitação">
        <div className="space-y-4">
          <p className="text-sm text-lumos-text-secondary">Tem certeza que deseja excluir esta solicitação de reembolso? Esta ação não pode ser desfeita.</p>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setIsDeleteModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handleDelete} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lumos flex-1 transition-all">Confirmar Exclusão</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
