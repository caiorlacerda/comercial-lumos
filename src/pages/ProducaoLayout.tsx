import { Suspense } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';
import { motion } from 'framer-motion';
import ProducaoViewsNav from '@/components/producao/ProducaoViewsNav';

// Layout das VIEWS de produção (Visão Geral, Calendário, Board, Timeline,
// Cronograma). A nav de pills fica FORA da troca de página — não pisca, fica
// sempre no mesmo lugar; só o conteúdo abaixo faz um fade-in ao trocar. O
// Suspense interno mantém a nav visível enquanto o chunk lazy da view carrega.
export default function ProducaoLayout() {
  const location = useLocation();
  const outlet = useOutlet();

  return (
    <div className="space-y-6 font-work-sans">
      <ProducaoViewsNav />
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="animate-spin rounded-full h-9 w-9 border-t-2 border-b-2 border-lumos-yellow" /></div>}>
          {outlet}
        </Suspense>
      </motion.div>
    </div>
  );
}
