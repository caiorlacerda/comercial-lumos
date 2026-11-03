// Plano de migração de um projeto antigo (layout v1) para a estrutura nova (v2).
// Funções PURAS (sem rede, sem banco): recebem o que existe no Drive e devolvem os passos.
// O executor (migrar-projetos-v2.mjs) só lê o Drive, chama estas funções e aplica os passos.
//
// Regras (decididas com o Caio):
//   · só MOVE (o ID da pasta/arquivo não muda); nunca copia nem apaga;
//   · pasta antiga é aninhada dentro da nova: 00/01/02 e OS → 00_DOCUMENTOS; 03_* → 01_BRUTO; 04/05 → 02_ARTES;
//   · 06_ENTREGA/01_REVISAO → 03_EXPORT/01_REVISAO e 06_ENTREGA/02_APROVADO → 03_EXPORT/02_FINAL;
//   · a única renomeação é 02_APROVADO → 02_FINAL, na virada para v2;
//   · 06_ENTREGA não é renomeada nem apagada: o que sobrar nela é só listado.

export const NOMES = {
  documentos: '00_DOCUMENTOS',
  bruto: '01_BRUTO',
  artes: '02_ARTES',
  trilhas: '01_TRILHAS',
  export: '03_EXPORT',
  revisao: '01_REVISAO',
  final: '02_FINAL',
};

const ALVOS_RAIZ = ['documentos', 'bruto', 'artes', 'export'];

/** Pastas do nível do cliente (ver supabase/functions/drive-provision/layout.ts). */
export const PASTA_MARCA = 'MARCA';            // materiais fixos (brandbook, logos, fontes, guidelines)
export const PASTA_MARCA_ANTIGA = '_ASSETS';   // como os clientes antigos chamam a pasta acima
export const PASTA_PROJETOS = 'PROJETOS';      // onde moram os projetos da estrutura nova

/** Caminho a partir da pasta do cliente até a pasta do mês: PROJETOS › [sub-marca] › AAAA-MM. */
export function caminhoDoMes(marca, mes) {
  const m = String(marca ?? '').replace(/[\\/]/g, '-').replace(/\s+/g, ' ').trim();
  return m ? [PASTA_PROJETOS, m, mes] : [PASTA_PROJETOS, mes];
}

/**
 * Plano para a pasta de materiais fixos do cliente (opção --renomear-assets): `_ASSETS` → `MARCA`,
 * renomeando a MESMA pasta (o ID não muda). Nunca cria, move nem apaga nada.
 * @param {{id:string,name:string,isFolder:boolean}[]} filhosDoCliente
 */
export function planejarMarcaDoCliente(filhosDoCliente) {
  const pastas = filhosDoCliente.filter(f => f.isFolder);
  const assets = pastas.filter(f => f.name === PASTA_MARCA_ANTIGA);
  const marca = pastas.filter(f => f.name === PASTA_MARCA);
  if (assets.length > 1) return { acao: 'conflito', motivo: `há ${assets.length} pastas _ASSETS no cliente; decida qual fica antes de renomear` };
  if (assets.length === 1 && marca.length) return { acao: 'conflito', id: assets[0].id, motivo: 'o cliente já tem MARCA e _ASSETS ao mesmo tempo; nada será renomeado' };
  if (assets.length === 1) return { acao: 'renomear', id: assets[0].id, de: PASTA_MARCA_ANTIGA, para: PASTA_MARCA };
  if (marca.length) return { acao: 'ja-esta', id: marca[0].id };
  return { acao: 'nada', motivo: 'o cliente não tem _ASSETS nem MARCA' };
}

/** Para onde vai uma pasta da raiz do projeto, pelo nome. null = não mexe. */
export function destinoDaPastaAntiga(nome) {
  if (nome === 'OS') return 'documentos';
  const m = /^(\d{2})_/.exec(nome);
  if (!m) return null;
  if (m[1] === '00' || m[1] === '01' || m[1] === '02') return 'documentos';
  if (m[1] === '03') return 'bruto';
  if (m[1] === '04' || m[1] === '05') return 'artes';
  return null; // 06_ENTREGA é tratada à parte; 99_*, _* e o resto ficam onde estão
}

/**
 * @param {object} p
 * @param {{id:string,name:string,isFolder:boolean}[]} p.filhos         conteúdo da raiz do projeto
 * @param {{id:string,name:string,isFolder:boolean}[]|null} p.filhosEntrega conteúdo de 06_ENTREGA (null se não existe)
 * @param {Record<string,{id:string,name:string,isFolder:boolean}[]>} [p.filhosDosAlvos] conteúdo dos alvos que já existem
 * @returns {{passos:object[], ignorados:object[], avisos:string[], sobraEmEntrega:object[]}}
 */
export function planejarProjeto({ filhos, filhosEntrega, filhosDosAlvos = {} }) {
  const pastas = filhos.filter(f => f.isFolder);
  const passos = [];
  const ignorados = [];
  const avisos = [];
  const usadas = new Set();

  // 1) Alvos da raiz: reaproveita pasta com o nome exato (ex.: um 00_DOCUMENTOS que já existia) ou cria.
  const existe = {};
  for (const chave of ALVOS_RAIZ) {
    const achada = pastas.find(f => f.name === NOMES[chave]);
    existe[chave] = achada ?? null;
    if (achada) { usadas.add(achada.id); passos.push({ op: 'reusar', chave, id: achada.id, nome: achada.name }); }
    else passos.push({ op: 'criar', chave, nome: NOMES[chave], pai: 'raiz' });
  }

  // 2) 02_ARTES/01_TRILHAS
  const trilhasJa = existe.artes ? (filhosDosAlvos.artes ?? []).find(f => f.isFolder && f.name === NOMES.trilhas) : null;
  if (trilhasJa) passos.push({ op: 'reusar', chave: 'trilhas', id: trilhasJa.id, nome: trilhasJa.name });
  else passos.push({ op: 'criar', chave: 'trilhas', nome: NOMES.trilhas, pai: 'artes' });

  // 3) 03_EXPORT/01_REVISAO e 02_FINAL: vêm de 06_ENTREGA quando existem lá
  const entrega = filhosEntrega ?? [];
  const jaNoExport = filhosDosAlvos.export ?? [];
  const revisaoJa = existe.export ? jaNoExport.find(f => f.isFolder && f.name === NOMES.revisao) : null;
  const finalJa = existe.export ? jaNoExport.find(f => f.isFolder && f.name === NOMES.final) : null;
  const revisaoOld = entrega.find(f => f.isFolder && f.name === '01_REVISAO');
  const aprovadoOld = entrega.find(f => f.isFolder && f.name === '02_APROVADO');

  if (revisaoJa) passos.push({ op: 'reusar', chave: 'revisao', id: revisaoJa.id, nome: revisaoJa.name });
  else if (revisaoOld) passos.push({ op: 'mover', id: revisaoOld.id, nome: revisaoOld.name, de: '06_ENTREGA', para: 'export', registra: 'revisao' });
  else passos.push({ op: 'criar', chave: 'revisao', nome: NOMES.revisao, pai: 'export' });

  if (finalJa) passos.push({ op: 'reusar', chave: 'final', id: finalJa.id, nome: finalJa.name });
  else if (aprovadoOld) passos.push({ op: 'mover', id: aprovadoOld.id, nome: aprovadoOld.name, de: '06_ENTREGA', para: 'export', renomearPara: NOMES.final, registra: 'final' });
  else passos.push({ op: 'criar', chave: 'final', nome: NOMES.final, pai: 'export' });

  // 4) Pastas antigas da raiz: aninhadas dentro do alvo, só movendo
  for (const f of pastas) {
    if (usadas.has(f.id)) continue;
    if (f.name === '06_ENTREGA') continue; // tratada acima
    if (f.name.startsWith('06_')) { ignorados.push({ id: f.id, nome: f.name, motivo: 'pasta 06_ diferente de 06_ENTREGA; fica onde está' }); continue; }
    const para = destinoDaPastaAntiga(f.name);
    if (!para) { ignorados.push({ id: f.id, nome: f.name, motivo: 'nome fora do mapa; fica onde está' }); continue; }
    const jaTem = (filhosDosAlvos[para] ?? []).some(x => x.name === f.name);
    if (jaTem) { passos.push({ op: 'conflito', id: f.id, nome: f.name, para, motivo: `${NOMES[para]} já tem uma pasta "${f.name}"` }); continue; }
    passos.push({ op: 'mover', id: f.id, nome: f.name, de: 'raiz', para });
  }

  // 5) Arquivos soltos na raiz: não se mexe
  for (const f of filhos.filter(x => !x.isFolder)) ignorados.push({ id: f.id, nome: f.name, motivo: 'arquivo solto na raiz; fica onde está' });

  // 6) O que sobra em 06_ENTREGA depois dos movimentos
  const saem = new Set([revisaoOld?.id, aprovadoOld?.id].filter(Boolean));
  const sobraEmEntrega = entrega.filter(f => !saem.has(f.id)).map(f => ({ id: f.id, nome: f.name, pasta: f.isFolder }));
  if (filhosEntrega === null) avisos.push('Projeto sem 06_ENTREGA: 01_REVISAO e 02_FINAL serão criadas vazias.');
  if (sobraEmEntrega.length) avisos.push(`06_ENTREGA ainda terá ${sobraEmEntrega.length} item(ns) que não são 01_REVISAO/02_APROVADO.`);

  return { passos, ignorados, avisos, sobraEmEntrega };
}

/** "AAAA-MM" do projeto: data de início, ou a criação (fuso de São Paulo). Igual à drive-provision. */
export function mesDoProjeto(dataInicio, criadoEm) {
  for (const valor of [dataInicio, criadoEm]) {
    if (!valor) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor.slice(0, 7);
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) continue;
    const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(d);
    const ano = partes.find(x => x.type === 'year')?.value;
    const mes = partes.find(x => x.type === 'month')?.value;
    if (ano && mes) return `${ano}-${mes}`;
  }
  throw new Error('Projeto sem data de início nem de criação');
}

/** SQL (para o Caio rodar) que registra o projeto como v2 com os IDs finais. */
export function sqlDeAtualizacao(projetoId, pastas) {
  const faltam = Object.keys(NOMES).filter(k => !pastas[k]);
  if (faltam.length) throw new Error(`IDs faltando para o SQL: ${faltam.join(', ')}`);
  const json = JSON.stringify(Object.fromEntries(Object.keys(NOMES).map(k => [k, pastas[k]])));
  const q = s => s.replace(/'/g, "''");
  return `update public.projects\n   set drive_layout = 'v2',\n       drive_upload_folder_id = '${q(pastas.revisao)}',\n       drive_pastas = '${q(json)}'::jsonb\n where id = '${q(projetoId)}' and drive_layout = 'v1';`;
}
