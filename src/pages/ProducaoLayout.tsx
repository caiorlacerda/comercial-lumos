import { Suspense } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';
import { motion } from 'framer-motion';

// Layout das páginas de produção. As antigas pills de views (Visão Geral,
// Calendário, Board, Timeline, Cronograma) saíram a pedido do Caio: a Visão
// Geral é o destino de "Todos os Projetos" na sidebar, e o calendário virou a
// página Agenda. As rotas das outras views continuam existindo por URL.
export default function ProducaoLayout() {
  const location = useLocation();
  const outlet = useOutlet();

  return (
    <div className="space-y-6 font-work-sans">
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
