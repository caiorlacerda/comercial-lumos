import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { 
  FileStack, 
  Search, 
  Plus, 
  Copy, 
  Trash2, 
  ChevronRight,
  Filter,
  Package,
  Clock,
  Layout,
  Layers,
  FileText,
  XCircle,
  AlertCircle
} from 'lucide-react';
import { formatCurrency } from '@/utils/financials';
import { clsx } from 'clsx';
import Modal from '@/components/common/Modal';

interface Template {
  id: string;
  project_name: string;
  category: 'digital' | 'filme' | 'live';
  template_category: string;
  active_version_id: string;
  code: string;
  versions: any[];
}

export default function Templates() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isDuplicating, setIsDuplicating] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, []);

  async function fetchTemplates() {
    try {
      setLoading(true);
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

      if (error) throw error;
      setTemplates(data || []);
    } catch (err) {
      console.error('Error fetching templates:', err);
    } finally {
      setLoading(false);
    }
  }

  const handleRemoveFromTemplates = async (id: string) => {
    if (!confirm('Tem certeza que deseja remover este orçamento dos padrões? Ele continuará existindo na lista geral de orçamentos.')) return;
    
    try {
      const { error } = await supabase
        .from('budgets')
        .update({ is_template: false })
        .eq('id', id);

      if (error) throw error;
      fetchTemplates();
    } catch (err) {
      console.error('Error removing from templates:', err);
    }
  };

  const handleUseTemplate = async (template: Template) => {
    try {
      setIsDuplicating(true);

      // 1. Get the original version and items
      const originalVersion = template.versions?.find(v => v.id === template.active_version_id) || template.versions?.[0];
      if (!originalVersion) throw new Error('Versão do template não encontrada');

      const { data: originalItems } = await supabase
        .from('budget_items')
        .select('*')
        .eq('version_id', originalVersion.id);

      // 2. Initialise new code
      const { data: newCode } = await supabase.rpc('next_budget_code');

      // 3. Create new budget
      const { data: newBudget, error: bError } = await supabase
        .from('budgets')
        .insert({
          code: newCode || '0000',
          project_name: `${template.project_name} (Baseada em Template)`,
          category: template.category,
          status: 'rascunho',
          is_template: false
        })
        .select()
        .single();

      if (bError) throw bError;

      // 4. Create new version
      const { data: newVersion, error: vError } = await supabase
        .from('budget_versions')
        .insert({
          budget_id: newBudget.id,
          version_number: 1,
          margin_pct: originalVersion.margin_pct,
          nf_pct: originalVersion.nf_pct,
          discount_value: originalVersion.discount_value,
          notes_internal: originalVersion.notes_internal,
          notes_client: originalVersion.notes_client,
          payment_terms: originalVersion.payment_terms,
          validity_days: originalVersion.validity_days
        })
        .select()
        .single();

      if (vError) throw vError;

      // 5. Update budget with active version
      await supabase.from('budgets').update({ active_version_id: newVersion.id }).eq('id', newBudget.id);

      // 6. Clone items
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
      alert('Erro ao criar orçamento a partir do template.');
    } finally {
      setIsDuplicating(false);
    }
  };

  const filteredTemplates = templates.filter(t => {
    const matchesSearch = t.project_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         t.template_category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || t.template_category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = Array.from(new Set(templates.map(t => t.template_category)));

  // Separate by template_category
  const groupedTemplates = filteredTemplates.reduce((acc, t) => {
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
            <h1 className="text-3xl font-black text-lumos-text-primary uppercase tracking-tight">Orçamentos Padrão</h1>
          </div>
          <p className="text-lumos-text-secondary font-medium pl-1">Modelos reutilizáveis para projetos recorrentes.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-lumos-text-secondary" />
          <input 
            type="text" 
            placeholder="Buscar por nome ou categoria de template..." 
            className="input-lumos w-full pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-lumos-text-secondary" />
          <select 
            className="input-lumos min-w-[200px]"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            <option value="all">Todas as Categorias</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Templates List */}
      <div className="space-y-12">
        {Object.keys(groupedTemplates).length === 0 ? (
          <div className="card text-center py-20 flex flex-col items-center justify-center space-y-4">
            <div className="w-20 h-20 rounded-full bg-lumos-bg flex items-center justify-center text-lumos-text-secondary/20">
              <Plus className="w-10 h-10" />
            </div>
            <div className="space-y-1">
              <h3 className="text-xl font-bold text-lumos-text-primary">Nenhum template encontrado</h3>
              <p className="text-lumos-text-secondary max-w-sm">
                Salve um orçamento como "Orçamento Padrão" no editor para que ele apareça aqui.
              </p>
            </div>
          </div>
        ) : Object.entries(groupedTemplates).map(([category, items]) => (
          <div key={category} className="space-y-6">
            <div className="flex items-center gap-4">
              <h2 className="text-sm font-black text-lumos-text-primary uppercase tracking-widest whitespace-nowrap bg-lumos-yellow/10 px-3 py-1 rounded text-lumos-yellow border border-lumos-yellow/20">
                {category}
              </h2>
              <div className="h-px bg-lumos-border w-full" />
              <span className="text-[10px] font-bold text-lumos-text-secondary uppercase whitespace-nowrap">
                {items.length} {items.length === 1 ? 'modelo' : 'modelos'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {items.map(template => {
                const activeVersion = template.versions?.find(v => v.id === template.active_version_id) || template.versions?.[0];
                const itemCount = activeVersion?.items?.[0]?.count || 0;
                
                return (
                  <div key={template.id} className="card group hover:border-lumos-yellow/30 transition-all flex flex-col h-full">
                    <div className="flex items-start justify-between mb-4">
                      <div className="space-y-1 overflow-hidden">
                        <span className={clsx(
                          "text-[10px] font-black uppercase px-2 py-0.5 rounded ring-1 ring-inset inline-block",
                          template.category === 'digital' ? 'bg-blue-500/10 text-blue-500 ring-blue-500/20' :
                          template.category === 'filme' ? 'bg-purple-500/10 text-purple-500 ring-purple-500/20' :
                          'bg-orange-500/10 text-orange-500 ring-orange-500/20'
                        )}>
                          {template.category}
                        </span>
                        <h3 className="text-lg font-black text-lumos-text-primary leading-tight truncate">
                          {template.project_name}
                        </h3>
                      </div>
                      <div className="flex-shrink-0 ml-2">
                        <Package className="w-5 h-5 text-lumos-text-secondary group-hover:text-lumos-yellow transition-colors" />
                      </div>
                    </div>

                    <div className="space-y-3 mb-6 flex-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-lumos-text-secondary font-medium">Itens no Modelo</span>
                        <span className="text-lumos-text-primary font-bold">{itemCount}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-lumos-text-secondary font-medium">Markup Padrão</span>
                        <span className="text-lumos-text-primary font-bold">{Math.round((activeVersion?.margin_pct || 0) * 100)}%</span>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-lumos-border flex flex-col gap-2">
                      <button 
                        disabled={isDuplicating}
                        onClick={() => handleUseTemplate(template)}
                        className="btn-primary w-full flex items-center justify-center gap-2"
                      >
                        {isDuplicating ? <Clock className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
                        Usar como Base
                      </button>
                      <button 
                        onClick={() => handleRemoveFromTemplates(template.id)}
                        className="w-full py-2 text-[10px] font-black uppercase text-lumos-text-secondary hover:text-red-500 transition-colors flex items-center justify-center gap-1.5"
                      >
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
    </div>
  );
}
