import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Plus, Download, Pencil, Trash2, Copy, Palette, Inbox, Search } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { useVisualNovo, definirVisualNovo } from '@/lib/visualNovo';
import Button, { IconButton } from '@/components/ui/Button';
import StatusChip, { type StatusTone } from '@/components/ui/StatusChip';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Tabs, SegmentedControl } from '@/components/ui/Tabs';
import PageHeader from '@/components/ui/PageHeader';
import { Panel, StatCard } from '@/components/ui/Panel';
import DataTable, { type Column } from '@/components/ui/DataTable';
import ActionMenu from '@/components/ui/ActionMenu';
import EmptyState, { Skeleton } from '@/components/ui/EmptyState';
import Select from '@/components/ui/Select';
import Modal from '@/components/common/Modal';

// Guia de design da plataforma (só admin): todas as peças padrão, no tema e visual atuais.
// É a referência para aprovar o visual e para construir telas novas.

function Secao({ id, titulo, children }: { id: string; titulo: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-10 scroll-mt-6">
      <h2 className="mb-4 border-b border-lumos-border pb-2 text-lg font-semibold text-lumos-text-primary">{titulo}</h2>
      {children}
    </section>
  );
}

function Amostra({ legenda, children }: { legenda: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <p className="mb-2 text-xs uppercase tracking-wider text-lumos-text-secondary">{legenda}</p>
      {children}
    </div>
  );
}

interface Linha { id: string; projeto: string; cliente: string; valor: string; status: string; tom: StatusTone }

const LINHAS: Linha[] = [
  { id: '1', projeto: 'Webinar Open Arena', cliente: 'Alice Saúde', valor: 'R$ 10.000,00', status: 'Aprovado', tom: 'ok' },
  { id: '2', projeto: 'Festa de Fim de Ano 2026', cliente: 'Jotacom', valor: 'R$ 22.323,81', status: 'Em revisão', tom: 'review' },
  { id: '3', projeto: 'Campanha Black Friday', cliente: 'Midea', valor: 'R$ 50.000,00', status: 'Reprovado', tom: 'danger' },
  { id: '4', projeto: 'Captação Hospital', cliente: 'Hospital Albert Einstein', valor: 'R$ 436.661,54', status: 'Pendente', tom: 'warn' },
];

const TONS: { tom: StatusTone; nome: string; uso: string }[] = [
  { tom: 'ok', nome: 'ok', uso: 'sucesso, pago, aprovado' },
  { tom: 'danger', nome: 'danger', uso: 'erro, atraso, perigo' },
  { tom: 'warn', nome: 'warn', uso: 'atenção, pendente' },
  { tom: 'info', nome: 'info', uso: 'informação, em andamento' },
  { tom: 'review', nome: 'review', uso: 'em revisão' },
  { tom: 'brand', nome: 'brand', uso: 'destaque da marca' },
  { tom: 'neutral', nome: 'neutral', uso: 'sem significado especial' },
];

export default function DesignSystem() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const visualNovo = useVisualNovo();
  const [aba, setAba] = useState('receber');
  const [forma, setForma] = useState('lista');
  const [estadoTabela, setEstadoTabela] = useState('dados');
  const [select, setSelect] = useState('todos');
  const [janela, setJanela] = useState<null | 'sm' | 'md' | 'lg'>(null);

  if (!isAdmin) return <Navigate to="/" replace />;

  const colunas: Column<Linha>[] = [
    { key: 'projeto', header: 'Projeto', cell: (r) => <span className="font-medium">{r.projeto}</span> },
    { key: 'cliente', header: 'Cliente', cell: (r) => <span className="text-lumos-text-secondary">{r.cliente}</span> },
    { key: 'valor', header: 'Valor', align: 'right', className: 'tabular-nums', cell: (r) => r.valor },
    { key: 'status', header: 'Status', cell: (r) => <StatusChip tone={r.tom} dot>{r.status}</StatusChip> },
    {
      key: 'acoes', header: '', align: 'right', width: 'w-12',
      cell: () => (
        <ActionMenu items={[
          { label: 'Editar', icon: <Pencil />, onClick: () => toast.info('Editar') },
          { label: 'Duplicar', icon: <Copy />, onClick: () => toast.info('Duplicar') },
          { label: 'Excluir', icon: <Trash2 />, danger: true, onClick: () => toast.error('Excluir') },
        ]} />
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl pb-16">
      <PageHeader
        title="Guia de design"
        subtitle="Todas as peças padrão da plataforma, no tema e no visual que você está usando agora."
        icon={<Palette className="size-7" />}
      />

      {!visualNovo && (
        <Panel className="mb-8 border-warn/40">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-lumos-text-primary">O visual novo está <b>desligado</b>. Ligue para ver as peças como ficarão para o time.</p>
            <Button size="sm" onClick={() => definirVisualNovo(true)}>Ligar visual novo</Button>
          </div>
        </Panel>
      )}

      <Secao id="cores" titulo="1. Cores">
        <Amostra legenda="Marca e superfícies">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Amarelo da marca', 'bg-lumos-yellow'],
              ['Fundo', 'bg-lumos-bg border border-lumos-border'],
              ['Cartão', 'bg-lumos-surface border border-lumos-border'],
              ['Texto secundário', 'bg-lumos-text-secondary'],
            ].map(([nome, cls]) => (
              <div key={nome} className="rounded-lumos border border-lumos-border bg-lumos-surface p-3">
                <div className={`h-12 rounded-md ${cls}`} />
                <p className="mt-2 text-xs text-lumos-text-secondary">{nome}</p>
              </div>
            ))}
          </div>
        </Amostra>
        <Amostra legenda="Cores de significado (use o tom, nunca o matiz: bg-ok/10, text-ok-fg…)">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TONS.map((t) => (
              <div key={t.tom} className="flex items-center justify-between gap-3 rounded-lumos border border-lumos-border bg-lumos-surface p-3">
                <div>
                  <p className="text-sm font-semibold text-lumos-text-primary">{t.nome}</p>
                  <p className="text-xs text-lumos-text-secondary">{t.uso}</p>
                </div>
                <StatusChip tone={t.tom} dot>{t.nome}</StatusChip>
              </div>
            ))}
          </div>
        </Amostra>
      </Secao>

      <Secao id="tipografia" titulo="2. Tipografia">
        <Panel>
          <p className="font-titulo text-4xl text-lumos-text-primary">Título de página, Instrument Serif</p>
          <p className="mt-4 text-base text-lumos-text-primary">Texto de corpo 16px em DM Sans. Controle de faturamento e entradas de projetos.</p>
          <p className="mt-2 text-sm text-lumos-text-primary">Texto padrão 14px em DM Sans. Valores: R$ 550.535,19</p>
          <p className="mt-2 text-xs text-lumos-text-secondary">Texto de apoio 12px (o mínimo da plataforma).</p>
          <p className="mt-3 text-xs uppercase tracking-wider text-lumos-text-secondary">Rótulo em caixa alta (JetBrains Mono)</p>
        </Panel>
      </Secao>

      <Secao id="cantos" titulo="3. Cantos e sombras">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="flex h-20 items-center justify-center rounded-lumos border border-lumos-border bg-lumos-surface text-xs text-lumos-text-secondary">canto padrão</div>
          <div className="flex h-20 items-center justify-center rounded-md border border-lumos-border bg-lumos-surface text-xs text-lumos-text-secondary">canto pequeno</div>
          <div className="flex h-20 items-center justify-center rounded-lumos border border-lumos-border bg-lumos-surface text-xs text-lumos-text-secondary shadow-sm">sombra cartão</div>
          <div className="flex h-20 items-center justify-center rounded-lumos border border-lumos-border bg-lumos-surface text-xs text-lumos-text-secondary shadow-2xl">sombra janela</div>
        </div>
      </Secao>

      <Secao id="botoes" titulo="4. Botões">
        <Amostra legenda="Variantes">
          <div className="flex flex-wrap gap-3">
            <Button icon={<Plus className="size-4" />}>Principal</Button>
            <Button variant="secondary" icon={<Download className="size-4" />}>Secundário</Button>
            <Button variant="ghost">Discreto</Button>
            <Button variant="danger" icon={<Trash2 className="size-4" />}>Excluir</Button>
          </div>
        </Amostra>
        <Amostra legenda="Tamanhos (pequeno 32px, médio 40px, grande 48px)">
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Pequeno</Button>
            <Button size="md">Médio</Button>
            <Button size="lg">Grande</Button>
          </div>
        </Amostra>
        <Amostra legenda="Estados: carregando, desativado, só ícone">
          <div className="flex flex-wrap items-center gap-3">
            <Button loading>Salvando</Button>
            <Button disabled>Desativado</Button>
            <IconButton aria-label="Editar" variant="secondary"><Pencil className="size-4" /></IconButton>
            <IconButton aria-label="Excluir" variant="danger"><Trash2 className="size-4" /></IconButton>
            <IconButton aria-label="Buscar"><Search className="size-4" /></IconButton>
          </div>
        </Amostra>
      </Secao>

      <Secao id="etiquetas" titulo="5. Etiquetas de status">
        <div className="flex flex-wrap gap-2">
          {TONS.map((t) => <StatusChip key={t.tom} tone={t.tom}>{t.nome}</StatusChip>)}
          <StatusChip tone="ok" dot>Pago</StatusChip>
          <StatusChip tone="danger" dot>Atrasado</StatusChip>
        </div>
      </Secao>

      <Secao id="campos" titulo="6. Campos">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do projeto" hint="Aparece no orçamento e no PDF.">
            <Input placeholder="Ex.: Webinar Open Arena" />
          </Field>
          <Field label="Valor" required error="Informe um valor maior que zero.">
            <Input invalid defaultValue="0" />
          </Field>
          <Field label="Status">
            <Select
              value={select}
              onChange={setSelect}
              className="input-lumos h-10 text-sm"
              options={[
                { value: 'todos', label: 'Todos' },
                { value: 'aprovado', label: 'Aprovado', dotClass: 'bg-ok' },
                { value: 'pendente', label: 'Pendente', dotClass: 'bg-warn' },
              ]}
            />
          </Field>
          <Field label="Observações">
            <Textarea placeholder="Escreva aqui…" />
          </Field>
        </div>
      </Secao>

      <Secao id="abas" titulo="7. Abas e alternadores">
        <Amostra legenda="Abas (trocam de seção na mesma página)">
          <Tabs
            value={aba}
            onChange={setAba}
            items={[
              { id: 'receber', label: 'A Receber', count: 12 },
              { id: 'pagar', label: 'A Pagar', count: 4 },
              { id: 'bancos', label: 'Bancos' },
            ]}
          />
        </Amostra>
        <Amostra legenda="Alternador (muda a forma de ver os mesmos dados)">
          <SegmentedControl
            value={forma}
            onChange={setForma}
            items={[{ id: 'lista', label: 'Lista' }, { id: 'cards', label: 'Cards' }, { id: 'agenda', label: 'Agenda' }]}
          />
        </Amostra>
      </Secao>

      <Secao id="cabecalho" titulo="8. Cabeçalho de página">
        <Panel>
          <PageHeader
            title="Contas a Receber"
            subtitle="Controle de faturamento e entradas de projetos."
            actions={<><Button variant="secondary" icon={<Download className="size-4" />}>Excel</Button><Button icon={<Plus className="size-4" />}>Novo recebível</Button></>}
            tabs={<Tabs value={aba} onChange={setAba} items={[{ id: 'receber', label: 'A Receber' }, { id: 'pagar', label: 'A Pagar' }, { id: 'bancos', label: 'Bancos' }]} />}
            flush
          />
        </Panel>
      </Secao>

      <Secao id="indicadores" titulo="9. Indicadores e painéis">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total a receber" value="R$ 550.535" hint="38 títulos" />
          <StatCard label="Recebido no mês" value="R$ 59.513" tone="ok" hint="+12% vs. mês anterior" />
          <StatCard label="Em atraso" value="1" tone="danger" hint="R$ 8.400" />
          <StatCard label="A vencer em 7 dias" value="6" tone="warn" />
        </div>
        <div className="mt-4">
          <Panel title="Painel com título" subtitle="Subtítulo opcional" actions={<Button size="sm" variant="secondary">Ação</Button>}>
            <p className="text-sm text-lumos-text-secondary">Conteúdo do painel.</p>
          </Panel>
        </div>
      </Secao>

      <Secao id="tabela" titulo="10. Tabela">
        <div className="mb-3">
          <SegmentedControl
            value={estadoTabela}
            onChange={setEstadoTabela}
            items={[{ id: 'dados', label: 'Com dados' }, { id: 'carregando', label: 'Carregando' }, { id: 'vazio', label: 'Vazia' }]}
          />
        </div>
        <DataTable
          columns={colunas}
          rows={estadoTabela === 'vazio' ? [] : LINHAS}
          rowKey={(r) => r.id}
          loading={estadoTabela === 'carregando'}
          onRowClick={(r) => toast.info(`Abrir ${r.projeto}`)}
          empty={<EmptyState icon={<Inbox />} title="Nenhum orçamento encontrado" description="Ajuste os filtros ou crie um novo orçamento." action={<Button size="sm" icon={<Plus className="size-4" />}>Novo orçamento</Button>} />}
          mobileCard={(r) => (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-lumos-text-primary">{r.projeto}</p>
                <p className="text-xs text-lumos-text-secondary">{r.cliente}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-sm tabular-nums">{r.valor}</span>
                <StatusChip tone={r.tom} dot>{r.status}</StatusChip>
              </div>
            </div>
          )}
        />
      </Secao>

      <Secao id="janelas" titulo="11. Janelas">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setJanela('sm')}>Pequena</Button>
          <Button variant="secondary" onClick={() => setJanela('md')}>Média</Button>
          <Button variant="secondary" onClick={() => setJanela('lg')}>Grande</Button>
        </div>
        <Modal
          isOpen={janela !== null}
          onClose={() => setJanela(null)}
          title="Excluir orçamento"
          size={janela ?? 'md'}
          footer={<><Button variant="ghost" onClick={() => setJanela(null)}>Cancelar</Button><Button variant="danger" onClick={() => { setJanela(null); toast.success('Orçamento excluído'); }}>Excluir</Button></>}
        >
          <p className="text-sm text-lumos-text-primary">Esta ação não pode ser desfeita. O orçamento e o histórico dele serão removidos.</p>
        </Modal>
      </Secao>

      <Secao id="avisos" titulo="12. Avisos (toast)">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => toast.success('Salvo com sucesso')}>Sucesso</Button>
          <Button variant="secondary" onClick={() => toast.error('Não foi possível salvar')}>Erro</Button>
          <Button variant="secondary" onClick={() => toast.warning('Confira os dados antes de enviar')}>Atenção</Button>
          <Button variant="secondary" onClick={() => toast.info('Nova versão disponível')}>Informação</Button>
        </div>
      </Secao>

      <Secao id="vazio" titulo="13. Carregando e vazio">
        <div className="grid gap-4 sm:grid-cols-2">
          <Panel>
            <div className="space-y-3"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></div>
          </Panel>
          <Panel padding="none">
            <EmptyState icon={<Inbox />} title="Nada por aqui ainda" description="Quando houver itens, eles aparecem nesta lista." />
          </Panel>
        </div>
      </Secao>
    </div>
  );
}
