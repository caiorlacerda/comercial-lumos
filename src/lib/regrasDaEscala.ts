/**
 * Regras da escala da diária que não dependem de tela nem de banco (testadas em
 * scripts/testes/regrasDaEscala.test.mjs): comparação com a ficha técnica da ordem do
 * dia, conflito de agenda no mesmo dia e a mensagem pronta para WhatsApp.
 */

export interface PessoaDaFicha { nome: string; funcao: string }

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
/** A ficha técnica guarda só nome e função (sem id), então a pessoa é reconhecida pelo nome. */
export const chaveDoNome = (s?: string | null) => semAcento(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

// ── ordem do dia × escala ─────────────────────────────────────────────

export interface DiferencaDaFicha {
  /** Estão na escala e não estão na ficha. */
  entram: PessoaDaFicha[];
  /** Estão nas duas, mas a escala tem outra função. */
  funcoes: { nome: string; de: string; para: string }[];
  /** Estão só na ficha (saíram da escala OU foram postos à mão na ordem do dia). */
  soNaFicha: PessoaDaFicha[];
}

export function compararFichaComEscala(ficha: PessoaDaFicha[], escala: PessoaDaFicha[]): DiferencaDaFicha {
  const dif: DiferencaDaFicha = { entram: [], funcoes: [], soNaFicha: [] };
  const naEscala = new Set<string>();
  for (const e of escala) {
    const k = chaveDoNome(e.nome);
    if (!k) continue;
    const mesmos = ficha.filter(f => chaveDoNome(f.nome) === k);
    const repetidoNaEscala = naEscala.has(k);
    naEscala.add(k);
    if (repetidoNaEscala) continue;
    if (mesmos.length === 0) { dif.entram.push({ nome: e.nome, funcao: (e.funcao || '').trim() }); continue; }
    // Escala sem função não apaga a função que a ficha tem. Se alguma linha da ficha já tem a função, está igual.
    const para = (e.funcao || '').trim();
    if (para && !mesmos.some(f => chaveDoNome(f.funcao) === chaveDoNome(para))) {
      dif.funcoes.push({ nome: mesmos[0].nome, de: (mesmos[0].funcao || '').trim(), para });
    }
  }
  dif.soNaFicha = ficha.filter(f => !naEscala.has(chaveDoNome(f.nome)));
  return dif;
}

export const temDiferenca = (d: DiferencaDaFicha) => d.entram.length + d.funcoes.length + d.soNaFicha.length > 0;

/** Muda quando a diferença muda: serve para o "manter como está" valer só para a diferença de agora. */
export const assinaturaDaDiferenca = (d: DiferencaDaFicha) => JSON.stringify([
  d.entram.map(p => [chaveDoNome(p.nome), chaveDoNome(p.funcao)]).sort(),
  d.funcoes.map(p => [chaveDoNome(p.nome), chaveDoNome(p.para)]).sort(),
  d.soNaFicha.map(p => chaveDoNome(p.nome)).sort(),
]);

/** Aplica só o que foi escolhido. Mantém a ordem da ficha e quaisquer outros dados das linhas. */
export function aplicarEscalaNaFicha<T extends PessoaDaFicha>(
  ficha: T[], dif: DiferencaDaFicha, opcoes: { entram: boolean; funcoes: boolean; tirar: boolean },
): (T | PessoaDaFicha)[] {
  const fora = new Set(opcoes.tirar ? dif.soNaFicha.map(p => chaveDoNome(p.nome)) : []);
  const novaFuncao = new Map(opcoes.funcoes ? dif.funcoes.map(f => [chaveDoNome(f.nome), f.para] as const) : []);
  const saida: (T | PessoaDaFicha)[] = [];
  for (const linha of ficha) {
    const k = chaveDoNome(linha.nome);
    if (fora.has(k)) continue;
    const para = novaFuncao.get(k);
    if (para !== undefined) { saida.push({ ...linha, funcao: para }); novaFuncao.delete(k); }   // só a primeira linha da pessoa
    else saida.push(linha);
  }
  if (opcoes.entram) saida.push(...dif.entram);
  return saida;
}

// ── conflito no mesmo dia ─────────────────────────────────────────────

export interface DiariaDoDia { id: string; nome: string; project_id: string; projeto?: string | null }
export interface VinculoDaEscala { diaria_id: string; user_id: string | null; freela_id: string | null }

/** Para cada pessoa ('user:id' | 'freela:id'), onde mais ela está escalada entre as OUTRAS diárias do dia. */
export function conflitosPorPessoa(outras: DiariaDoDia[], vinculos: VinculoDaEscala[], projetoAtual: string): Map<string, string[]> {
  const porId = new Map(outras.map(d => [d.id, d]));
  const mapa = new Map<string, string[]>();
  for (const v of vinculos) {
    const d = porId.get(v.diaria_id);
    if (!d) continue;
    const chave = v.user_id ? `user:${v.user_id}` : `freela:${v.freela_id}`;
    // No mesmo projeto o nome do projeto não ajuda: diz qual diária.
    const onde = d.project_id === projetoAtual ? `${d.nome} (deste projeto)` : (d.projeto || d.nome);
    const lista = mapa.get(chave) || [];
    if (!lista.includes(onde)) lista.push(onde);
    mapa.set(chave, lista);
  }
  return mapa;
}

// ── mensagem para WhatsApp ────────────────────────────────────────────

export const linkDoMapa = (endereco: string) => `https://www.google.com/maps/search/${encodeURIComponent(endereco)}`;

export interface DadosDaMensagem {
  nome: string;
  projeto?: string | null;
  data?: string | null;          // AAAA-MM-DD
  horaInicio?: string | null;    // HH:MM[:SS]
  horaFim?: string | null;
  local?: string | null;
  /** Endereço do local cadastrado: o mapa usa ele quando existe. */
  endereco?: string | null;
  equipe: PessoaDaFicha[];
}

export function montarMensagemDaDiaria(d: DadosDaMensagem): string {
  const data = d.data
    ? new Date(d.data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : 'a definir';
  const ini = (d.horaInicio || '').slice(0, 5);
  const fim = (d.horaFim || '').slice(0, 5);
  const horario = !ini ? 'a definir' : !fim ? `a partir das ${ini}` : `${ini} às ${fim}${fim < ini ? ' (dia seguinte)' : ''}`;
  const local = (d.local || '').trim();
  const endereco = (d.endereco || '').trim();

  const linhas = [`*${d.nome.trim()}*`];
  if (d.projeto) linhas.push(d.projeto);
  linhas.push('', `*Data:* ${data}`, `*Horário:* ${horario}`);
  linhas.push(`*Local:* ${local || 'a definir'}${local && endereco && chaveDoNome(endereco) !== chaveDoNome(local) ? `, ${endereco}` : ''}`);
  if (local) linhas.push(`*Mapa:* ${linkDoMapa(endereco || local)}`);
  linhas.push('');
  if (d.equipe.length === 0) linhas.push('*Equipe:* ainda não escalada');
  else {
    linhas.push('*Equipe:*');
    for (const p of d.equipe) linhas.push(`• ${p.nome}${p.funcao?.trim() ? `: ${p.funcao.trim()}` : ''}`);
  }
  return linhas.join('\n');
}
