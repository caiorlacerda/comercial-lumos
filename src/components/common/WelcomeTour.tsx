import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, ArrowLeft, X, Check } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import Confetti from '@/components/common/Confetti';

// ── Mini-ilustrações animadas (framer-motion) ───────────────────────────────
const Float = ({ children }: { children: React.ReactNode }) => (
  <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }} className="text-6xl">
    {children}
  </motion.div>
);

const TasksVisual = () => (
  <div className="w-full max-w-[240px] space-y-2">
    {[0, 1, 2].map(i => (
      <motion.div key={i}
        initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.15 * i, duration: 0.4 }}
        className="flex items-center gap-2 bg-lumos-surface border border-lumos-border rounded-lumos px-3 py-2">
        <motion.span
          animate={{ backgroundColor: i === 0 ? ['#0000', 'var(--color-lumos-yellow)'] : '#0000' }}
          transition={{ delay: 0.8, duration: 0.5 }}
          className="w-4 h-4 rounded-full border-2 border-lumos-yellow flex items-center justify-center">
          {i === 0 && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1 }}><Check className="w-2.5 h-2.5 text-black" /></motion.span>}
        </motion.span>
        <div className="h-2 rounded-full bg-lumos-text-secondary/25 flex-1" style={{ width: `${70 - i * 12}%` }} />
        <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full bg-pink-500/20 text-pink-400">tag</span>
      </motion.div>
    ))}
  </div>
);

const BoardVisual = () => (
  <div className="flex gap-2">
    {['A Fazer', 'Fazendo', 'Feito'].map((c, i) => (
      <div key={c} className="w-16 bg-lumos-surface border border-lumos-border rounded-lumos p-1.5 space-y-1.5">
        <p className="text-[7px] font-black uppercase text-lumos-text-secondary text-center">{c}</p>
        {i === 1 ? (
          <motion.div layout animate={{ y: [8, 0], opacity: [0.4, 1] }} transition={{ duration: 1, repeat: Infinity, repeatType: 'reverse' }}
            className="h-6 rounded bg-lumos-yellow/80" />
        ) : (
          <div className="h-6 rounded bg-lumos-text-secondary/15" />
        )}
      </div>
    ))}
  </div>
);

const RealtimeVisual = () => (
  <div className="flex items-center gap-4">
    <div className="w-11 h-11 rounded-full bg-blue-500/20 border-2 border-blue-500/40 flex items-center justify-center text-lg">🧑‍💻</div>
    <motion.div animate={{ x: [-6, 6, -6], opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.6, repeat: Infinity }} className="text-lumos-yellow text-xl">⇄</motion.div>
    <div className="w-11 h-11 rounded-full bg-pink-500/20 border-2 border-pink-500/40 flex items-center justify-center text-lg">👩‍🎨</div>
  </div>
);

const ReviewVisual = () => (
  <div className="relative w-[210px] aspect-video bg-black rounded-lumos overflow-hidden border border-lumos-border flex items-center justify-center">
    <span className="text-3xl opacity-60">🎞️</span>
    <motion.span
      animate={{ scale: [1, 1.4, 1], opacity: [0.7, 1, 0.7] }} transition={{ duration: 1.4, repeat: Infinity }}
      className="absolute top-4 left-8 w-3 h-3 rounded-full bg-lumos-yellow ring-2 ring-black" />
    <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-white/15">
      <motion.div animate={{ width: ['10%', '85%'] }} transition={{ duration: 3, repeat: Infinity }} className="h-full bg-lumos-yellow" />
    </div>
  </div>
);

// ── Slides por cargo ────────────────────────────────────────────────────────
interface Slide { key: string; accent: string; title: string; body: string; Visual: React.FC; }

function getSlides(role: string, isAdmin: boolean): Slide[] {
  const intro: Slide = {
    key: 'intro', accent: 'yellow',
    title: 'Bem-vindo à central da Lumos! 🎬',
    body: 'Esta é a nossa plataforma de produção. Pensa num ClickUp, mas agora feito sob medida pra Lumos, com tudo o que a gente precisa num lugar só.',
    Visual: () => <Float>🎬</Float>,
  };
  const tasks: Slide = {
    key: 'tasks', accent: 'yellow',
    title: 'Projetos & Tarefas',
    body: 'Cada projeto tem suas tarefas, com status, prioridade, responsável, prazo e tags coloridas. Você cria, organiza e acompanha, do jeitinho que já conhece.',
    Visual: TasksVisual,
  };
  const views: Slide = {
    key: 'views', accent: 'blue',
    title: 'Do seu jeito: Lista, Board, Timeline e Calendário',
    body: 'Veja as tarefas como preferir. As abas no topo alternam entre Lista, quadro Kanban, linha do tempo (Gantt) e o Calendário da produção.',
    Visual: BoardVisual,
  };
  const realtime: Slide = {
    key: 'realtime', accent: 'emerald',
    title: 'Tudo em tempo real',
    body: 'Igual Google Docs: o que você faz aparece na hora pra todo mundo. Comente, marque @colegas e acompanhe o histórico de quem fez o quê.',
    Visual: RealtimeVisual,
  };
  const review: Slide = {
    key: 'review', accent: 'purple',
    title: 'Revisão de vídeo',
    body: 'Suba os cortes, comente no segundo exato, rabisque em cima do vídeo e gere um link pro cliente aprovar, sem sair da plataforma.',
    Visual: ReviewVisual,
  };
  const finance: Slide = {
    key: 'finance', accent: 'emerald',
    title: 'Financeiro na mão',
    body: 'Você também acompanha custos de projeto, contas e reembolsos direto por aqui.',
    Visual: () => <Float>💰</Float>,
  };
  const admin: Slide = {
    key: 'admin', accent: 'purple',
    title: 'Você comanda tudo',
    body: 'Como admin, você acessa Comercial, Financeiro, Produção e a gestão de usuários e permissões. É a visão completa da Lumos.',
    Visual: () => <Float>🛠️</Float>,
  };
  const profileSlide: Slide = {
    key: 'profile', accent: 'pink',
    title: 'Seu perfil',
    body: 'Complete seu cadastro com foto e seus dados. Assim seu rostinho aparece nas tarefas, comentários e na equipe.',
    Visual: () => <Float>🙂</Float>,
  };
  const finish: Slide = {
    key: 'finish', accent: 'yellow',
    title: 'Bora produzir! 🚀',
    body: 'É isso! Explore à vontade, e qualquer dúvida, chama o time. Seja muito bem-vindo(a) à Lumos.',
    Visual: () => <Float>🚀</Float>,
  };

  if (isAdmin) return [intro, tasks, views, realtime, review, admin, profileSlide, finish];
  if (role === 'producao') return [intro, tasks, views, realtime, review, finance, profileSlide, finish];
  if (role === 'basico') return [intro, { ...finance, title: 'Seus reembolsos', body: 'Aqui você lança e acompanha seus reembolsos de forma simples.' }, profileSlide, finish];
  // editor, atendimento, social_media
  return [intro, tasks, views, realtime, review, profileSlide, finish];
}

const ACCENTS: Record<string, string> = {
  yellow: 'from-lumos-yellow/20 to-lumos-yellow/5',
  blue: 'from-blue-500/20 to-blue-500/5',
  emerald: 'from-emerald-500/20 to-emerald-500/5',
  purple: 'from-purple-500/20 to-purple-500/5',
  pink: 'from-pink-500/20 to-pink-500/5',
};

export default function WelcomeTour() {
  const { profile, isAdmin, markTourSeen } = useAuth();
  const [step, setStep] = useState(0);
  const [closing, setClosing] = useState(false);

  const slides = useMemo(() => getSlides(profile?.role || 'basico', isAdmin), [profile?.role, isAdmin]);

  // Só no primeiro login (tour_seen === false). tour_seen undefined = ainda
  // carregando/coluna nova → não mostra pra não piscar.
  if (!profile || profile.tour_seen !== false || closing) {
    return closing ? <Confetti duration={4500} /> : null;
  }

  const slide = slides[step];
  const isLast = step === slides.length - 1;
  const accent = ACCENTS[slide.accent] || ACCENTS.yellow;

  const close = () => { setClosing(true); markTourSeen(); };
  const next = () => { if (isLast) close(); else setStep(s => s + 1); };
  const back = () => setStep(s => Math.max(0, s - 1));

  return createPortal(
    <div className="fixed inset-0 z-[280] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-3xl bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl overflow-hidden">
        {/* Palco da animação */}
        <div className={`relative h-80 flex items-center justify-center bg-gradient-to-b ${accent}`}>
          <button onClick={close} title="Pular" className="absolute top-4 right-4 p-2 rounded-full text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-black/10">
            <X className="w-5 h-5" />
          </button>
          <AnimatePresence mode="wait">
            <motion.div key={slide.key}
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3 }}
              className="flex items-center justify-center scale-[1.5]">
              <slide.Visual />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Texto */}
        <div className="px-10 pt-8 pb-5 text-center min-h-[180px]">
          <AnimatePresence mode="wait">
            <motion.div key={slide.key}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25 }}>
              <h2 className="text-3xl font-black text-lumos-text-primary tracking-tight">{slide.title}</h2>
              <p className="text-base text-lumos-text-secondary mt-3 leading-relaxed max-w-xl mx-auto">{slide.body}</p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Rodapé: progresso + navegação */}
        <div className="px-10 py-5 border-t border-lumos-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            {slides.map((s, i) => (
              <button key={s.key} onClick={() => setStep(i)}
                className={`h-2 rounded-full transition-all ${i === step ? 'w-7 bg-lumos-yellow' : 'w-2 bg-lumos-text-secondary/30 hover:bg-lumos-text-secondary/50'}`} />
            ))}
          </div>
          <div className="flex items-center gap-2.5">
            {step > 0 && (
              <button onClick={back} className="btn-secondary h-11 px-4 text-sm font-bold flex items-center gap-1.5">
                <ArrowLeft className="w-4 h-4" /> Voltar
              </button>
            )}
            <button onClick={next} className="btn-primary h-11 px-6 text-sm font-bold flex items-center gap-2">
              {isLast ? 'Começar!' : 'Próximo'}
              {!isLast && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
