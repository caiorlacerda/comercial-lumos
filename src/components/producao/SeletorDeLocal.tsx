import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Pencil, Plus, Trash2, Loader2, Building2 } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';
import { useConfirm } from '@/components/ui/useConfirm';
import { SegmentedControl } from '@/components/ui/Tabs';
import { normalizar, textoDoLocal, type Local } from '@/lib/locais';

/**
 * Campo "Local" da diária com o cadastro central de locais: aparecem primeiro os do cliente do
 * projeto, depois os gerais (e os de outros clientes quando a pessoa digita). Continua aceitando
 * texto livre: a diária guarda o texto em `local` e, quando o local é cadastrado, também o `local_id`.
 */

interface Props {
  clientId: string | null;
  clienteNome: string | null;
  texto: string;
  localId: string | null;
  onChange: (texto: string, localId: string | null) => void;
}

interface FormLocal {
  id?: string;
  nome: string;
  endereco: string;
  observacoes: string;
  pertence: 'cliente' | 'geral';
  clienteId: string | null;
  clienteNome: string | null;
}

const rotulo = 'text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest';

export default function SeletorDeLocal({ clientId, clienteNome, texto, localId, onChange }: Props) {
  const { profile } = useAuth();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [locais, setLocais] = useState<Local[]>([]);
  const [aberto, setAberto] = useState(false);
  // Só filtra a lista depois que a pessoa digita: ao tocar num local já escolhido, ela vê todos.
  const [digitou, setDigitou] = useState(false);
  const [form, setForm] = useState<FormLocal | null>(null);
  const [salvando, setSalvando] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from('locais')
      .select('id, nome, endereco, observacoes, client_id, cliente:clients(name)')
      .order('nome');
    setLocais((data as unknown as Local[]) || []);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent | TouchEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    document.addEventListener('touchstart', fora);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('touchstart', fora); };
  }, [aberto]);

  // A lista abre embaixo do campo, dentro de uma janela que rola: traz ela pra dentro da vista.
  useEffect(() => {
    if (aberto) setTimeout(() => lista.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30);
  }, [aberto]);

  const termo = digitou ? normalizar(texto) : '';
  const casa = (l: Local) => !termo || normalizar(`${l.nome} ${l.endereco || ''}`).includes(termo);
  const doCliente = locais.filter(l => !!clientId && l.client_id === clientId && casa(l));
  const gerais = locais.filter(l => !l.client_id && casa(l));
  // Os de outros clientes só entram na busca, pra lista não virar um mural.
  const outros = digitou && termo ? locais.filter(l => l.client_id && l.client_id !== clientId && casa(l)).slice(0, 6) : [];
  const atual = localId ? locais.find(l => l.id === localId) : undefined;

  const escolher = (l: Local) => { onChange(textoDoLocal(l), l.id); setAberto(false); setDigitou(false); };

  const abrirNovo = (nome: string) => {
    setAberto(false);
    setForm({
      nome: nome.trim(), endereco: '', observacoes: '',
      pertence: clientId ? 'cliente' : 'geral', clienteId: clientId, clienteNome,
    });
  };
  const abrirEdicao = (l: Local) => {
    setAberto(false);
    setForm({
      id: l.id, nome: l.nome, endereco: l.endereco || '', observacoes: l.observacoes || '',
      pertence: l.client_id ? 'cliente' : 'geral',
      clienteId: l.client_id ?? clientId,
      clienteNome: l.client_id ? (l.cliente?.name ?? null) : clienteNome,
    });
  };

  const salvar = async () => {
    if (!form) return;
    const nome = form.nome.trim();
    if (!nome) { toast.error('Dê um nome ao local.'); return; }
    setSalvando(true);
    const payload = {
      nome,
      endereco: form.endereco.trim() || null,
      observacoes: form.observacoes.trim() || null,
      client_id: form.pertence === 'cliente' ? form.clienteId : null,
      updated_at: new Date().toISOString(),
    };
    const sel = 'id, nome, endereco, observacoes, client_id, cliente:clients(name)';
    const r = form.id
      ? await supabase.from('locais').update(payload).eq('id', form.id).select(sel).single()
      : await supabase.from('locais').insert([{ ...payload, created_by: profile?.id || null }]).select(sel).single();
    setSalvando(false);
    if (r.error || !r.data) {
      if ((r.error as any)?.code === '23505') toast.error('Já existe um local com esse nome para este cliente.');
      else toast.error('Não foi possível salvar o local. Se for a primeira vez, falta rodar a migration dos locais no banco.');
      return;
    }
    const salvo = r.data as unknown as Local;
    await carregar();
    setForm(null);
    // Local novo já fica escolhido; local editado que era o escolhido atualiza o texto do campo.
    if (!form.id || salvo.id === localId) onChange(textoDoLocal(salvo), salvo.id);
  };

  const excluir = async () => {
    if (!form?.id) return;
    const ok = await confirm({
      title: 'Excluir local',
      message: `Excluir "${form.nome}" do cadastro?\nAs diárias que já usam esse local continuam com o texto que têm.`,
      confirmLabel: 'Excluir', danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('locais').delete().eq('id', form.id);
    if (error) { toast.error('Não foi possível excluir o local.'); return; }
    if (form.id === localId) onChange(texto, null);
    setForm(null);
    carregar();
  };

  const linha = (l: Local, comCliente = false) => (
    <div key={l.id} className="group flex items-stretch hover:bg-lumos-text-primary/5">
      <button type="button" onClick={() => escolher(l)} className="flex-1 min-w-0 text-left px-3 py-2">
        <span className="block text-[12.5px] font-bold text-lumos-text-primary truncate">{l.nome}</span>
        {(l.endereco || comCliente) && (
          <span className="block text-[10.5px] text-lumos-text-secondary truncate">
            {comCliente && l.cliente?.name ? `${l.cliente.name}${l.endereco ? ' · ' : ''}` : ''}{l.endereco}
          </span>
        )}
      </button>
      <button type="button" onClick={() => abrirEdicao(l)} title="Editar local" aria-label={`Editar ${l.nome}`}
        className="px-3 text-lumos-text-secondary hover:text-lumos-yellow">
        <Pencil className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  const titulo = (t: string) => (
    <p className="px-3 pt-2 pb-1 text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">{t}</p>
  );
  const semNada = doCliente.length + gerais.length + outros.length === 0;

  return (
    <div ref={caixa} className="relative">
      <label className={rotulo}>Local</label>
      <div className="relative mt-1">
        <MapPin className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-lumos-text-secondary pointer-events-none" />
        <input
          className="input-lumos w-full h-10 text-sm pl-9"
          placeholder="Escolha um local ou digite (ex.: Praia da Reserva, Rio de Janeiro)"
          value={texto}
          onFocus={() => setAberto(true)}
          onChange={e => { setDigitou(true); setAberto(true); onChange(e.target.value, null); }}
        />
      </div>

      {aberto && (
        <div ref={lista} className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-lumos border border-lumos-border bg-lumos-surface shadow-2xl">
          <button type="button" onClick={() => abrirNovo(digitou ? texto : '')}
            className="w-full flex items-center gap-2 px-3 py-2.5 border-b border-lumos-border text-[12px] font-bold text-lumos-yellow hover:bg-lumos-yellow/10 text-left">
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{digitou && texto.trim() ? `Cadastrar "${texto.trim()}" como novo local` : 'Cadastrar novo local'}</span>
          </button>
          {doCliente.length > 0 && <>{titulo(clienteNome ? `Locais de ${clienteNome}` : 'Locais do cliente')}{doCliente.map(l => linha(l))}</>}
          {gerais.length > 0 && <>{titulo('Locais gerais')}{gerais.map(l => linha(l))}</>}
          {outros.length > 0 && <>{titulo('De outros clientes')}{outros.map(l => linha(l, true))}</>}
          {semNada && (
            <p className="px-3 py-3 text-[11.5px] text-lumos-text-secondary">
              {digitou && texto.trim() ? 'Nenhum local cadastrado com esse nome.' : 'Ainda não há locais cadastrados.'}
            </p>
          )}
        </div>
      )}

      {atual?.observacoes && (
        <p className="mt-1.5 text-[11px] text-lumos-text-secondary whitespace-pre-line leading-snug rounded-lumos bg-lumos-text-primary/5 px-2.5 py-2">
          {atual.observacoes}
        </p>
      )}
      <div className="flex items-center gap-3 mt-1">
        <p className="text-[10px] text-lumos-text-secondary flex-1">Com local e data, a previsão do tempo aparece sozinha no card.</p>
        {atual && (
          <button type="button" onClick={() => abrirEdicao(atual)} className="text-[10.5px] font-bold text-lumos-text-secondary hover:text-lumos-yellow">
            Editar local
          </button>
        )}
        {!localId && texto.trim().length > 2 && !aberto && (
          <button type="button" onClick={() => abrirNovo(texto)} className="text-[10.5px] font-bold text-lumos-yellow hover:underline">
            Guardar como local
          </button>
        )}
      </div>

      {form && (
        <Modal
          isOpen
          onClose={() => setForm(null)}
          title={form.id ? 'Editar local' : 'Novo local'}
          size="md"
          camada="z-[210]"
          portal
          fecharAoClicarFora={false}
          footer={(
            <>
              {form.id && (
                <button type="button" onClick={excluir}
                  className="mr-auto text-[11px] font-bold text-red-400 border border-red-500/40 rounded-lumos px-3 h-10 hover:bg-red-500/10 flex items-center gap-1.5">
                  <Trash2 className="w-3.5 h-3.5" /> Excluir
                </button>
              )}
              <button type="button" onClick={() => setForm(null)} className="btn-secondary h-10 px-4 text-xs font-bold">Cancelar</button>
              <button type="button" onClick={salvar} disabled={salvando}
                className="btn-primary h-10 px-5 text-xs font-black disabled:opacity-60 flex items-center gap-1.5">
                {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Salvar
              </button>
            </>
          )}
        >
          <div className="space-y-3">
            <div>
              <label className={rotulo}>Nome</label>
              <input className="input-lumos w-full h-10 mt-1 text-sm" autoFocus placeholder="Ex.: Escritório Shopee"
                value={form.nome} onChange={e => setForm(f => f && ({ ...f, nome: e.target.value }))} />
            </div>
            <div>
              <label className={rotulo}>Endereço <span className="normal-case tracking-normal font-semibold">(opcional)</span></label>
              <input className="input-lumos w-full h-10 mt-1 text-sm" placeholder="Rua, número, bairro, cidade"
                value={form.endereco} onChange={e => setForm(f => f && ({ ...f, endereco: e.target.value }))} />
              <p className="text-[10px] text-lumos-text-secondary mt-1">Com endereço completo, a previsão do tempo e o mapa acertam melhor.</p>
            </div>
            <div>
              <label className={rotulo}>Observações <span className="normal-case tracking-normal font-semibold">(opcional)</span></label>
              <textarea rows={3} className="input-lumos w-full mt-1 text-sm resize-y"
                placeholder="Estacionamento, quem recebe a equipe, entrada de equipamento..."
                value={form.observacoes} onChange={e => setForm(f => f && ({ ...f, observacoes: e.target.value }))} />
            </div>
            <div>
              <label className={rotulo}>De quem é este local</label>
              {form.clienteId ? (
                <div className="mt-1">
                  <SegmentedControl
                    value={form.pertence}
                    onChange={v => setForm(f => f && ({ ...f, pertence: v as 'cliente' | 'geral' }))}
                    items={[
                      { id: 'cliente', label: form.clienteNome ? `Só de ${form.clienteNome}` : 'Só deste cliente', icon: <Building2 className="w-3.5 h-3.5" /> },
                      { id: 'geral', label: 'Geral' },
                    ]}
                  />
                </div>
              ) : (
                <p className="text-[11.5px] text-lumos-text-secondary mt-1">Geral: vale para qualquer cliente (este projeto não tem cliente).</p>
              )}
              <p className="text-[10px] text-lumos-text-secondary mt-1">
                {form.pertence === 'geral' ? 'Aparece para todos os clientes (estúdio, locação...).' : 'Aparece primeiro nos projetos deste cliente.'}
              </p>
            </div>
            {form.id && (
              <p className="text-[10px] text-lumos-text-secondary">As diárias que já usam este local mantêm o texto que tinham.</p>
            )}
          </div>
        </Modal>
      )}
      {dialog}
    </div>
  );
}
