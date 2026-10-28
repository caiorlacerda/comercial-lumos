import { useCallback, useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { ROLE_DEFAULTS } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { notify } from '@/lib/notifications/notify';
import { NOTIFICATION_EVENTS } from '@/lib/notifications/events';
import Modal from '@/components/common/Modal';
import UserAvatar from '@/components/common/UserAvatar';

/**
 * Admin escolhe quem pode EDITAR o cronograma da equipe (todo mundo da equipe continua vendo).
 * Grava a permissão 'cronograma_editar' em app_users.custom_permissions, o mesmo mecanismo de
 * Equipe/Usuários; o banco confere a mesma regra (pode_editar_cronograma, SQL 2026102801).
 */

export const PERMISSAO_CRONOGRAMA = 'cronograma_editar';

interface Pessoa {
  id: string; full_name: string; role: string; job_title: string | null; avatar_url: string | null;
  custom_permissions: Record<string, boolean> | null;
}

const padraoDoCargo = (role: string) => {
  const d = ROLE_DEFAULTS[role] || [];
  return d.includes('*') || d.includes(PERMISSAO_CRONOGRAMA);
};
const podeEditar = (p: Pessoa) => {
  const c = p.custom_permissions || {};
  return PERMISSAO_CRONOGRAMA in c ? !!c[PERMISSAO_CRONOGRAMA] : padraoDoCargo(p.role);
};

export default function QuemEditaModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [pessoas, setPessoas] = useState<Pessoa[] | null>(null);
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('app_users')
      .select('id, full_name, role, job_title, avatar_url, custom_permissions')
      .eq('status', 'ativo').eq('hidden', false).order('full_name');
    if (error) { toast.error('Não foi possível carregar as pessoas.'); setPessoas([]); return; }
    setPessoas((data as Pessoa[]) || []);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { carregar(); }, [carregar]);

  const alternar = async (p: Pessoa) => {
    const liberar = !podeEditar(p);
    // Só guarda a chave quando ela difere do padrão do cargo (mantém o JSON limpo).
    const cp = { ...(p.custom_permissions || {}) };
    if (liberar === padraoDoCargo(p.role)) delete cp[PERMISSAO_CRONOGRAMA]; else cp[PERMISSAO_CRONOGRAMA] = liberar;
    setSalvando(p.id);
    setPessoas(prev => prev && prev.map(x => (x.id === p.id ? { ...x, custom_permissions: cp } : x)));
    const { error } = await supabase.from('app_users').update({ custom_permissions: cp }).eq('id', p.id);
    setSalvando(null);
    if (error) { toast.error('Não foi possível salvar. Só administradores mudam isso.'); carregar(); return; }
    notify({
      userIds: [p.id], event: NOTIFICATION_EVENTS.PERMISSAO_ALTERADA,
      title: liberar ? 'Você agora pode editar o Cronograma da equipe' : 'Você não edita mais o Cronograma da equipe',
      body: liberar ? 'Um administrador liberou a edição do cronograma para você.' : 'Você continua vendo o cronograma, mas só a gestão edita.',
      link: '/producao/cronograma-edicao',
    });
  };

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (pessoas || []).filter(p => !q || `${p.full_name} ${p.job_title || ''}`.toLowerCase().includes(q))
      // quem edita primeiro, depois por nome
      .sort((a, b) => Number(podeEditar(b)) - Number(podeEditar(a)) || a.full_name.localeCompare(b.full_name, 'pt-BR'));
  }, [pessoas, busca]);
  const total = (pessoas || []).filter(podeEditar).length;

  return (
    <Modal isOpen onClose={onClose} title="Quem edita o cronograma">
      <div className="space-y-3">
        <p className="text-xs text-lumos-text-secondary">
          Todo o time vê o cronograma; só quem estiver ligado aqui edita. Administradores sempre editam;
          a Gestão de Produção edita por padrão, e dá para desligar.
        </p>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-lumos-text-secondary" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar pessoa…" className="input-lumos w-full !pl-9" />
        </div>
        <p className="text-[11px] font-bold text-lumos-text-secondary">{total} {total === 1 ? 'pessoa edita' : 'pessoas editam'}</p>
        <div className="max-h-[50vh] overflow-y-auto divide-y divide-lumos-border/60 border border-lumos-border rounded-lumos">
          {pessoas === null && <p className="p-4 text-xs text-lumos-text-secondary">Carregando…</p>}
          {pessoas && lista.length === 0 && <p className="p-4 text-xs text-lumos-text-secondary">Ninguém encontrado.</p>}
          {lista.map(p => {
            const admin = p.role === 'admin';
            const ligado = admin || podeEditar(p);
            return (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2">
                <UserAvatar user={{ id: p.id, full_name: p.full_name, avatar_url: p.avatar_url }} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-lumos-text-primary truncate">{p.full_name}</p>
                  <p className="text-[10px] text-lumos-text-secondary truncate">
                    {admin ? 'Administrador · sempre edita' : p.job_title || (p.role === 'producao' ? 'Gestão de Produção' : 'Time')}
                  </p>
                </div>
                <button type="button" role="switch" aria-checked={ligado} aria-label={`${p.full_name} edita o cronograma`}
                  disabled={admin || salvando === p.id} onClick={() => alternar(p)}
                  className={clsx('relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50',
                    ligado ? 'bg-lumos-yellow' : 'bg-lumos-text-secondary/30')}>
                  <span className={clsx('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform', ligado && 'translate-x-5')} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
