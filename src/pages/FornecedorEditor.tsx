import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Truck, Plus, Trash2, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import ServicosDatalist from '@/components/common/ServicosDatalist';

const CurrencyInput = ({ value, onChange, className }: any) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/\D/g, "");
    const numberValue = rawValue ? parseInt(rawValue) / 100 : 0;
    onChange(numberValue);
  };
  const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  return <input type="text" className={className} value={formattedValue} onChange={handleChange} />;
};

interface ServiceItem {
  id?: string;
  tipo_servico: string;
  valor: number;
  notes?: string;
}

export default function FornecedorEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { profile } = useAuth();
  
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    nome: '',
    cnpj: '',
    telefone: '',
    email: '',
    payment_info: '',
    notes: ''
  });
  
  const [services, setServices] = useState<ServiceItem[]>([
    { tipo_servico: '', valor: 0, notes: '' }
  ]);
  const [dbServiceIds, setDbServiceIds] = useState<string[]>([]);

  useEffect(() => {
    if (id) {
      fetchFornecedorData();
    }
  }, [id]);

  async function fetchFornecedorData() {
    try {
      setLoading(true);
      const { data: supplier, error } = await supabase
        .from('fornecedores')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error) throw error;
      
      setFormData({
        nome: supplier.nome,
        cnpj: supplier.cnpj || '',
        telefone: supplier.telefone || '',
        email: supplier.email || '',
        payment_info: supplier.payment_info || '',
        notes: supplier.notes || ''
      });

      const { data: sData, error: sError } = await supabase
        .from('fornecedor_servicos')
        .select('*')
        .eq('fornecedor_id', id)
        .order('created_at', { ascending: true });
        
      if (sError) throw sError;
      
      if (sData && sData.length > 0) {
        setServices(sData.map(s => ({
          id: s.id,
          tipo_servico: s.tipo_servico,
          valor: Number(s.valor || 0),
          notes: s.notes || ''
        })));
        setDbServiceIds(sData.map(s => s.id));
      } else {
        setServices([{ tipo_servico: '', valor: 0, notes: '' }]);
      }
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao buscar dados do fornecedor.');
      navigate('/producao/fornecedores');
    } finally {
      setLoading(false);
    }
  }

  const handleAddService = () => {
    setServices([...services, { tipo_servico: '', valor: 0, notes: '' }]);
  };

  const handleRemoveService = (index: number) => {
    setServices(services.filter((_, i) => i !== index));
  };

  const handleUpdateService = (index: number, field: keyof ServiceItem, value: any) => {
    const updated = [...services];
    updated[index] = { ...updated[index], [field]: value };
    setServices(updated);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nome.trim()) {
      toast.error('O nome do fornecedor é obrigatório.');
      return;
    }

    try {
      setSaving(true);
      let supplierId = id;

      const payload = {
        nome: formData.nome.trim(),
        cnpj: formData.cnpj.trim() || null,
        telefone: formData.telefone.trim() || null,
        email: formData.email.trim() || null,
        payment_info: formData.payment_info.trim() || null,
        notes: formData.notes.trim() || null,
        updated_at: new Date().toISOString()
      };

      if (id) {
        const { error } = await supabase
          .from('fornecedores')
          .update(payload)
          .eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('fornecedores')
          .insert([{ ...payload, created_by: profile?.id }])
          .select()
          .single();
        if (error) throw error;
        supplierId = data.id;
      }

      // Save/Upsert Services
      if (supplierId) {
        const formServices = services.filter(s => s.tipo_servico.trim());
        const formServiceIds = formServices.map(s => s.id).filter(Boolean) as string[];
        
        // Deletions
        const idsToDelete = dbServiceIds.filter(sid => !formServiceIds.includes(sid));
        if (idsToDelete.length > 0) {
          const { error: delError } = await supabase
            .from('fornecedor_servicos')
            .delete()
            .in('id', idsToDelete);
          if (delError) throw delError;
        }

        // Insert new services (no id)
        const servicesToInsert = formServices
          .filter(s => !s.id)
          .map(s => ({
            fornecedor_id: supplierId,
            tipo_servico: s.tipo_servico.trim(),
            valor: s.valor,
            notes: s.notes?.trim() || null
          }));

        if (servicesToInsert.length > 0) {
          const { error: insError } = await supabase
            .from('fornecedor_servicos')
            .insert(servicesToInsert);
          if (insError) throw insError;
        }

        // Update existing services (has id)
        const servicesToUpdate = formServices.filter(s => s.id);
        for (const s of servicesToUpdate) {
          const { error: updError } = await supabase
            .from('fornecedor_servicos')
            .update({
              tipo_servico: s.tipo_servico.trim(),
              valor: s.valor,
              notes: s.notes?.trim() || null
            })
            .eq('id', s.id);
          if (updError) throw updError;
        }
      }

      toast.success(id ? 'Fornecedor atualizado com sucesso.' : 'Fornecedor cadastrado com sucesso.');
      navigate('/producao/fornecedores');
    } catch (err: any) {
      console.error(err);
      toast.error(`Erro ao salvar: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-lumos-yellow"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 font-work-sans">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-xs font-black uppercase text-lumos-text-secondary hover:text-lumos-yellow transition-all"
      >
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>

      <div className="card border-t-4 border-t-lumos-yellow p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded bg-lumos-yellow/10 flex items-center justify-center text-lumos-yellow">
            <Truck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-lumos-text-primary tracking-tight">
              {id ? 'Editar Fornecedor' : 'Novo Fornecedor'}
            </h1>
            <p className="text-lumos-text-secondary text-xs">Insira os dados gerais e os serviços do fornecedor.</p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Nome do Fornecedor *</label>
              <input 
                required
                type="text" 
                className="input-lumos w-full h-10 px-4" 
                placeholder="Ex: Carlos Filmmaker"
                value={formData.nome}
                onChange={e => setFormData({ ...formData, nome: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">CNPJ / CPF</label>
              <input 
                type="text" 
                className="input-lumos w-full h-10 px-4" 
                placeholder="Ex: 00.000.000/0001-00"
                value={formData.cnpj}
                onChange={e => setFormData({ ...formData, cnpj: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Telefone</label>
              <input 
                type="text" 
                className="input-lumos w-full h-10 px-4" 
                placeholder="Ex: (11) 99999-9999"
                value={formData.telefone}
                onChange={e => setFormData({ ...formData, telefone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">E-mail</label>
              <input 
                type="email" 
                className="input-lumos w-full h-10 px-4" 
                placeholder="Ex: contato@fornecedor.com"
                value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Dados de Pagamento (PIX, Conta, etc)</label>
              <textarea 
                className="input-lumos w-full p-4 h-20 resize-none" 
                placeholder="Ex: Chave PIX Celular: (11) 99999-9999 (Nubank)"
                value={formData.payment_info}
                onChange={e => setFormData({ ...formData, payment_info: e.target.value })}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Observações Gerais</label>
              <textarea 
                className="input-lumos w-full p-4 h-20 resize-none" 
                placeholder="Notas ou termos gerais acordados com o fornecedor..."
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-4 pt-6 border-t border-lumos-border/40">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-lumos-text-primary uppercase tracking-wider">
                Serviços Oferecidos
              </h3>
              <button
                type="button"
                onClick={handleAddService}
                className="text-xs font-black uppercase text-lumos-yellow bg-lumos-yellow/10 px-4 py-2 rounded transition-all hover:bg-lumos-yellow/20"
              >
                + Adicionar Serviço
              </button>
            </div>

            <div className="space-y-4">
              <ServicosDatalist />
              {services.map((item, idx) => (
                <div key={idx} className="bg-lumos-bg/30 p-4 rounded border border-lumos-border grid grid-cols-1 md:grid-cols-12 gap-4 items-end relative">
                  <div className="md:col-span-6 space-y-1">
                    <label className="block text-[10px] font-bold text-lumos-text-secondary uppercase">Tipo de Serviço *</label>
                    <input
                      required
                      type="text"
                      list="servicos-catalogo"
                      className="input-lumos w-full h-10 px-3 text-sm"
                      placeholder="Busque o serviço (ex.: Filmmaker, Som direto…)"
                      value={item.tipo_servico}
                      onChange={e => handleUpdateService(idx, 'tipo_servico', e.target.value)}
                    />
                  </div>
                  <div className="md:col-span-3 space-y-1">
                    <label className="block text-[10px] font-bold text-lumos-text-secondary uppercase">Valor Padrão (R$)</label>
                    <CurrencyInput 
                      className="input-lumos w-full h-10 px-3 text-sm font-bold"
                      value={item.valor}
                      onChange={(val: number) => handleUpdateService(idx, 'valor', val)}
                    />
                  </div>
                  <div className="md:col-span-2 space-y-1">
                    <label className="block text-[10px] font-bold text-lumos-text-secondary uppercase">Notas / Observação</label>
                    <input 
                      type="text" 
                      className="input-lumos w-full h-10 px-3 text-xs"
                      placeholder="Ex: Sem alimentação"
                      value={item.notes || ''}
                      onChange={e => handleUpdateService(idx, 'notes', e.target.value)}
                    />
                  </div>
                  <div className="md:col-span-1 flex justify-center pb-1">
                    {services.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveService(idx)}
                        className="p-2 text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10 rounded transition-all"
                        title="Remover"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-4 pt-6 border-t border-lumos-border/40 max-lg:fixed max-lg:bottom-0 max-lg:left-0 max-lg:right-0 max-lg:bg-lumos-surface max-lg:border-t max-lg:p-4 max-lg:pb-[calc(1rem+env(safe-area-inset-bottom))] max-lg:z-30 lg:static lg:pt-6 lg:border-t lg:border-lumos-border/40">
            <button
              type="button"
              onClick={() => navigate('/producao/fornecedores')}
              className="btn-secondary h-11 px-6 min-w-[140px] max-lg:flex-1"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn-primary h-11 px-8 min-w-[160px] max-lg:flex-1 flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" /> {saving ? 'Salvando...' : 'Salvar Fornecedor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
