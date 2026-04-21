import React, { useEffect, useState } from 'react';
import { 
  UserPlus, 
  Search, 
  Edit2, 
  Shield, 
  CheckCircle2, 
  XCircle, 
  Mail, 
  Briefcase 
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, AppUserProfile } from '@/hooks/useAuth';
import Modal from '@/components/common/Modal';

type UserRole = 'admin' | 'producao' | 'basico';
type UserStatus = 'ativo' | 'inativo';

export default function UsersPage() {
  const { profile: currentUserProfile } = useAuth();
  const [users, setUsers] = useState<AppUserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
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
    status: 'ativo' as UserStatus
  });

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

      // 1. Criar o registro prévio em app_users
      const { error: dbError } = await supabase
        .from('app_users')
        .insert([{
          full_name: formData.full_name,
          email: formData.email,
          role: formData.role,
          job_title: formData.job_title,
          status: 'ativo',
          invited_by: currentUserProfile?.id
        }]);

      if (dbError) throw dbError;

      // 2. Chamar a Edge Function para disparar o e-mail de convite
      const { error: funcError } = await supabase.functions.invoke('invite-user', {
        body: { 
          email: formData.email, 
          full_name: formData.full_name, 
          role: formData.role, 
          job_title: formData.job_title 
        }
      });

      if (funcError) {
        // Rollback: deleta o registro recém-criado em app_users se a função falhar
        await supabase.from('app_users').delete().eq('email', formData.email).is('auth_user_id', null);
        throw funcError;
      }

      alert(`Convite enviado com sucesso para ${formData.email}!`);
      setIsInviteModalOpen(false);
      resetForm();
      fetchUsers();
    } catch (error: any) {
      console.error('Erro no convite:', error);
      alert(`Erro ao processar convite: ${error.message}`);
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
          status: formData.status
        })
        .eq('id', selectedUser.id);

      if (error) throw error;
      
      setIsEditModalOpen(false);
      fetchUsers();
    } catch (error: any) {
      alert(`Erro ao atualizar: ${error.message}`);
    } finally {
      setFormLoading(false);
    }
  };

  const openEditModal = (user: AppUserProfile) => {
    setSelectedUser(user);
    setFormData({
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      job_title: user.job_title || '',
      status: user.status
    });
    setIsEditModalOpen(true);
  };

  const resetForm = () => {
    setFormData({
      full_name: '',
      email: '',
      role: 'basico',
      job_title: '',
      status: 'ativo'
    });
  };

  const filteredUsers = users.filter(u => {
    const matchesSearch = u.full_name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         u.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    const matchesStatus = statusFilter === 'all' || u.status === statusFilter;
    return matchesSearch && matchesRole && matchesStatus;
  });

  const getRoleBadgeColor = (role: UserRole) => {
    switch (role) {
      case 'admin': return 'bg-lumos-yellow/20 text-lumos-yellow border-lumos-yellow/30';
      case 'producao': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      default: return 'bg-white/10 text-lumos-text-secondary border-white/10';
    }
  };

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Gerenciamento de Usuários</h1>
          <p className="text-lumos-text-secondary text-sm">Controle quem acessa a plataforma e seus níveis de permissão.</p>
        </div>
        <button 
          onClick={() => { resetForm(); setIsInviteModalOpen(true); }}
          className="btn-primary flex items-center justify-center gap-2 h-10 px-6"
        >
          <UserPlus className="w-4 h-4" />
          Convidar Usuário
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
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <select 
            className="input-lumos text-sm h-10 px-4"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="all">Todos os Cargos</option>
            <option value="admin">Admin</option>
            <option value="producao">Produção</option>
            <option value="basico">Básico</option>
          </select>
          <select 
            className="input-lumos text-sm h-10 px-4"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
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
              <tr className="bg-white/5 border-b border-lumos-border">
                <th className="px-6 py-4 text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Usuário</th>
                <th className="px-6 py-4 text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Cargo / Nível</th>
                <th className="px-6 py-4 text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lumos-border">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-lumos-yellow mx-auto"></div>
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-lumos-text-secondary text-sm italic">
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-white/5 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lumos bg-lumos-yellow/10 flex items-center justify-center text-lumos-yellow font-bold text-sm border border-lumos-yellow/20">
                          {user.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-white tracking-tight">{user.full_name}</span>
                          <span className="text-xs text-lumos-text-secondary">{user.email}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-white">{user.job_title || 'Não definido'}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border w-fit ${getRoleBadgeColor(user.role)}`}>
                          <Shield className="w-2.5 h-2.5 mr-1" />
                          {user.role.toUpperCase()}
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
        </div>
      </div>

      <Modal 
        isOpen={isInviteModalOpen} 
        onClose={() => !formLoading && setIsInviteModalOpen(false)}
        title="Convidar Novo Usuário"
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
