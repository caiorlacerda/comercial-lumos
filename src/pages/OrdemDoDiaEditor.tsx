import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Download,
  Plus,
  Trash2,
  CloudSun,
  MapPin,
  Building2,
  Phone,
  Users,
  ListChecks,
  Star,
  Search,
  Briefcase,
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { notify, getUserIdsWithPermission } from '@/lib/notifications/notify';
import { NOTIFICATION_EVENTS } from '@/lib/notifications/events';
import { pdf } from '@react-pdf/renderer';

import { OrdemDoDiaPDF } from '@/components/editor/OrdemDoDiaPDF';
import AddressAutocomplete from '@/components/common/AddressAutocomplete';
import {
  SECOES_ATIVAS_DEFAULT,
  type Contato,
  type MembroEquipe,
  type AtividadePlano,
  type Talento,
  type SecoesAtivas,
  type OrdemDoDia,
} from '@/types/ordemDoDia';

// ─────────────────────────────────────────────
// Estado interno do formulário
// ─────────────────────────────────────────────
interface FormState {
  codigo: string;
  titulo: string;
  data_producao: string;
  clima: string;
  ponto_encontro: { nome: string; endereco: string };
  locacao: { nome: string; endereco: string; observacoes: string };
  contatos: Contato[];
  equipe: MembroEquipe[];
  plano_acao: AtividadePlano[];
  talentos: Talento[];
  secoes_ativas: SecoesAtivas;
}

const blankForm = (): FormState => ({
  codigo: '',
  titulo: '',
  data_producao: '',
  clima: '',
  ponto_encontro: { nome: '', endereco: '' },
  locacao: { nome: '', endereco: '', observacoes: '' },
  contatos: [],
  equipe: [],
  plano_acao: [],
  talentos: [],
  secoes_ativas: { ...SECOES_ATIVAS_DEFAULT },
});

// ─────────────────────────────────────────────
// Cabeçalho de seção com toggle de ativação
// ─────────────────────────────────────────────
interface SectionToggleProps {
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  active: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const Section = ({ Icon, title, active, onToggle, children }: SectionToggleProps) => (
  <div
    className={clsx(
      'card p-6 transition-all',
      !active && 'opacity-50'
    )}
  >
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-lumos-yellow/10 rounded-lumos text-lumos-yellow">
          <Icon className="w-4 h-4" />
        </div>
        <h2 className="text-sm font-black text-lumos-text-primary uppercase tracking-widest">{title}</h2>
      </div>
      <label className="inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          checked={active}
          onChange={onToggle}
          className="sr-only peer"
        />
        <div className="relative w-10 h-5 bg-lumos-text-secondary/20 peer-checked:bg-lumos-yellow rounded-full peer transition-colors">
          <div
            className={clsx(
              'absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform',
              active && 'translate-x-5'
            )}
          />
        </div>
      </label>
    </div>
    {active && <div className="space-y-3">{children}</div>}
  </div>
);

// Linhas dinâmicas reutilizáveis
const RemoveButton = ({ onClick }: { onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="p-2 rounded-full text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10 transition-all flex-shrink-0"
    title="Remover"
  >
    <Trash2 className="w-4 h-4" />
  </button>
);

const AddButton = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full mt-2 py-2 px-4 rounded-lumos border border-dashed border-lumos-yellow/40 text-lumos-yellow hover:bg-lumos-yellow/5 text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
  >
    <Plus className="w-3.5 h-3.5" /> {label}
  </button>
);

// ─────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────
export default function OrdemDoDiaEditor() {
  const { id } = useParams();
  const isNew = !id || id === 'nova';
  const navigate = useNavigate();
  const toast = useToast();
  const { profile } = useAuth();

  const [form, setForm] = useState<FormState>(blankForm());
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [generatingPDF, setGeneratingPDF] = useState(false);

  // Dropdown de projetos
  const [projects, setProjects] = useState<Array<{ id: string; code: string | null; name: string }>>([]);
  const [projectSearch, setProjectSearch] = useState('');
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);

  const fetchOrdem = useCallback(async () => {
    if (isNew) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('ordens_do_dia')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      const o = data as OrdemDoDia;
      setForm({
        codigo: o.codigo || '',
        titulo: o.titulo || '',
        data_producao: o.data_producao || '',
        clima: o.clima || '',
        ponto_encontro: o.ponto_encontro || { nome: '', endereco: '' },
        locacao: o.locacao || { nome: '', endereco: '', observacoes: '' },
        contatos: o.contatos || [],
        equipe: o.equipe || [],
        plano_acao: o.plano_acao || [],
        talentos: o.talentos || [],
        secoes_ativas: { ...SECOES_ATIVAS_DEFAULT, ...(o.secoes_ativas || {}) },
      });
    } catch (err: any) {
      toast.error(err.message);
      navigate('/ordem-do-dia');
    } finally {
      setLoading(false);
    }
  }, [id, isNew, navigate, toast]);

  useEffect(() => { fetchOrdem(); }, [fetchOrdem]);

  // Busca projetos para o dropdown do cabeçalho
  useEffect(() => {
    supabase
      .from('projects')
      .select('id, code, name')
      .order('created_at', { ascending: false })
      .then(({ data }) => setProjects(data || []));
  }, []);

  // Em nova ordem, pré-preenche contatos com o produtor logado (se tiver telefone cadastrado)
  useEffect(() => {
    if (!isNew) return;
    if (!profile) return;
    if (form.contatos.length > 0) return; // não sobrescreve
    if (profile.phone && profile.full_name) {
      setForm(f => ({
        ...f,
        contatos: [
          { funcao: 'Produção Lumos', nome: profile.full_name, telefone: profile.phone || '' },
        ],
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, profile?.id]);

  // Helpers de update
  const toggleSection = (key: keyof SecoesAtivas) => {
    setForm(f => ({
      ...f,
      secoes_ativas: { ...f.secoes_ativas, [key]: !f.secoes_ativas[key] },
    }));
  };

  // ─── Save / Update ───
  const handleSave = async (): Promise<string | null> => {
    if (!form.codigo.trim() || !form.titulo.trim()) {
      toast.error('Preencha o código e o título antes de salvar.');
      return null;
    }
    setSaving(true);
    try {
      const payload = {
        codigo: form.codigo.trim(),
        titulo: form.titulo.trim(),
        data_producao: form.data_producao || null,
        clima: form.clima || null,
        ponto_encontro: form.ponto_encontro,
        locacao: form.locacao,
        contatos: form.contatos,
        equipe: form.equipe,
        plano_acao: form.plano_acao,
        talentos: form.talentos,
        secoes_ativas: form.secoes_ativas,
        updated_at: new Date().toISOString(),
      };

      if (isNew) {
        const { data, error } = await supabase
          .from('ordens_do_dia')
          .insert([{ ...payload, created_by: profile?.id || null }])
          .select('id')
          .single();
        if (error) throw error;
        toast.success('Ordem do Dia criada!');

        // Trigger notification ORDEM_DIA_PUBLICADA
        const recipientIds = await getUserIdsWithPermission('ordem_do_dia');
        await notify({
          userIds: recipientIds,
          event: NOTIFICATION_EVENTS.ORDEM_DIA_PUBLICADA,
          title: 'Ordem do Dia publicada',
          body: `Nova Ordem do Dia disponível: ${payload.codigo} - ${payload.titulo}`,
          link: `/ordem-do-dia/${data.id}`
        });

        navigate(`/ordem-do-dia/${data.id}`, { replace: true });
        return data.id as string;

      } else {
        const { error } = await supabase
          .from('ordens_do_dia')
          .update(payload)
          .eq('id', id);
        if (error) throw error;
        toast.success('Alterações salvas!');
        return id!;
      }
    } catch (err: any) {
      toast.error(err.message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  // ─── Gerar PDF ───
  const handleGeneratePDF = async () => {
    if (!form.codigo.trim() || !form.titulo.trim()) {
      toast.error('Preencha o código e o título antes de gerar o PDF.');
      return;
    }
    setGeneratingPDF(true);
    try {
      // Salva antes de gerar
      const savedId = await handleSave();
      if (!savedId) return;

      const ordemForPdf: OrdemDoDia = {
        id: savedId,
        codigo: form.codigo,
        titulo: form.titulo,
        data_producao: form.data_producao || null,
        data_emissao: new Date().toISOString(),
        clima: form.clima || null,
        ponto_encontro: form.ponto_encontro,
        locacao: form.locacao,
        contatos: form.contatos,
        equipe: form.equipe,
        plano_acao: form.plano_acao,
        talentos: form.talentos,
        secoes_ativas: form.secoes_ativas,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: null,
      };

      const blob = await pdf(<OrdemDoDiaPDF ordem={ordemForPdf} />).toBlob();
      const codigoSafe = form.codigo.replace(/[^\w-]/g, '');
      const tituloSafe = form.titulo.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
      const fileName = `OD_${codigoSafe}_Lumos_${tituloSafe}_${form.data_producao || 'sem-data'}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error('Erro ao gerar PDF: ' + err.message);
    } finally {
      setGeneratingPDF(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-lumos-yellow"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 font-work-sans max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            title="Voltar"
            className="p-2 bg-lumos-text-primary/5 rounded-full hover:bg-lumos-text-primary/10 transition-all"
          >
            <ArrowLeft className="w-5 h-5 text-lumos-text-primary" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">
              {isNew ? 'Nova Ordem do Dia' : 'Editar Ordem do Dia'}
            </h1>
            <p className="text-lumos-text-secondary text-sm">Preencha as informações operacionais da produção.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn-secondary flex items-center gap-2 h-10 px-4 text-xs disabled:opacity-50"
          >
            <Save className="w-4 h-4" /> {saving ? 'Salvando...' : 'Salvar'}
          </button>
          <button
            type="button"
            onClick={handleGeneratePDF}
            disabled={generatingPDF || saving}
            className="btn-primary h-10 px-6 flex items-center gap-2 disabled:opacity-50"
          >
            <Download className="w-4 h-4" /> {generatingPDF ? 'Gerando PDF...' : 'Gerar PDF'}
          </button>
        </div>
      </div>

      {/* CABEÇALHO (sempre ativo) */}
      <div className="card p-6 space-y-4">
        <h2 className="text-sm font-black text-lumos-text-primary uppercase tracking-widest pb-2 border-b border-lumos-border">
          Cabeçalho
        </h2>

        {/* Dropdown de projetos existentes — preenche código e título automaticamente */}
        <div className="space-y-2 relative">
          <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">
            Vincular Projeto Existente (opcional)
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-lumos-text-secondary" />
            <input
              type="text"
              className="input-lumos w-full pl-9 h-10 text-sm"
              placeholder="Buscar projeto pelo código ou nome..."
              value={projectSearch}
              onFocus={() => setShowProjectDropdown(true)}
              onChange={e => {
                setProjectSearch(e.target.value);
                setShowProjectDropdown(true);
              }}
            />
          </div>
          {showProjectDropdown && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowProjectDropdown(false)}></div>
              <div className="absolute top-full left-0 right-0 mt-1 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl z-20 max-h-60 overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200">
                {projects
                  .filter(p =>
                    p.name.toLowerCase().includes(projectSearch.toLowerCase()) ||
                    (p.code && p.code.toLowerCase().includes(projectSearch.toLowerCase()))
                  )
                  .slice(0, 30)
                  .map(p => {
                    const codeStr = p.code ? (p.code.startsWith('#') ? p.code : `#${p.code}`) : '';
                    const display = codeStr ? `${codeStr} — ${p.name}` : p.name;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setForm(f => ({
                            ...f,
                            codigo: codeStr || f.codigo,
                            titulo: p.name,
                          }));
                          setProjectSearch(display);
                          setShowProjectDropdown(false);
                        }}
                        className="w-full text-left px-4 py-2.5 hover:bg-lumos-yellow/10 transition-colors border-b border-lumos-border/50 last:border-0 flex items-center gap-3"
                      >
                        <div className="p-1.5 bg-lumos-yellow/10 rounded text-lumos-yellow flex-shrink-0">
                          <Briefcase className="w-3.5 h-3.5" />
                        </div>
                        <p className="text-xs font-bold text-lumos-text-primary">{display}</p>
                      </button>
                    );
                  })}
                {projects.length === 0 && (
                  <p className="px-4 py-3 text-xs text-lumos-text-secondary italic">Nenhum projeto cadastrado.</p>
                )}
              </div>
            </>
          )}
          <p className="text-[10px] text-lumos-text-secondary italic">
            Ao selecionar, o código e o título serão preenchidos. Você pode editar manualmente depois.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Código da OS *</label>
            <input
              type="text"
              required
              placeholder="#2026-197"
              className="input-lumos w-full"
              value={form.codigo}
              onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))}
            />
          </div>
          <div className="md:col-span-2 space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Título do Projeto *</label>
            <input
              type="text"
              required
              placeholder="Sicredi | Social Show — Semana ENEF"
              className="input-lumos w-full"
              value={form.titulo}
              onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Data da Produção</label>
            <input
              type="date"
              className="input-lumos w-full"
              value={form.data_producao}
              onChange={e => setForm(f => ({ ...f, data_producao: e.target.value }))}
            />
          </div>
        </div>
      </div>

      {/* CLIMA */}
      <Section
        Icon={CloudSun}
        title="Clima"
        active={form.secoes_ativas.clima}
        onToggle={() => toggleSection('clima')}
      >
        <textarea
          rows={3}
          className="input-lumos w-full resize-none"
          placeholder="Sol com muitas nuvens e pancadas de chuva à tarde. 15° – 22°."
          value={form.clima}
          onChange={e => setForm(f => ({ ...f, clima: e.target.value }))}
        />
      </Section>

      {/* PONTO DE ENCONTRO */}
      <Section
        Icon={MapPin}
        title="Ponto de Encontro"
        active={form.secoes_ativas.ponto_encontro}
        onToggle={() => toggleSection('ponto_encontro')}
      >
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Nome do local (ex: Café da Esquina)"
            className="input-lumos w-full"
            value={form.ponto_encontro.nome}
            onChange={e => setForm(f => ({ ...f, ponto_encontro: { ...f.ponto_encontro, nome: e.target.value } }))}
          />
          <AddressAutocomplete
            value={form.ponto_encontro.endereco}
            onChange={(formatted, details) =>
              setForm(f => ({
                ...f,
                ponto_encontro: {
                  ...f.ponto_encontro,
                  endereco: formatted,
                  // Se o Google retornou um nome de estabelecimento (hotel, café, etc),
                  // sobrescreve o nome do local com ele. Caso contrário, mantém o que estiver.
                  nome: details?.name || f.ponto_encontro.nome,
                },
              }))
            }
            placeholder="Endereço completo (ex: Av. Paulista, 1000)"
          />
        </div>
      </Section>

      {/* LOCAÇÃO */}
      <Section
        Icon={Building2}
        title="Locação"
        active={form.secoes_ativas.locacao}
        onToggle={() => toggleSection('locacao')}
      >
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Nome da locação"
            className="input-lumos w-full"
            value={form.locacao.nome}
            onChange={e => setForm(f => ({ ...f, locacao: { ...f.locacao, nome: e.target.value } }))}
          />
          <AddressAutocomplete
            value={form.locacao.endereco}
            onChange={(formatted, details) =>
              setForm(f => ({
                ...f,
                locacao: {
                  ...f.locacao,
                  endereco: formatted,
                  // Sobrescreve com o nome do estabelecimento quando o Google retorna um.
                  nome: details?.name || f.locacao.nome,
                },
              }))
            }
            placeholder="Endereço da locação"
          />
          <textarea
            rows={2}
            placeholder="Observações de acesso (opcional)"
            className="input-lumos w-full resize-none"
            value={form.locacao.observacoes}
            onChange={e => setForm(f => ({ ...f, locacao: { ...f.locacao, observacoes: e.target.value } }))}
          />
        </div>
      </Section>

      {/* CONTATOS */}
      <Section
        Icon={Phone}
        title="Contatos"
        active={form.secoes_ativas.contatos}
        onToggle={() => toggleSection('contatos')}
      >
        {form.contatos.map((c, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-center">
            <input
              type="text"
              placeholder="Função / Empresa"
              className="input-lumos col-span-4 w-full"
              value={c.funcao}
              onChange={e => setForm(f => {
                const arr = [...f.contatos];
                arr[i] = { ...arr[i], funcao: e.target.value };
                return { ...f, contatos: arr };
              })}
            />
            <input
              type="text"
              placeholder="Nome"
              className="input-lumos col-span-4 w-full"
              value={c.nome}
              onChange={e => setForm(f => {
                const arr = [...f.contatos];
                arr[i] = { ...arr[i], nome: e.target.value };
                return { ...f, contatos: arr };
              })}
            />
            <input
              type="text"
              placeholder="Telefone"
              className="input-lumos col-span-3 w-full"
              value={c.telefone}
              onChange={e => setForm(f => {
                const arr = [...f.contatos];
                arr[i] = { ...arr[i], telefone: e.target.value };
                return { ...f, contatos: arr };
              })}
            />
            <div className="col-span-1 flex justify-end">
              <RemoveButton onClick={() => setForm(f => ({ ...f, contatos: f.contatos.filter((_, j) => j !== i) }))} />
            </div>
          </div>
        ))}
        <AddButton
          label="Adicionar contato"
          onClick={() =>
            setForm(f => ({
              ...f,
              contatos: [...f.contatos, { funcao: '', nome: '', telefone: '' }],
            }))
          }
        />
      </Section>

      {/* TALENTOS — agora vem antes de Equipe */}
      <Section
        Icon={Star}
        title="Lista de Talentos"
        active={form.secoes_ativas.talentos}
        onToggle={() => toggleSection('talentos')}
      >
        {form.talentos.map((t, i) => (
          <div key={i} className="space-y-2 p-3 bg-lumos-bg/40 rounded-lumos border border-lumos-border/50">
            <div className="grid grid-cols-12 gap-2">
              <input
                type="text"
                placeholder="Nome"
                className="input-lumos col-span-5 w-full"
                value={t.nome}
                onChange={e => setForm(f => {
                  const arr = [...f.talentos];
                  arr[i] = { ...arr[i], nome: e.target.value };
                  return { ...f, talentos: arr };
                })}
              />
              <input
                type="text"
                placeholder="Função (ex: Palestrante)"
                className="input-lumos col-span-6 w-full"
                value={t.funcao}
                onChange={e => setForm(f => {
                  const arr = [...f.talentos];
                  arr[i] = { ...arr[i], funcao: e.target.value };
                  return { ...f, talentos: arr };
                })}
              />
              <div className="col-span-1 flex justify-end">
                <RemoveButton onClick={() => setForm(f => ({ ...f, talentos: f.talentos.filter((_, j) => j !== i) }))} />
              </div>
            </div>
            <div className="grid grid-cols-12 gap-2">
              <input
                type="time"
                placeholder="Chegada"
                className="input-lumos col-span-3 w-full"
                value={t.horario_chegada}
                onChange={e => setForm(f => {
                  const arr = [...f.talentos];
                  arr[i] = { ...arr[i], horario_chegada: e.target.value };
                  return { ...f, talentos: arr };
                })}
              />
              <input
                type="time"
                placeholder="Gravação"
                className="input-lumos col-span-3 w-full"
                value={t.horario_gravacao}
                onChange={e => setForm(f => {
                  const arr = [...f.talentos];
                  arr[i] = { ...arr[i], horario_gravacao: e.target.value };
                  return { ...f, talentos: arr };
                })}
              />
              <input
                type="text"
                placeholder="Observações"
                className="input-lumos col-span-6 w-full"
                value={t.obs}
                onChange={e => setForm(f => {
                  const arr = [...f.talentos];
                  arr[i] = { ...arr[i], obs: e.target.value };
                  return { ...f, talentos: arr };
                })}
              />
            </div>
          </div>
        ))}
        <AddButton
          label="Adicionar talento"
          onClick={() =>
            setForm(f => ({
              ...f,
              talentos: [
                ...f.talentos,
                { nome: '', funcao: '', horario_chegada: '', horario_gravacao: '', obs: '' },
              ],
            }))
          }
        />
      </Section>

      {/* EQUIPE */}
      <Section
        Icon={Users}
        title="Equipe"
        active={form.secoes_ativas.equipe}
        onToggle={() => toggleSection('equipe')}
      >
        {form.equipe.map((m, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-center">
            <input
              type="text"
              placeholder="Função (ex: Direção, Filmmaker, Op. de som)"
              className="input-lumos col-span-5 w-full"
              value={m.funcao}
              onChange={e => setForm(f => {
                const arr = [...f.equipe];
                arr[i] = { ...arr[i], funcao: e.target.value };
                return { ...f, equipe: arr };
              })}
            />
            <input
              type="text"
              placeholder="Nome"
              className="input-lumos col-span-6 w-full"
              value={m.nome}
              onChange={e => setForm(f => {
                const arr = [...f.equipe];
                arr[i] = { ...arr[i], nome: e.target.value };
                return { ...f, equipe: arr };
              })}
            />
            <div className="col-span-1 flex justify-end">
              <RemoveButton onClick={() => setForm(f => ({ ...f, equipe: f.equipe.filter((_, j) => j !== i) }))} />
            </div>
          </div>
        ))}
        <AddButton
          label="Adicionar membro"
          onClick={() => setForm(f => ({ ...f, equipe: [...f.equipe, { funcao: '', nome: '' }] }))}
        />
      </Section>

      {/* PLANO DE AÇÃO */}
      <Section
        Icon={ListChecks}
        title="Plano de Ação"
        active={form.secoes_ativas.plano_acao}
        onToggle={() => toggleSection('plano_acao')}
      >
        {form.plano_acao.map((a, i) => (
          <div key={i} className="space-y-2 p-3 bg-lumos-bg/40 rounded-lumos border border-lumos-border/50">
            <div className="grid grid-cols-12 gap-2 items-center">
              <input
                type="time"
                placeholder="Início"
                className="input-lumos col-span-2 w-full"
                value={a.inicio}
                onChange={e => setForm(f => {
                  const arr = [...f.plano_acao];
                  arr[i] = { ...arr[i], inicio: e.target.value };
                  return { ...f, plano_acao: arr };
                })}
              />
              <input
                type="time"
                placeholder="Fim"
                className="input-lumos col-span-2 w-full"
                value={a.fim}
                onChange={e => setForm(f => {
                  const arr = [...f.plano_acao];
                  arr[i] = { ...arr[i], fim: e.target.value };
                  return { ...f, plano_acao: arr };
                })}
              />
              <input
                type="text"
                placeholder="Atividade / Descrição"
                className="input-lumos col-span-5 w-full"
                value={a.descricao}
                onChange={e => setForm(f => {
                  const arr = [...f.plano_acao];
                  arr[i] = { ...arr[i], descricao: e.target.value };
                  return { ...f, plano_acao: arr };
                })}
              />
              <input
                type="text"
                placeholder="Responsável"
                className="input-lumos col-span-2 w-full"
                value={a.responsavel}
                onChange={e => setForm(f => {
                  const arr = [...f.plano_acao];
                  arr[i] = { ...arr[i], responsavel: e.target.value };
                  return { ...f, plano_acao: arr };
                })}
              />
              <div className="col-span-1 flex justify-end">
                <RemoveButton onClick={() => setForm(f => ({ ...f, plano_acao: f.plano_acao.filter((_, j) => j !== i) }))} />
              </div>
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={a.destaque}
                onChange={e => setForm(f => {
                  const arr = [...f.plano_acao];
                  arr[i] = { ...arr[i], destaque: e.target.checked };
                  return { ...f, plano_acao: arr };
                })}
                className="sr-only peer"
              />
              <div className={clsx(
                'w-4 h-4 rounded border flex items-center justify-center transition-all',
                a.destaque ? 'bg-lumos-yellow border-lumos-yellow' : 'border-lumos-border'
              )}>
                {a.destaque && <Star className="w-2.5 h-2.5 fill-lumos-bg text-lumos-bg" />}
              </div>
              <span className="text-lumos-text-secondary font-bold uppercase tracking-widest">
                Marco do dia (negrito no PDF)
              </span>
            </label>
          </div>
        ))}
        <AddButton
          label="Adicionar atividade"
          onClick={() =>
            setForm(f => ({
              ...f,
              plano_acao: [
                ...f.plano_acao,
                { inicio: '', fim: '', descricao: '', responsavel: '', destaque: false },
              ],
            }))
          }
        />
      </Section>

      {/* Footer actions */}
      <div className="flex justify-end gap-3 pt-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn-secondary h-10 px-6 flex items-center gap-2 disabled:opacity-50"
        >
          <Save className="w-4 h-4" /> {saving ? 'Salvando...' : 'Salvar'}
        </button>
        <button
          type="button"
          onClick={handleGeneratePDF}
          disabled={generatingPDF || saving}
          className="btn-primary h-10 px-6 flex items-center gap-2 disabled:opacity-50"
        >
          <Download className="w-4 h-4" /> {generatingPDF ? 'Gerando PDF...' : 'Gerar PDF'}
        </button>
      </div>
    </div>
  );
}
