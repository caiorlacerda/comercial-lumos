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
  XCircle,
  Trash2,
  AlertTriangle,
  Ban,
  Trash
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatCurrency } from '@/utils/financials';
import { clsx } from 'clsx';

interface CatalogItem {
  id: string;
  item_group: 'equipe' | 'equipamentos' | 'edicao' | 'producao';
  subcategory: string;
  name: string;
  default_unit_cost: number;
  unit_label: string;
  description: string | null;
  is_active: boolean;
}

export default function Catalog() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingType, setDeletingType] = useState<'single' | 'bulk'>('single');
  const [itemToDelete, setItemToDelete] = useState<CatalogItem | null>(null);
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [formData, setFormData] = useState<Partial<CatalogItem>>({
    name: '',
    subcategory: '',
    item_group: 'equipe',
    default_unit_cost: 0,
    unit_label: 'diaria',
    description: '',
    is_active: true
  });

  const [expandedGroups, setExpandedGroups] = useState<string[]>(['equipe', 'equipamentos', 'producao', 'edicao']);

  useEffect(() => {
    fetchCatalog();
    
    // Esc key listener to clear selection
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedItems.size > 0) {
        setSelectedItems(new Set());
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItems.size]);

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
        description: '',
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

  const toggleSelectItem = (id: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedItems(newSelected);
  };

  const toggleSelectGroup = (groupTotal: CatalogItem[], isAllGroupSelected: boolean) => {
    const newSelected = new Set(selectedItems);
    groupTotal.forEach(item => {
      if (isAllGroupSelected) newSelected.delete(item.id);
      else newSelected.add(item.id);
    });
    setSelectedItems(newSelected);
  };

  const handleBulkDeactivate = async () => {
    try {
      const { error } = await supabase
        .from('item_catalog')
        .update({ is_active: false })
        .in('id', Array.from(selectedItems));
      
      if (error) throw error;
      setSelectedItems(new Set());
      fetchCatalog();
    } catch (err) {
      console.error('Error deactivating items:', err);
    }
  };

  const handleDeleteItems = async () => {
    try {
      const idsToDelete = deletingType === 'single' && itemToDelete 
        ? [itemToDelete.id] 
        : Array.from(selectedItems);

      const { error } = await supabase
        .from('item_catalog')
        .delete()
        .in('id', idsToDelete);
      
      if (error) throw error;
      
      setIsDeleteModalOpen(false);
      setItemToDelete(null);
      setSelectedItems(new Set());
      fetchCatalog();
    } catch (err) {
      console.error('Error deleting items:', err);
    }
  };

  const filteredItems = items.filter(i => 
    i.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    i.subcategory.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const groups = ['equipe', 'equipamentos', 'producao', 'edicao'] as const;

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
              <div className="w-full flex items-center bg-lumos-bg/50 border-b border-lumos-border hover:bg-lumos-bg transition-colors">
                <div className="pl-6 py-4">
                  <input 
                    type="checkbox"
                    className="checkbox-lumos"
                    checked={groupItems.length > 0 && groupItems.every(i => selectedItems.has(i.id))}
                    onChange={() => toggleSelectGroup(groupItems, groupItems.every(i => selectedItems.has(i.id)))}
                  />
                </div>
                <button 
                  onClick={() => toggleGroup(group)}
                  className="flex-1 flex items-center justify-between px-6 py-4"
                >
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold uppercase tracking-widest text-lumos-text-secondary">
                    {group === 'edicao' ? 'Pós-produção' : group}
                  </h2>
                  <span className="bg-lumos-bg text-[10px] px-2 py-0.5 rounded-full font-bold">
                    {groupItems.length} itens
                  </span>
                </div>
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              
              {isExpanded && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm table-fixed">
                    <thead>
                      <tr className="text-left text-xs uppercase text-lumos-text-secondary bg-lumos-bg/30 border-b border-lumos-border">
                        <th className="px-6 py-3" style={{ width: '40px' }}></th>
                        <th className="px-6 py-3 font-bold" style={{ width: '35%' }}>Item</th>
                        <th className="px-6 py-3 font-bold" style={{ width: '20%' }}>Subcategoria</th>
                        <th className="px-6 py-3 font-bold text-right" style={{ width: '15%' }}>Valor Padrão</th>
                        <th className="px-6 py-3 font-bold text-center" style={{ width: '10%' }}>Unidade</th>
                        <th className="px-6 py-3 font-bold text-center" style={{ width: '10%' }}>Status</th>
                        <th className="px-6 py-3 font-bold text-center" style={{ width: '10%' }}>Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-lumos-border">
                      {groupItems.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-6 py-8 text-center text-lumos-text-secondary italic">
                            Nenhum item encontrado neste grupo.
                          </td>
                        </tr>
                      ) : groupItems.map((item) => (
                        <tr key={item.id} className={clsx(
                          "hover:bg-lumos-bg/30 transition-colors group",
                          !item.is_active && "opacity-60",
                          selectedItems.has(item.id) && "bg-lumos-yellow/5"
                        )}>
                          <td className="px-6 py-4">
                            <input 
                              type="checkbox"
                              className={clsx(
                                "checkbox-lumos transition-opacity",
                                selectedItems.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                              )}
                              checked={selectedItems.has(item.id)}
                              onChange={() => toggleSelectItem(item.id)}
                            />
                          </td>
                          <td className="px-6 py-4 truncate">
                            <div className="font-medium text-lumos-text-primary whitespace-nowrap overflow-hidden text-ellipsis">{item.name}</div>
                            {item.description && (
                              <div className="text-[11px] text-lumos-text-secondary mt-0.5 line-clamp-1">{item.description}</div>
                            )}
                          </td>
                          <td className="px-6 py-4 text-lumos-text-secondary whitespace-nowrap overflow-hidden text-ellipsis">{item.subcategory}</td>
                          <td className="px-6 py-4 text-right font-mono text-lumos-text-primary whitespace-nowrap">{formatCurrency(item.default_unit_cost)}</td>
                          <td className="px-6 py-4 text-center">
                            <span className="uppercase text-[10px] font-bold text-lumos-text-primary bg-lumos-bg/50 px-2 py-0.5 rounded-full border border-lumos-border">
                              {item.unit_label}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <button 
                              onClick={() => toggleStatus(item)}
                              className={clsx(
                                "mx-auto flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-1 rounded-full border transition-colors hover:scale-105",
                                item.is_active 
                                  ? "text-green-500 bg-green-500/10 border-green-500/20" 
                                  : "text-lumos-text-secondary bg-lumos-text-secondary/10 border-lumos-text-secondary/20"
                              )}
                            >
                              {item.is_active ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                              {item.is_active ? 'Ativo' : 'Inativo'}
                            </button>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center justify-center gap-2">
                              <button 
                                onClick={() => handleOpenModal(item)}
                                className="p-2 text-lumos-text-secondary hover:text-lumos-yellow transition-colors"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => {
                                  setDeletingType('single');
                                  setItemToDelete(item);
                                  setIsDeleteModalOpen(true);
                                }}
                                className="p-2 text-lumos-text-secondary hover:text-red-500 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-lumos-surface border border-lumos-border rounded-lumos w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
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
                    <option value="edicao">Pós-produção</option>
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
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-lumos-text-secondary uppercase mb-1">Descrição</label>
                  <textarea 
                    className="input-lumos w-full h-[80px] py-3 resize-none"
                    value={formData.description || ''}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    placeholder="Descreva o serviço ou item detalhadamente..."
                  />
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
      {/* Modal Deleção */}
      <AnimatePresence>
        {isDeleteModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-lumos-surface border border-lumos-border rounded-lumos w-full max-w-md shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-lumos-border bg-red-500/5 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center text-red-500">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-lumos-text-primary">Confirmar Deleção</h2>
                  <p className="text-sm text-red-500/80 font-medium">Esta ação é irreversível.</p>
                </div>
              </div>
              
              <div className="p-6 space-y-4">
                <div className="text-lumos-text-secondary text-sm">
                  {deletingType === 'single' ? (
                    <p>Tem certeza que deseja excluir permanentemente o item <span className="text-lumos-text-primary font-bold">"{itemToDelete?.name}"</span> do catálogo?</p>
                  ) : (
                    <p>Tem certeza que deseja excluir permanentemente os <span className="text-lumos-text-primary font-bold">{selectedItems.size} itens selecionados</span> do catálogo?</p>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  <button 
                    onClick={() => {
                      setIsDeleteModalOpen(false);
                      setItemToDelete(null);
                    }} 
                    className="btn-secondary flex-1"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={handleDeleteItems} 
                    className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lumos flex-1 transition-colors flex items-center justify-center gap-2"
                  >
                    <Trash className="w-4 h-4" />
                    Deletar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Barra de Ações Flutuante */}
      <AnimatePresence>
        {selectedItems.size > 0 && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-lumos-surface/80 backdrop-blur-xl border border-lumos-yellow/20 shadow-2xl rounded-full px-6 py-3 flex items-center gap-6 min-w-[500px]"
          >
            <div className="flex items-center gap-3 pr-6 border-r border-lumos-border">
              <div className="w-8 h-8 rounded-full bg-lumos-yellow flex items-center justify-center text-lumos-bg font-black text-sm">
                {selectedItems.size}
              </div>
              <span className="text-sm font-bold text-lumos-text-primary uppercase tracking-wider">
                {selectedItems.size === 1 ? 'Item Selecionado' : 'Itens Selecionados'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button 
                onClick={handleBulkDeactivate}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase text-lumos-text-secondary hover:text-lumos-yellow transition-colors"
              >
                <Ban className="w-4 h-4" />
                Desativar
              </button>
              <button 
                onClick={() => {
                  setDeletingType('bulk');
                  setIsDeleteModalOpen(true);
                }}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase text-red-400 hover:text-red-500 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Deletar
              </button>
            </div>

            <button 
              onClick={() => setSelectedItems(new Set())}
              className="ml-auto flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase text-lumos-text-secondary hover:text-lumos-text-primary transition-colors"
            >
              <X className="w-4 h-4" />
              Cancelar
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
