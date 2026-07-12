import React, { useEffect, useState } from 'react';
import {
  UserPlus,
  Search,
  Edit2,
  Shield,
  CheckCircle2,
  XCircle,
  Mail,
  Briefcase,
  Check,
  Trash2,
  AlertTriangle
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth, AppUserProfile, ROLE_DEFAULTS } from '@/hooks/useAuth';
import { notify, getAdminUserIds } from '@/lib/notifications/notify';
import { NOTIFICATION_EVENTS } from '@/lib/notifications/events';
import Modal from '@/components/common/Modal';
import { useToast } from '@/context/ToastContext';

import { logAudit } from '@/hooks/useAuditLog';
import Pagination from '@/components/common/Pagination';

type UserRole = 'admin' | 'producao' | 'atendimento' | 'editor' | 'social_media' | 'basico';

// Permissões que o admin pode liberar/bloquear por usuário (sobre o padrão do cargo)
const PERM_OPTIONS: { key: string; label: string }[] = [
  { key: 'ordem_do_dia', label: 'Produção (Projetos, Ordem do Dia, views)' },
  { key: 'fornecedores', label: 'Fornecedores' },
  { key: 'cronograma_edicao', label: 'Cronograma de Edição' },
  { key: 'acessos', label: 'Acessos & Senhas (cofre)' },
  { key: 'reembolso', label: 'Reembolso' },
  { key: 'custos_projeto', label: 'Custos de Projeto' },
];
type UserStatus = 'ativo' | 'inativo';

export default function UsersPage() {
  const { profile: currentUserProfile } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<AppUserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AppUserProfile | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    role: 'basico' as UserRole,
    job_title: '',
    status: 'ativo' as UserStatus,
    password: '',
    custom_permissions: {} as Record<string, boolean>,
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchDeleteModalOpen, setIsBatchDeleteModalOpen] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('app_users')
        .select('*')
        .order('full_name', { ascending: true });

      if (error) throw error;
      setUsers(data || []);
    } catch (error) {
      console.error('Erro ao buscar usuários:', error);
    } finally {
      setLoading(false);
    }
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setFormLoading(true);

      // Envia o convite por e-mail via edge function (service_role). A função
      // valida que o solicitante é admin, cria a conta de auth, o perfil em
      // app_users e dispara o e-mail para a pessoa definir a própria senha.
      const { data, error: fnError } = await supabase.functions.invoke('invite-user', {
        body: {
          email: formData.email,
          full_name: formData.full_name,
          role: formData.role,
          job_title: formData.job_title,
        },
      });

      // supabase-js encapsula erros HTTP; extrai a mensagem real do corpo.
      if (fnError) {
        let msg = fnError.message;
        try {
          const ctx = (fnError as any).context;
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json();
            if (body?.error) msg = body.error;
          }
        } catch { /* mantém msg genérica */ }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);

      logAudit('user_created', `Convite enviado para "${formData.full_name}" (${formData.email})`, { email: formData.email, role: formData.role });

      // Trigger notification NOVO_USUARIO_ACESSO
      const admins = await getAdminUserIds();
      await notify({
        userIds: admins,
        event: NOTIFICATION_EVENTS.NOVO_USUARIO_ACESSO,
        title: 'Novo acesso solicitado',
        body: `Convite enviado para o funcionário "${formData.full_name}" (${formData.role}).`,
        link: '/usuarios'
      });

      toast.success(`✓ Convite enviado para ${formData.email}. A pessoa vai receber um e-mail para definir a senha.`);

      setIsInviteModalOpen(false);
      resetForm();
      fetchUsers();
    } catch (error: any) {
      console.error('Erro ao convidar:', error);
      toast.error(`Erro: ${error.message}`);
    } finally {
      setFormLoading(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    try {
      setFormLoading(true);
      const { error } = await supabase
        .from('app_users')
        .update({
          full_name: formData.full_name,
          role: formData.role,
          job_title: formData.job_title,
          status: formData.status,
          custom_permissions: formData.custom_permissions,
        })
        .eq('id', selectedUser.id);

      if (error) throw error;

      // Trigger notification PERMISSAO_ALTERADA
      if (formData.role !== selectedUser.role) {
        await notify({
          userIds: [selectedUser.id],
          event: NOTIFICATION_EVENTS.PERMISSAO_ALTERADA,
          title: 'Suas permissões foram alteradas',
          body: `Seu nível de acesso foi alterado para "${formData.role}".`,
          link: '/configuracoes'
        });
      }

      if (formData.status !== selectedUser.status) {
        const action = formData.status === 'inativo' ? 'user_deactivated' : 'user_activated';
        logAudit(action, `Usuário "${selectedUser.full_name}" ${formData.status === 'inativo' ? 'desativado' : 'reativado'}`, { user_id: selectedUser.id });
      }


      setIsEditModalOpen(false);
      fetchUsers();
    } catch (error: any) {
      toast.error(`Erro ao atualizar: ${error.message}`);
    } finally {
      setFormLoading(false);
    }
  };

  // Reenvia o tour de boas-vindas: zera tour_seen → a pessoa vê de novo no
  // próximo acesso.
  const handleResendTour = async () => {
    if (!selectedUser) return;
    try {
      setFormLoading(true);
      const { error } = await supabase.from('app_users').update({ tour_seen: false }).eq('id', selectedUser.id);
      if (error) throw error;
      toast.success(`Tour reenviado — ${selectedUser.full_name.split(' ')[0]} verá no próximo login.`);
    } catch (error: any) {
      toast.error(`Erro ao reenviar: ${error.message}`);
    } finally {
      setFormLoading(false);
    }
  };

  const handleBatchStatus = async (status: UserStatus) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    try {
      const { error } = await supabase
        .from('app_users')
        .update({ status })
        .in('id', ids);

      if (error) throw error;
      const action = status === 'inativo' ? 'user_deactivated' : 'user_activated';
      logAudit(action, `${ids.length} usuário(s) ${status === 'inativo' ? 'desativado(s)' : 'ativado(s)'} em lote`, { user_ids: ids });
      setSelectedIds(new Set());
      fetchUsers();
    } catch (error: any) {
      toast.error(`Erro ao atualizar status: ${error.message}`);
    }
  };

  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    try {
      // Exclui pela edge function (service_role): remove a conta de auth E o
      // perfil de uma vez, sem deixar conta órfã no Supabase.
      const { data, error } = await supabase.functions.invoke('delete-user', {
        body: { ids },
      });

      if (error) {
        let msg = error.message;
        try {
          const ctx = (error as any).context;
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json();
            if (body?.error) msg = body.error;
          }
        } catch { /* mantém msg genérica */ }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);

      setIsBatchDeleteModalOpen(false);
      setSelectedIds(new Set());
      fetchUsers();
    } catch (error: any) {
      toast.error(`Erro ao excluir: ${error.message}`);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredUsers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredUsers.map(u => u.id)));
    }
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const openEditModal = (user: AppUserProfile) => {
    setSelectedUser(user);
    setFormData({
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      job_title: user.job_title || '',
      status: user.status,
      password: '',
      custom_permissions: { ...(user.custom_permissions || {}) },
    });
    setIsEditModalOpen(true);
  };

  // Liberar/bloquear/voltar-ao-padrão uma permissão para o usuário em edição
  const setPerm = (key: string, mode: 'default' | 'allow' | 'block') => {
    setFormData(fd => {
      const cp = { ...fd.custom_permissions };
      if (mode === 'default') delete cp[key]; else cp[key] = mode === 'allow';
      return { ...fd, custom_permissions: cp };
    });
  };

  const resetForm = () => {
    setFormData({
      full_name: '',
      email: '',
      role: 'basico',
      job_title: '',
      status: 'ativo',
      password: '',
      custom_permissions: {}
    });
  };

  const filteredUsers = users.filter(u => {
    const matchesSearch = u.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         u.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    const matchesStatus = statusFilter === 'all' || u.status === statusFilter;
    return matchesSearch && matchesRole && matchesStatus;
  });
  const totalPages = Math.ceil(filteredUsers.length / PAGE_SIZE);
  const pagedUsers = filteredUsers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const getRoleBadgeColor = (role: UserRole) => {
    switch (role) {
      case 'admin': return 'bg-lumos-yellow/20 text-lumos-yellow border-lumos-yellow/30';
      case 'producao': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'atendimento': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'editor': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'social_media': return 'bg-pink-500/20 text-pink-400 border-pink-500/30';
      default: return 'bg-lumos-text-primary/10 text-lumos-text-secondary border-lumos-border';
    }
  };

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">Gerenciamento de Usuários</h1>
          <p className="text-lumos-text-secondary text-sm">Controle quem acessa a plataforma e seus níveis de permissão.</p>
        </div>
        <button 
          onClick={() => { resetForm(); setIsInviteModalOpen(true); }}
          className="btn-primary flex items-center justify-center gap-2 h-10 px-6"
        >
          <UserPlus className="w-4 h-4" />
          Novo Usuário
        </button>
      </div>

      <div className="card p-4 flex flex-col md:flex-row gap-4 items-center">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
          <input 
            type="text"
            placeholder="Buscar por nome ou e-mail..."
            className="input-lumos pl-10 w-full"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
          />
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <select 
            className="input-lumos text-sm h-10 px-4"
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value); setCurrentPage(1); }}
          >
            <option value="all">Todos os Cargos</option>
            <option value="admin">Admin</option>
            <option value="producao">Produção</option>
            <option value="atendimento">Atendimento</option>
            <option value="editor">Editor</option>
            <option value="social_media">Social Media</option>
            <option value="basico">Básico</option>
          </select>
          <select 
            className="input-lumos text-sm h-10 px-4"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
          >
            <option value="all">Todos os Status</option>
            <option value="ativo">Ativos</option>
            <option value="inativo">Inativos</option>
          </select>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-lumos-text-primary/5 border-b border-lumos-border">
                <th className="px-6 py-4 w-10">
                  <div 
                    onClick={toggleSelectAll}
                    className={clsx(
                      "w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all",
                      selectedIds.size === filteredUsers.length && filteredUsers.length > 0
                        ? "bg-lumos-yellow border-lumos-yellow text-lumos-bg"
                        : "border-lumos-border hover:border-lumos-yellow/50"
                    )}
                  >
                    {selectedIds.size === filteredUsers.length && filteredUsers.length > 0 && <Check className="w-3.5 h-3.5" />}
                  </div>
                </th>
                <th className="px-6 py-4 text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Usuário</th>
                <th className="px-6 py-4 text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Cargo / Nível</th>
                <th className="px-6 py-4 text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lumos-border">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse border-b border-lumos-border">
                    <td className="px-6 py-4"><div className="h-4 w-4 rounded bg-lumos-border" /></td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-lumos-border flex-shrink-0" />
                        <div className="space-y-1.5">
                          <div className="h-3 w-32 rounded bg-lumos-border" />
                          <div className="h-2.5 w-40 rounded bg-lumos-border" />
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4"><div className="h-5 w-20 rounded-full bg-lumos-border" /></td>
                    <td className="px-6 py-4"><div className="h-5 w-16 rounded-full bg-lumos-border" /></td>
                    <td className="px-6 py-4"><div className="h-3 w-8 rounded bg-lumos-border ml-auto" /></td>
                  </tr>
                ))
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-lumos-text-secondary text-sm italic">
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              ) : (
                pagedUsers.map((user) => (
                  <tr 
                    key={user.id} 
                    className={clsx(
                      "hover:bg-lumos-text-primary/5 transition-colors group cursor-pointer",
                      selectedIds.has(user.id) && "bg-lumos-yellow/[0.03]"
                    )}
                    onClick={() => openEditModal(user)}
                  >
                    <td className="px-6 py-4">
                      <div 
                        onClick={(e) => toggleSelect(user.id, e)}
                        className={clsx(
                          "w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all",
                          selectedIds.has(user.id)
                            ? "bg-lumos-yellow border-lumos-yellow text-lumos-bg"
                            : "border-lumos-border group-hover:border-lumos-yellow/50 opacity-0 group-hover:opacity-100",
                          selectedIds.size > 0 && "opacity-100"
                        )}
                      >
                        {selectedIds.has(user.id) && <Check className="w-3.5 h-3.5" />}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lumos bg-lumos-yellow/10 flex items-center justify-center text-lumos-yellow font-bold text-sm border border-lumos-yellow/20">
                          {user.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-lumos-text-primary tracking-tight">{user.full_name}</span>
                          <span className="text-xs text-lumos-text-secondary">{user.email}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-lumos-text-primary">{user.job_title || 'Não definido'}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border w-fit ${getRoleBadgeColor(user.role)}`}>
                          <Shield className="w-2.5 h-2.5 mr-1" />
                          {user.role.replace('_', ' ').toUpperCase()}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {user.status === 'ativo' ? (
                        <span className="flex items-center text-xs text-green-500 font-bold uppercase tracking-wider">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Ativo
                        </span>
                      ) : (
                        <span className="flex items-center text-xs text-red-500 font-bold uppercase tracking-wider">
                          <XCircle className="w-3 h-3 mr-1" /> Inativo
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={() => openEditModal(user)}
                        className="p-2 text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-yellow/10 rounded-lumos transition-all"
                        title="Editar Usuário"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="px-6 pb-4">
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filteredUsers.length} pageSize={PAGE_SIZE} />
          </div>
        </div>
      </div>

      {/* Batch Action Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-8 duration-500">
          <div className="bg-lumos-surface border border-lumos-yellow/20 shadow-[0_20px_50px_rgba(0,0,0,0.5)] rounded-full px-6 py-4 flex items-center gap-6 backdrop-blur-xl">
            <div className="flex items-center gap-3 pr-6 border-r border-lumos-border">
              <div className="w-8 h-8 rounded-full bg-lumos-yellow/20 flex items-center justify-center font-black text-lumos-yellow text-sm">
                {selectedIds.size}
              </div>
              <span className="text-sm font-bold text-lumos-text-primary uppercase tracking-tight">
                {selectedIds.size === 1 ? 'Usuário selecionado' : 'Usuários selecionados'}
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <button 
                onClick={() => handleBatchStatus('ativo')}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 text-green-500 font-black text-[10px] uppercase hover:bg-green-500 hover:text-white transition-all active:scale-95"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Ativar
              </button>

              <button 
                onClick={() => handleBatchStatus('inativo')}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-yellow-500/10 text-yellow-500 font-black text-[10px] uppercase hover:bg-yellow-500 hover:text-white transition-all active:scale-95"
              >
                <XCircle className="w-3.5 h-3.5" />
                Desativar
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
        title="Excluir Usuários"
      >
        <div className="space-y-4">
          <div className="flex gap-4 items-start">
            <div className="p-3 bg-red-500/10 rounded-full flex-shrink-0">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <div className="space-y-1">
              <p className="text-lumos-text-primary font-bold">Confirma a exclusão em lote?</p>
              <p className="text-xs text-lumos-text-secondary">Você selecionou {selectedIds.size} usuários para exclusão permanente. O acesso deles será revogado imediatamente. Esta ação não pode ser desfeita.</p>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setIsBatchDeleteModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handleBatchDelete} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lumos flex-1 transition-all">Sim, Excluir</button>
          </div>
        </div>
      </Modal>


      <Modal 
        isOpen={isInviteModalOpen} 
        onClose={() => !formLoading && setIsInviteModalOpen(false)}
        title="Cadastrar Novo Usuário"
      >
        <form onSubmit={handleInvite} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase">Nome Completo</label>
            <input 
              required
              type="text" 
              className="input-lumos w-full"
              placeholder="Ex: João Silva"
              value={formData.full_name}
              onChange={(e) => setFormData({...formData, full_name: e.target.value})}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase">E-mail Corporativo</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
              <input 
                required
                type="email" 
                className="input-lumos pl-10 w-full"
                placeholder="joao@lumos.com.br"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase">Nível de Acesso</label>
              <select 
                className="input-lumos w-full"
                value={formData.role}
                onChange={(e) => setFormData({...formData, role: e.target.value as UserRole})}
              >
                <option value="basico">Básico</option>
                <option value="producao">Produção</option>
                <option value="atendimento">Atendimento</option>
                <option value="editor">Editor</option>
                <option value="social_media">Social Media</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase">Cargo</label>
              <div className="relative">
                <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
                <input 
                  type="text" 
                  className="input-lumos pl-10 w-full"
                  placeholder="Ex: Editor Sênior"
                  value={formData.job_title}
                  onChange={(e) => setFormData({...formData, job_title: e.target.value})}
                />
              </div>
            </div>
          </div>
          <div className="p-4 bg-lumos-yellow/5 border border-lumos-yellow/20 rounded-lumos flex items-start gap-3">
            <Mail className="w-4 h-4 text-lumos-yellow mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-lumos-text-secondary leading-relaxed">
              Um convite será enviado por e-mail para <span className="font-bold text-lumos-text-primary">{formData.email || 'o endereço informado'}</span>. A pessoa define a própria senha ao aceitar — nenhuma senha é compartilhada.
            </p>
          </div>
          <div className="pt-4 flex gap-3">
            <button type="button" disabled={formLoading} onClick={() => setIsInviteModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" disabled={formLoading} className="btn-primary flex-1 h-10 flex items-center justify-center gap-2">
              {formLoading ? <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-white"></div> : 'Enviar Convite'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal 
        isOpen={isEditModalOpen} 
        onClose={() => !formLoading && setIsEditModalOpen(false)}
        title="Editar Perfil"
      >
        <form onSubmit={handleUpdate} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase">Nome Completo</label>
            <input 
              required
              type="text" 
              className="input-lumos w-full"
              value={formData.full_name}
              onChange={(e) => setFormData({...formData, full_name: e.target.value})}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">E-mail (Não editável)</label>
            <input 
              disabled
              type="email" 
              className="input-lumos w-full opacity-50 cursor-not-allowed"
              value={formData.email}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase">Nível de Acesso</label>
              <select 
                className="input-lumos w-full"
                value={formData.role}
                onChange={(e) => setFormData({...formData, role: e.target.value as UserRole})}
              >
                <option value="basico">Básico</option>
                <option value="producao">Produção</option>
                <option value="atendimento">Atendimento</option>
                <option value="editor">Editor</option>
                <option value="social_media">Social Media</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Status</label>
              <select 
                className="input-lumos w-full"
                value={formData.status}
                onChange={(e) => setFormData({...formData, status: e.target.value as UserStatus})}
              >
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Cargo</label>
            <input
              type="text"
              className="input-lumos w-full"
              value={formData.job_title}
              onChange={(e) => setFormData({...formData, job_title: e.target.value})}
            />
          </div>

          {formData.role !== 'admin' && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Permissões — o que essa pessoa vê</label>
              <p className="text-[10px] text-lumos-text-secondary/70 leading-relaxed">
                <b>Padrão</b> = herda do cargo. <b>Liberar</b>/<b>Bloquear</b> sobrescreve só para este usuário. A bolinha verde mostra o resultado atual.
              </p>
              <div className="space-y-1.5 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                {PERM_OPTIONS.map(p => {
                  const roleGrants = (ROLE_DEFAULTS[formData.role] || []).some(x => x === '*' || x === p.key);
                  const ov = formData.custom_permissions[p.key];
                  const mode: 'default' | 'allow' | 'block' = ov === undefined ? 'default' : ov ? 'allow' : 'block';
                  const effective = ov === undefined ? roleGrants : ov;
                  return (
                    <div key={p.key} className="flex items-center justify-between gap-2 p-2 rounded-lumos border border-lumos-border/50 bg-lumos-bg/20">
                      <span className="text-[11px] font-semibold text-lumos-text-primary flex items-center gap-1.5 min-w-0">
                        <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', effective ? 'bg-green-500' : 'bg-lumos-text-secondary/40')} />
                        <span className="truncate">{p.label}</span>
                      </span>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        {([['default', 'Padrão'], ['allow', 'Liberar'], ['block', 'Bloquear']] as const).map(([m, lbl]) => (
                          <button key={m} type="button" onClick={() => setPerm(p.key, m)}
                            className={clsx('text-[9px] font-black uppercase px-2 py-1 rounded transition-colors',
                              mode === m
                                ? (m === 'allow' ? 'bg-green-500/20 text-green-500' : m === 'block' ? 'bg-red-500/20 text-red-400' : 'bg-lumos-yellow/20 text-lumos-yellow')
                                : 'text-lumos-text-secondary hover:bg-lumos-text-secondary/10')}>
                            {lbl}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Reenviar tour de boas-vindas (aparece no próximo login da pessoa) */}
          <button type="button" disabled={formLoading} onClick={handleResendTour}
            className="w-full h-9 text-xs font-bold rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-yellow hover:border-lumos-yellow/40 transition-colors flex items-center justify-center gap-1.5">
            🎬 Reenviar tour de boas-vindas no próximo login
          </button>

          <div className="pt-4 flex gap-3">
            <button type="button" disabled={formLoading} onClick={() => setIsEditModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" disabled={formLoading} className="btn-primary flex-1 h-10 flex items-center justify-center gap-2">
              {formLoading ? <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-white"></div> : 'Salvar Alterações'}
            </button>
          </div>
        </form>
      </Modal>

    </div>
  );
}
