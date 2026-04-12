import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { 
  ChevronLeft, 
  ChevronRight,
  Save, 
  Plus, 
  Trash2, 
  Copy, 
  FileDown,
  AlertCircle,
  MoreVertical,
  ChevronDown,
  ChevronUp,
  Search,
  CheckCircle,
  Clock,
  ExternalLink,
  MessageSquare,
  FileText,
  Info,
  Library,
  X,
  FileStack,
  ClipboardList,
  StickyNote
} from 'lucide-react';
import { 
  BudgetItem, 
  BudgetVersion, 
  VersionFinancials, 
  calcFinancials, 
  formatCurrency 
} from '@/utils/financials';
import { BudgetPDF } from '@/components/editor/BudgetPDF';
import { ServiceOrderPDF } from '@/components/editor/ServiceOrderPDF';
import { pdf, PDFDownloadLink } from '@react-pdf/renderer';
import { useGoogleDrive } from '@/hooks/useGoogleDrive';
import GoogleDriveAuthModal from '@/components/editor/GoogleDriveAuthModal';
import { formatBudgetCode } from '@/utils/formatters';
import { getPdfFileName } from '@/utils/pdfFileName';
import { debounce } from 'lodash';
import { clsx } from 'clsx';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/common/Modal';

interface Budget {
  id: string;
  code: string;
  project_name: string;
  category: 'digital' | 'filme' | 'live';
  status: 'rascunho' | 'em_negociacao' | 'aprovado' | 'reprovado';
  client_id: string;
  active_version_id?: string;
  clients?: { name: string; agency_name?: string | null };
  is_template?: boolean;
  template_category?: string;
}

export default function BudgetEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [version, setVersion] = useState<BudgetVersion | null>(null);
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [versions, setVersions] = useState<BudgetVersion[]>([]);
  
  // Internal refs for non-re-rendering save state
  const saveTimers = useRef<Record<string, any>>({});
  const lastSavedRef = useRef<Date | null>(null);
  const [lastSavedTime, setLastSavedTime] = useState<Date | null>(null);
  const [isDraft, setIsDraft] = useState(false);
  
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<BudgetItem['item_group'] | null>(null);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [catalogSearch, setCatalogSearch] = useState('');

  const [clients, setClients] = useState<any[]>([]);
  const [isEditingCode, setIsEditingCode] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [templateCategory, setTemplateCategory] = useState('');
  const [availableContacts, setAvailableContacts] = useState<any[]>([]);
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(new Set());
  
  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const { login, uploadToDrive, isAuthenticated } = useGoogleDrive();
  
  // Ref to track dirty state and prevent save loops
  const isDirty = useRef(false);
  const lastLoadedData = useRef<string>('');
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const catalogSearchRef = useRef<HTMLInputElement>(null);

  // Close menu on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Read-only logic: only allow editing if it's a draft OR the current version is the active one
  const isReadOnly = useMemo(() => {
    if (isDraft) return false;
    if (!budget || !version) return true;
    return budget.active_version_id !== version.id;
  }, [isDraft, budget, version]);

  const selectedContact = useMemo(() => {
    if (!version?.contact_id) return null;
    return availableContacts.find(c => c.id === version.contact_id);
  }, [availableContacts, version?.contact_id]);

  // Calculate financials
  const financials = useMemo(() => {
    if (!version) return null;
    return calcFinancials(items, version);
  }, [items, version]);

  // Validation logic
  const validation = useMemo(() => {
    const missing = [];
    if (!budget?.code || budget.code === '----') missing.push('Código do orçamento');
    if (!budget?.project_name || budget.project_name === 'Novo Projeto' || budget.project_name.trim() === '') missing.push('Nome do projeto');
    if (!budget?.client_id) missing.push('Cliente');
    if (items.length === 0) missing.push('Pelo menos um item');
    
    return {
      isValid: missing.length === 0,
      missing
    };
  }, [budget, items]);

  // Load basic data
  useEffect(() => {
    if (id && id !== 'novo') {
      fetchBudgetData(id);
    } else {
      initNewBudget();
    }
    fetchClients();

    // Cleanup timers on unmount
    return () => {
      Object.values(saveTimers.current).forEach(clearTimeout);
    };
  }, [id]);

  async function fetchClients() {
    const { data } = await supabase.from('clients').select('*').order('name');
    setClients(data || []);
  }

  async function initNewBudget() {
    setIsDraft(true);
    setLoading(true);
    try {
      const draftBudget: Budget = {
        id: 'draft',
        code: '----',
        project_name: 'Novo Projeto',
        category: 'digital',
        status: 'rascunho',
        client_id: ''
      };

      const draftVersion: BudgetVersion = {
        id: 'draft-v1',
        budget_id: 'draft',
        version_number: 1,
        margin_pct: 0.4,
        nf_pct: 0.18,
        discount_value: 0,
        validity_days: 7,
        payment_terms: '60 dias após emissão da NF'
      };
      
      setBudget(draftBudget);
      setVersion(draftVersion);
      setItems([]);
      setVersions([]);
      
      lastLoadedData.current = JSON.stringify({ draftBudget, draftVersion, items: [] });
      isDirty.current = false;
    } catch (err) {
      console.error('Error initializing draft:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchBudgetData(budgetId: string, specificVersionId?: string) {
    // If we have unsaved changes, don't overwrite them with a background fetch
    if (isDirty.current) return;

    try {
      if (!budget) setLoading(true);
      setIsDraft(false);

      const { data: budgetData, error: budgetError } = await supabase
        .from('budgets')
        .select('*, clients(*)')
        .eq('id', budgetId)
        .single();

      if (budgetError) throw budgetError;

      const { data: versionsData } = await supabase
        .from('budget_versions')
        .select('*')
        .eq('budget_id', budgetId)
        .order('version_number', { ascending: false });
      
      const targetVersionId = specificVersionId || budgetData.active_version_id;
      const targetVersion = versionsData?.find((v: any) => v.id === targetVersionId);

      if (!targetVersion) throw new Error('Version not found');

      const { data: itemsData, error: itemsError } = await supabase
        .from('budget_items')
        .select('id, version_id, item_group, name, unit_cost, quantity, unit_label, description, sort_order, catalog_item_id')
        .eq('version_id', targetVersion.id)
        .order('sort_order', { ascending: true });

      if (itemsError) throw itemsError;

      setBudget(budgetData);
      setVersions(versionsData || []);
      setVersion(targetVersion);
      setItems(itemsData || []);
      
      if (budgetData.client_id) {
        fetchContactsForClient(budgetData.client_id);
      }
      
      lastLoadedData.current = JSON.stringify({ budgetData, targetVersion, itemsData });
      isDirty.current = false;
    } catch (err) {
      console.error('Error loading budget:', err);
    } finally {
      setLoading(false);
    }
  }

  // Persistent Save Logic
  const handleSave = async (showNotification: boolean = true) => {
    if (!budget || !version || !isDirty.current) return;
    
    if (showNotification) notifySaveStatus('saving');
    try {
      let currentBudgetId = budget.id;
      let currentVersionId = version.id;

      if (isDraft) {
        let finalCode = budget.code;
        if (finalCode === '----') {
          const { data: newCode, error: codeError } = await supabase.rpc('next_budget_code');
          if (codeError) throw codeError;
          finalCode = newCode || 'AUTO';
          setBudget(prev => prev ? { ...prev, code: finalCode } : null);
        }

        const { data: bData, error: bError } = await supabase
          .from('budgets')
          .insert({
            code: finalCode,
            project_name: budget.project_name,
            category: budget.category,
            status: budget.status,
            client_id: budget.client_id || null
          })
          .select()
          .single();
        
        if (bError) throw bError;
        currentBudgetId = bData.id;

        const { data: vData, error: vError } = await supabase
          .from('budget_versions')
          .insert({
            budget_id: currentBudgetId,
            contact_id: version.contact_id || null,
            version_number: 1,
            margin_pct: version.margin_pct,
            nf_pct: version.nf_pct,
            discount_value: version.discount_value,
            notes_internal: version.notes_internal,
            notes_client: version.notes_client,
            payment_terms: version.payment_terms,
            validity_days: version.validity_days
          })
          .select()
          .single();
        
        if (vError) throw vError;
        currentVersionId = vData.id;

        await supabase.from('budgets').update({ active_version_id: currentVersionId }).eq('id', currentBudgetId);
        setIsDraft(false);
        navigate(`/orcamentos/${currentBudgetId}`, { replace: true });
      } else {
        await Promise.all([
          supabase.from('budget_versions').update({
            contact_id: version.contact_id || null,
            margin_pct: version.margin_pct,
            nf_pct: version.nf_pct,
            discount_value: version.discount_value,
            notes_internal: version.notes_internal,
            notes_client: version.notes_client,
            payment_terms: version.payment_terms,
            validity_days: version.validity_days
          }).eq('id', version.id),
          supabase.from('budgets').update({
            code: budget.code,
            project_name: budget.project_name,
            category: budget.category,
            status: budget.status,
            client_id: budget.client_id || null
          }).eq('id', budget.id)
        ]);
      }

      if (items.length > 0) {
        await supabase.from('budget_items').upsert(
          items.map((it, idx) => ({
            id: it.id,
            version_id: currentVersionId,
            item_group: it.item_group,
            name: it.name,
            unit_cost: it.unit_cost,
            quantity: it.quantity,
            unit_label: it.unit_label,
            description: it.description,
            sort_order: idx,
            catalog_item_id: it.catalog_item_id
          }))
        );
      }

      isDirty.current = false;
      lastSavedRef.current = new Date();
      setLastSavedTime(new Date());
      if (showNotification) notifySaveStatus('saved');
    } catch (err) {
      console.error('Save error:', err);
      if (showNotification) notifySaveStatus('error');
    }
  };

  // Optimized Partial Saves
  const savePartialBudget = async (updates: Partial<Budget>) => {
    if (isDraft || !budget) return;
    notifySaveStatus('saving');
    try {
      const { error } = await supabase.from('budgets').update(updates).eq('id', budget.id);
      if (error) throw error;
      lastSavedRef.current = new Date();
      setLastSavedTime(new Date());
      notifySaveStatus('saved');
    } catch (err) {
      console.error('Partial budget save error:', err);
      notifySaveStatus('error');
    }
  };

  const savePartialVersion = async (updates: Partial<BudgetVersion>) => {
    if (isDraft || !version) return;
    notifySaveStatus('saving');
    try {
      const { error } = await supabase.from('budget_versions').update(updates).eq('id', version.id);
      if (error) throw error;
      lastSavedRef.current = new Date();
      setLastSavedTime(new Date());
      notifySaveStatus('saved');
    } catch (err) {
      console.error('Partial version save error:', err);
      notifySaveStatus('error');
    }
  };

  const handleNewVersion = async () => {
    if (!budget || !version || isDraft) return;
    if (!confirm('Deseja criar uma NOVA VERSÃO baseada na atual?')) return;

    notifySaveStatus('saving');
    try {
      const nextNumber = versions.length > 0 ? Math.max(...versions.map(v => v.version_number)) + 1 : version.version_number + 1;
      
      const { data: newV, error: vError } = await supabase
        .from('budget_versions')
        .insert({
          budget_id: budget.id,
          version_number: nextNumber,
          margin_pct: version.margin_pct,
          nf_pct: version.nf_pct,
          discount_value: version.discount_value,
          notes_internal: version.notes_internal,
          notes_client: version.notes_client,
          payment_terms: version.payment_terms,
          validity_days: version.validity_days
        })
        .select()
        .single();

      if (vError) throw vError;

      const itemsToClone = items.map(item => ({
        version_id: newV.id,
        item_group: item.item_group,
        name: item.name,
        unit_cost: item.unit_cost,
        quantity: item.quantity,
        unit_label: item.unit_label,
        description: item.description,
        sort_order: item.sort_order,
        catalog_item_id: item.catalog_item_id
      }));
      
      if (itemsToClone.length > 0) {
        await supabase.from('budget_items').insert(itemsToClone);
      }

      await supabase.from('budgets').update({ active_version_id: newV.id }).eq('id', budget.id);
      
      isDirty.current = false;
      notifySaveStatus('saved');
      await fetchBudgetData(budget.id, newV.id);
    } catch (err) {
      console.error('Error creating new version:', err);
      notifySaveStatus('error');
    }
  };

  const handleSaveAsTemplate = async () => {
    if (!budget || !templateCategory.trim()) return;
    
    setIsMoreMenuOpen(false);
    notifySaveStatus('saving');
    try {
      let budgetId = budget.id;

      if (isDraft) {
        // If it's a draft, we need to create the budget first
        let finalCode = budget.code;
        if (finalCode === '----') {
          const { data: newCode, error: codeError } = await supabase.rpc('next_budget_code');
          if (codeError) throw codeError;
          finalCode = newCode || 'AUTO';
        }

        const { data: bData, error: bError } = await supabase
          .from('budgets')
          .insert({
            code: finalCode,
            project_name: budget.project_name === 'Novo Orçamento' || !budget.project_name ? `Template: ${templateCategory.trim()}` : budget.project_name,
            category: budget.category,
            status: budget.status,
            client_id: budget.client_id || null, // Templates don't need clients
            is_template: true,
            template_category: templateCategory.trim()
          })
          .select()
          .single();
        
        if (bError) throw bError;
        budgetId = bData.id;

        // Create initial version
        const { data: vData, error: vError } = await supabase
          .from('budget_versions')
          .insert({
            budget_id: budgetId,
            contact_id: version?.contact_id || null,
            version_number: 1,
            margin_pct: version?.margin_pct || 0.4,
            nf_pct: version?.nf_pct || 0.18,
            discount_value: version?.discount_value || 0,
            notes_internal: version?.notes_internal,
            notes_client: version?.notes_client,
            payment_terms: version?.payment_terms,
            validity_days: version?.validity_days || 7
          })
          .select()
          .single();
        
        if (vError) throw vError;

        // Insert items
        if (items.length > 0) {
          const itemsToInsert = items.map((it, idx) => ({
            version_id: vData.id,
            item_group: it.item_group,
            name: it.name,
            unit_cost: it.unit_cost,
            quantity: it.quantity,
            unit_label: it.unit_label,
            description: it.description,
            sort_order: idx,
            catalog_item_id: it.catalog_item_id
          }));
          await supabase.from('budget_items').insert(itemsToInsert);
        }

        await supabase.from('budgets').update({ active_version_id: vData.id }).eq('id', budgetId);
        
        setIsDraft(false);
        setBudget({ ...bData, is_template: true, template_category: templateCategory.trim() });
        navigate(`/orcamentos/${budgetId}`, { replace: true });
      } else {
        // Just update existing budget
        const { error } = await supabase
          .from('budgets')
          .update({ 
            is_template: true, 
            template_category: templateCategory.trim() 
          })
          .eq('id', budgetId);

        if (error) throw error;
        setBudget(prev => prev ? { ...prev, is_template: true, template_category: templateCategory.trim() } : null);
      }

      setIsTemplateModalOpen(false);
      notifySaveStatus('saved');
      alert('Orçamento salvo como padrão com sucesso!');
    } catch (err) {
      console.error('Error saving as template:', err);
      notifySaveStatus('error');
      alert('Erro ao salvar como template: ' + (err as any).message);
    }
  };

  const syncItem = async (item: BudgetItem) => {
    if (isReadOnly || isDraft || !version) return;
    notifySaveStatus('saving');
    try {
      const { error } = await supabase
        .from('budget_items')
        .upsert({
          id: item.id,
          version_id: version.id,
          item_group: item.item_group,
          name: item.name,
          unit_cost: item.unit_cost,
          quantity: item.quantity,
          unit_label: item.unit_label,
          description: item.description,
          sort_order: items.indexOf(item),
          catalog_item_id: item.catalog_item_id
        });
      
      if (error) throw error;
      notifySaveStatus('saved');
    } catch (err) {
      console.error('Error syncing item:', err);
      notifySaveStatus('error');
    }
  };

  const deleteItemFromDb = async (itemId: string) => {
    if (isReadOnly || isDraft) return;
    notifySaveStatus('saving');
    try {
      const { error } = await supabase.from('budget_items').delete().eq('id', itemId);
      if (error) throw error;
      notifySaveStatus('saved');
    } catch (err) {
      console.error('Error deleting item:', err);
      notifySaveStatus('error');
    }
  };

  const triggerSave = (type: 'budget' | 'version', updates: any) => {
    const key = `${type}-${Object.keys(updates).join('-')}`;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    
    saveTimers.current[key] = setTimeout(() => {
      if (type === 'budget') savePartialBudget(updates);
      else savePartialVersion(updates);
      delete saveTimers.current[key];
    }, 5000);
  };

  // Catalog Logic
  useEffect(() => {
    if (isCatalogOpen) {
      setCatalogSearch('');
      fetchCatalogItems();
      // Short delay to ensure modal is rendered before focusing
      setTimeout(() => catalogSearchRef.current?.focus(), 100);
    }
  }, [isCatalogOpen]);

  async function fetchCatalogItems() {
    const { data } = await supabase.from('item_catalog').select('*').eq('is_active', true).order('name');
    setCatalogItems(data || []);
  }

  const addManualItem = (group: BudgetItem['item_group'] = activeGroup!) => {
    if (isReadOnly) return;
    const newItem: BudgetItem = {
      id: crypto.randomUUID(),
      item_group: group,
      name: '',
      unit_cost: 0,
      quantity: 1,
      unit_label: 'unidade',
      sort_order: items.length
    };
    
    const updatedItems = [...items, newItem];
    setItems(updatedItems);
    
    // Immediate save for manual adds
    if (!isDraft && version) {
      syncItem(newItem);
    } else {
      isDirty.current = true;
    }
  };

  const addCatalogItem = async (catItem: any) => {
    if (isReadOnly) return;
    const newItem: BudgetItem = {
      id: crypto.randomUUID(),
      item_group: activeGroup!,
      name: catItem.name,
      unit_cost: catItem.default_unit_cost || 0,
      quantity: 1,
      unit_label: catItem.unit_label || 'diaria',
      description: catItem.description || '',
      sort_order: items.length,
      catalog_item_id: catItem.id
    };

    const updatedItems = [...items, newItem];
    setItems(updatedItems);
    
    // Immediate save for catalog adds
    if (!isDraft && version) {
      await syncItem(newItem);
    } else {
      isDirty.current = true;
    }
    
    setIsCatalogOpen(false);
  };

  const removeItem = (id: string) => {
    if (isReadOnly) return;
    setItems(items.filter(i => i.id !== id));
    
    if (!isDraft && version) {
      deleteItemFromDb(id);
    } else {
      isDirty.current = true;
    }
  };

  const updateItem = (id: string, updates: Partial<BudgetItem>) => {
    if (isReadOnly) return;
    const item = items.find(i => i.id === id);
    if (!item) return;

    const updatedItem = { ...item, ...updates };
    setItems(items.map(i => i.id === id ? updatedItem : i));
    
    const isTextField = 'name' in updates || 'description' in updates;
    
    if (!isDraft && version) {
      if (isTextField) {
        const key = `item-${id}`;
        if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
        saveTimers.current[key] = setTimeout(() => {
          syncItem(updatedItem);
          delete saveTimers.current[key];
        }, 5000);
      } else {
        setTimeout(() => syncItem(updatedItem), 0);
      }
    } else {
      isDirty.current = true;
    }
  };

  const handleGenerateAndBackup = async (shouldBackup: boolean = true) => {
    if (!financials || !budget || !version) return;
    
    setIsGeneratingPDF(true);
    try {
      const fileName = getPdfFileName(
        budget.code,
        budget.clients?.name || 'Cliente',
        budget.clients?.agency_name,
        budget.project_name
      );
      
      const blob = await pdf(
        <BudgetPDF 
          budget={budget} 
          version={version} 
          contact={selectedContact}
          items={items} 
          financials={financials} 
          userName={user?.user_metadata?.full_name || user?.email}
        />
      ).toBlob();

      // Trigger download
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Backup if needed
      const isNegotiating = budget.status === 'em_negociacao';

      if (shouldBackup && isNegotiating) {
        try {
          await uploadToDrive(blob, fileName);
          // Toast-like notification
          const toast = document.createElement('div');
          toast.className = 'fixed bottom-6 right-6 bg-green-600 text-white px-6 py-3 rounded-lumos shadow-2xl z-[100] animate-in slide-in-from-bottom-4 duration-300 font-bold flex items-center gap-2';
          toast.innerHTML = '<span class="w-2 h-2 rounded-full bg-white animate-pulse"></span> PDF salvo no Google Drive ✓';
          document.body.appendChild(toast);
          setTimeout(() => {
            toast.classList.add('animate-out', 'fade-out', 'slide-out-to-bottom-4');
            setTimeout(() => {
              if (document.body.contains(toast)) document.body.removeChild(toast);
            }, 300);
          }, 4000);
        } catch (uploadErr) {
          console.error('Drive upload failed:', uploadErr);
        }
      }
    } catch (err) {
      console.error('PDF generation error:', err);
      alert('Erro ao gerar o PDF da proposta.');
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const onPDFClick = () => {
    if (budget?.status === 'em_negociacao' && !isAuthenticated()) {
      setIsDriveModalOpen(true);
    } else {
      handleGenerateAndBackup(isAuthenticated());
    }
  };

  const updateBudget = (updates: Partial<Budget>) => {
    if (isReadOnly) return;
    setBudget(prev => prev ? { ...prev, ...updates } : null);
    if (!isDraft) triggerSave('budget', updates);
    else isDirty.current = true;
  };

  const updateVersion = (updates: Partial<BudgetVersion>) => {
    if (isReadOnly) return;
    setVersion(prev => prev ? { ...prev, ...updates } : null);
    if (!isDraft) triggerSave('version', updates);
    else isDirty.current = true;
  };

  async function fetchContactsForClient(clientId: string, autoSelect: boolean = false) {
    const { data } = await supabase
      .from('client_contacts')
      .select('*')
      .eq('client_id', clientId)
      .order('is_primary', { ascending: false });
    
    setAvailableContacts(data || []);
    
    if (autoSelect && data && data.length === 1) {
      updateVersion({ contact_id: data[0].id });
    } else if (autoSelect && data && data.length > 1) {
      // If we don't have a contact already selected, pick the primary
      if (!version?.contact_id) {
        const primary = data.find(c => c.is_primary);
        if (primary) updateVersion({ contact_id: primary.id });
      }
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-lumos-yellow"></div>
        <p className="text-lumos-text-secondary animate-pulse font-bold uppercase tracking-widest text-[10px]">Carregando editor de orçamento...</p>
      </div>
    );
  }

  if (!budget || !version) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 animate-in fade-in duration-500">
        <div className="p-4 bg-red-500/10 rounded-full">
          <AlertCircle className="w-12 h-12 text-red-500" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-black text-lumos-text-primary tracking-tight">Erro ao carregar orçamento</h2>
          <p className="text-lumos-text-secondary mt-2">Não foi possível encontrar os dados deste projeto ou houve um erro na conexão.</p>
        </div>
        <button onClick={() => navigate('/')} className="btn-secondary px-8">
          Voltar para o Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-20">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/')} className="p-2 hover:bg-lumos-bg rounded-full transition-colors text-lumos-text-secondary">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              {isEditingCode ? (
                <div className="flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap">
                  <span className="font-mono text-lumos-yellow text-sm font-bold">#</span>
                  <input
                    autoFocus
                    className="bg-lumos-bg border border-lumos-yellow/50 text-lumos-yellow font-mono text-sm px-2 py-1 rounded w-32 focus:ring-1 focus:ring-lumos-yellow outline-none"
                    value={budget?.code || ''}
                    onChange={(e) => updateBudget({ code: e.target.value })}
                    onBlur={() => setIsEditingCode(false)}
                    onKeyDown={(e) => e.key === 'Enter' && setIsEditingCode(false)}
                  />
                </div>
              ) : (
                <span 
                  onClick={() => !isReadOnly && setIsEditingCode(true)}
                  className={clsx(
                    "font-mono text-lumos-yellow text-xs px-2.5 py-1.5 bg-lumos-yellow/10 rounded font-bold border border-lumos-yellow/20 cursor-pointer hover:bg-lumos-yellow/20 transition-all flex-shrink-0 whitespace-nowrap",
                    isReadOnly && "cursor-default hover:bg-lumos-yellow/10"
                  )}
                >
                  {formatBudgetCode(budget?.code || '')}
                </span>
              )}
              <input 
                disabled={isReadOnly}
                className="bg-transparent border-none text-2xl font-bold focus:ring-0 p-0 text-lumos-text-primary w-full max-w-md disabled:opacity-70"
                value={budget?.project_name || ''}
                onChange={(e) => updateBudget({ project_name: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-4 text-xs font-semibold">
              <div className="flex items-center gap-2">
                <select 
                  disabled={isReadOnly}
                  className="bg-transparent border-none text-lumos-text-secondary focus:ring-0 p-0 hover:text-lumos-text-primary transition-colors cursor-pointer disabled:cursor-default max-w-[200px] truncate"
                  value={budget?.client_id || ''}
                  onChange={(e) => {
                    const cid = e.target.value;
                    updateBudget({ client_id: cid });
                    // Reset contact when client changes
                    if (cid) {
                      fetchContactsForClient(cid, true);
                    } else {
                      setAvailableContacts([]);
                      setVersion(v => v ? { ...v, contact_id: undefined } : null);
                    }
                  }}
                >
                  <option value="">Selecionar Empresa</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.agency_name ? `${c.agency_name} + ${c.name}` : c.name}
                    </option>
                  ))}
                </select>

                {budget?.client_id && (
                  <>
                    <div className="w-px h-3 bg-lumos-border" />
                    <select
                      disabled={isReadOnly}
                      className="bg-transparent border-none text-lumos-text-secondary focus:ring-0 p-0 hover:text-lumos-text-primary transition-colors cursor-pointer disabled:cursor-default max-w-[150px] truncate"
                      value={version?.contact_id || ''}
                      onChange={(e) => updateVersion({ contact_id: e.target.value })}
                    >
                      <option value="">Contato</option>
                      {availableContacts.map(c => (
                        <option key={c.id} value={c.id}>{c.name} {c.role ? `· ${c.role}` : ''}</option>
                      ))}
                    </select>
                  </>
                )}
              </div>
              <div className="w-px h-3 bg-lumos-border" />
              <select 
                disabled={isReadOnly}
                className="bg-transparent border-none text-lumos-text-secondary focus:ring-0 p-0 uppercase hover:text-lumos-text-primary transition-colors cursor-pointer disabled:cursor-default"
                value={budget?.category || 'digital'}
                onChange={(e) => updateBudget({ category: e.target.value as any })}
              >
                <option value="digital">Digital</option>
                <option value="filme">Filme</option>
                <option value="live">Live</option>
              </select>
              <div className="w-px h-3 bg-lumos-border" />
              <div className="flex items-center gap-2">
                <Clock className="w-3 h-3 text-lumos-yellow" />
                <select 
                  className="bg-transparent border-none text-lumos-yellow font-black focus:ring-0 p-0 uppercase hover:text-lumos-yellow transition-colors cursor-pointer"
                  value={version?.id}
                  onChange={(e) => {
                    const selectedVid = e.target.value;
                    fetchBudgetData(budget!.id, selectedVid);
                  }}
                >
                  {versions.map(v => (
                    <option key={v.id} value={v.id}>
                      Versão {v.version_number} {v.id === budget?.active_version_id ? '(Ativa)' : ''}
                    </option>
                  ))}
                  {isDraft && <option value="draft-v1">Versão 1 (Rascunho)</option>}
                </select>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:flex flex-col items-end mr-2">
            <SavingIndicator />
            {lastSavedTime && (
              <span className="flex items-center gap-1 text-[10px] uppercase font-bold text-green-600">
                <CheckCircle className="w-3 h-3" /> Salvo às {lastSavedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          {!isReadOnly && (
            <div className="relative group/save">
              <MainSaveButton 
                onSave={() => handleSave()} 
                disabled={!isDirty.current || !validation.isValid}
              />
              
              {!validation.isValid && (
                <div className="absolute top-full mt-2 right-0 w-64 bg-black/90 text-white p-3 rounded-lumos border border-white/10 shadow-2xl opacity-0 group-hover/save:opacity-100 transition-opacity z-[100] pointer-events-none">
                  <p className="text-[10px] font-black uppercase text-lumos-yellow mb-2 tracking-widest">Requisitos pendentes:</p>
                  <ul className="space-y-1">
                    {validation.missing.map(msg => (
                      <li key={msg} className="text-[10px] flex items-center gap-2 font-bold text-gray-300">
                        <div className="w-1 h-1 rounded-full bg-red-500" />
                        {msg}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="relative" ref={moreMenuRef}>
            <button 
              onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
              className="p-2.5 hover:bg-lumos-bg rounded-lumos text-lumos-text-secondary transition-all border border-lumos-border"
            >
              <MoreVertical className="w-5 h-5" />
            </button>

            {isMoreMenuOpen && (
              <div className="absolute top-12 right-0 w-56 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl z-50 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <button
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    setIsTemplateModalOpen(true);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-bold text-lumos-text-primary hover:bg-lumos-bg transition-colors"
                >
                  <FileStack className="w-4 h-4 text-lumos-yellow" />
                  Salvar como Orçamento Padrão
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Template Modal */}
      <Modal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        title="Salvar como Orçamento Padrão"
        footer={
          <>
            <button onClick={() => setIsTemplateModalOpen(false)} className="btn-secondary">Cancelar</button>
            <button 
              onClick={handleSaveAsTemplate}
              disabled={!templateCategory.trim()}
              className="btn-primary px-6"
            >
              Confirmar
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-lumos-text-secondary leading-relaxed">
            Este orçamento será marcado como um modelo reutilizável. Defina uma categoria para facilitar a busca posterior.
          </p>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest block">
              Categoria do Template
            </label>
            <input 
              autoFocus
              className="input-lumos w-full"
              placeholder="Ex: Produção de Conteúdo, Live, Filme Publicitário..."
              value={templateCategory}
              onChange={(e) => setTemplateCategory(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveAsTemplate()}
            />
          </div>
        </div>
      </Modal>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Editor Main Area */}
        <div className="lg:col-span-3 space-y-8">
          
          {/* Briefing Section */}
          <div className="card space-y-4">
            <div className="flex items-center gap-2 text-lumos-text-primary border-b border-lumos-border pb-4">
              <FileText className="w-5 h-5" />
              <h3 className="font-bold">Briefing & Condições</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-2 block flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" /> Proposta para o Cliente (PDF)
                  </label>
                  <textarea 
                    disabled={isReadOnly}
                    className="input-lumos w-full min-h-[160px] text-sm leading-relaxed disabled:opacity-70"
                    placeholder="Descreva o projeto, entregas, produção e prazos..."
                    value={version?.notes_client || ''}
                    onChange={(e) => {
                      setVersion(v => v ? { ...v, notes_client: e.target.value } : null);
                      isDirty.current = true;
                    }}
                  />
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-2 block flex items-center gap-1">
                    <Info className="w-3 h-3" /> Observações Internas (Não aparecem no PDF)
                  </label>
                  <textarea 
                    disabled={isReadOnly}
                    className="input-lumos w-full min-h-[80px] text-sm bg-blue-50/10 disabled:opacity-70"
                    placeholder="Notas para a equipe Lumos..."
                    value={version?.notes_internal || ''}
                    onChange={(e) => {
                      setVersion(v => v ? { ...v, notes_internal: e.target.value } : null);
                      isDirty.current = true;
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-2 block">Pagamento</label>
                    <input 
                      disabled={isReadOnly}
                      className="input-lumos w-full text-xs disabled:opacity-70"
                      value={version?.payment_terms || ''}
                      onChange={(e) => {
                        setVersion(v => v ? { ...v, payment_terms: e.target.value } : null);
                        isDirty.current = true;
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-2 block">Validade (Dias)</label>
                    <input 
                      disabled={isReadOnly}
                      type="number"
                      className="input-lumos w-full text-xs disabled:opacity-70"
                      value={version?.validity_days || 7}
                      onChange={(e) => {
                        setVersion(v => v ? { ...v, validity_days: Number(e.target.value) } : null);
                        isDirty.current = true;
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {(['equipe', 'equipamentos', 'producao', 'edicao'] as const).map(group => (
            <div key={group} className="card !p-0 overflow-hidden shadow-sm border-lumos-border">
              <div className="bg-lumos-bg/50 px-6 py-4 flex items-center justify-between border-b border-lumos-border">
                <h3 className="uppercase tracking-widest text-[10px] font-black text-lumos-text-secondary">
                  {group === 'edicao' ? 'Pós-produção' : group}
                </h3>
                {!isReadOnly && (
                  <button 
                    onClick={() => {
                      setActiveGroup(group);
                      setIsCatalogOpen(true);
                    }}
                    className="text-lumos-yellow hover:scale-105 transition-all flex items-center gap-1 text-[10px] font-black uppercase"
                  >
                    <Plus className="w-3 h-3" /> Adicionar Item
                  </button>
                )}
              </div>
              <div className="divide-y divide-lumos-border">
                {items.filter(i => i.item_group === group).length === 0 ? (
                  <div className="p-8 text-center text-xs text-lumos-text-secondary italic">
                    Nenhum item adicionado a este grupo.
                  </div>
                ) : items.filter(i => i.item_group === group).map(item => (
                  <div key={item.id} className="p-4 flex flex-col gap-3 group hover:bg-lumos-bg/30 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <input 
                          disabled={isReadOnly}
                          className="bg-transparent border-none w-full p-0 font-medium text-lumos-text-primary focus:ring-0 placeholder:text-lumos-text-secondary/30 disabled:opacity-70" 
                          value={item.name} 
                          onChange={(e) => updateItem(item.id, { name: e.target.value })}
                          placeholder="Nome do item..."
                        />
                      </div>
                      <div className="w-32">
                        <div className="flex items-center gap-1 border-b border-transparent group-hover:border-lumos-border transition-colors">
                          <span className="text-xs text-lumos-text-secondary">R$</span>
                          <input 
                            disabled={isReadOnly}
                            type="number"
                            className="bg-transparent border-none w-full p-0 text-right text-sm font-bold focus:ring-0 text-lumos-text-primary disabled:opacity-70" 
                            value={item.unit_cost} 
                            onChange={(e) => updateItem(item.id, { unit_cost: Number(e.target.value) })}
                          />
                        </div>
                      </div>
                      <div className="w-16">
                        <input 
                          disabled={isReadOnly}
                          type="number"
                          className="bg-transparent border-none w-full p-0 text-center text-sm font-bold focus:ring-0 text-lumos-text-primary disabled:opacity-70" 
                          value={item.quantity} 
                          onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) })}
                        />
                      </div>
                      <div className="w-24">
                        <select 
                          disabled={isReadOnly}
                          className="bg-transparent border-none w-full p-0 text-[10px] uppercase font-bold text-lumos-text-secondary focus:ring-0 cursor-pointer disabled:cursor-default disabled:opacity-70"
                          value={item.unit_label}
                          onChange={(e) => updateItem(item.id, { unit_label: e.target.value })}
                        >
                          <option value="diaria">diária</option>
                          <option value="hora">hora</option>
                          <option value="video">vídeo</option>
                          <option value="unidade">unidade</option>
                          <option value="pacote">pacote</option>
                        </select>
                      </div>
                      <div className="w-32 text-right font-mono text-sm font-bold text-lumos-text-primary">
                        {formatCurrency(item.unit_cost * item.quantity)}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => {
                            const newSet = new Set(expandedDescriptions);
                            if (newSet.has(item.id)) newSet.delete(item.id);
                            else newSet.add(item.id);
                            setExpandedDescriptions(newSet);
                          }}
                          className={clsx(
                            "p-2 transition-colors rounded-full",
                            expandedDescriptions.has(item.id) || item.description
                              ? "text-lumos-yellow bg-lumos-yellow/10"
                              : "text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-yellow/5"
                          )}
                          title="Descrição/Notas"
                        >
                          <StickyNote className="w-4 h-4" />
                        </button>
                        {!isReadOnly && (
                          <button 
                            onClick={() => removeItem(item.id)}
                            className="text-red-400 hover:text-red-600 p-2 transition-colors"
                            title="Remover Item"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {(expandedDescriptions.has(item.id) || item.description) && (
                      <div className="animate-in slide-in-from-top-1 duration-200">
                        <textarea
                          disabled={isReadOnly}
                          className="w-full bg-lumos-bg/50 border border-lumos-border/50 rounded-lumos p-3 text-xs text-lumos-text-primary focus:border-lumos-yellow/50 focus:ring-0 resize-none h-[60px] placeholder:text-lumos-text-secondary/30"
                          placeholder="Adicione uma descrição opcional para este item..."
                          value={item.description || ''}
                          onChange={(e) => updateItem(item.id, { description: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                 ))
               }
               </div>
            </div>
          ))}
        </div>

        {/* Financial Sidebar */}
        <aside className="lg:col-span-1 space-y-6">
          <div className="card sticky top-8 shadow-xl border-lumos-yellow/10">
            <h3 className="text-sm font-black uppercase tracking-widest mb-6 text-lumos-text-primary flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-lumos-yellow" />
              Resumo Financeiro
            </h3>
            
            <div className="space-y-4 text-xs font-semibold">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-lumos-text-secondary uppercase">Custo Direto (Itens)</span>
                  <span className="text-lumos-text-primary">{formatCurrency(financials?.totalCusto || 0)}</span>
                </div>
                <div className="flex justify-between text-lumos-text-secondary">
                  <span className="uppercase">Margem ({Math.round((version?.margin_pct || 0) * 100)}%)</span>
                  <span>+{formatCurrency(financials?.margem || 0)}</span>
                </div>
              </div>
              
              <div className="h-px bg-lumos-border my-4" />
              
              <div className="flex justify-between font-black text-sm text-lumos-text-primary">
                <span className="uppercase">Subtotal (Custo + Margem)</span>
                <span>{formatCurrency(financials?.subtotal || 0)}</span>
              </div>

              <div className="flex justify-between text-lumos-text-secondary mt-2">
                <span className="uppercase">Imposto NF ({Math.round((version?.nf_pct || 0) * 100)}%)</span>
                <span>+{formatCurrency(financials?.nf || 0)}</span>
              </div>

              <div className="h-px bg-lumos-border my-4" />

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] text-lumos-text-secondary font-black uppercase mb-1 block">Margem / Markup</label>
                    <div className="flex items-center gap-2">
                      <input 
                        disabled={isReadOnly}
                        type="number" 
                        className="input-lumos w-full text-center font-bold text-lumos-text-primary disabled:opacity-70" 
                        value={version ? Math.round((version.margin_pct || 0) * 100) : 40}
                        onChange={(e) => setVersion(v => v ? { ...v, margin_pct: (Number(e.target.value) || 0) / 100 } : null)}
                      />
                      <span className="text-lumos-text-secondary text-[10px]">%</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-lumos-text-secondary font-black uppercase mb-1 block">Imposto (NF)</label>
                    <div className="flex items-center gap-2">
                      <input 
                        disabled={isReadOnly}
                        type="number" 
                        className="input-lumos w-full text-center font-bold text-lumos-text-primary disabled:opacity-70" 
                        value={version ? Math.round((version.nf_pct || 0) * 100) : 18}
                        onChange={(e) => setVersion(v => v ? { ...v, nf_pct: (Number(e.target.value) || 0) / 100 } : null)}
                      />
                      <span className="text-lumos-text-secondary text-[10px]">%</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-lumos-text-secondary font-black uppercase mb-2 block">Status Proposta</label>
                  <select 
                    disabled={isReadOnly}
                    className={clsx(
                      "input-lumos w-full font-black uppercase text-[10px] disabled:opacity-70",
                      budget?.status === 'aprovado' ? 'text-green-600' : 
                      budget?.status === 'em_negociacao' ? 'text-lumos-yellow text-glow' : 
                      budget?.status === 'reprovado' ? 'text-red-600' : 'text-gray-400'
                    )}
                    value={budget?.status || 'rascunho'}
                    onChange={(e) => updateBudget({ status: e.target.value as any })}
                  >
                    <option value="rascunho">Rascunho</option>
                    <option value="em_negociacao">Em Negociação</option>
                    <option value="aprovado">Aprovado</option>
                    <option value="reprovado">Reprovado</option>
                  </select>
                </div>
              </div>

              <div className="pt-6 mt-6 border-t border-lumos-yellow/20 bg-lumos-yellow/5 -mx-6 px-6 pb-6">
                <div className="flex flex-col gap-1 mb-4">
                  <span className="text-[10px] text-lumos-text-secondary font-black uppercase">Valor de Venda Final</span>
                  <span className="text-4xl font-black text-lumos-yellow leading-none tracking-tighter drop-shadow-sm">{formatCurrency(financials?.valorFinal || 0)}</span>
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-[10px] font-black uppercase">
                    <span className="text-lumos-text-secondary">Lucro Líquido</span>
                    <span className="text-lumos-text-primary">{formatCurrency(financials?.lucro || 0)}</span>
                  </div>
                  
                  <div className={clsx(
                    "p-3 rounded-lumos flex items-center justify-between font-black uppercase text-[10px] border",
                    (financials?.margemReal || 0) < 30 
                      ? "bg-red-500/10 text-red-500 border-red-500/20" 
                      : "bg-green-500/10 text-green-500 border-green-500/20"
                  )}>
                    <span>Margem Real</span>
                    <span>{financials?.margemReal.toFixed(1)}%</span>
                  </div>
                </div>

                {(financials?.margemReal || 0) < 30 && (
                  <p className="text-[9px] text-red-500 mt-2 flex items-start gap-1 font-bold italic leading-tight">
                    <AlertCircle className="w-3 h-3 flex-shrink-0" /> Margem abaixo do mínimo sugerido pela produtora (30%)
                  </p>
                )}
              </div>
            </div>

            {financials && budget && version && (
              <div className="space-y-3 mt-6">
                <button 
                  onClick={onPDFClick}
                  disabled={isGeneratingPDF}
                  className="btn-secondary w-full py-4 flex items-center justify-center gap-2 font-black uppercase tracking-widest text-[10px]"
                >
                  <FileDown className="w-4 h-4" />
                  {isGeneratingPDF ? 'Preparando...' : 'Gerar Orçamento PDF'}
                </button>

                <PDFDownloadLink 
                  key={`os-${version.id}-${items.length}`}
                  document={
                    <ServiceOrderPDF 
                      budget={budget} 
                      version={version} 
                      contact={selectedContact}
                      items={items} 
                    />
                  } 
                  fileName={getPdfFileName(
                    budget.code,
                    budget.clients?.name || 'Cliente',
                    budget.clients?.agency_name,
                    budget.project_name,
                    'OS_'
                  )}
                  className="btn-secondary w-full py-4 flex items-center justify-center gap-2 font-black uppercase tracking-widest text-[10px] border-lumos-yellow/20 hover:border-lumos-yellow/40"
                >
                  {({ loading }) => (
                    <>
                      <ClipboardList className="w-4 h-4" />
                      {loading ? 'Preparando...' : 'Gerar O.S'}
                    </>
                  )}
                </PDFDownloadLink>
              </div>
            )}
            
            <div className="mt-4 flex flex-col items-center gap-2">
               <button 
                disabled={isDraft}
                onClick={handleNewVersion}
                className="text-[9px] font-bold text-lumos-text-secondary hover:text-lumos-yellow transition-colors flex items-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                 <Copy className="w-3 h-3" /> Criar Nova Versão
               </button>
            </div>
          </div>
        </aside>
      </div>

      {/* Add Item Modal */}
      {isCatalogOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-lumos-surface border border-lumos-border w-full max-w-2xl rounded-lumos shadow-2xl flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-lumos-border flex items-center justify-between bg-lumos-bg/30">
              <div>
                <h2 className="text-xl font-black text-lumos-text-primary flex items-center gap-2">
                  <Library className="w-6 h-6 text-lumos-yellow" />
                  Biblioteca: {activeGroup}
                </h2>
                <p className="text-xs text-lumos-text-secondary mt-1 font-semibold uppercase tracking-tight">Utilize itens pré-cadastrados para agilizar sua proposta.</p>
              </div>
              <button 
                onClick={() => setIsCatalogOpen(false)} 
                className="text-lumos-text-secondary hover:bg-lumos-bg p-2 rounded-full transition-all"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 border-b border-lumos-border">
              <div className="relative group">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-lumos-text-secondary group-focus-within:text-lumos-yellow transition-colors" />
                <input 
                  ref={catalogSearchRef}
                  autoFocus
                  className="input-lumos w-full pl-12 py-4 text-base font-medium" 
                  placeholder="Pesquisar por nome ou cargo no catálogo..."
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-2">
              <button 
                onClick={() => addManualItem()}
                className="w-full text-left p-6 rounded-lumos hover:bg-lumos-bg border-2 border-dashed border-gray-200 hover:border-lumos-yellow transition-all flex items-center justify-between group"
              >
                <div className="flex items-center gap-4">
                  <div className="bg-gray-100 p-3 rounded-full text-gray-500 group-hover:bg-lumos-yellow/10 group-hover:text-lumos-yellow transition-colors">
                    <Plus className="w-6 h-6" />
                  </div>
                  <div>
                    <span className="font-black text-lumos-text-primary block">Criar Item Avulso</span>
                    <span className="text-[10px] uppercase font-bold text-lumos-text-secondary">Item personalizado não constante no catálogo</span>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-lumos-yellow transition-all" />
              </button>

              <div className="pt-4 pb-2 text-[10px] font-black uppercase text-lumos-text-secondary tracking-widest flex items-center gap-2">
                <div className="h-px flex-1 bg-lumos-border" />
                Sugestões do Catálogo
                <div className="h-px flex-1 bg-lumos-border" />
              </div>

              <div className="grid grid-cols-1 gap-1">
                {catalogItems
                  .filter(c => c.item_group === activeGroup && c.name.toLowerCase().includes(catalogSearch.toLowerCase()))
                  .map(c => (
                    <button 
                      key={c.id} 
                      onClick={() => addCatalogItem(c)}
                      className="w-full text-left p-5 rounded-lumos hover:bg-lumos-bg border border-transparent hover:border-lumos-border flex items-center justify-between group transition-all"
                    >
                      <div className="flex flex-col">
                        <span className="font-bold text-lumos-text-primary text-sm group-hover:text-lumos-yellow transition-colors">{c.name}</span>
                        <span className="text-[9px] font-black text-lumos-text-secondary uppercase tracking-tight">{c.subcategory}</span>
                      </div>
                      <div className="text-right flex flex-col items-end">
                        <span className="text-sm font-black text-lumos-text-primary">{c.default_unit_cost ? formatCurrency(c.default_unit_cost) : 'A definir'}</span>
                        <span className="text-[9px] font-black text-lumos-text-secondary uppercase">{c.unit_label}</span>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}
      <GoogleDriveAuthModal 
        isOpen={isDriveModalOpen}
        onClose={() => setIsDriveModalOpen(false)}
        onAuthorize={login}
        onSkip={() => handleGenerateAndBackup(false)}
      />
    </div>
  );
}

// Low-level Save Status Event Bridge
const notifySaveStatus = (status: 'idle' | 'saving' | 'saved' | 'error') => {
  window.dispatchEvent(new CustomEvent('budget-save-status', { detail: status }));
  if (status === 'saved' || status === 'error') {
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('budget-save-status', { detail: 'idle' }));
    }, 3000);
  }
};

const SavingIndicator = () => {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  
  useEffect(() => {
    const handleStatus = (e: any) => setStatus(e.detail);
    window.addEventListener('budget-save-status', handleStatus);
    return () => window.removeEventListener('budget-save-status', handleStatus);
  }, []);

  if (status === 'idle') return null;

  return (
    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider mb-1">
      <div className={clsx(
        "w-2 h-2 rounded-full",
        status === 'saving' && "bg-lumos-yellow animate-pulse",
        status === 'saved' && "bg-green-500",
        status === 'error' && "bg-red-500"
      )} />
      <span className={clsx(
        status === 'saving' && "text-lumos-yellow",
        status === 'saved' && "text-green-600",
        status === 'error' && "text-red-500"
      )}>
        {status === 'saving' ? 'Salvando...' : status === 'saved' ? 'Alterações salvas' : 'Erro ao salvar'}
      </span>
    </div>
  );
};

const MainSaveButton = ({ onSave, disabled }: { onSave: () => void, disabled: boolean }) => {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  
  useEffect(() => {
    const handleStatus = (e: any) => setStatus(e.detail);
    window.addEventListener('budget-save-status', handleStatus);
    return () => window.removeEventListener('budget-save-status', handleStatus);
  }, []);

  return (
    <div className="relative group/save">
      <button 
        onClick={onSave} 
        disabled={disabled || status === 'saving'}
        className={clsx(
          "btn-primary flex items-center gap-2 shadow-lg transition-all",
          (disabled || status === 'saving') ? "opacity-30 grayscale cursor-not-allowed shadow-none" : "shadow-lumos-yellow/20"
        )}
      >
        <Save className="w-4 h-4" />
        {status === 'saving' ? 'Gravando...' : 'Salvar Proposta'}
      </button>
    </div>
  );
};
