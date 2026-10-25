import { Suspense } from 'react';
import { EsqueletoPagina } from '@/components/ui/Esqueleto';
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
        <Suspense fallback={<EsqueletoPagina />}>
          {outlet}
        </Suspense>
      </motion.div>
    </div>
  );
}
