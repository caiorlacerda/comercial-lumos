import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Plus, Search, Phone, Mail, FileText, Trash2, Edit2, AlertTriangle, Link2, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/common/Modal';
import { useToast } from '@/context/ToastContext';
import { Fornecedor } from '@/types/fornecedor';

export default function Fornecedores() {
  const navigate = useNavigate();
  const toast = useToast();
  const { profile } = useAuth();
  
  const [fornecedores, setFornecedores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  useEffect(() => {
    fetchFornecedores();
  }, []);

  const handleCopyPublicLink = async () => {
    const url = `${window.location.origin}/cadastro-fornecedor`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`Link de cadastro copiado: ${url}`);
    } catch (err) {
      console.error(err);
      toast.error(`Falha ao copiar o link. URL: ${url}`);
    }
  };

  async function fetchFornecedores() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('fornecedores')
        .select('*, servicos:fornecedor_servicos(id, tipo_servico)')
        .order('nome', { ascending: true });
      
      if (error) throw error;
      setFornecedores(data || []);
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao carregar fornecedores.');
    } finally {
      setLoading(false);
    }
  }

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      const { error } = await supabase.from('fornecedores').delete().eq('id', deletingId);
      if (error) throw error;
      toast.success('Fornecedor excluído com sucesso.');
      setIsDeleteModalOpen(false);
      setDeletingId(null);
      fetchFornecedores();
    } catch (err: any) {
      toast.error(`Erro ao excluir: ${err.message}`);
    }
  };

  const filteredFornecedores = fornecedores.filter(f => {
    const term = searchTerm.toLowerCase();
    const matchName = f.nome.toLowerCase().includes(term);
    const matchCnpj = f.cnpj && f.cnpj.toLowerCase().includes(term);
    const matchService = f.servicos && f.servicos.some((s: any) => s.tipo_servico.toLowerCase().includes(term));
    return matchName || matchCnpj || matchService;
  });

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">Fornecedores</h1>
          <p className="text-lumos-text-secondary text-sm">Gestão de parceiros, fornecedores e diárias de serviço.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleCopyPublicLink}
            className="btn-secondary h-10 px-4 flex items-center gap-2 text-xs"
            title="Copiar URL pública de cadastro para enviar aos fornecedores"
          >
            <Link2 className="w-4 h-4" /> Enviar link de cadastro
          </button>
          <button
            onClick={() => navigate('/producao/fornecedores/nova')}
            className="btn-primary h-10 px-6 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Novo Fornecedor
          </button>
        </div>
      </div>

      <div className="card p-4 relative">
        <Search className="absolute left-7 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
        <input
          type="text"
          placeholder="Buscar por nome, CNPJ/CPF ou tipo de serviço..."
          className="input-lumos pl-10 w-full"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="card p-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-lumos-yellow mx-auto"></div>
        </div>
      ) : filteredFornecedores.length === 0 ? (
        <div className="card p-12 text-center text-lumos-text-secondary text-sm italic">
          Nenhum fornecedor cadastrado ou encontrado.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredFornecedores.map(f => (
            <div
              key={f.id}
              onClick={() => navigate(`/producao/fornecedores/${f.id}`)}
              className="card p-6 flex flex-col justify-between hover:border-lumos-yellow/30 cursor-pointer group relative transition-all border border-lumos-border"
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-lg font-bold text-lumos-text-primary group-hover:text-lumos-yellow transition-colors line-clamp-1">
                        {f.nome}
                      </h3>
                      {f.status_cadastro === 'pendente' && (
                        <span className="bg-yellow-500/15 text-yellow-500 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded border border-yellow-500/20 shrink-0">
                          Pendente
                        </span>
                      )}
                    </div>
                    {f.cnpj && (
                      <p className="text-xs text-lumos-text-secondary font-medium tracking-wide mt-0.5">
                        CNPJ/CPF: {f.cnpj}
                      </p>
                    )}
                  </div>
                  <div className="p-2 bg-lumos-yellow/10 rounded text-lumos-yellow">
                    <Truck className="w-5 h-5" />
                  </div>
                </div>

                <div className="space-y-2 pt-3 border-t border-lumos-border/40 text-xs text-lumos-text-secondary">
                  {f.telefone && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-lumos-yellow shrink-0" />
                      <span>{f.telefone}</span>
                    </div>
                  )}
                  {f.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="w-3.5 h-3.5 text-lumos-yellow shrink-0" />
                      <span className="truncate">{f.email}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-lumos-yellow shrink-0" />
                    <span>{f.servicos?.length || 0} {f.servicos?.length === 1 ? 'serviço' : 'serviços'}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 mt-6 pt-3 border-t border-lumos-border/20">
                {f.status_cadastro === 'pendente' && (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        const { error } = await supabase
                          .from('fornecedores')
                          .update({ status_cadastro: 'aprovado' })
                          .eq('id', f.id);
                        if (error) throw error;
                        toast.success('Fornecedor aprovado com sucesso!');
                        fetchFornecedores();
                      } catch (err: any) {
                        toast.error(`Erro ao aprovar: ${err.message}`);
                      }
                    }}
                    className="mr-auto flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-green-500 hover:bg-green-500/10 rounded transition-all border border-green-500/20"
                    title="Aprovar Fornecedor"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Aprovar
                  </button>
                )}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    navigate(`/producao/fornecedores/${f.id}`);
                  }}
                  className="p-2 text-lumos-text-secondary hover:text-blue-500 rounded hover:bg-blue-500/10 transition-all"
                  title="Editar"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    setDeletingId(f.id);
                    setIsDeleteModalOpen(true);
                  }}
                  className="p-2 text-lumos-text-secondary hover:text-red-500 rounded hover:bg-red-500/10 transition-all"
                  title="Excluir"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        title="Confirmar Exclusão"
      >
        <div className="space-y-4">
          <div className="flex gap-4 items-start">
            <div className="p-3 bg-red-500/10 rounded-full flex-shrink-0">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <div className="space-y-1">
              <p className="text-lumos-text-primary font-bold">Deseja excluir este fornecedor?</p>
              <p className="text-xs text-lumos-text-secondary">
                Isso removerá permanentemente o fornecedor e todos os seus serviços cadastrados.
              </p>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setIsDeleteModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handleDelete} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lumos flex-1 transition-all">
              Excluir
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
