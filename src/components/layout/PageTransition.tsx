import React from 'react';
import { motion } from 'framer-motion';

interface PageTransitionProps {
  children: React.ReactNode;
}

// Transição de página: só a entrada, um fade curto (só opacity). A página antiga sai na hora e a
// nova já aparece subindo de 0 a 1 em ~0,14 s. Antes a saída esperava terminar (0,2 s) para a
// entrada começar (mais 0,2 s): eram 0,4 s de tela vazia a cada troca.
//
// Importante: NÃO deslizar na horizontal. A "piscada" de antigamente vinha do slide de saída.
// Com o fundo fixo (FundoDeck / bg-lumos-bg) atrás, a troca nunca mostra um quadro em branco.
export default function PageTransition({ children }: PageTransitionProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.14, ease: 'easeOut' }}
      className="w-full flex flex-col flex-1"
    >
      {children}
    </motion.div>
  );
}
