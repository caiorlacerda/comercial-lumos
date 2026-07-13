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
  StickyNote,
  RotateCcw,
  Calendar,
  MapPin,
  GripVertical
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { 
  BudgetItem, 
  BudgetVersion, 
  VersionFinancials, 
  calcFinancials, 
  formatCurrency 
} from '@/utils/financials';
import { BudgetPDF } from '@/components/editor/BudgetPDF';
import { ServiceOrderPDF } from '@/components/editor/ServiceOrderPDF';
import { pdf } from '@react-pdf/renderer';
import { useGoogleDrive } from '@/hooks/useGoogleDrive';
import GoogleDriveAuthModal from '@/components/editor/GoogleDriveAuthModal';
import { formatBudgetCode } from '@/utils/formatters';
import { syncBudgetApprovalFlow } from '@/utils/financeiro';
import { getPdfFileName } from '@/utils/pdfFileName';
import { debounce } from 'lodash';
import { clsx } from 'clsx';
import { useAuth } from '@/hooks/useAuth';
import { notify, getAdminUserIds } from '@/lib/notifications/notify';
import { NOTIFICATION_EVENTS } from '@/lib/notifications/events';

import Modal from '@/components/common/Modal';
import RichTextEditor from '@/components/common/RichTextEditor';
import Select from '@/components/ui/Select';

const PAYMENT_PRESETS = [
  '7 dias após a emissão da nota',
  '15 dias após a emissão da nota',
  '30 dias após a emissão da nota',
  '45 dias após a emissão da nota',
  '60 dias após a emissão da nota',
];
import { useToast } from '@/context/ToastContext';
import { logAudit } from '@/hooks/useAuditLog';

interface Budget {
  id: string;
  code: string;
  project_name: string;
  category: 'digital' | 'filme' | 'live';
  status: 'rascunho' | 'em_negociacao' | 'aprovado' | 'reprovado';
  client_id: string;
  active_version_id?: string;
  created_by?: string | null;
  clients?: { name: string; agency_name?: string | null };
  is_template?: boolean;
  template_category?: string;
}

function SortableItemRow({ id, isReadOnly, children }: { id: string; isReadOnly: boolean; children: (dragHandle: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  const dragHandle = !isReadOnly ? (
    <button
      {...attributes}
      {...listeners}
      className="text-lumos-text-secondary/30 hover:text-lumos-text-secondary cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
      tabIndex={-1}
    >
      <GripVertical className="w-4 h-4" />
    </button>
  ) : null;
  return (
    <div ref={setNodeRef} style={style} className="group border-b border-lumos-border last:border-0 hover:bg-lumos-bg/30 transition-colors">
      {children(dragHandle)}
    </div>
  );
}

export default function BudgetEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const toast = useToast();
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
  // Criar cliente novo direto do dropdown
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientAgency, setNewClientAgency] = useState('');
  const [savingClient, setSavingClient] = useState(false);
  const [paymentCustom, setPaymentCustom] = useState(false);
  const [previewCode, setPreviewCode] = useState('');
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [templateCategory, setTemplateCategory] = useState('');
  const [availableContacts, setAvailableContacts] = useState<any[]>([]);
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(new Set());

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [activity, setActivity] = useState<{ id: string; action: string; description: string; user_name: string; created_at: string }[]>([]);
  const [showActivity, setShowActivity] = useState(false);
  
  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [isGeneratingOS, setIsGeneratingOS] = useState(false);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [approvalResponse, setApprovalResponse] = useState<{ approved: boolean; approver_name: string | null; approver_notes: string | null; created_at: string } | null>(null);
  const { login, uploadToDrive, isAuthenticated } = useGoogleDrive();
  
  const [briefingTemplates, setBriefingTemplates] = useState<any[]>([]);
  const [isBriefingPopoverOpen, setIsBriefingPopoverOpen] = useState(false);
  const [showBriefingSuggestion, setShowBriefingSuggestion] = useState(false);
  
  // Ref to track dirty state and prevent save loops
  const isDirty = useRef(false);
  const lastLoadedData = useRef<string>('');
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const catalogSearchRef = useRef<HTMLInputElement>(null);
  const briefingPopoverRef = useRef<HTMLDivElement>(null);

  // Close briefing popover on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreMenuOpen(false);
      }
      if (briefingPopoverRef.current && !briefingPopoverRef.current.contains(event.target as Node)) {
        setIsBriefingPopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch briefing templates
  useEffect(() => {
    async function fetchBriefingTemplates() {
      const { data } = await supabase
        .from('briefing_templates')
        .select('*')
        .order('name');
      setBriefingTemplates(data || []);
    }
    fetchBriefingTemplates();
  }, []);

  // Show suggestion for new budgets with empty briefing
  useEffect(() => {
    if (isDraft && budget?.category && (!version?.notes_client || version.notes_client.trim() === '')) {
      setShowBriefingSuggestion(true);
    } else {
      setShowBriefingSuggestion(false);
    }
  }, [isDraft, budget?.category, version?.notes_client]);

  // Briefing placeholders mapping
  const briefingPlaceholders: Record<string, string> = {
    digital: "Descreva o que o cliente quer comunicar, produto/serviço, público-alvo, tom da marca e se há roteiro fornecido ou a Lumos cria...",
    filme: "Descreva o conceito da peça, o que ela precisa fazer sentir, onde vai veicular, se há agência envolvida e se há roteiro aprovado...",
    live: "Descreva a natureza do evento, audiência esperada, se é público ou privado, e se haverá gravação para edição posterior..."
  };

  const handleLoadBriefingTemplate = (content: string) => {
    if (version?.notes_client && version.notes_client.trim() !== '') {
      if (!confirm('Substituir o briefing atual pelo template?')) return;
    }
    setVersion(v => v ? { ...v, notes_client: content } : null);
    isDirty.current = true;
    setIsBriefingPopoverOpen(false);
    setShowBriefingSuggestion(false);
  };

  const handleQuickLoadTemplate = () => {
    const defaultTemplate = briefingTemplates.find(t => t.category === budget?.category && t.is_default);
    const templateToUse = defaultTemplate || briefingTemplates.find(t => t.category === budget?.category);
    
    if (templateToUse) {
      handleLoadBriefingTemplate(templateToUse.notes_client);
    } else {
      toast.warning(`Nenhum template padrão encontrado para a categoria ${budget?.category}`);
    }
  };

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
    if (!budget?.project_name || budget.project_name === 'Novo Projeto' || budget.project_name.trim() === '') missing.push('Nome do projeto');
    if (!budget?.client_id) missing.push('Cliente');
    if (items.length === 0) missing.push('Pelo menos um item');
    
    return {
      isValid: missing.length === 0,
      missing
    };
  }, [budget, items]);

  const displayCode = useMemo(() => {
    if (isDraft && budget?.code === '----') {
      if (previewCode) {
        return previewCode;
      }
      return '#----';
    }
    return formatBudgetCode(budget?.code || '');
  }, [isDraft, budget?.code, previewCode]);

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

  // Cria um cliente novo direto do dropdown e já seleciona no orçamento
  async function handleCreateClient() {
    const name = newClientName.trim();
    if (!name) return;
    setSavingClient(true);
    try {
      const { data, error } = await supabase
        .from('clients')
        .insert({ name, agency_name: newClientAgency.trim() || null })
        .select('*')
        .single();
      if (error) throw error;
      setClients(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      updateBudget({ client_id: data.id });
      fetchContactsForClient(data.id, true);
      setShowNewClient(false);
      setNewClientName('');
      setNewClientAgency('');
      toast.success('Cliente criado!');
    } catch (err: any) {
      console.error(err);
      toast.error('Não foi possível criar o cliente.');
    } finally {
      setSavingClient(false);
    }
  }

  async function initNewBudget() {
    setIsDraft(true);
    setLoading(true);
    try {
      // Busca a prévia informativa do próximo código sem persistir
      try {
        const { data: newCode } = await supabase.rpc('next_budget_code');
        if (newCode) {
          setPreviewCode(newCode);
        }
      } catch (err) {
        console.error('Error fetching preview code:', err);
      }

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
        payment_terms: '60 dias após a emissão da nota'
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
      setExpandedDescriptions(new Set((itemsData || []).filter((i: any) => i.description).map((i: any) => i.id)));

      // Load activity history (fails silently if table doesn't exist)
      supabase.from('budget_activity').select('*').eq('budget_id', budgetData.id).order('created_at', { ascending: false }).limit(30)
        .then(({ data }) => { if (data) setActivity(data); });

      // Load approval response if version has a public token
      if (targetVersion.public_token) {
        supabase.from('budget_approvals').select('approved, approver_name, approver_notes, created_at')
          .eq('version_id', targetVersion.id).maybeSingle()
          .then(({ data }) => { if (data) setApprovalResponse(data); });
      }

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

  const logActivity = async (action: string, description: string) => {
    if (!budget?.id || isDraft) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from('app_users').select('full_name').eq('auth_user_id', user?.id).single();
      const { data: row } = await supabase.from('budget_activity').insert({
        budget_id: budget.id,
        user_name: (profile as any)?.full_name || user?.email || 'Usuário',
        action,
        description,
      }).select().single();
      if (row) setActivity(prev => [row, ...prev]);
    } catch { /* silently ignore if table doesn't exist */ }
  };

  // Persistent Save Logic
  const handleSave = async (showNotification: boolean = true) => {
    if (!budget || !version || !isDirty.current) return;
    
    if (showNotification) notifySaveStatus('saving');
    try {
      let currentBudgetId = budget.id;
      let currentVersionId = version.id;

      if (isDraft) {
        let finalCode = budget.code;

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
        
        // Atualiza o estado local do orçamento com o código real gerado pelo banco
        setBudget(prev => prev ? { ...prev, code: bData.code } : null);

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
            validity_days: version.validity_days,
            logistics_date: version.logistics_date || null,
            logistics_time: version.logistics_time || null,
            logistics_location: version.logistics_location || null
          })
          .select()
          .single();
        
        if (vError) throw vError;
        currentVersionId = vData.id;

        await supabase.from('budgets').update({ active_version_id: currentVersionId }).eq('id', currentBudgetId);
        logAudit('budget_created', `Orçamento "${budget.project_name}" (#${finalCode}) criado`, { budget_id: currentBudgetId });

        // Trigger notification ORCAMENTO_CRIADO
        const admins = await getAdminUserIds();
        await notify({
          userIds: admins,
          event: NOTIFICATION_EVENTS.ORCAMENTO_CRIADO,
          title: 'Novo orçamento criado',
          body: `Orçamento "${budget.project_name}" (#${finalCode}) criado por ${profile?.full_name || 'Funcionário'}.`,
          link: `/orcamentos/${currentBudgetId}`
        });

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
            validity_days: version.validity_days,
            logistics_date: version.logistics_date || null,
            logistics_time: version.logistics_time || null,
            logistics_location: version.logistics_location || null
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

      if (budget.status === 'aprovado' && financials) {
        await syncBudgetApprovalFlow(currentBudgetId, financials.valorFinal);
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
      
      // Sync to Receivables if approved
      if (updates.status === 'aprovado' && financials) {
        await syncBudgetApprovalFlow(budget.id, financials.valorFinal);
        // A notificação ORCAMENTO_APROVADO é disparada pelo trigger de banco
        // trg_budget_approved_notification. Não notificar aqui para evitar duplicidade.
      }


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
          validity_days: version.validity_days,
          logistics_date: version.logistics_date || null,
          logistics_time: version.logistics_time || null,
          logistics_location: version.logistics_location || null
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
      logActivity('version_created', `Nova versão criada (v${nextNumber})`);

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

        // Atualiza o estado local do orçamento com o código real gerado pelo banco
        setBudget(prev => prev ? { ...prev, code: bData.code } : null);

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
            validity_days: version?.validity_days || 7,
            logistics_date: version?.logistics_date || null,
            logistics_time: version?.logistics_time || null,
            logistics_location: version?.logistics_location || null
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
      toast.success('Orçamento salvo como padrão com sucesso!');
    } catch (err) {
      console.error('Error saving as template:', err);
      notifySaveStatus('error');
      toast.error('Erro ao salvar como template: ' + (err as any).message);
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

  const handleDragEnd = async (event: DragEndEvent, group: BudgetItem['item_group']) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const groupItems = items.filter(i => i.item_group === group);
    const oldIndex = groupItems.findIndex(i => i.id === active.id);
    const newIndex = groupItems.findIndex(i => i.id === over.id);
    const reordered = arrayMove(groupItems, oldIndex, newIndex);

    const otherItems = items.filter(i => i.item_group !== group);
    const updatedItems = [...otherItems, ...reordered.map((item, idx) => ({ ...item, sort_order: idx }))];
    setItems(updatedItems);

    if (!isDraft && version) {
      notifySaveStatus('saving');
      try {
        await Promise.all(
          reordered.map((item, idx) =>
            supabase.from('budget_items').update({ sort_order: idx }).eq('id', item.id)
          )
        );
        notifySaveStatus('saved');
      } catch (err) {
        console.error('Error saving sort order:', err);
        notifySaveStatus('error');
      }
    } else {
      isDirty.current = true;
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
    // Cancel any pending debounced save for this item to prevent re-insertion after delete
    const timerKey = `item-${id}`;
    if (saveTimers.current[timerKey]) {
      clearTimeout(saveTimers.current[timerKey]);
      delete saveTimers.current[timerKey];
    }
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

    if ('unit_cost' in updates) updates.unit_cost = Math.max(0, updates.unit_cost as number);
    if ('quantity' in updates) updates.quantity = Math.max(0, updates.quantity as number);

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
      logActivity('pdf_generated', `PDF gerado: ${fileName}`);

      // Backup if needed
      const isNegotiating = budget.status === 'em_negociacao';

      if (shouldBackup && isNegotiating) {
        try {
          await uploadToDrive(blob, fileName);
          toast.success('PDF salvo no Google Drive ✓');
        } catch (uploadErr) {
          console.error('Drive upload failed:', uploadErr);
        }
      }
    } catch (err) {
      console.error('PDF generation error:', err);
      toast.error('Erro ao gerar o PDF da proposta.');
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

  const handleGenerateOS = async () => {
    if (!budget || !version) return;
    setIsGeneratingOS(true);
    try {
      const fileName = getPdfFileName(
        budget.code,
        budget.clients?.name || 'Cliente',
        budget.clients?.agency_name,
        budget.project_name,
        'OS_'
      );
      const blob = await pdf(
        <ServiceOrderPDF
          budget={budget}
          version={version}
          contact={selectedContact}
          items={items}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('OS generation error:', err);
      toast.error('Erro ao gerar a O.S.');
    } finally {
      setIsGeneratingOS(false);
    }
  };

  const updateBudget = (updates: Partial<Budget>) => {
    if (isReadOnly) return;
    if (updates.status && budget?.status && updates.status !== budget.status) {
      const labels: Record<string, string> = { rascunho: 'Rascunho', em_negociacao: 'Em Negociação', aprovado: 'Aprovado', reprovado: 'Reprovado' };
      logActivity('status_changed', `Status alterado: ${labels[budget.status]} → ${labels[updates.status]}`);
    }
    setBudget(prev => prev ? { ...prev, ...updates } : null);
    if (!isDraft) triggerSave('budget', updates);
    else isDirty.current = true;
  };

  const handleGeneratePublicLink = async () => {
    if (!version) return;
    setIsGeneratingLink(true);
    try {
      let token = version.public_token;

      if (!token) {
        const { data, error } = await supabase
          .from('budget_versions')
          .update({ public_token: crypto.randomUUID() })
          .eq('id', version.id)
          .select('public_token')
          .single();

        if (error) throw error;
        token = data.public_token;
        setVersion(prev => prev ? { ...prev, public_token: token } : null);
      }

      const url = `${window.location.origin}/aprovar/${token}`;
      await navigator.clipboard.writeText(url);
      toast.success('Link copiado para a área de transferência!');
    } catch {
      toast.error('Erro ao gerar link público.');
    } finally {
      setIsGeneratingLink(false);
    }
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 lg:sticky lg:top-0 lg:z-20 lg:bg-lumos-bg/95 lg:backdrop-blur-sm lg:py-4 lg:-mx-8 lg:px-8 lg:-mt-8 lg:mb-4 lg:border-b lg:border-lumos-border/50 transition-all">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/')} className="p-2 hover:bg-lumos-bg rounded-full transition-colors text-lumos-text-secondary">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <span 
                className="font-mono text-lumos-yellow text-xs px-2.5 py-1.5 bg-lumos-yellow/10 rounded font-bold border border-lumos-yellow/20 flex-shrink-0 whitespace-nowrap"
              >
                {displayCode}
              </span>
              <input 
                disabled={isReadOnly}
                className="bg-transparent border-none text-2xl font-bold focus:ring-0 p-0 text-lumos-text-primary w-full max-w-md disabled:opacity-70"
                value={budget?.project_name || ''}
                onChange={(e) => updateBudget({ project_name: e.target.value })}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
              <Select
                disabled={isReadOnly}
                className="w-auto! max-w-[240px] text-xs font-semibold text-lumos-text-secondary hover:text-lumos-text-primary px-2.5 py-1 rounded-lumos bg-lumos-surface border border-lumos-border hover:border-lumos-yellow/40 transition-colors"
                value={budget?.client_id || ''}
                onChange={(v) => {
                  if (v === '__new__') { setShowNewClient(true); return; }
                  updateBudget({ client_id: v });
                  if (v) {
                    fetchContactsForClient(v, true);
                  } else {
                    setAvailableContacts([]);
                    setVersion(vv => vv ? { ...vv, contact_id: undefined } : null);
                  }
                }}
                options={[
                  { value: '', label: 'Selecionar Empresa' },
                  ...clients.map(c => ({ value: c.id, label: c.agency_name ? `${c.agency_name} + ${c.name}` : c.name })),
                  { value: '__new__', label: '＋ Novo cliente' },
                ]}
              />
              {budget?.client_id && (
                <Select
                  disabled={isReadOnly}
                  className="w-auto! max-w-[190px] text-xs font-semibold text-lumos-text-secondary hover:text-lumos-text-primary px-2.5 py-1 rounded-lumos bg-lumos-surface border border-lumos-border hover:border-lumos-yellow/40 transition-colors"
                  value={version?.contact_id || ''}
                  onChange={(v) => updateVersion({ contact_id: v })}
                  options={[
                    { value: '', label: 'Contato' },
                    ...availableContacts.map(c => ({ value: c.id, label: `${c.name}${c.role ? ` · ${c.role}` : ''}` })),
                  ]}
                />
              )}
              <Select
                disabled={isReadOnly}
                className="w-auto! uppercase text-xs font-semibold text-lumos-text-secondary hover:text-lumos-text-primary px-2.5 py-1 rounded-lumos bg-lumos-surface border border-lumos-border hover:border-lumos-yellow/40 transition-colors"
                value={budget?.category || 'digital'}
                onChange={(v) => updateBudget({ category: v as any })}
                options={[
                  { value: 'digital', label: 'Digital' },
                  { value: 'filme', label: 'Filme' },
                  { value: 'live', label: 'Live' },
                ]}
              />
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lumos bg-lumos-yellow/10 border border-lumos-yellow/25">
                <Clock className="w-3 h-3 text-lumos-yellow flex-shrink-0" />
                <Select
                  className="w-auto! text-xs font-black uppercase text-lumos-yellow hover:text-lumos-yellow"
                  value={version?.id || ''}
                  onChange={(v) => fetchBudgetData(budget!.id, v)}
                  options={[
                    ...versions.map(v => ({ value: v.id, label: `Versão ${v.version_number}${v.id === budget?.active_version_id ? ' (Ativa)' : ''}` })),
                    ...(isDraft ? [{ value: 'draft-v1', label: 'Versão 1 (Rascunho)' }] : []),
                  ]}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 max-lg:fixed max-lg:bottom-0 max-lg:left-0 max-lg:right-0 max-lg:bg-lumos-surface max-lg:border-t max-lg:p-4 max-lg:pb-[calc(1rem+env(safe-area-inset-bottom))] max-lg:z-30 max-lg:justify-end lg:static lg:p-0 lg:border-0">
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
                <div className="absolute top-full mt-2 max-lg:bottom-full max-lg:top-auto max-lg:mb-2 right-0 w-64 bg-black/90 text-white p-3 rounded-lumos border border-white/10 shadow-2xl opacity-0 group-hover/save:opacity-100 transition-opacity z-[100] pointer-events-none">
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
            <div className="flex items-center justify-between border-b border-lumos-border pb-4">
              <div className="flex items-center gap-2 text-lumos-text-primary">
                <FileText className="w-5 h-5" />
                <h3 className="font-bold">Briefing & Condições</h3>
              </div>
              
              {!isReadOnly && (
                <div className="relative" ref={briefingPopoverRef}>
                  <button 
                    onClick={() => setIsBriefingPopoverOpen(!isBriefingPopoverOpen)}
                    className="flex items-center gap-1.5 text-[10px] font-black uppercase text-lumos-text-secondary hover:text-lumos-yellow transition-colors group"
                  >
                    <RotateCcw className={clsx("w-3 h-3 transition-transform duration-500", isBriefingPopoverOpen && "rotate-180")} />
                    Carregar Template
                  </button>

                  {isBriefingPopoverOpen && (
                    <div className="absolute right-0 mt-2 w-64 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl z-50 py-2 animate-in fade-in zoom-in-95 duration-200">
                      <div className="px-4 py-2 border-b border-lumos-border mb-1">
                        <span className="text-[9px] font-bold text-lumos-text-secondary uppercase tracking-widest">Templates de Briefing</span>
                      </div>
                      <div className="max-h-60 overflow-auto">
                        {briefingTemplates.length === 0 ? (
                          <div className="px-4 py-3 text-xs text-lumos-text-secondary italic">Nenhum template cadastrado</div>
                        ) : (
                          briefingTemplates
                            .filter(t => t.category === budget?.category || !budget?.category)
                            .map(template => (
                              <button
                                key={template.id}
                                onClick={() => handleLoadBriefingTemplate(template.notes_client)}
                                className="w-full text-left px-4 py-2.5 hover:bg-lumos-bg transition-colors space-y-0.5 group"
                              >
                                <div className="text-[11px] font-bold text-lumos-text-primary group-hover:text-lumos-yellow transition-colors">{template.name}</div>
                                <div className="text-[9px] text-lumos-text-secondary uppercase">{template.category}</div>
                              </button>
                            ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {showBriefingSuggestion && !isReadOnly && (
              <div className="bg-lumos-yellow/10 border border-lumos-yellow/20 rounded-lumos p-3 flex items-center justify-between animate-in slide-in-from-top-2 duration-300">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-lumos-yellow flex items-center justify-center text-lumos-bg">
                    <RotateCcw className="w-3.5 h-3.5" />
                  </div>
                  <p className="text-xs font-bold text-lumos-text-primary">
                    Template disponível para <span className="uppercase">{budget?.category}</span>. Deseja carregar?
                  </p>
                </div>
                <button 
                  onClick={handleQuickLoadTemplate}
                  className="px-3 py-1 bg-lumos-yellow text-lumos-bg text-[10px] font-black uppercase rounded-full hover:scale-105 active:scale-95 transition-all shadow-sm"
                >
                  Carregar
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-2 block flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" /> Proposta para o Cliente (PDF)
                  </label>
                  <RichTextEditor
                    editable={!isReadOnly}
                    minHeight={160}
                    value={version?.notes_client || ''}
                    onChange={(html) => {
                      setVersion(v => v ? { ...v, notes_client: html } : null);
                      isDirty.current = true;
                    }}
                  />
                  
                  {/* Logistics Fields */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 animate-in fade-in duration-500">
                    <div>
                      <label className="text-[9px] font-bold text-lumos-text-secondary uppercase mb-1.5 block flex items-center gap-1">
                        <Calendar className="w-2.5 h-2.5" /> Data(s)
                      </label>
                      <input 
                        disabled={isReadOnly}
                        className="input-lumos w-full text-xs py-2 placeholder:text-gray-300 disabled:opacity-70"
                        placeholder="A definir"
                        value={version?.logistics_date || ''}
                        onChange={(e) => {
                          setVersion(v => v ? { ...v, logistics_date: e.target.value } : null);
                          isDirty.current = true;
                        }}
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-lumos-text-secondary uppercase mb-1.5 block flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" /> Horário
                      </label>
                      <input 
                        disabled={isReadOnly}
                        className="input-lumos w-full text-xs py-2 placeholder:text-gray-300 disabled:opacity-70"
                        placeholder="A definir"
                        value={version?.logistics_time || ''}
                        onChange={(e) => {
                          setVersion(v => v ? { ...v, logistics_time: e.target.value } : null);
                          isDirty.current = true;
                        }}
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-lumos-text-secondary uppercase mb-1.5 block flex items-center gap-1">
                        <MapPin className="w-2.5 h-2.5" /> Local
                      </label>
                      <input 
                        disabled={isReadOnly}
                        className="input-lumos w-full text-xs py-2 placeholder:text-gray-300 disabled:opacity-70"
                        placeholder="A definir"
                        value={version?.logistics_location || ''}
                        onChange={(e) => {
                          setVersion(v => v ? { ...v, logistics_location: e.target.value } : null);
                          isDirty.current = true;
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-2 block flex items-center gap-1">
                    <Info className="w-3 h-3" /> Observações Internas (Não aparecem no PDF)
                  </label>
                  <RichTextEditor
                    editable={!isReadOnly}
                    minHeight={80}
                    value={version?.notes_internal || ''}
                    onChange={(html) => {
                      setVersion(v => v ? { ...v, notes_internal: html } : null);
                      isDirty.current = true;
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-2 block">Pagamento</label>
                    {(() => {
                      const pv = version?.payment_terms || '';
                      const isCustom = paymentCustom || (pv !== '' && !PAYMENT_PRESETS.includes(pv));
                      return (
                        <>
                          <Select
                            disabled={isReadOnly}
                            className="input-lumos w-full text-xs disabled:opacity-70"
                            value={isCustom ? '__custom__' : pv}
                            onChange={(v) => {
                              if (v === '__custom__') { setPaymentCustom(true); return; }
                              setPaymentCustom(false);
                              setVersion(vv => vv ? { ...vv, payment_terms: v } : null);
                              isDirty.current = true;
                            }}
                            options={[
                              { value: '', label: 'Selecionar Pagamento' },
                              ...PAYMENT_PRESETS.map(o => ({ value: o, label: o })),
                              { value: '__custom__', label: 'Personalizado…' },
                            ]}
                          />
                          {isCustom && (
                            <div className="flex items-center gap-2 mt-2">
                              <input
                                type="number" min={0} disabled={isReadOnly}
                                className="input-lumos w-24 h-9 text-xs disabled:opacity-70"
                                placeholder="Dias"
                                value={pv.match(/\d+/)?.[0] || ''}
                                onChange={(e) => {
                                  const n = e.target.value.replace(/\D/g, '');
                                  setVersion(vv => vv ? { ...vv, payment_terms: n ? `${n} dias após a emissão da nota` : '' } : null);
                                  isDirty.current = true;
                                }}
                              />
                              <span className="text-xs text-lumos-text-secondary">dias após a emissão da nota</span>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-2 block">Validade (Dias)</label>
                    <Select
                      disabled={isReadOnly}
                      className="input-lumos w-full text-xs disabled:opacity-70"
                      value={String(version?.validity_days || 7)}
                      onChange={(v) => {
                        setVersion(vv => vv ? { ...vv, validity_days: Number(v) } : null);
                        isDirty.current = true;
                      }}
                      options={[
                        ...Array.from({ length: 30 }, (_, i) => i + 1).map(day => ({ value: String(day), label: `${day} ${day === 1 ? 'dia' : 'dias'}` })),
                        ...(version?.validity_days && (version.validity_days < 1 || version.validity_days > 30)
                          ? [{ value: String(version.validity_days), label: `${version.validity_days} dias` }] : []),
                      ]}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {(['equipe', 'equipamentos', 'producao', 'edicao'] as const).map(group => {
            const groupItems = items.filter(i => i.item_group === group);
            return (
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
              <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={(e) => handleDragEnd(e, group)}>
              <SortableContext items={groupItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
              <div className="divide-y divide-lumos-border">
                {groupItems.length === 0 ? (
                  <div className="p-8 text-center text-xs text-lumos-text-secondary italic">
                    Nenhum item adicionado a este grupo.
                  </div>
                ) : groupItems.map(item => {
                  const isExpanded = expandedDescriptions.has(item.id);
                  const toggleDescription = () => {
                    const newSet = new Set(expandedDescriptions);
                    if (newSet.has(item.id)) newSet.delete(item.id);
                    else newSet.add(item.id);
                    setExpandedDescriptions(newSet);
                  };
                  return (
                  <SortableItemRow key={item.id} id={item.id} isReadOnly={isReadOnly}>
                    {(dragHandle) => (
                      <>
                        <div className="flex items-center gap-2 px-4 py-3">
                          {dragHandle}
                          <div className="flex-1 min-w-0">
                            <input
                              disabled={isReadOnly}
                              className="bg-transparent border-none w-full p-0 font-medium text-lumos-text-primary focus:ring-0 placeholder:text-lumos-text-secondary/30 disabled:opacity-70"
                              value={item.name}
                              onChange={(e) => updateItem(item.id, { name: e.target.value })}
                              placeholder="Nome do item..."
                            />
                          </div>
                          <div className="w-32 flex-shrink-0">
                            <div className="flex items-center gap-1 border-b border-transparent hover:border-lumos-border transition-colors">
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
                          <div className="w-16 flex-shrink-0">
                            <input
                              disabled={isReadOnly}
                              type="number"
                              className="bg-transparent border-none w-full p-0 text-center text-sm font-bold focus:ring-0 text-lumos-text-primary disabled:opacity-70"
                              value={item.quantity}
                              onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) })}
                            />
                          </div>
                          <div className="w-24 flex-shrink-0">
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
                          <div className="w-32 flex-shrink-0 text-right font-mono text-sm font-bold text-lumos-text-primary">
                            {formatCurrency(item.unit_cost * item.quantity)}
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                            <button
                              onClick={toggleDescription}
                              className={clsx(
                                "p-2 transition-colors rounded-full",
                                isExpanded || item.description
                                  ? "text-lumos-yellow bg-lumos-yellow/10"
                                  : "text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-yellow/5"
                              )}
                              title={isExpanded ? "Fechar nota" : "Abrir nota"}
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
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
                        {isExpanded && (
                          <div className="px-10 pb-3 animate-in slide-in-from-top-1 duration-200">
                            <textarea
                              disabled={isReadOnly}
                              className="w-full bg-lumos-bg/50 border border-lumos-border/50 rounded-lumos p-3 text-xs text-lumos-text-primary focus:border-lumos-yellow/50 focus:ring-0 resize-none h-[60px] placeholder:text-lumos-text-secondary/30"
                              placeholder="Adicione uma nota para este item..."
                              value={item.description || ''}
                              onChange={(e) => updateItem(item.id, { description: e.target.value })}
                            />
                          </div>
                        )}
                      </>
                    )}
                  </SortableItemRow>
                  );
                })}
              </div>
              </SortableContext>
              </DndContext>
            </div>
          )})}

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

                <button
                  onClick={handleGenerateOS}
                  disabled={isGeneratingOS}
                  className="btn-secondary w-full py-4 flex items-center justify-center gap-2 font-black uppercase tracking-widest text-[10px] border-lumos-yellow/20 hover:border-lumos-yellow/40"
                >
                  <ClipboardList className="w-4 h-4" />
                  {isGeneratingOS ? 'Preparando...' : 'Gerar O.S'}
                </button>
              </div>
            )}
            
            {!isDraft && (
              <button
                onClick={handleGeneratePublicLink}
                disabled={isGeneratingLink}
                className="btn-secondary w-full py-3 flex items-center justify-center gap-2 font-black uppercase tracking-widest text-[10px] border-lumos-yellow/20 hover:border-lumos-yellow/40 mt-2"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {isGeneratingLink ? 'Gerando...' : version?.public_token ? 'Copiar Link Público' : 'Gerar Link de Aprovação'}
              </button>
            )}

            {/* Approval response */}
            {version?.public_token && (
              <div className={`mt-2 rounded-lumos border p-3 text-[10px] ${
                approvalResponse
                  ? approvalResponse.approved
                    ? 'bg-green-500/5 border-green-500/20'
                    : 'bg-red-500/5 border-red-500/20'
                  : 'bg-lumos-border/10 border-lumos-border'
              }`}>
                <p className={`font-black uppercase tracking-widest mb-1 ${
                  approvalResponse
                    ? approvalResponse.approved ? 'text-green-500' : 'text-red-500'
                    : 'text-lumos-text-secondary'
                }`}>
                  {approvalResponse
                    ? approvalResponse.approved ? '✓ Proposta Aprovada' : '✗ Proposta Recusada'
                    : '⏳ Aguardando Resposta'}
                </p>
                {approvalResponse && (
                  <>
                    {approvalResponse.approver_name && (
                      <p className="text-lumos-text-secondary">Por: <span className="text-lumos-text-primary font-semibold">{approvalResponse.approver_name}</span></p>
                    )}
                    {approvalResponse.approver_notes && (
                      <p className="text-lumos-text-secondary mt-1 italic">"{approvalResponse.approver_notes}"</p>
                    )}
                    <p className="text-lumos-text-secondary mt-1">
                      {new Date(approvalResponse.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </>
                )}
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

          {/* Histórico de atividade */}
          {!isDraft && (
            <div className="card shadow-sm border-lumos-border">
              <button
                onClick={() => setShowActivity(v => !v)}
                className="w-full flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary hover:text-lumos-text-primary transition-colors"
              >
                <span className="flex items-center gap-2"><Clock className="w-3.5 h-3.5" /> Histórico</span>
                {showActivity ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {showActivity && (
                <div className="mt-4 space-y-3">
                  {activity.length === 0 ? (
                    <p className="text-xs text-lumos-text-secondary italic">Nenhuma atividade registrada ainda.</p>
                  ) : activity.map((a) => (
                    <div key={a.id} className="flex gap-2.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-lumos-yellow mt-1.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-lumos-text-primary leading-snug">{a.description}</p>
                        <p className="text-[10px] text-lumos-text-secondary mt-0.5">
                          {a.user_name} · {new Date(a.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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

      {/* Criar cliente novo direto do orçamento */}
      <Modal isOpen={showNewClient} onClose={() => setShowNewClient(false)} title="Novo cliente">
        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-1.5 block">Nome do cliente *</label>
            <input
              autoFocus
              className="input-lumos w-full h-10 text-sm"
              placeholder="Ex.: Shopee"
              value={newClientName}
              onChange={e => setNewClientName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateClient(); }}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-1.5 block">Agência (opcional)</label>
            <input
              className="input-lumos w-full h-10 text-sm"
              placeholder="Ex.: Ampfy"
              value={newClientAgency}
              onChange={e => setNewClientAgency(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateClient(); }}
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={() => setShowNewClient(false)} className="btn-secondary flex-1 h-10">Cancelar</button>
            <button onClick={handleCreateClient} disabled={!newClientName.trim() || savingClient} className="btn-primary flex-1 h-10 flex items-center justify-center gap-2 disabled:opacity-50">
              {savingClient ? <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-black" /> : 'Criar e selecionar'}
            </button>
          </div>
        </div>
      </Modal>
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
