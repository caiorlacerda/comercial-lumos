import React from 'react';
import { motion } from 'framer-motion';

interface PageTransitionProps {
  children: React.ReactNode;
}

// Transição de página fluida: a nova página ENTRA com fade + um leve deslize da
// esquerda para a direita. Sem animação de saída — antes o `exit` levava a tela
// ao fundo em branco antes da próxima aparecer, o que causava a "piscada". Agora
// a troca é imediata e só a entrada é animada, então nunca há um quadro em branco.
export default function PageTransition({ children }: PageTransitionProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -18 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="w-full flex flex-col flex-1"
    >
      {children}
    </motion.div>
  );
}
