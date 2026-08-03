import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  Settings, 
  Percent, 
  TrendingUp, 
  Save, 
  Plus, 
  FolderPlus,
  Trash2, 
  Check, 
  Edit3, 
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  Loader2,
  FolderOpen
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import Select from '@/components/ui/Select';

interface ConfigFinanceiro {
  id: number;
  nf_percent: number;
  margem_default: number;
}

interface Categoria {
  id: string;
  nome: string;
  ordem: number;
  ativo: boolean;
}

interface TipoServico {
  id: string;
  categoria_id: string;
  nome: string;
  ativo: boolean;
}

export default function FinanceiroConfig() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [savingService, setSavingService] = useState(false);

  // Data states
  const [config, setConfig] = useState<ConfigFinanceiro>({ id: 1, nf_percent: 0.18, margem_default: 0.40 });
  const [categories, setCategories] = useState<Categoria[]>([]);
  const [services, setServices] = useState<TipoServico[]>([]);

  // Input states for new items
  const [newCatName, setNewCatName] = useState('');
  const [newServiceCatId, setNewServiceCatId] = useState('');
  const [newServiceName, setNewServiceName] = useState('');

  // Editing states
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [editServiceName, setEditServiceName] = useState('');

  useEffect(() => {
    fetchConfigData();
  }, []);

  async function fetchConfigData() {
    try {
      setLoading(true);
      const [configRes, catRes, svcRes] = await Promise.all([
        supabase.from('config_financeiro').select('*').eq('id', 1).single(),
        supabase.from('categorias').select('*').order('ordem', { ascending: true }).order('nome', { ascending: true }),
        supabase.from('tipos_servico').select('*').order('nome', { ascending: true }),
      ]);

      if (configRes.data) setConfig(configRes.data);
      if (catRes.data) setCategories(catRes.data);
      if (svcRes.data) setServices(svcRes.data);

      if (catRes.data && catRes.data.length > 0) {
        setNewServiceCatId(catRes.data[0].id);
      }
    } catch (err: any) {
      console.error('Error fetching financial configuration:', err);
      toast.error('Erro ao carregar configurações.');
    } finally {
      setLoading(false);
    }
  }

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      const { error } = await supabase
        .from('config_financeiro')
        .update({
          nf_percent: config.nf_percent,
          margem_default: config.margem_default,
          atualizado_em: new Date().toISOString()
        })
        .eq('id', 1);

      if (error) throw error;
      toast.success('Configurações salvas com sucesso!');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar configurações.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    setSavingCategory(true);
    try {
      const maxOrdem = categories.reduce((max, c) => c.ordem > max ? c.ordem : max, 0);
      const { data, error } = await supabase
        .from('categorias')
        .insert([{
          nome: newCatName.trim(),
          ordem: maxOrdem + 10,
          ativo: true
        }])
        .select()
        .single();

      if (error) throw error;
      setCategories(prev => [...prev, data].sort((a, b) => a.ordem - b.ordem));
      setNewCatName('');
      if (!newServiceCatId) setNewServiceCatId(data.id);
      toast.success('Categoria criada!');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao criar categoria.');
    } finally {
      setSavingCategory(false);
    }
  };

  const handleCreateService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServiceName.trim() || !newServiceCatId) return;
    setSavingService(true);
    try {
      const { data, error } = await supabase
        .from('tipos_servico')
        .insert([{
          categoria_id: newServiceCatId,
          nome: newServiceName.trim(),
          ativo: true
        }])
        .select()
        .single();

      if (error) throw error;
      setServices(prev => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome)));
      setNewServiceName('');
      toast.success('Tipo de serviço criado!');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao criar tipo de serviço.');
    } finally {
      setSavingService(false);
    }
  };

  const toggleCategoryActive = async (cat: Categoria) => {
    try {
      const { error } = await supabase
        .from('categorias')
        .update({ ativo: !cat.ativo })
        .eq('id', cat.id);

      if (error) throw error;
      setCategories(prev => prev.map(c => c.id === cat.id ? { ...c, ativo: !c.ativo } : c));
      toast.success(`Categoria ${!cat.ativo ? 'ativada' : 'desativada'}!`);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const toggleServiceActive = async (svc: TipoServico) => {
    try {
      const { error } = await supabase
        .from('tipos_servico')
        .update({ ativo: !svc.ativo })
        .eq('id', svc.id);

      if (error) throw error;
      setServices(prev => prev.map(s => s.id === svc.id ? { ...s, ativo: !svc.ativo } : s));
      toast.success(`Serviço ${!svc.ativo ? 'ativado' : 'desativado'}!`);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const saveEditCategory = async (id: string) => {
    if (!editCatName.trim()) return;
    try {
      const { error } = await supabase
        .from('categorias')
        .update({ nome: editCatName.trim() })
        .eq('id', id);

      if (error) throw error;
      setCategories(prev => prev.map(c => c.id === id ? { ...c, nome: editCatName.trim() } : c));
      setEditingCatId(null);
      toast.success('Categoria renomeada!');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const saveEditService = async (id: string) => {
    if (!editServiceName.trim()) return;
    try {
      const { error } = await supabase
        .from('tipos_servico')
        .update({ nome: editServiceName.trim() })
        .eq('id', id);

      if (error) throw error;
      setServices(prev => prev.map(s => s.id === id ? { ...s, nome: editServiceName.trim() } : s));
      setEditingServiceId(null);
      toast.success('Serviço renomeado!');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh] bg-lumos-bg">
      <Loader2 className="animate-spin text-lumos-yellow w-10 h-10" />
    </div>
  );

  return (
    <div className="space-y-8 font-work-sans max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight">Configurações Financeiras</h1>
        <p className="text-lumos-text-secondary mt-1 font-medium">Defina impostos padrão, margens comerciais e gerencie dimensões de serviços.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left column: Defaults & General Config */}
        <div className="card p-6 h-fit space-y-6">
          <h3 className="text-sm font-black text-lumos-text-primary uppercase tracking-widest flex items-center gap-2 border-b border-lumos-border pb-3">
            <Settings className="w-4 h-4 text-lumos-yellow" /> Padrões Globais
          </h3>

          <form onSubmit={handleSaveConfig} className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest block">
                Imposto NF Padrão (Ex: 0.18 = 18%)
              </label>
              <div className="relative">
                <Percent className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
                <input 
                  type="number"
                  step="0.0001"
                  min="0"
                  max="1"
                  className="input-lumos w-full pl-10 h-11 text-sm font-bold"
                  value={config.nf_percent}
                  onChange={e => setConfig({ ...config, nf_percent: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <p className="text-[10px] text-lumos-text-secondary italic">Aplicado automaticamente a novos orçamentos aprovados.</p>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest block">
                Margem Padrão Comercial (Ex: 0.40 = 40%)
              </label>
              <div className="relative">
                <TrendingUp className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
                <input 
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  className="input-lumos w-full pl-10 h-11 text-sm font-bold"
                  value={config.margem_default}
                  onChange={e => setConfig({ ...config, margem_default: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <p className="text-[10px] text-lumos-text-secondary italic">Meta de margem sugerida na área comercial.</p>
            </div>

            <button 
              type="submit" 
              disabled={savingConfig}
              className="btn-primary w-full h-11 flex items-center justify-center gap-2 mt-4 font-bold text-xs uppercase"
            >
              {savingConfig ? <Loader2 className="animate-spin w-4 h-4" /> : <Save className="w-4 h-4" />}
              Salvar Padrões
            </button>
          </form>
        </div>

        {/* Right Columns: Categories & Services */}
        <div className="md:col-span-2 space-y-6">
          {/* Categories panel */}
          <div className="card p-6">
            <h3 className="text-sm font-black text-lumos-text-primary uppercase tracking-widest flex items-center gap-2 border-b border-lumos-border pb-3 mb-4">
              <FolderOpen className="w-4 h-4 text-lumos-yellow" /> Categorias Mãe
            </h3>

            {/* Create Category form */}
            <form onSubmit={handleCreateCategory} className="flex gap-2 mb-4">
              <input 
                type="text"
                placeholder="Ex: Digital, Filme, Live..."
                className="input-lumos flex-1 h-10 text-sm font-medium"
                value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                required
              />
              <button 
                type="submit"
                disabled={savingCategory || !newCatName.trim()}
                className="btn-primary px-4 h-10 flex items-center gap-1.5 font-bold text-xs uppercase shrink-0"
              >
                {savingCategory ? <Loader2 className="animate-spin w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                Add
              </button>
            </form>

            {/* Categories list */}
            <div className="divide-y divide-lumos-border/50 max-h-56 overflow-y-auto custom-scrollbar">
              {categories.map(cat => (
                <div key={cat.id} className="flex items-center justify-between py-2.5">
                  {editingCatId === cat.id ? (
                    <div className="flex gap-2 w-full pr-4">
                      <input 
                        type="text" 
                        className="input-lumos flex-1 h-9 text-xs" 
                        value={editCatName} 
                        onChange={e => setEditCatName(e.target.value)}
                      />
                      <button onClick={() => saveEditCategory(cat.id)} className="p-2 bg-green-500/10 hover:bg-green-500 text-green-500 hover:text-black rounded-lumos transition-all">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setEditingCatId(null)} className="p-2 bg-lumos-text-secondary/10 hover:bg-lumos-text-secondary/20 rounded-lumos transition-all text-xs font-bold">
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${cat.ativo ? 'bg-green-500' : 'bg-lumos-text-secondary/40'}`} />
                        <span className={`text-sm font-bold ${cat.ativo ? 'text-lumos-text-primary' : 'text-lumos-text-secondary line-through'}`}>
                          {cat.nome}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => { setEditingCatId(cat.id); setEditCatName(cat.nome); }} 
                          className="p-1 text-lumos-text-secondary hover:text-lumos-yellow transition-all"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button 
                          onClick={() => toggleCategoryActive(cat)} 
                          className="text-lumos-text-secondary hover:text-lumos-text-primary transition-all"
                        >
                          {cat.ativo ? <ToggleRight className="w-5 h-5 text-green-500" /> : <ToggleLeft className="w-5 h-5" />}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Services panel */}
          <div className="card p-6">
            <h3 className="text-sm font-black text-lumos-text-primary uppercase tracking-widest flex items-center gap-2 border-b border-lumos-border pb-3 mb-4">
              <FolderPlus className="w-4 h-4 text-lumos-yellow" /> Tipos de Serviço
            </h3>

            {/* Create Service form */}
            <form onSubmit={handleCreateService} className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
              <Select value={newServiceCatId} onChange={setNewServiceCatId} className="input-lumos h-10 text-xs font-bold uppercase tracking-widest sm:col-span-1"
                options={categories.map(c => ({ value: c.id, label: c.nome }))} />
              <input 
                type="text"
                placeholder="Ex: Criação de Conteúdo, Comercial..."
                className="input-lumos h-10 text-sm font-medium sm:col-span-1"
                value={newServiceName}
                onChange={e => setNewServiceName(e.target.value)}
                required
              />
              <button 
                type="submit"
                disabled={savingService || !newServiceName.trim()}
                className="btn-primary h-10 flex items-center justify-center gap-1.5 font-bold text-xs uppercase"
              >
                {savingService ? <Loader2 className="animate-spin w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                Adicionar Serviço
              </button>
            </form>

            {/* Services list grouped by category */}
            <div className="divide-y divide-lumos-border/50 max-h-80 overflow-y-auto custom-scrollbar">
              {categories.map(cat => {
                const catServices = services.filter(s => s.categoria_id === cat.id);
                if (catServices.length === 0) return null;
                return (
                  <div key={cat.id} className="py-3">
                    <p className="text-[10px] font-black text-lumos-yellow uppercase tracking-widest mb-1.5 opacity-80">{cat.nome}</p>
                    <div className="space-y-1.5 pl-2">
                      {catServices.map(svc => (
                        <div key={svc.id} className="flex items-center justify-between py-1">
                          {editingServiceId === svc.id ? (
                            <div className="flex gap-2 w-full pr-4">
                              <input 
                                type="text" 
                                className="input-lumos flex-1 h-9 text-xs" 
                                value={editServiceName} 
                                onChange={e => setEditServiceName(e.target.value)}
                              />
                              <button onClick={() => saveEditService(svc.id)} className="p-2 bg-green-500/10 hover:bg-green-500 text-green-500 hover:text-black rounded-lumos transition-all">
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => setEditingServiceId(null)} className="p-2 bg-lumos-text-secondary/10 hover:bg-lumos-text-secondary/20 rounded-lumos transition-all text-xs font-bold">
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full ${svc.ativo ? 'bg-green-500' : 'bg-lumos-text-secondary/40'}`} />
                                <span className={`text-xs font-bold ${svc.ativo ? 'text-lumos-text-primary' : 'text-lumos-text-secondary line-through'}`}>
                                  {svc.nome}
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                <button 
                                  onClick={() => { setEditingServiceId(svc.id); setEditServiceName(svc.nome); }} 
                                  className="p-1 text-lumos-text-secondary hover:text-lumos-yellow transition-all"
                                >
                                  <Edit3 className="w-3 h-3" />
                                </button>
                                <button 
                                  onClick={() => toggleServiceActive(svc)} 
                                  className="text-lumos-text-secondary hover:text-lumos-text-primary transition-all"
                                >
                                  {svc.ativo ? <ToggleRight className="w-4 h-4 text-green-500" /> : <ToggleLeft className="w-4 h-4" />}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
