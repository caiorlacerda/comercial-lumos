import React from 'react';

export default function CronogramaEdicao() {
  return (
    <div className="p-6 lg:p-8 text-white space-y-6">
      <div className="flex items-center justify-between border-b border-lumos-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Cronograma de Edição</h1>
          <p className="text-lumos-text-secondary text-sm">
            Linha do tempo e backlog de edições na produção.
          </p>
        </div>
      </div>
      
      <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-12 text-center max-w-xl mx-auto space-y-4">
        <div className="w-16 h-16 bg-lumos-yellow/10 rounded-full flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-lumos-yellow animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-white font-work-sans">Em Construção</h2>
        <p className="text-lumos-text-secondary text-sm leading-relaxed">
          Esta tela está sendo implementada nas próximas etapas do cronograma de edição.
          As permissões e chaves de segurança para esta rota foram configuradas com sucesso.
        </p>
      </div>
    </div>
  );
}
