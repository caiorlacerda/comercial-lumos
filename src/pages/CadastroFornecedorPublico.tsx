import React, { useState } from 'react';
import { Trash2, CheckCircle2, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import PaginaPublica, { MONO, SERIF, ROTULO_PUBLICO, CAMPO_PUBLICO, BOTAO_AMARELO, BOTAO_CONTORNO, CARTAO_VIDRO_FORTE } from '@/components/publico/PaginaPublica';
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
    <PaginaPublica largura="max-w-4xl" rodape="Cadastro de fornecedores">
      <div className="space-y-8">
        {/* Título */}
        <div>
          <div className="mb-4 flex items-center gap-3">
            <span className="block h-[9px] w-[9px] bg-[#efc700]" />
            <span className="text-[10px] uppercase tracking-[3px]" style={{ fontFamily: MONO }}>Rede de parceiros</span>
          </div>
          <h1 className="text-[44px] font-normal leading-[1.05] tracking-[-0.01em] sm:text-[56px]" style={{ fontFamily: SERIF }}>
            Cadastro de fornecedores
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#d5d3d0]">
            Preencha seus dados cadastrais e os serviços prestados para fazer parte da nossa rede de parceiros.
          </p>
        </div>

        {success ? (
          <div className={`${CARTAO_VIDRO_FORTE} p-8 text-center space-y-6 max-w-lg mx-auto animate-in zoom-in duration-300`}>
            <div className="w-16 h-16 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <div className="space-y-2">
              <h2 className="text-[34px] font-normal leading-tight" style={{ fontFamily: SERIF }}>Cadastro enviado!</h2>
              <p className="text-sm text-[#d5d3d0]">
                A equipe Lumos vai revisar os seus dados. Em breve entraremos em contato se necessário.
              </p>
            </div>
            <div className="pt-4">
              <button
                onClick={handleResetForm}
                className={`${BOTAO_CONTORNO} h-10 px-6 text-xs uppercase tracking-[2px]`} style={{ fontFamily: MONO }}
              >
                Enviar Novo Cadastro
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className={`${CARTAO_VIDRO_FORTE} p-6 sm:p-9 space-y-8`}>
            {/* Dados Cadastrais */}
            <div className="space-y-6">
              <h2 className="border-b border-white/[0.22] pb-2 text-[11px] uppercase tracking-[3px] text-[#efc700]" style={{ fontFamily: MONO }}>
                Dados Cadastrais
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className={ROTULO_PUBLICO} style={{ fontFamily: MONO }}>
                    Nome do Fornecedor / Razão Social *
                  </label>
                  <input
                    required
                    type="text"
                    className={`${CAMPO_PUBLICO} h-10`}
                    placeholder="Ex: Carlos Filmmaker Ltda"
                    value={formData.nome}
                    onChange={e => setFormData({ ...formData, nome: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className={ROTULO_PUBLICO} style={{ fontFamily: MONO }}>
                    CNPJ / CPF
                  </label>
                  <input
                    type="text"
                    className={`${CAMPO_PUBLICO} h-10`}
                    placeholder="Ex: 00.000.000/0001-00"
                    value={formData.cnpj}
                    onChange={e => setFormData({ ...formData, cnpj: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className={ROTULO_PUBLICO} style={{ fontFamily: MONO }}>
                    Telefone de Contato
                  </label>
                  <input
                    type="text"
                    className={`${CAMPO_PUBLICO} h-10`}
                    placeholder="Ex: (11) 99999-9999"
                    value={formData.telefone}
                    onChange={e => setFormData({ ...formData, telefone: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className={ROTULO_PUBLICO} style={{ fontFamily: MONO }}>
                    E-mail
                  </label>
                  <input
                    type="email"
                    className={`${CAMPO_PUBLICO} h-10`}
                    placeholder="Ex: contato@parceiro.com"
                    value={formData.email}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className={ROTULO_PUBLICO} style={{ fontFamily: MONO }}>
                    Dados de Pagamento (PIX, Banco, Agência, Conta)
                  </label>
                  <textarea
                    className={`${CAMPO_PUBLICO} h-24 resize-none py-3`}
                    placeholder="Ex: Chave PIX Celular: (11) 99999-9999 (Banco Nubank)"
                    value={formData.payment_info}
                    onChange={e => setFormData({ ...formData, payment_info: e.target.value })}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className={ROTULO_PUBLICO} style={{ fontFamily: MONO }}>
                    Observações Gerais
                  </label>
                  <textarea
                    className={`${CAMPO_PUBLICO} h-24 resize-none py-3`}
                    placeholder="Alguma observação, restrição ou observação contratual..."
                    value={formData.notes}
                    onChange={e => setFormData({ ...formData, notes: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Serviços e Valores */}
            <div className="space-y-6 pt-6 border-t border-white/[0.15]">
              <div className="flex items-center justify-between">
                <h2 className="text-[11px] uppercase tracking-[3px] text-[#efc700]" style={{ fontFamily: MONO }}>
                  Serviços Oferecidos
                </h2>
                <button
                  type="button"
                  onClick={handleAddService}
                  className="rounded-full border border-[#efc700]/50 px-4 py-2 text-[11px] uppercase tracking-[2px] text-[#efc700] transition-colors hover:bg-[#efc700]/10" style={{ fontFamily: MONO }}
                >
                  + Adicionar Serviço
                </button>
              </div>

              <div className="space-y-4">
                <ServicosDatalist />
                {services.map((item, idx) => (
                  <div key={idx} className="bg-[#161616]/40 p-4 rounded-xl border border-white/[0.22] grid grid-cols-1 md:grid-cols-12 gap-4 items-end relative">
                    <div className="md:col-span-5 space-y-1">
                      <label className={`${ROTULO_PUBLICO} !tracking-[2px] !text-[10px]`} style={{ fontFamily: MONO }}>
                        Tipo de Serviço *
                      </label>
                      <input
                        required
                        type="text"
                        list="servicos-catalogo"
                        className={`${CAMPO_PUBLICO} h-10`}
                        placeholder="Busque o serviço (ex.: Filmmaker, Som direto…)"
                        value={item.tipo_servico}
                        onChange={e => handleUpdateService(idx, 'tipo_servico', e.target.value)}
                      />
                    </div>
                    <div className="md:col-span-3 space-y-1">
                      <label className={`${ROTULO_PUBLICO} !tracking-[2px] !text-[10px]`} style={{ fontFamily: MONO }}>
                        Valor da Diária (R$)
                      </label>
                      <CurrencyInput
                        className={`${CAMPO_PUBLICO} h-10 font-bold`}
                        value={item.valor}
                        onChange={(val: number) => handleUpdateService(idx, 'valor', val)}
                      />
                    </div>
                    <div className="md:col-span-3 space-y-1">
                      <label className={`${ROTULO_PUBLICO} !tracking-[2px] !text-[10px]`} style={{ fontFamily: MONO }}>
                        Detalhes do Serviço
                      </label>
                      <input
                        type="text"
                        className={`${CAMPO_PUBLICO} h-10`}
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
                          className="p-2 text-white/60 hover:text-red-300 hover:bg-red-500/15 rounded-lg transition-all"
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
            <div className="pt-6 border-t border-white/[0.15] flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className={`${BOTAO_AMARELO} h-12 px-8 min-w-[200px] text-sm uppercase tracking-[2px]`}
              >
                <Send className="w-4 h-4" /> {saving ? 'Enviando...' : 'Enviar Cadastro'}
              </button>
            </div>
          </form>
        )}
      </div>
    </PaginaPublica>
  );
}
