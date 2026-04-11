import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  Plus, 
  Search, 
  Edit2, 
  ToggleLeft as Toggle,
  ToggleRight,
  ChevronDown,
  ChevronUp,
  X,
  Save,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import { formatCurrency } from '@/utils/financials';
import { clsx } from 'clsx';

interface CatalogItem {
  id: string;
  item_group: 'equipe' | 'equipamentos' | 'edicao' | 'producao';
  subcategory: string;
  name: string;
  default_unit_cost: number;
  unit_label: string;
  is_active: boolean;
}

export default function Catalog() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [formData, setFormData] = useState<Partial<CatalogItem>>({
    name: '',
    subcategory: '',
    item_group: 'equipe',
    default_unit_cost: 0,
    unit_label: 'diaria',
    is_active: true
  });

  const [expandedGroups, setExpandedGroups] = useState<string[]>(['equipe', 'equipamentos', 'edicao', 'producao']);

  useEffect(() => {
    fetchCatalog();
  }, []);

  async function fetchCatalog() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('item_catalog')
        .select('*')
        .order('name');

      if (error) throw error;
      setItems(data || []);
    } catch (err) {
      console.error('Error fetching catalog:', err);
    } finally {
      setLoading(false);
    }
  }

  const handleOpenModal = (item?: CatalogItem) => {
    if (item) {
      setEditingItem(item);
      setFormData(item);
    } else {
      setEditingItem(null);
      setFormData({
        name: '',
        subcategory: '',
        item_group: 'equipe',
        default_unit_cost: 0,
        unit_label: 'diaria',
        is_active: true
      });
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingItem) {
        const { error } = await supabase
          .from('item_catalog')
          .update(formData)
          .eq('id', editingItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('item_catalog')
          .insert(formData);
        if (error) throw error;
      }
      setIsModalOpen(false);
      fetchCatalog();
    } catch (err) {
      console.error('Error saving item:', err);
    }
  };

  const toggleStatus = async (item: CatalogItem) => {
    try {
      const { error } = await supabase
        .from('item_catalog')
        .update({ is_active: !item.is_active })
        .eq('id', item.id);
      
      if (error) throw error;
      fetchCatalog();
    } catch (err) {
      console.error('Error toggling status:', err);
    }
  };

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => 
      prev.includes(group) ? prev.filter(g => g !== group) : [...prev, group]
    );
  };

  const filteredItems = items.filter(i => 
    i.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    i.subcategory.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const groups = ['equipe', 'equipamentos', 'edicao', 'producao'] as const;

  return (
    <div className="space-y-8 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-lumos-text-primary">Catálogo de Itens</h1>
          <p className="text-lumos-text-secondary mt-1">Biblioteca global de itens e serviços.</p>
        </div>
        <button 
          onClick={() => handleOpenModal()}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Novo Item
        </button>
      </div>

      {/* Filter */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-lumos-text-secondary" />
        <input 
          type="text" 
          placeholder="Buscar no catálogo por nome ou subcategoria..." 
          className="input-lumos w-full pl-10"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Grouped Lists */}
      <div className="space-y-6">
        {loading ? (
          <div className="text-center py-12 text-lumos-text-secondary">Carregando catálogo...</div>
        ) : groups.map(group => {
          const groupItems = filteredItems.filter(i => i.item_group === group);
          const isExpanded = expandedGroups.includes(group);
          
          return (
            <div key={group} className="card !p-0 overflow-hidden">
              <button 
                onClick={() => toggleGroup(group)}
                className="w-full flex items-center justify-between px-6 py-4 bg-lumos-bg/50 border-b border-lumos-border hover:bg-lumos-bg transition-colors"
              >
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold uppercase tracking-widest text-lumos-text-secondary">{group}</h2>
                  <span className="bg-lumos-bg text-[10px] px-2 py-0.5 rounded-full font-bold">
                    {groupItems.length} itens
                  </span>
                </div>
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              
              {isExpanded && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-lumos-text-secondary bg-lumos-bg/30">
                        <th className="px-6 py-3 font-bold">Item</th>
                        <th className="px-6 py-3 font-bold">Subcategoria</th>
                        <th className="px-6 py-3 font-bold text-right">Valor Padrão</th>
                        <th className="px-6 py-3 font-bold">Unidade</th>
                        <th className="px-6 py-3 font-bold text-center">Status</th>
                        <th className="px-6 py-3 font-bold text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-lumos-border">
                      {groupItems.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-8 text-center text-lumos-text-secondary italic">
                            Nenhum item encontrado neste grupo.
                          </td>
                        </tr>
                      ) : groupItems.map((item) => (
                        <tr key={item.id} className={clsx("hover:bg-lumos-bg/30 transition-colors", !item.is_active && "opacity-50")}>
                          <td className="px-6 py-4 font-medium text-lumos-text-primary">{item.name}</td>
                          <td className="px-6 py-4 text-lumos-text-secondary">{item.subcategory}</td>
                          <td className="px-6 py-4 text-right font-mono text-lumos-text-primary">{formatCurrency(item.default_unit_cost)}</td>
                          <td className="px-6 py-4 uppercase text-[10px] font-bold text-lumos-text-primary">{item.unit_label}</td>
                          <td className="px-6 py-4 text-center">
                            <button 
                              onClick={() => toggleStatus(item)}
                              className={clsx(
                                "mx-auto flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-1 rounded-full",
                                item.is_active ? "text-green-600 bg-green-50" : "text-gray-400 bg-gray-100"
                              )}
                            >
                              {item.is_active ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                              {item.is_active ? 'Ativo' : 'Inativo'}
                            </button>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button 
                              onClick={() => handleOpenModal(item)}
                              className="p-2 text-lumos-text-secondary hover:text-lumos-yellow"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lumos w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-lumos-border flex items-center justify-between">
              <h2 className="text-xl font-bold">{editingItem ? 'Editar Item do Catálogo' : 'Novo Item'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-lumos-text-secondary hover:text-lumos-text-primary">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-lumos-text-secondary uppercase mb-1">Nome do Item</label>
                  <input 
                    required
                    className="input-lumos w-full"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    placeholder="Ex: Diretor de Fotografia"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-lumos-text-secondary uppercase mb-1">Grupo</label>
                  <select 
                    className="input-lumos w-full"
                    value={formData.item_group}
                    onChange={(e) => setFormData({...formData, item_group: e.target.value as any})}
                  >
                    <option value="equipe">Equipe</option>
                    <option value="equipamentos">Equipamentos</option>
                    <option value="edicao">Edição</option>
                    <option value="producao">Produção</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-lumos-text-secondary uppercase mb-1">Subcategoria</label>
                  <input 
                    className="input-lumos w-full"
                    value={formData.subcategory}
                    onChange={(e) => setFormData({...formData, subcategory: e.target.value})}
                    placeholder="Ex: Profissionais de Imagem"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-lumos-text-secondary uppercase mb-1">Valor Unitário Padrão</label>
                  <input 
                    type="number"
                    className="input-lumos w-full"
                    value={formData.default_unit_cost}
                    onChange={(e) => setFormData({...formData, default_unit_cost: Number(e.target.value)})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-lumos-text-secondary uppercase mb-1">Unidade</label>
                  <select 
                    className="input-lumos w-full"
                    value={formData.unit_label}
                    onChange={(e) => setFormData({...formData, unit_label: e.target.value})}
                  >
                    <option value="diaria">diária</option>
                    <option value="pacote">pacote</option>
                    <option value="unidade">unidade</option>
                    <option value="video">vídeo</option>
                    <option value="hora">hora</option>
                  </select>
                </div>
              </div>
              
              <div className="flex items-center gap-2 py-2">
                <input 
                  type="checkbox"
                  id="is_active"
                  className="rounded text-lumos-yellow focus:ring-lumos-yellow"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({...formData, is_active: e.target.checked})}
                />
                <label htmlFor="is_active" className="text-sm text-lumos-text-primary">Item Ativo</label>
              </div>

              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
                <button type="submit" className="btn-primary flex-1 flex items-center justify-center gap-2">
                  <Save className="w-4 h-4" />
                  Salvar Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
