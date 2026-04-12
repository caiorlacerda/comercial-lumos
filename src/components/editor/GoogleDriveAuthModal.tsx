import React from 'react';
import Modal from '@/components/common/Modal';
import { Share2, Download, ShieldCheck } from 'lucide-react';

interface GoogleDriveAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthorize: () => void;
  onSkip: () => void;
}

export default function GoogleDriveAuthModal({
  isOpen,
  onClose,
  onAuthorize,
  onSkip
}: GoogleDriveAuthModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Backup no Google Drive"
      maxWidth="max-w-md"
    >
      <div className="space-y-6">
        <div className="flex justify-center">
          <div className="relative">
            <div className="w-20 h-20 bg-lumos-yellow/10 rounded-full flex items-center justify-center">
              <Share2 className="w-10 h-10 text-lumos-yellow" />
            </div>
            <div className="absolute -bottom-1 -right-1 bg-lumos-surface border-2 border-lumos-yellow/20 rounded-full p-1.5 shadow-lg">
              <ShieldCheck className="w-4 h-4 text-green-500" />
            </div>
          </div>
        </div>

        <div className="text-center space-y-2">
          <p className="text-sm text-lumos-text-secondary leading-relaxed">
            Para sua segurança, propostas em negociação podem ser salvas automaticamente no Google Drive da Lumos.
          </p>
          <p className="text-xs text-lumos-text-secondary/60">
            Você autoriza o acesso apenas para criar e gerenciar os arquivos gerados por este sistema.
          </p>
        </div>

        <div className="flex flex-col gap-3 pt-2">
          <button
            onClick={() => {
              onAuthorize();
              onClose();
            }}
            className="btn-primary w-full py-3 flex items-center justify-center gap-2 group"
          >
            <Share2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
            Autorizar Google Drive
          </button>
          
          <button
            onClick={() => {
              onSkip();
              onClose();
            }}
            className="flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold text-lumos-text-secondary hover:text-lumos-text-primary transition-colors"
          >
            <Download className="w-4 h-4" />
            Baixar apenas (sem backup)
          </button>
        </div>
      </div>
    </Modal>
  );
}
