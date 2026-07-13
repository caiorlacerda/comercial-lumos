import React from 'react';
import { motion } from 'framer-motion';

interface PageTransitionProps {
  children: React.ReactNode;
}

// Transição de página: cross-fade puro (só opacity), igual à troca de abas do
// perfil da Equipe. A página que sai faz fade-out e a que entra faz fade-in.
//
// Importante: NÃO deslizar na horizontal. A "piscada" de antes vinha do slide
// de saída (a tela era arrastada pra fora revelando o fundo), não do fade em si.
// Com fade puro sobre o `bg-lumos-bg`, a troca nunca mostra um quadro em branco.
export default function PageTransition({ children }: PageTransitionProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="w-full flex flex-col flex-1"
    >
      {children}
    </motion.div>
  );
}
