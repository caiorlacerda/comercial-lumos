import { clsx } from 'clsx';

/**
 * Esqueletos: blocos no tamanho do conteúdo real, com um brilho suave passando. Entram no lugar do
 * círculo girando, e o conteúdo não "pula" quando chega, porque o espaço já estava reservado.
 * O círculo continua só dentro de botões (ex.: "Salvando...").
 */

export function Esqueleto({ className }: { className?: string }) {
  return <div aria-hidden className={clsx('esqueleto rounded-lumos', className)} />;
}

/** Envolve um grupo de esqueletos: avisa leitores de tela e esconde o brilho do resto. */
export function GrupoEsqueleto({ className, children, rotulo = 'Carregando' }: { className?: string; children: React.ReactNode; rotulo?: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{rotulo}…</span>
      {children}
    </div>
  );
}

/** Linhas de texto (larguras variadas, para não parecer uma grade). */
export function EsqueletoLinhas({ n = 3, className }: { n?: number; className?: string }) {
  const larguras = ['w-full', 'w-5/6', 'w-2/3', 'w-11/12', 'w-1/2'];
  return (
    <GrupoEsqueleto className={clsx('space-y-2.5', className)}>
      {Array.from({ length: n }, (_, i) => <Esqueleto key={i} className={clsx('h-3.5', larguras[i % larguras.length])} />)}
    </GrupoEsqueleto>
  );
}

/** Lista de itens com um marcador à esquerda (tarefas, vídeos, avisos). */
export function EsqueletoItens({ n = 4, className }: { n?: number; className?: string }) {
  return (
    <GrupoEsqueleto className={clsx('space-y-2', className)}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lumos border border-lumos-border/60 bg-lumos-surface/50 p-3">
          <Esqueleto className="h-9 w-9 flex-shrink-0 !rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Esqueleto className={clsx('h-3.5', i % 2 ? 'w-2/3' : 'w-5/6')} />
            <Esqueleto className="h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </GrupoEsqueleto>
  );
}

/** Linhas de uma tabela de tarefas: círculo, título e algumas colunas. */
export function EsqueletoTarefas({ n = 6, className }: { n?: number; className?: string }) {
  return (
    <GrupoEsqueleto className={clsx('divide-y divide-lumos-border/40', className)} rotulo="Carregando tarefas">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-3">
          <Esqueleto className="h-[18px] w-[18px] flex-shrink-0 !rounded-full" />
          <Esqueleto className={clsx('h-3.5 flex-1 max-w-[44%]', i % 3 === 0 ? 'max-w-[52%]' : i % 3 === 1 ? 'max-w-[38%]' : '')} />
          <Esqueleto className="hidden h-6 w-20 md:block" />
          <Esqueleto className="hidden h-6 w-16 md:block" />
          <Esqueleto className="hidden h-6 w-28 lg:block" />
          <Esqueleto className="ml-auto h-6 w-24" />
        </div>
      ))}
    </GrupoEsqueleto>
  );
}

/** Cartão de resumo (número grande + legenda). */
export function EsqueletoResumo({ className }: { className?: string }) {
  return (
    <div className={clsx('rounded-lumos border border-lumos-border bg-lumos-surface p-4 space-y-3', className)}>
      <Esqueleto className="h-3 w-1/2" />
      <Esqueleto className="h-7 w-1/3" />
      <Esqueleto className="h-2.5 w-2/3" />
    </div>
  );
}

/** Página inteira genérica (título + cartões + bloco grande): o que aparece enquanto o código da página chega. */
export function EsqueletoPagina() {
  return (
    <GrupoEsqueleto className="space-y-5" rotulo="Carregando página">
      <div className="space-y-2">
        <Esqueleto className="h-8 w-56" />
        <Esqueleto className="h-3.5 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => <EsqueletoResumo key={i} />)}
      </div>
      <div className="rounded-lumos border border-lumos-border bg-lumos-surface p-4">
        <EsqueletoItens n={5} />
      </div>
    </GrupoEsqueleto>
  );
}

/** Tela de um projeto: cabeçalho, abas e o conteúdo da aba. */
export function EsqueletoProjeto() {
  return (
    <GrupoEsqueleto className="space-y-5" rotulo="Carregando projeto">
      <div className="rounded-lumos border border-lumos-border bg-lumos-surface p-5 space-y-4">
        <Esqueleto className="h-3 w-40" />
        <Esqueleto className="h-9 w-72 max-w-full" />
        <div className="flex gap-2 pt-1">
          {[0, 1, 2, 3, 4, 5].map(i => <Esqueleto key={i} className="h-8 w-20" />)}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => <EsqueletoResumo key={i} />)}
      </div>
      <div className="rounded-lumos border border-lumos-border bg-lumos-surface p-4">
        <EsqueletoTarefas n={6} />
      </div>
    </GrupoEsqueleto>
  );
}
