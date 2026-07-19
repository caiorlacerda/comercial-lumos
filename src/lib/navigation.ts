import {
  Users, BookOpen, LayoutDashboard, Settings, FileText, FileStack,
  BarChart3, PieChart, ArrowUpCircle, ArrowDownCircle, Receipt,
  Briefcase, ClipboardList, TrendingUp, Landmark,
  CalendarDays, Truck, Users2, KeyRound, Radio, Megaphone
} from 'lucide-react';
import type { SectionType } from '@/context/LayoutContext';

export interface NavItem { 
  icon: any; 
  label: string; 
  path: string; 
  end?: boolean; 
  permission?: string; 
}

export interface NavContext { 
  can: (p: string) => boolean; 
  isAdmin: boolean; 
}

export interface Section { 
  id: SectionType; 
  title: string; 
  items: NavItem[]; 
  visibleWhen: (ctx: NavContext) => boolean; 
}

export const NAV_SECTIONS: Section[] = [
  {
    id: 'comercial',
    title: 'COMERCIAL',
    visibleWhen: ({ isAdmin }) => isAdmin,
    items: [
      { icon: LayoutDashboard, label: 'Dashboard Comercial', path: '/comercial', end: true },
      { icon: Users, label: 'Clientes', path: '/clientes' },
      { icon: BookOpen, label: 'Orçamentos', path: '/orcamentos' },
      { icon: FileText, label: 'Catálogo', path: '/catalogo' },
      { icon: FileStack, label: 'Templates', path: '/templates' },
    ],
  },
  {
    id: 'producao',
    title: 'PRODUÇÃO',
    visibleWhen: ({ can }) => can('ordem_do_dia') || can('fornecedores') || can('custos_projeto') || can('cronograma_edicao'),
    items: [
      // Calendário, Board, Timeline e Cronograma são "views" acessadas por
      // pills no topo das páginas de produção (ProducaoViewsNav), não itens
      // de sidebar — estilo ClickUp. "Projetos" leva à Visão Geral (/producao),
      // que é a visão "Todos os Projetos"; na sidebar ele vira um dropdown
      // com a árvore de clientes → projetos.
      { icon: ClipboardList, label: 'Projetos', path: '/producao', permission: 'ordem_do_dia', end: true },
      { icon: CalendarDays, label: 'Ordem do Dia', path: '/ordem-do-dia', permission: 'ordem_do_dia' },
      { icon: Truck, label: 'Fornecedores', path: '/producao/fornecedores', permission: 'fornecedores' },
      { icon: FileStack, label: 'Templates de Tarefas', path: '/producao/templates-tarefas', permission: 'admin' },
      { icon: KeyRound, label: 'Acessos & Senhas', path: '/producao/acessos', permission: 'acessos' },
      // Cronograma de Edição no sidebar para todos que têm a permissão
      // (admin, produção e editor). Admin/produção também acessam pelas views.
      { icon: CalendarDays, label: 'Cronograma de Edição', path: '/producao/cronograma-edicao', permission: 'cronograma_edicao' },
    ],
  },
  {
    id: 'financeiro',
    title: 'FINANCEIRO',
    visibleWhen: ({ can, isAdmin }) => isAdmin || can('custos_projeto') || can('reembolso'),
    items: [
      { icon: BarChart3, label: 'Dashboard Financeiro', path: '/financeiro', permission: 'financeiro_dashboard', end: true },
      { icon: TrendingUp, label: 'Fluxo de Caixa', path: '/financeiro/fluxo-de-caixa', permission: 'financeiro_admin' },
      { icon: Landmark, label: 'Custos Fixos', path: '/financeiro/custos-fixos', permission: 'financeiro_admin' },
      { icon: Briefcase, label: 'Custos de Projeto', path: '/financeiro/custos-projeto', permission: 'custos_projeto' },
      { icon: ArrowUpCircle, label: 'Contas a Pagar', path: '/financeiro/contas-pagar', permission: 'financeiro_admin' },
      { icon: ArrowDownCircle, label: 'Contas a Receber', path: '/financeiro/contas-receber', permission: 'financeiro_admin' },
      { icon: Receipt, label: 'Reembolso', path: '/financeiro/reembolso', permission: 'reembolso' },
      { icon: PieChart, label: 'Relatórios', path: '/financeiro/relatorios', permission: 'financeiro_admin' },
      { icon: Settings, label: 'Configuração', path: '/financeiro/configuracao', permission: 'financeiro_admin' },
    ],
  },
  {
    id: 'configuracoes',
    title: 'CONFIGURAÇÕES',
    visibleWhen: () => true,
    items: [
      { icon: Users2, label: 'Equipe', path: '/equipe' },
      { icon: Megaphone, label: 'Comunicados', path: '/comunicados', permission: 'admin' },
      { icon: Radio, label: 'Monitoramento', path: '/monitoramento', permission: 'admin' },
      { icon: Settings, label: 'Configurações', path: '/configuracoes' },
      { icon: ClipboardList, label: 'Auditoria', path: '/auditoria', permission: 'admin' },
    ],
  },
];

export function getSectionItems(sectionId: SectionType, ctx: NavContext): NavItem[] {
  const section = NAV_SECTIONS.find(s => s.id === sectionId);
  if (!section) return [];
  return section.items.filter(item => {
    if (!item.permission) return true;
    if (item.permission === 'admin') return ctx.isAdmin;
    if (item.permission === 'financeiro_admin') return ctx.isAdmin;
    if (item.permission === 'financeiro_dashboard') return ctx.isAdmin;
    // Item exclusivo de quem só tem o cronograma (papel editor): quem tem
    // ordem_do_dia acessa o Cronograma pelas views, não pela sidebar.
    if (item.permission === 'cronograma_edicao_only') {
      return ctx.can('cronograma_edicao') && !ctx.can('ordem_do_dia');
    }
    return ctx.can(item.permission);
  });
}

export function getVisibleSections(ctx: NavContext): Section[] {
  return NAV_SECTIONS.filter(s => s.visibleWhen(ctx) && getSectionItems(s.id, ctx).length > 0);
}
