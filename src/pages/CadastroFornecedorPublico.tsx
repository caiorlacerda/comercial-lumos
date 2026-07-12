import React, { useState } from 'react';
import { Truck, Plus, Trash2, CheckCircle2, Sun, Moon, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';
import { notify, getAdminUserIds } from '@/lib/notifications/notify';
import { NOTIFICATION_EVENTS } from '@/lib/notifications/events';
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
  tipo_servico: string;
  valor: number;
  notes?: string;
}

export default function CadastroFornecedorPublico() {
  const { theme, toggleTheme } = useTheme();
  const toast = useToast();

  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

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

  const handleResetForm = () => {
    setFormData({
      nome: '',
      cnpj: '',
      telefone: '',
      email: '',
      payment_info: '',
      notes: ''
    });
    setServices([{ tipo_servico: '', valor: 0, notes: '' }]);
    setSuccess(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nome.trim()) {
      toast.error('O nome do fornecedor é obrigatório.');
      return;
    }

    try {
      setSaving(true);

      const supplierId = (typeof crypto !== 'undefined' && crypto.randomUUID) 
        ? crypto.randomUUID() 
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
          });

      const payload = {
        id: supplierId,
        nome: formData.nome.trim(),
        cnpj: formData.cnpj.trim() || null,
        telefone: formData.telefone.trim() || null,
        email: formData.email.trim() || null,
        payment_info: formData.payment_info.trim() || null,
        notes: formData.notes.trim() || null,
        origem: 'autocadastro',
        status_cadastro: 'pendente',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Inserir fornecedor sem retornar via SELECT para contornar RLS de leitura
      const { error } = await supabase
        .from('fornecedores')
        .insert([payload]);

      if (error) throw error;

      // Inserir serviços se houver
      const formServices = services.filter(s => s.tipo_servico.trim());
      if (formServices.length > 0) {
        const servicesToInsert = formServices.map(s => ({
          fornecedor_id: supplierId,
          tipo_servico: s.tipo_servico.trim(),
          valor: s.valor,
          notes: s.notes?.trim() || null
        }));

        const { error: sError } = await supabase
          .from('fornecedor_servicos')
          .insert(servicesToInsert);

        if (sError) throw sError;
      }

      // Trigger notification FORNECEDOR_AUTOCADASTRO
      const admins = await getAdminUserIds();
      await notify({
        userIds: admins,
        event: NOTIFICATION_EVENTS.FORNECEDOR_AUTOCADASTRO,
        title: 'Novo autocadastro de fornecedor',
        body: `Fornecedor "${formData.nome.trim()}" preencheu o cadastro público.`,
        link: '/producao/fornecedores'
      });

      setSuccess(true);
      toast.success('Cadastro enviado com sucesso!');

    } catch (err: any) {
      console.error(err);
      toast.error(`Erro ao salvar cadastro: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-lumos-bg text-lumos-text-primary transition-colors duration-300 font-work-sans py-12 px-4 sm:px-6 lg:px-8 relative flex flex-col items-center justify-start">
      {/* Theme Toggle Button */}
      <div className="absolute top-6 right-6">
        <button
          onClick={toggleTheme}
          className="p-2 rounded-full text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-text-secondary/5 transition-all flex items-center justify-center"
          title="Alternar Tema"
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
      </div>

      {/* Main Container */}
      <div className="w-full max-w-4xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-750">
        {/* Header/Logo */}
        <div className="text-center space-y-4">
          <img
            src={theme === 'dark' ? "/logo/Logotipo-Branco-Alpha.svg" : "/logo/Logotipo-Preto-Alpha.svg"}
            alt="Lumos Logo"
            className="h-10 mx-auto transition-all duration-300"
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Cadastro de Fornecedores</h1>
            <p className="text-lumos-text-secondary text-xs mt-1">Preencha seus dados cadastrais e os serviços prestados para fazer parte da nossa rede de parceiros.</p>
          </div>
        </div>

        {success ? (
          <div className="card border-t-4 border-t-green-500 p-8 text-center space-y-6 max-w-lg mx-auto animate-in zoom-in duration-300">
            <div className="w-16 h-16 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-lumos-text-primary">Cadastro enviado!</h2>
              <p className="text-sm text-lumos-text-secondary">
                A equipe Lumos vai revisar os seus dados. Em breve entraremos em contato se necessário.
              </p>
            </div>
            <div className="pt-4">
              <button
                onClick={handleResetForm}
                className="btn-secondary py-2 px-6 text-xs font-bold"
              >
                Enviar Novo Cadastro
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card border-t-4 border-t-lumos-yellow p-6 sm:p-8 space-y-8 shadow-xl">
            {/* Dados Cadastrais */}
            <div className="space-y-6">
              <h2 className="text-sm font-bold text-lumos-text-primary uppercase tracking-widest border-b border-lumos-border/50 pb-2">
                Dados Cadastrais
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest block">
                    Nome do Fornecedor / Razão Social *
                  </label>
                  <input
                    required
                    type="text"
                    className="input-lumos w-full h-10 px-4"
                    placeholder="Ex: Carlos Filmmaker Ltda"
                    value={formData.nome}
                    onChange={e => setFormData({ ...formData, nome: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest block">
                    CNPJ / CPF
                  </label>
                  <input
                    type="text"
                    className="input-lumos w-full h-10 px-4"
                    placeholder="Ex: 00.000.000/0001-00"
                    value={formData.cnpj}
                    onChange={e => setFormData({ ...formData, cnpj: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest block">
                    Telefone de Contato
                  </label>
                  <input
                    type="text"
                    className="input-lumos w-full h-10 px-4"
                    placeholder="Ex: (11) 99999-9999"
                    value={formData.telefone}
                    onChange={e => setFormData({ ...formData, telefone: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest block">
                    E-mail
                  </label>
                  <input
                    type="email"
                    className="input-lumos w-full h-10 px-4"
                    placeholder="Ex: contato@parceiro.com"
                    value={formData.email}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest block">
                    Dados de Pagamento (PIX, Banco, Agência, Conta)
                  </label>
                  <textarea
                    className="input-lumos w-full p-4 h-24 resize-none"
                    placeholder="Ex: Chave PIX Celular: (11) 99999-9999 (Banco Nubank)"
                    value={formData.payment_info}
                    onChange={e => setFormData({ ...formData, payment_info: e.target.value })}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest block">
                    Observações Gerais
                  </label>
                  <textarea
                    className="input-lumos w-full p-4 h-24 resize-none"
                    placeholder="Alguma observação, restrição ou observação contratual..."
                    value={formData.notes}
                    onChange={e => setFormData({ ...formData, notes: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Serviços e Valores */}
            <div className="space-y-6 pt-6 border-t border-lumos-border/30">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-lumos-text-primary uppercase tracking-widest">
                  Serviços Oferecidos
                </h2>
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
                      <label className="block text-[9px] font-bold text-lumos-text-secondary uppercase tracking-wide">
                        Tipo de Serviço *
                      </label>
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
                      <label className="block text-[9px] font-bold text-lumos-text-secondary uppercase tracking-wide">
                        Valor da Diária (R$)
                      </label>
                      <CurrencyInput
                        className="input-lumos w-full h-10 px-3 text-sm font-bold"
                        value={item.valor}
                        onChange={(val: number) => handleUpdateService(idx, 'valor', val)}
                      />
                    </div>
                    <div className="md:col-span-2 space-y-1">
                      <label className="block text-[9px] font-bold text-lumos-text-secondary uppercase tracking-wide">
                        Detalhes do Serviço
                      </label>
                      <input
                        type="text"
                        className="input-lumos w-full h-10 px-3 text-xs"
                        placeholder="Ex: Incluso kit de lentes"
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
                          title="Remover Serviço"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Enviar Form */}
            <div className="pt-6 border-t border-lumos-border/30 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="btn-primary h-11 px-8 min-w-[200px] flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" /> {saving ? 'Enviando...' : 'Enviar Cadastro'}
              </button>
            </div>
          </form>
        )}

        {/* Footer */}
        <div className="text-center pt-8 border-t border-lumos-border/20">
          <p className="text-[10px] text-lumos-text-secondary font-bold uppercase tracking-wider opacity-40">
            Lumos Studio © {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  );
}
