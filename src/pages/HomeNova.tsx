import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Flame, SlidersHorizontal } from 'lucide-react';
import { clsx } from 'clsx';
import Confetti from '@/components/common/Confetti';
import UserAvatar from '@/components/common/UserAvatar';
import OnboardingGate from '@/components/common/OnboardingGate';
import WelcomeTour from '@/components/common/WelcomeTour';
import { papelDaHome } from '@/components/home/tipos';
import { useMinhasTarefas } from '@/components/home/useMinhasTarefas';
import { useGestaoHome } from '@/components/home/useGestaoHome';
import { useHomeLayout } from '@/components/home/useHomeLayout';
import type { BlocoHome } from '@/components/home/catalogo';
import PersonalizarHome from '@/components/home/PersonalizarHome';

interface Birthday { id: string; app_user_id: string | null; full_name: string; photo_url: string | null; }

type Faixa =
  | { tipo: 'cheia'; bloco: BlocoHome }
  | { tipo: 'colunas'; principais: BlocoHome[]; laterais: BlocoHome[] };

/** Blocos de largura total ocupam a linha; os de coluna se agrupam em duas colunas (larga e estreita). */
function emFaixas(blocos: BlocoHome[]): Faixa[] {
  const faixas: Faixa[] = [];
  let atual: Extract<Faixa, { tipo: 'colunas' }> | null = null;
  for (const b of blocos) {
    if (b.largura === 'cheia') { atual = null; faixas.push({ tipo: 'cheia', bloco: b }); continue; }
    if (!atual) { atual = { tipo: 'colunas', principais: [], laterais: [] }; faixas.push(atual); }
    (b.largura === 'principal' ? atual.principais : atual.laterais).push(b);
  }
  return faixas;
}

export default function Home() {
  const { profile } = useAuth();
  const papel = papelDaHome(profile?.role);
  const minhas = useMinhasTarefas();
  const gestao = useGestaoHome(papel !== 'time');
  const dados = useMemo(() => ({ ...minhas, gestao }), [minhas, gestao]);
  const layout = useHomeLayout(papel);
  const [personalizando, setPersonalizando] = useState(false);

  // Aniversariantes de hoje → confete + banner comemorativo (para todo o time)
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [showConfetti, setShowConfetti] = useState(false);
  const [bannerClosed, setBannerClosed] = useState(false);
  useEffect(() => {
    supabase.rpc('birthdays_today').then(({ data }) => {
      const list = (data as Birthday[]) || [];
      if (list.length) { setBirthdays(list); setShowConfetti(true); }
    });
  }, []);

  // Get current local date formatted
  const formattedDate = useMemo(() => {
    const dateStr = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(new Date());
    return dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
  }, []);

  const myBirthday = birthdays.some(b => (b.app_user_id && b.app_user_id === profile?.id) || b.full_name === profile?.full_name);
  const birthdayNames = birthdays.map(b => b.full_name.split(' ')[0]).join(', ').replace(/, ([^,]*)$/, ' e $1');

  const faixas = useMemo(() => emFaixas(layout.visiveis), [layout.visiveis]);

  return (
    <>
      {/* Tour de boas-vindas (só no 1º login) + onboarding de dados. Ficam fora do escopo
          de vidro (.lumos-deck) porque são modais e precisam do fundo sólido de sempre. */}
      <WelcomeTour />
      <OnboardingGate />
      <PersonalizarHome
        aberto={personalizando}
        onFechar={() => setPersonalizando(false)}
        itens={layout.itens}
        mover={layout.mover}
        alternar={layout.alternar}
        restaurar={layout.restaurar}
        personalizado={layout.personalizado}
      />

      {showConfetti && <Confetti onDone={() => setShowConfetti(false)} />}

    <div className="space-y-5 max-w-7xl mx-auto text-lumos-text-primary pb-10">

      {/* Banner de aniversário 🎂 */}
      {birthdays.length > 0 && !bannerClosed && (
        <div className="relative overflow-hidden rounded-lumos border border-lumos-yellow/40 bg-gradient-to-r from-lumos-yellow/15 via-pink-500/10 to-purple-500/10 p-4 flex items-center gap-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex -space-x-2 flex-shrink-0">
            {birthdays.slice(0, 4).map(b => (
              <UserAvatar key={b.id} user={{ full_name: b.full_name, avatar_url: b.photo_url }} size={40} className="ring-2 ring-lumos-surface rounded-full" />
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm md:text-base font-black text-lumos-text-primary flex items-center gap-1.5">
              🎂 {myBirthday ? `Feliz aniversário, ${profile?.full_name?.split(' ')[0]}!` : `Hoje é aniversário de ${birthdayNames}!`}
            </p>
            <p className="text-[11px] text-lumos-text-secondary font-semibold">
              {myBirthday ? 'A Lumos deseja um dia incrível! 🎉' : 'Passa lá e deseja um feliz aniversário! 🎉'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button onClick={() => setShowConfetti(true)} title="Soltar confete de novo" className="hidden sm:flex text-lg hover:scale-110 transition-transform">🎉</button>
            <button onClick={() => setBannerClosed(true)} className="p-1 rounded-full text-lumos-text-secondary hover:text-lumos-text-primary" title="Fechar">
              <span className="text-lg leading-none">×</span>
            </button>
          </div>
        </div>
      )}

      {/* Welcome Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-lumos-surface border border-lumos-border rounded-lumos p-5 md:p-6 relative overflow-hidden">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <span className="block h-2 w-2 bg-lumos-yellow" />
            <span className="text-[10px] uppercase tracking-[3px] text-lumos-text-secondary">{formattedDate}</span>
          </div>
          <h1 className="text-2xl md:text-[28px] font-medium text-lumos-text-primary tracking-[-0.03em] leading-[1.05]">
            Olá, {profile?.full_name || 'Membro Lumos'}! 👋
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start md:self-center">
          <div className="flex items-center gap-2 bg-[#161616]/85 border border-white/20 px-3.5 py-1.5 rounded-full">
            <Flame className="w-4 h-4 text-lumos-yellow animate-pulse" />
            <span className="whitespace-nowrap text-[10px] uppercase tracking-[2px] text-white">
              Tudo Pronto Para Produzir
            </span>
          </div>
          <button
            type="button"
            onClick={() => setPersonalizando(true)}
            title="Personalizar a Home"
            aria-label="Personalizar a Home"
            className="flex items-center gap-2 border border-lumos-border px-3 py-1.5 rounded-full text-[10px] uppercase tracking-[2px] text-lumos-text-secondary hover:text-lumos-text-primary hover:border-lumos-text-secondary transition-colors"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Personalizar</span>
          </button>
        </div>
      </div>

      {/* Blocos do papel (ordem e visibilidade vêm do layout da pessoa) */}
      {faixas.map((faixa, i) => {
        if (faixa.tipo === 'cheia') return <div key={faixa.bloco.id}>{faixa.bloco.render(dados)}</div>;
        const { principais, laterais } = faixa;
        return (
          <div key={`cols-${i}`} className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {principais.length > 0 && (
              <div className={clsx('space-y-5', laterais.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3')}>
                {principais.map(b => <div key={b.id}>{b.render(dados)}</div>)}
              </div>
            )}
            {laterais.length > 0 && (
              <div className={clsx(principais.length > 0 ? 'space-y-5' : 'lg:col-span-3 grid grid-cols-1 lg:grid-cols-3 gap-5')}>
                {laterais.map(b => <div key={b.id}>{b.render(dados)}</div>)}
              </div>
            )}
          </div>
        );
      })}

    </div>
    </>
  );
}
