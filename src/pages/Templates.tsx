import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { 
  FileStack, 
  Search, 
  Plus, 
  Copy, 
  Trash2, 
  Filter,
  Package,
  Clock,
  FileText,
  RotateCcw,
  Edit2,
  Calendar,
  Check
} from 'lucide-react';
import { formatCurrency } from '@/utils/financials';
import { clsx } from 'clsx';
import Modal from '@/components/common/Modal';
import RichTextEditor from '@/components/common/RichTextEditor';
import { useToast } from '@/context/ToastContext';

interface Template {
  id: string;
  project_name: string;
  category: 'digital' | 'filme' | 'live';
  template_category: string;
  active_version_id: string;
  code: string;
  versions: any[];
}

interface BriefingTemplate {
  id: string;
  name: string;
  category: 'digital' | 'filme' | 'live';
  notes_client: string;
  created_at: string;
  updated_at: string;
}

type Tab = 'budgets' | 'briefing';

export default function Templates() {
  const navigate = useNavigate();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<Tab>('budgets');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Budget Templates State
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isDuplicating, setIsDuplicating] = useState(false);

  // Briefing Templates State
  const [briefingTemplates, setBriefingTemplates] = useState<BriefingTemplate[]>([]);
  const [isBriefingModalOpen, setIsBriefingModalOpen] = useState(false);
  const [editingBriefing, setEditingBriefing] = useState<Partial<BriefingTemplate> | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    await Promise.allSettled([fetchTemplates(), fetchBriefingTemplates()]);
    setLoading(false);
  }

  async function fetchTemplates() {
    const { data, error } = await supabase
      .from('budgets')
      .select(`
        *,
        versions:budget_versions(
          id,
          version_number,
          margin_pct,
          nf_pct,
          items:budget_items(count)
        )
      `)
      .eq('is_template', true)
      .order('template_category');

    if (error) console.error('Error fetching templates:', error);
    else setTemplates(data || []);
  }

  async function fetchBriefingTemplates() {
    const { data, error } = await supabase
      .from('briefing_templates')
      .select('*')
      .order('created_at', { ascending: false });

    console.log('briefing templates result:', data, error);

    if (error) {
      console.error('Error fetching briefing templates:', error);
    } else {
      setBriefingTemplates(data || []);
    }
  }

  const handleRemoveFromTemplates = async (id: string) => {
    if (!confirm('Tem certeza que deseja remover este orçamento dos padrões?')) return;
    try {
      const { error } = await supabase.from('budgets').update({ is_template: false }).eq('id', id);
      if (error) throw error;
      fetchTemplates();
    } catch (err) {
      console.error('Error removing from templates:', err);
    }
  };

  const handleUseTemplate = async (template: Template) => {
    try {
      setIsDuplicating(true);
      const originalVersion = template.versions?.find(v => v.id === template.active_version_id) || template.versions?.[0];
      if (!originalVersion) throw new Error('Versão do template não encontrada');

      const { data: originalItems } = await supabase.from('budget_items').select('*').eq('version_id', originalVersion.id);

      const { data: newBudget, error: bError } = await supabase.from('budgets').insert({
        code: '----',
        project_name: `${template.project_name} (Baseada em Template)`,
        category: template.category,
        status: 'rascunho',
        is_template: false
      }).select().single();

      if (bError) throw bError;

      const { data: newVersion, error: vError } = await supabase.from('budget_versions').insert({
        budget_id: newBudget.id,
        version_number: 1,
        margin_pct: originalVersion.margin_pct,
        nf_pct: originalVersion.nf_pct,
        discount_value: originalVersion.discount_value,
        notes_internal: originalVersion.notes_internal,
        notes_client: originalVersion.notes_client,
        payment_terms: originalVersion.payment_terms,
        validity_days: originalVersion.validity_days
      }).select().single();

      if (vError) throw vError;

      await supabase.from('budgets').update({ active_version_id: newVersion.id }).eq('id', newBudget.id);

      if (originalItems && originalItems.length > 0) {
        const clonedItems = originalItems.map(item => ({
          version_id: newVersion.id,
          item_group: item.item_group,
          name: item.name,
          unit_cost: item.unit_cost,
          quantity: item.quantity,
          unit_label: item.unit_label,
          sort_order: item.sort_order,
          catalog_item_id: item.catalog_item_id
        }));
        await supabase.from('budget_items').insert(clonedItems);
      }

      navigate(`/orcamentos/${newBudget.id}`);
    } catch (err) {
      console.error('Error using template:', err);
      toast.error('Erro ao criar orçamento a partir do template.');
    } finally {
      setIsDuplicating(false);
    }
  };

  // Briefing Logic
  const handleOpenBriefingModal = (briefing?: BriefingTemplate) => {
    setEditingBriefing(briefing || { name: '', category: 'digital', notes_client: '' });
    setIsBriefingModalOpen(true);
  };

  const handleSaveBriefing = async () => {
    if (!editingBriefing?.name || !editingBriefing.notes_client) return;

    try {
      if (editingBriefing.id) {
        const { error } = await supabase
          .from('briefing_templates')
          .update({
            name: editingBriefing.name,
            category: editingBriefing.category,
            notes_client: editingBriefing.notes_client,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingBriefing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('briefing_templates')
          .insert({
            name: editingBriefing.name,
            category: editingBriefing.category,
            notes_client: editingBriefing.notes_client
          });
        if (error) throw error;
      }
      setIsBriefingModalOpen(false);
      fetchBriefingTemplates();
    } catch (err) {
      console.error('Error saving briefing template:', err);
    }
  };

  const handleDeleteBriefing = async (id: string) => {
    if (!confirm('Excluir este template de briefing?')) return;
    try {
      const { error } = await supabase.from('briefing_templates').delete().eq('id', id);
      if (error) throw error;
      fetchBriefingTemplates();
    } catch (err) {
      console.error('Error deleting briefing template:', err);
    }
  };

  const handleDuplicateBriefing = async (briefing: BriefingTemplate) => {
    try {
      const { error } = await supabase.from('briefing_templates').insert({
        name: `Cópia de ${briefing.name}`,
        category: briefing.category,
        notes_client: briefing.notes_client
      });
      if (error) throw error;
      fetchBriefingTemplates();
    } catch (err) {
      console.error('Error duplicating briefing template:', err);
    }
  };

  const filteredBudgets = templates.filter(t => {
    const matchesSearch = t.project_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         t.template_category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || t.template_category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const filteredBriefings = briefingTemplates.filter(t => 
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const budgetCategories = Array.from(new Set(templates.map(t => t.template_category)));

  const groupedBudgets = filteredBudgets.reduce((acc, t) => {
    if (!acc[t.template_category]) acc[t.template_category] = [];
    acc[t.template_category].push(t);
    return acc;
  }, {} as Record<string, Template[]>);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-lumos-yellow"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-full bg-lumos-yellow/10 flex items-center justify-center text-lumos-yellow">
              <FileStack className="w-5 h-5" />
            </div>
            <h1 className="text-3xl font-black text-lumos-text-primary uppercase tracking-tight">Biblioteca de Templates</h1>
          </div>
          <p className="text-lumos-text-secondary font-medium pl-1">Gerencie modelos de orçamentos e estruturas de briefing.</p>
        </div>
        
        {activeTab === 'briefing' && (
          <button onClick={() => handleOpenBriefingModal()} className="btn-primary flex items-center gap-2 px-6">
            <Plus className="w-5 h-5" />
            Novo Template
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-lumos-border pb-px">
        <button 
          onClick={() => setActiveTab('budgets')}
          className={clsx(
            "px-6 py-3 text-xs font-black uppercase tracking-widest transition-all relative",
            activeTab === 'budgets' ? "text-lumos-yellow" : "text-lumos-text-secondary hover:text-lumos-text-primary"
          )}
        >
          Modelos de Orçamento
          {activeTab === 'budgets' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-lumos-yellow rounded-t-full shadow-[0_0_10px_rgba(245,216,122,0.5)]" />}
        </button>
        <button 
          onClick={() => { setActiveTab('briefing'); setSearchTerm(''); }}
          className={clsx(
            "px-6 py-3 text-xs font-black uppercase tracking-widest transition-all relative",
            activeTab === 'briefing' ? "text-lumos-yellow" : "text-lumos-text-secondary hover:text-lumos-text-primary"
          )}
        >
          Templates de Briefing
          {activeTab === 'briefing' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-lumos-yellow rounded-t-full shadow-[0_0_10px_rgba(245,216,122,0.5)]" />}
        </button>
      </div>

      {activeTab === 'budgets' ? (
        <>
          {/* Filters Budgets */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-lumos-text-secondary" />
              <input 
                type="text" 
                placeholder="Buscar por nome ou categoria..." 
                className="input-lumos w-full pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-lumos-text-secondary" />
              <select className="input-lumos min-w-[200px]" value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
                <option value="all">Todas as Categorias</option>
                {budgetCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-12">
            {Object.keys(groupedBudgets).length === 0 ? (
              <div className="card text-center py-20 flex flex-col items-center justify-center space-y-4">
                <div className="w-20 h-20 rounded-full bg-lumos-bg flex items-center justify-center text-lumos-text-secondary/20">
                  <Plus className="w-10 h-10" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xl font-bold text-lumos-text-primary">Nenhum template encontrado</h3>
                </div>
              </div>
            ) : Object.entries(groupedBudgets).map(([category, items]) => (
              <div key={category} className="space-y-6">
                <div className="flex items-center gap-4">
                  <h2 className="text-sm font-black text-lumos-text-primary uppercase tracking-widest whitespace-nowrap bg-lumos-yellow/10 px-3 py-1 rounded text-lumos-yellow border border-lumos-yellow/20">
                    {category}
                  </h2>
                  <div className="h-px bg-lumos-border w-full" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {items.map(template => {
                    const activeVersion = template.versions?.find(v => v.id === template.active_version_id) || template.versions?.[0];
                    return (
                      <div key={template.id} className="card group hover:border-lumos-yellow/30 transition-all flex flex-col h-full">
                        <div className="flex items-start justify-between mb-4">
                          <div className="space-y-1">
                            <span className={clsx(
                              "text-[10px] font-black uppercase px-2 py-0.5 rounded ring-1 ring-inset",
                              template.category === 'digital' ? 'bg-blue-500/10 text-blue-500 ring-blue-500/20' :
                              template.category === 'filme' ? 'bg-purple-500/10 text-purple-500 ring-purple-500/20' :
                              'bg-orange-500/10 text-orange-500 ring-orange-500/20'
                            )}>{template.category}</span>
                            <h3 className="text-lg font-black text-lumos-text-primary truncate">{template.project_name}</h3>
                          </div>
                        </div>
                        <div className="space-y-3 mb-6 flex-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-lumos-text-secondary font-medium">Markup Padrão</span>
                            <span className="text-lumos-text-primary font-bold">{Math.round((activeVersion?.margin_pct || 0) * 100)}%</span>
                          </div>
                        </div>
                        <div className="pt-4 border-t border-lumos-border flex flex-col gap-2">
                          <button disabled={isDuplicating} onClick={() => handleUseTemplate(template)} className="btn-primary w-full flex items-center justify-center gap-2">
                            {isDuplicating ? <Clock className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
                            Usar como Base
                          </button>
                          <button onClick={() => handleRemoveFromTemplates(template.id)} className="w-full py-2 text-[10px] font-black uppercase text-lumos-text-secondary hover:text-red-500 transition-colors flex items-center justify-center gap-1.5">
                            <Trash2 className="w-3 h-3" />
                            Remover dos padrões
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* Briefing Tab Content */}
          <div className="relative mb-8 max-w-2xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-lumos-text-secondary" />
            <input 
              type="text" 
              placeholder="Buscar templates de briefing..." 
              className="input-lumos w-full pl-10 h-12"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredBriefings.length === 0 ? (
              <div className="col-span-full card text-center py-20 flex flex-col items-center justify-center space-y-4">
                <div className="w-20 h-20 rounded-full bg-lumos-bg flex items-center justify-center text-lumos-text-secondary/20">
                  <FileText className="w-10 h-10" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xl font-bold text-lumos-text-primary">Nenhum template de briefing</h3>
                  <p className="text-lumos-text-secondary max-w-sm">
                    Crie seu primeiro modelo de briefing clicando em "Novo Template".
                  </p>
                </div>
              </div>
            ) : (
              filteredBriefings.map(t => (
                <div key={t.id} className="card group hover:shadow-xl transition-all border-l-4 border-l-lumos-yellow flex flex-col h-64 overflow-hidden">
                  <div className="flex items-start justify-between mb-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <h3 className="font-black text-lumos-text-primary group-hover:text-lumos-yellow transition-colors">{t.name}</h3>
                         {/* No default flag */}
                      </div>
                      <span className={clsx(
                        "text-[9px] font-black uppercase px-2 py-0.5 rounded border border-current",
                        t.category === 'digital' ? 'text-blue-500' : t.category === 'filme' ? 'text-purple-500' : 'text-orange-500'
                      )}>{t.category}</span>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleDuplicateBriefing(t)} className="p-2 text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-yellow/10 rounded-full" title="Duplicar">
                        <Copy className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleOpenBriefingModal(t)} className="p-2 text-lumos-text-secondary hover:text-blue-500 hover:bg-blue-500/10 rounded-full" title="Editar">
                        <Edit2 className="w-4 h-4" />
                      </button>
                    <button onClick={() => handleDeleteBriefing(t.id)} className="p-2 text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10 rounded-full" title="Excluir">
                      <Trash2 className="w-4 h-4" />
                    </button>
                    </div>
                  </div>
                  
                  <p className="text-[10px] text-lumos-text-secondary mb-4 line-clamp-6 leading-relaxed bg-lumos-bg/50 p-3 rounded-lumos flex-1 border border-lumos-border/50 italic">
                    {t.notes_client}
                  </p>

                  <div className="flex items-center justify-between mt-auto pt-3 text-[9px] font-bold text-lumos-text-secondary uppercase">
                    <div className="flex items-center gap-1">
                      <RotateCcw className="w-3 h-3" />
                      <span>Última edição: {new Date(t.updated_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* Briefing Modal */}
      <Modal 
        isOpen={isBriefingModalOpen} 
        onClose={() => setIsBriefingModalOpen(false)}
        title={editingBriefing?.id ? "Editar Template de Briefing" : "Novo Template de Briefing"}
        footer={
          <div className="flex gap-3">
            <button onClick={() => setIsBriefingModalOpen(false)} className="btn-secondary px-6">Cancelar</button>
            <button onClick={handleSaveBriefing} className="btn-primary px-8">Salvar Template</button>
          </div>
        }
      >
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-widest">Nome do Template</label>
              <input 
                className="input-lumos w-full"
                value={editingBriefing?.name}
                onChange={e => setEditingBriefing({...editingBriefing!, name: e.target.value})}
                placeholder="Ex: Briefing de Campanha Digital"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-widest">Categoria Base</label>
              <select 
                className="input-lumos w-full uppercase text-[11px] font-bold"
                value={editingBriefing?.category}
                onChange={e => setEditingBriefing({...editingBriefing!, category: e.target.value as any})}
              >
                <option value="digital">Digital</option>
                <option value="filme">Filme</option>
                <option value="live">Live</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-widest flex justify-between">
              Estrutura do Conteúdo
              <span className="text-lumos-yellow/60 normal-case font-medium">Este texto preencherá o campo de briefing no editor.</span>
            </label>
            <RichTextEditor
              minHeight={300}
              value={editingBriefing?.notes_client || ''}
              onChange={html => setEditingBriefing({ ...editingBriefing!, notes_client: html })}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
