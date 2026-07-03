import React from 'react';
import { 
  FolderClosed, 
  Layers, 
  CalendarDays, 
  ChevronRight, 
  Plus, 
  ClipboardList, 
  Lock
} from 'lucide-react';

export default function Projetos() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight uppercase">
            Gerenciador de Projetos
          </h1>
          <p className="text-sm font-medium text-lumos-text-secondary mt-1">
            Gestão integrada de clientes, projetos e tarefas de produção audiovisual.
          </p>
        </div>
        
        {/* Placeholder button for Creation */}
        <button 
          disabled
          className="btn-primary flex items-center gap-2 text-sm shadow-xl shadow-lumos-yellow/10 opacity-70 cursor-not-allowed"
        >
          <Plus className="w-4 h-4" />
          Novo Projeto
        </button>
      </div>

      {/* Main Base Skeleton Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 min-h-[500px]">
        {/* Left Side: Client Folders Placeholder */}
        <div className="lg:col-span-1 card border border-lumos-border bg-lumos-surface/40 flex flex-col p-4 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-lumos-border/50">
            <span className="text-[10px] font-bold tracking-widest text-lumos-text-secondary uppercase opacity-75">
              Pastas de Clientes
            </span>
            <FolderClosed className="w-3.5 h-3.5 text-lumos-text-secondary opacity-50" />
          </div>
          
          {/* Skeleton client lists */}
          <div className="space-y-2 flex-1 animate-pulse">
            <div className="h-9 bg-lumos-border/20 rounded-lumos flex items-center px-3 justify-between">
              <div className="w-24 h-3.5 bg-lumos-border/40 rounded"></div>
              <ChevronRight className="w-3 h-3 text-lumos-text-secondary/30" />
            </div>
            <div className="h-9 bg-lumos-border/20 rounded-lumos flex items-center px-3 justify-between">
              <div className="w-32 h-3.5 bg-lumos-border/40 rounded"></div>
              <ChevronRight className="w-3 h-3 text-lumos-text-secondary/30" />
            </div>
            <div className="h-9 bg-lumos-border/20 rounded-lumos flex items-center px-3 justify-between">
              <div className="w-20 h-3.5 bg-lumos-border/40 rounded"></div>
              <ChevronRight className="w-3 h-3 text-lumos-text-secondary/30" />
            </div>
          </div>
        </div>

        {/* Right Side: Workspace Placeholder (Projects & Tasks) */}
        <div className="lg:col-span-3 card border border-lumos-border bg-lumos-surface flex flex-col justify-center items-center text-center p-8 relative overflow-hidden">
          {/* Subtle background decoration */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-lumos-yellow/5 rounded-full blur-3xl pointer-events-none"></div>
          
          <div className="max-w-md space-y-5 relative z-10">
            <div className="mx-auto w-14 h-14 bg-lumos-yellow/10 border border-lumos-yellow/20 rounded-full flex items-center justify-center text-lumos-yellow shadow-lg shadow-lumos-yellow/5">
              <ClipboardList className="w-7 h-7" />
            </div>
            
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-lumos-text-primary uppercase tracking-tight">
                Espaço de Trabalho de Produção
              </h3>
              <p className="text-xs text-lumos-text-secondary leading-relaxed">
                Esta tela consolidará a visualização hierárquica dos projetos e suas tarefas. Nas próximas fases de desenvolvimento, o painel central será liberado para gerenciamento completo dos workflows de Filme, Digital e Live.
              </p>
            </div>

            {/* Feature preview list */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left pt-3">
              <div className="border border-lumos-border/40 p-3 rounded-lumos bg-lumos-bg/30">
                <div className="flex items-center gap-2 mb-1">
                  <Layers className="w-3.5 h-3.5 text-lumos-yellow" />
                  <span className="text-[10px] font-black uppercase text-lumos-text-primary tracking-wider">Lista e Kanban</span>
                </div>
                <p className="text-[10px] text-lumos-text-secondary leading-normal">
                  Visões integradas de tarefas estruturadas por status.
                </p>
              </div>

              <div className="border border-lumos-border/40 p-3 rounded-lumos bg-lumos-bg/30">
                <div className="flex items-center gap-2 mb-1">
                  <CalendarDays className="w-3.5 h-3.5 text-lumos-yellow" />
                  <span className="text-[10px] font-black uppercase text-lumos-text-primary tracking-wider">Gantt</span>
                </div>
                <p className="text-[10px] text-lumos-text-secondary leading-normal">
                  Cronogramas macro com controle visual e manual de datas.
                </p>
              </div>

              <div className="border border-lumos-border/40 p-3 rounded-lumos bg-lumos-bg/30">
                <div className="flex items-center gap-2 mb-1">
                  <Lock className="w-3.5 h-3.5 text-lumos-yellow" />
                  <span className="text-[10px] font-black uppercase text-lumos-text-primary tracking-wider">OS Integrada</span>
                </div>
                <p className="text-[10px] text-lumos-text-secondary leading-normal">
                  Download de ordens de serviço diretamente a partir da proposta.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
