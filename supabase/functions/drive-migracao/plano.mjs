// Plano de migração de um projeto antigo (layout v1) para a estrutura nova (v2).
// Só LÊ o Drive (através do `listar` que recebe) e devolve os passos; quem aplica é o nucleo.mjs.
// Roda igual no Node (testes e script) e no Deno (edge function drive-migracao).
//
// Regras (decididas com o Caio):
//   · só MOVE (o ID da pasta/arquivo não muda). Nunca copia e nunca apaga de vez;
//   · pasta antiga entra INTEIRA dentro da nova: 00/01/02 e OS → 00_DOCUMENTOS; 03_* → 01_BRUTO; 04_* → 02_ARTES;
//   · 06_ENTREGA/01_REVISAO → 03_EXPORT/01_REVISAO e 06_ENTREGA/02_APROVADO → 03_EXPORT/02_FINAL (renomeada);
//   · 06_ENTREGA/03_REDES e 04_THUMB: o CONTEÚDO vai para 03_EXPORT/02_FINAL e a pasta, se ficar vazia, vai para a lixeira;
//   · 05_POS_PRODUCAO: vazia → lixeira; com conteúdo → NÃO é apagada, vai inteira para 01_BRUTO;
//   · 03_*/BRUTO é redundante: o conteúdo dela vai direto para 01_BRUTO; 04_*/TRILHA(S) é mesclada em 02_ARTES/01_TRILHAS;
//   · arquivo de backup de câmera (CAM_1A_BKP_…) achado nas pastas de entrega vai para 01_BRUTO;
//   · segurança: pasta só vai para a lixeira se estiver vazia depois das movimentações (conferido de novo na hora de
//     aplicar); conflito de nome nunca sobrescreve: o item fica onde está e aparece como CONFLITO.

export const NOMES = {
  documentos: '00_DOCUMENTOS',
  bruto: '01_BRUTO',
  artes: '02_ARTES',
  trilhas: '01_TRILHAS',
  export: '03_EXPORT',
  revisao: '01_REVISAO',
  final: '02_FINAL',
};

/** Caminho legível de cada destino, para o relatório. */
export const CAMINHOS = {
  documentos: '00_DOCUMENTOS',
  bruto: '01_BRUTO',
  artes: '02_ARTES',
  trilhas: '02_ARTES/01_TRILHAS',
  export: '03_EXPORT',
  revisao: '03_EXPORT/01_REVISAO',
  final: '03_EXPORT/02_FINAL',
};

const ALVOS_RAIZ = ['documentos', 'bruto', 'artes', 'export'];

/** Pastas do nível do cliente (ver supabase/functions/drive-provision/layout.ts). */
export const PASTA_MARCA = 'MARCA';            // materiais fixos (brandbook, logos, fontes, guidelines)
export const PASTA_MARCA_ANTIGA = '_ASSETS';   // como os clientes antigos chamam a pasta acima
export const PASTA_PROJETOS = 'PROJETOS';      // onde moram os projetos da estrutura nova

const norm = s => String(s ?? '').trim().toLowerCase();

/** Backup de cartão de câmera: CAM_1A_BKP_2610211103_0002.mp4 (só arquivo, nunca pasta). */
export const ehBackupDeCamera = nome => /^cam_[a-z0-9]+_bkp_/i.test(String(nome ?? ''));

/** Caminho a partir da pasta do cliente até a pasta do mês: PROJETOS › [sub-marca] › AAAA-MM. */
export function caminhoDoMes(marca, mes) {
  const m = String(marca ?? '').replace(/[\\/]/g, '-').replace(/\s+/g, ' ').trim();
  return m ? [PASTA_PROJETOS, m, mes] : [PASTA_PROJETOS, mes];
}

/**
 * Plano para a pasta de materiais fixos do cliente (opção renomear_assets): `_ASSETS` → `MARCA`,
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
  if (norm(nome) === 'os') return 'documentos';
  const m = /^(\d{2})_/.exec(String(nome));
  if (!m) return null;
  if (m[1] === '00' || m[1] === '01' || m[1] === '02') return 'documentos';
  if (m[1] === '03') return 'bruto';
  if (m[1] === '04' || m[1] === '05') return 'artes';
  return null; // 06_ENTREGA é tratada à parte; 99_*, _* e o resto ficam onde estão
}

/**
 * @param {object} p
 * @param {string} p.raizId pasta do projeto no Drive
 * @param {(id:string) => Promise<{id:string,name:string,isFolder:boolean}[]>} p.listar filhos diretos (sem lixeira)
 * @param {{entregaVaziaParaLixeira?: boolean}} [p.opcoes]
 */
export async function planejarProjeto({ raizId, listar, opcoes = {} }) {
  const cache = new Map();
  const ls = async id => { if (!cache.has(id)) cache.set(id, await listar(id)); return cache.get(id); };
  const achar = (lista, nome) => lista.find(f => f.isFolder && f.name === nome) ?? null;

  const raiz = await ls(raizId);
  const passos = [];
  const ignorados = [];
  const avisos = [];
  const tratadas = new Set(); // pastas da raiz já resolvidas (alvos reaproveitados)
  const saem = new Set();     // itens que já têm destino (movidos ou indo para a lixeira): nenhuma outra regra mexe neles
  const conteudo = {};        // chave do destino → filhos que ele já tem hoje
  const nomesEm = {};         // chave do destino → nomes (minúsculos) que ele terá: os de hoje + os que chegam

  const registrar = (chave, filhos) => {
    conteudo[chave] = filhos;
    nomesEm[chave] = new Set(filhos.map(f => norm(f.name)));
  };

  // 1) Alvos da raiz: reaproveita a pasta com o nome exato (ex.: um 00_DOCUMENTOS que já existia) ou cria.
  const existe = {};
  for (const chave of ALVOS_RAIZ) {
    const achada = achar(raiz, NOMES[chave]);
    existe[chave] = achada;
    if (achada) { tratadas.add(achada.id); passos.push({ op: 'reusar', chave, id: achada.id, nome: achada.name }); registrar(chave, await ls(achada.id)); }
    else { passos.push({ op: 'criar', chave, nome: NOMES[chave], pai: 'raiz' }); registrar(chave, []); }
  }

  // 2) 02_ARTES/01_TRILHAS
  const trilhasJa = existe.artes ? achar(conteudo.artes, NOMES.trilhas) : null;
  if (trilhasJa) { passos.push({ op: 'reusar', chave: 'trilhas', id: trilhasJa.id, nome: trilhasJa.name }); registrar('trilhas', await ls(trilhasJa.id)); }
  else { passos.push({ op: 'criar', chave: 'trilhas', nome: NOMES.trilhas, pai: 'artes' }); registrar('trilhas', []); }
  nomesEm.artes.add(norm(NOMES.trilhas));

  // 3) 03_EXPORT/01_REVISAO e 02_FINAL: vêm de 06_ENTREGA quando existem lá
  const entregaPasta = raiz.find(f => f.isFolder && f.name === '06_ENTREGA') ?? null;
  const entrega = entregaPasta ? await ls(entregaPasta.id) : null;
  const revisaoJa = existe.export ? achar(conteudo.export, NOMES.revisao) : null;
  const finalJa = existe.export ? achar(conteudo.export, NOMES.final) : null;
  const revisaoOld = entrega ? achar(entrega, '01_REVISAO') : null;
  const aprovadoOld = entrega ? achar(entrega, '02_APROVADO') : null;
  nomesEm.export.add(norm(NOMES.revisao));
  nomesEm.export.add(norm(NOMES.final));

  // Pastas de entrega onde se procura backup de câmera: [filhos, de onde]
  const varreduras = [];

  if (revisaoJa) { passos.push({ op: 'reusar', chave: 'revisao', id: revisaoJa.id, nome: revisaoJa.name }); registrar('revisao', await ls(revisaoJa.id)); varreduras.push([conteudo.revisao, CAMINHOS.revisao]); }
  else if (revisaoOld) {
    passos.push({ op: 'mover', id: revisaoOld.id, nome: revisaoOld.name, tipo: 'pasta', de: '06_ENTREGA', para: 'export', registra: 'revisao' });
    saem.add(revisaoOld.id); registrar('revisao', await ls(revisaoOld.id)); varreduras.push([conteudo.revisao, '06_ENTREGA/01_REVISAO']);
  } else { passos.push({ op: 'criar', chave: 'revisao', nome: NOMES.revisao, pai: 'export' }); registrar('revisao', []); }

  if (finalJa) { passos.push({ op: 'reusar', chave: 'final', id: finalJa.id, nome: finalJa.name }); registrar('final', await ls(finalJa.id)); varreduras.push([conteudo.final, CAMINHOS.final]); }
  else if (aprovadoOld) {
    passos.push({ op: 'mover', id: aprovadoOld.id, nome: aprovadoOld.name, tipo: 'pasta', de: '06_ENTREGA', para: 'export', renomearPara: NOMES.final, registra: 'final' });
    saem.add(aprovadoOld.id); registrar('final', await ls(aprovadoOld.id)); varreduras.push([conteudo.final, '06_ENTREGA/02_APROVADO']);
  } else { passos.push({ op: 'criar', chave: 'final', nome: NOMES.final, pai: 'export' }); registrar('final', []); }

  // Move um item para um destino, sem sobrescrever: se o nome já existe lá, vira CONFLITO e o item fica onde está.
  const levar = (item, para, de, extra = {}) => {
    if (nomesEm[para].has(norm(item.name))) {
      passos.push({ op: 'conflito', id: item.id, nome: item.name, tipo: item.isFolder ? 'pasta' : 'arquivo', de, para, motivo: `${CAMINHOS[para]} já tem "${item.name}"` });
      return false;
    }
    nomesEm[para].add(norm(item.name));
    saem.add(item.id);
    passos.push({ op: 'mover', id: item.id, nome: item.name, tipo: item.isFolder ? 'pasta' : 'arquivo', de, para, ...extra });
    return true;
  };

  // Tira o conteúdo de uma pasta para dentro de um destino. Devolve true se TUDO saiu (a pasta ficará vazia).
  const esvaziar = async (origem, para, de) => {
    let tudo = true;
    for (const filho of await ls(origem.id)) {
      if (saem.has(filho.id)) continue; // já foi para outro lugar (ex.: backup de câmera)
      if (!levar(filho, para, de)) tudo = false;
    }
    return tudo;
  };

  const lixeira = (pasta, de, motivo) => { passos.push({ op: 'lixeira', id: pasta.id, nome: pasta.name, de, motivo }); saem.add(pasta.id); };

  // 4) Backups de câmera nas pastas de entrega vão para 01_BRUTO (antes do conteúdo de REDES/THUMB seguir para o FINAL)
  const subpastasEntrega = (entrega ?? []).filter(f => f.isFolder && ['03_redes', '04_thumb'].includes(norm(f.name)));
  for (const s of subpastasEntrega) varreduras.push([await ls(s.id), `06_ENTREGA/${s.name}`]);
  if (entrega) varreduras.push([entrega.filter(f => !f.isFolder), '06_ENTREGA']);
  for (const [filhos, de] of varreduras) {
    for (const f of filhos) if (!f.isFolder && ehBackupDeCamera(f.name) && !saem.has(f.id)) levar(f, 'bruto', de);
  }

  // 5) 06_ENTREGA/03_REDES e 04_THUMB: conteúdo → 02_FINAL; a pasta vai para a lixeira se ficar vazia
  for (const s of subpastasEntrega) {
    if (await esvaziar(s, 'final', `06_ENTREGA/${s.name}`)) lixeira(s, '06_ENTREGA', 'ficará vazia depois de mover o conteúdo para 02_FINAL');
  }

  // 6) Pastas antigas da raiz
  for (const f of raiz.filter(x => x.isFolder)) {
    if (tratadas.has(f.id) || f.id === entregaPasta?.id) continue;
    const n = norm(f.name);
    if (n.startsWith('06_')) { ignorados.push({ id: f.id, nome: f.name, motivo: 'pasta 06_ diferente de 06_ENTREGA; fica onde está' }); continue; }

    if (n === '05_pos_producao') {
      const filhos = await ls(f.id);
      if (!filhos.length) lixeira(f, 'raiz', 'está vazia');
      else levar(f, 'bruto', 'raiz', { conteudo: filhos.map(x => x.name), nota: 'tem conteúdo: não é apagada, vai inteira para 01_BRUTO' });
      continue;
    }

    const para = destinoDaPastaAntiga(f.name);
    if (!para) { ignorados.push({ id: f.id, nome: f.name, motivo: 'nome fora do mapa; fica onde está' }); continue; }

    if (para === 'bruto') {
      // 03_*/BRUTO é redundante: o que há nela sobe direto para 01_BRUTO
      const filhos = await ls(f.id);
      const interna = filhos.find(x => x.isFolder && norm(x.name) === 'bruto');
      if (!interna) { levar(f, 'bruto', 'raiz'); continue; }
      const internaVazia = await esvaziar(interna, 'bruto', `${f.name}/${interna.name}`);
      if (internaVazia) lixeira(interna, f.name, 'ficará vazia depois de subir o conteúdo para 01_BRUTO');
      const outros = filhos.filter(x => x.id !== interna.id);
      if (internaVazia && !outros.length) lixeira(f, 'raiz', 'ficará vazia: só tinha a BRUTO, que subiu para 01_BRUTO');
      else levar(f, 'bruto', 'raiz');
      continue;
    }

    if (para === 'artes' && n.startsWith('04_')) {
      // 04_*/TRILHA(S) é mesclada em 02_ARTES/01_TRILHAS, sem duplicar a pasta
      if (nomesEm.artes.has(n)) { levar(f, 'artes', 'raiz'); continue; } // registra o CONFLITO e não mexe em nada dentro dela
      const trilha = (await ls(f.id)).find(x => x.isFolder && /^trilhas?$/.test(norm(x.name)));
      if (trilha && await esvaziar(trilha, 'trilhas', `${f.name}/${trilha.name}`)) lixeira(trilha, f.name, 'ficará vazia depois de mesclar em 01_TRILHAS');
      levar(f, 'artes', 'raiz');
      continue;
    }

    levar(f, para, 'raiz');
  }

  // 7) Arquivos soltos na raiz: não se mexe
  for (const f of raiz.filter(x => !x.isFolder)) ignorados.push({ id: f.id, nome: f.name, motivo: 'arquivo solto na raiz; fica onde está' });

  // 8) O que sobra em 06_ENTREGA depois dos movimentos
  const sobraEmEntrega = (entrega ?? []).filter(f => !saem.has(f.id)).map(f => ({ id: f.id, nome: f.name, pasta: f.isFolder }));
  if (entrega === null) avisos.push('Projeto sem 06_ENTREGA: 01_REVISAO e 02_FINAL serão criadas vazias.');
  else if (sobraEmEntrega.length) avisos.push(`06_ENTREGA ainda terá ${sobraEmEntrega.length} item(ns) que não são 01_REVISAO/02_APROVADO.`);
  else if (opcoes.entregaVaziaParaLixeira) lixeira(entregaPasta, 'raiz', '06_ENTREGA ficará vazia (opção entrega_vazia_para_lixeira)');
  else avisos.push('06_ENTREGA ficará VAZIA. Ela não será apagada (decisão pendente do Caio); só vai para a lixeira com a opção entrega_vazia_para_lixeira.');

  return { passos, ignorados, avisos, sobraEmEntrega, entregaId: entregaPasta?.id ?? null };
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
