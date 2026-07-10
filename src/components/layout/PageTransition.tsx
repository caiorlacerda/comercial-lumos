import React from 'react';
import { motion } from 'framer-motion';

interface PageTransitionProps {
  children: React.ReactNode;
}

// Cross-fade entre páginas (todas as larguras): a página que sai faz fade-out
// e a que entra faz fade-in, orquestradas pelo AnimatePresence mode="wait" no
// layout (Sidebar). Apenas opacidade — sem slide, conforme convenção do app.
export default function PageTransition({ children }: PageTransitionProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeInOut' }}
      className="w-full flex flex-col flex-1"
    >
      {children}
    </motion.div>
  );
}
