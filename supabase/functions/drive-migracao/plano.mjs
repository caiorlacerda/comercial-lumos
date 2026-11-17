// Plano de migração de um projeto antigo (layout v1) para a estrutura nova (v2).
// Só LÊ o Drive (através do `listar` que recebe) e devolve os passos; quem aplica é o nucleo.mjs.
// Roda igual no Node (testes e script) e no Deno (edge function drive-migracao).
//
// Regras (decididas com o Caio):
//   · só MOVE (o ID da pasta/arquivo não muda). Nunca copia e nunca apaga de vez;
//   · nomes das pastas novas: só a primeira letra maiúscula (00_Documentos, 01_Bruto, 02_Artes/01_Trilhas, 03_Export/01_Revisao,
//     03_Export/02_Final; no cliente, Marca e Projetos). Ao PROCURAR uma pasta a comparação ignora maiúsculas e minúsculas,
//     então tanto o nome antigo (00_Documentos, MARCA…) quanto o novo são reconhecidos e nunca se cria uma pasta duplicada;
//   · pasta antiga entra INTEIRA dentro da nova: 00/01/02 e OS → 00_Documentos; 03_* → 01_Bruto; 04_* → 02_Artes;
//   · 06_ENTREGA/01_REVISAO → 03_Export/01_Revisao e 06_ENTREGA/02_APROVADO → 03_Export/02_Final (as duas são renomeadas na mudança);
//   · 06_ENTREGA/03_REDES e 04_THUMB: o CONTEÚDO vai para 03_Export/02_Final e a pasta, se ficar vazia, vai para a lixeira;
//   · 05_POS_PRODUCAO: vazia → lixeira; com conteúdo → NÃO é apagada, vai inteira para 01_Bruto;
//   · 03_*/BRUTO é redundante: a 03_* se dissolve (o conteúdo da BRUTO e o resto dela sobem para 01_Bruto; vazias, vão para a lixeira);
//     04_*/TRILHA(S) é mesclada em 02_Artes/01_Trilhas;
//   · arquivo de backup de câmera (CAM_1A_BKP_…) achado nas pastas de entrega vai para 01_Bruto;
//   · PASTA VAZIA QUE NÃO É DA ESTRUTURA VAI PARA A LIXEIRA (regra do Caio, 16/11). "Vazia" = depois das movimentações não
//     sobra nenhum ARQUIVO nela, contando as subpastas em qualquer profundidade. Fica sempre, mesmo vazia, só a estrutura
//     (00_Documentos, 01_Bruto, 02_Artes, 02_Artes/01_Trilhas, 03_Export, 03_Export/01_Revisao e 03_Export/02_Final) e as
//     pastas de cliente, sub-marca, mês e projeto. Vai a pasta mais alta de cada trecho vazio (as subpastas vão junto);
//     o que ia ser movido ou marcado como CONFLITO e é só uma pasta vazia vai direto para a lixeira, sem ser movido;
//   · segurança: nunca exclusão definitiva, só lixeira (recuperável), e só se a pasta estiver sem arquivos também na hora
//     de aplicar (conferido de novo); conflito de nome nunca sobrescreve: o item fica onde está e aparece como CONFLITO.

export const NOMES = {
  documentos: '00_Documentos',
  bruto: '01_Bruto',
  artes: '02_Artes',
  trilhas: '01_Trilhas',
  export: '03_Export',
  revisao: '01_Revisao',
  final: '02_Final',
};

/** Caminho legível de cada destino, para o relatório. */
export const CAMINHOS = {
  documentos: '00_Documentos',
  bruto: '01_Bruto',
  artes: '02_Artes',
  trilhas: '02_Artes/01_Trilhas',
  export: '03_Export',
  revisao: '03_Export/01_Revisao',
  final: '03_Export/02_Final',
};

const ALVOS_RAIZ = ['documentos', 'bruto', 'artes', 'export'];

/** Máximo de pastas que a varredura de pastas vazias lê por projeto (cada pasta é uma leitura no Drive). Acima disso, não varre. */
export const LIMITE_PASTAS_VARREDURA = 300;

/** Pastas do nível do cliente (ver supabase/functions/drive-provision/layout.ts). */
export const PASTA_MARCA = 'Marca';            // materiais fixos (brandbook, logos, fontes, guidelines)
export const PASTA_MARCA_ANTIGA = '_ASSETS';   // como os clientes antigos chamam a pasta acima
export const PASTA_PROJETOS = 'Projetos';      // onde moram os projetos da estrutura nova

const norm = s => String(s ?? '').trim().toLowerCase();

/** Dois nomes de pasta são o mesmo, ignorando maiúsculas e minúsculas ("MARCA" = "Marca", "00_Documentos" = "00_Documentos"). */
export const mesmoNome = (a, b) => norm(a) === norm(b);

/**
 * Mesmo nome de pasta, para achar contêineres. Os nomes FIXOS da estrutura (Marca, Projetos, _ASSETS e as pastas do projeto)
 * ignoram maiúsculas e minúsculas; qualquer outro (sub-marca, projeto) continua exato, como sempre foi.
 */
const NOMES_FIXOS = new Set([...Object.values(NOMES), PASTA_MARCA, PASTA_MARCA_ANTIGA, PASTA_PROJETOS].map(norm));
export const mesmoNomeDePasta = (achado, procurado) => (NOMES_FIXOS.has(norm(procurado)) ? mesmoNome(achado, procurado) : achado === procurado);

/** Backup de cartão de câmera: CAM_1A_BKP_2610211103_0002.mp4 (só arquivo, nunca pasta). */
export const ehBackupDeCamera = nome => /^cam_[a-z0-9]+_bkp_/i.test(String(nome ?? ''));

/** Caminho a partir da pasta do cliente até a pasta do mês: Projetos › [sub-marca] › AAAA-MM. */
export function caminhoDoMes(marca, mes) {
  const m = String(marca ?? '').replace(/[\\/]/g, '-').replace(/\s+/g, ' ').trim();
  return m ? [PASTA_PROJETOS, m, mes] : [PASTA_PROJETOS, mes];
}

/**
 * Plano para a pasta de materiais fixos do cliente (opção renomear_assets): `_ASSETS` → `Marca`,
 * renomeando a MESMA pasta (o ID não muda). Nunca cria, move nem apaga nada.
 * @param {{id:string,name:string,isFolder:boolean}[]} filhosDoCliente
 */
export function planejarMarcaDoCliente(filhosDoCliente) {
  const pastas = filhosDoCliente.filter(f => f.isFolder);
  const assets = pastas.filter(f => mesmoNome(f.name, PASTA_MARCA_ANTIGA));
  const marca = pastas.filter(f => mesmoNome(f.name, PASTA_MARCA));
  if (assets.length > 1) return { acao: 'conflito', motivo: `há ${assets.length} pastas _ASSETS no cliente; decida qual fica antes de renomear` };
  if (assets.length === 1 && marca.length) return { acao: 'conflito', id: assets[0].id, motivo: 'o cliente já tem Marca e _ASSETS ao mesmo tempo; nada será renomeado' };
  if (assets.length === 1) return { acao: 'renomear', id: assets[0].id, de: PASTA_MARCA_ANTIGA, para: PASTA_MARCA };
  if (marca.length) return { acao: 'ja-esta', id: marca[0].id };
  return { acao: 'nada', motivo: 'o cliente não tem _ASSETS nem Marca' };
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
 * Regra "pasta vazia que não é da estrutura vai para a lixeira". Projeta o estado FINAL da árvore do projeto (lê o Drive
 * só para listar; aplica na memória as movimentações e lixeiras que o plano já tem) e acha as pastas sem nenhum arquivo,
 * nem nas subpastas, que não são da estrutura. Altera `passos` no lugar: tira o MOVER/CONFLITO de pasta que é só uma pasta
 * vazia e acrescenta uma LIXEIRA para a pasta mais alta de cada trecho vazio (as subpastas vão junto).
 * Devolve { truncou } = true quando o projeto tem pastas demais para varrer (aí não mexe em nada).
 */
async function varrerPastasVazias({ raizId, ls, passos }) {
  const nos = new Map();
  const criar = (id, name, isFolder, pai) => { const n = { id, name, isFolder, pai, paiOriginal: pai, filhos: [], estrutura: false }; nos.set(id, n); return n; };
  const raiz = criar(raizId, '', true, null);

  // 1) árvore de hoje (cada pasta é uma listagem; passou do limite, desiste)
  let lidas = 0;
  const descer = async no => {
    for (const f of await ls(no.id)) {
      const c = criar(f.id, f.name, f.isFolder, no.id);
      no.filhos.push(c.id);
      if (f.isFolder) { if (++lidas > LIMITE_PASTAS_VARREDURA) return false; if ((await descer(c)) === false) return false; }
    }
    return true;
  };
  if ((await descer(raiz)) === false) return { truncou: true };

  // 2) estado final: aplica em memória o que o plano já decidiu
  const alvo = {}; // chave do destino → id do nó
  const soltar = n => { const pai = nos.get(n.pai); if (pai) pai.filhos = pai.filhos.filter(x => x !== n.id); n.pai = null; };
  const prender = (n, paiId) => { n.pai = paiId; nos.get(paiId).filhos.push(n.id); };
  for (const st of passos) {
    if (st.op === 'reusar') alvo[st.chave] = st.id;
    else if (st.op === 'criar') {
      const id = `novo:${st.chave}`;
      const n = criar(id, st.nome, true, null); n.estrutura = true;
      prender(n, st.pai === 'raiz' ? raizId : alvo[st.pai]);
      alvo[st.chave] = id;
    } else if (st.op === 'mover') {
      const n = nos.get(st.id);
      if (!n) continue;
      soltar(n); prender(n, alvo[st.para] ?? raizId);
      if (st.registra) alvo[st.registra] = st.id;
    } else if (st.op === 'lixeira') { const n = nos.get(st.id); if (n) soltar(n); }
  }
  for (const k of Object.keys(NOMES)) { const n = nos.get(alvo[k]); if (n) n.estrutura = true; }

  // 3) quem não tem arquivo nenhum (a estrutura conta como "tem": nunca é apagada nem some dentro de uma pasta apagada)
  const memo = new Map();
  const temArquivo = n => {
    if (!n.isFolder || n.estrutura) return true;
    if (!memo.has(n.id)) memo.set(n.id, n.filhos.some(id => temArquivo(nos.get(id))));
    return memo.get(n.id);
  };
  const vazia = n => n.isFolder && !n.estrutura && n.id !== raizId && !temArquivo(n);
  const alcancaveis = [];
  const andar = n => { for (const id of n.filhos) { const c = nos.get(id); alcancaveis.push(c); if (c.isFolder) andar(c); } };
  andar(raiz);
  const vazias = alcancaveis.filter(vazia);
  if (!vazias.length) return { truncou: false };

  // 4) a pasta vazia que só ia ser movida (ou ficar como CONFLITO) vai direto para a lixeira, sem ser movida
  const idsVazias = new Set(vazias.map(n => n.id));
  for (let i = passos.length - 1; i >= 0; i--) if ((passos[i].op === 'mover' || passos[i].op === 'conflito') && idsVazias.has(passos[i].id)) passos.splice(i, 1);

  // 5) só a mais alta de cada trecho vai para a lixeira
  const caminhoOriginal = n => { const nomes = []; for (let c = nos.get(n.paiOriginal); c && c.id !== raizId; c = nos.get(c.paiOriginal)) nomes.unshift(c.name); return nomes.length ? nomes.join('/') : 'raiz'; };
  for (const n of vazias) {
    const pai = n.pai ? nos.get(n.pai) : null;
    if (pai && vazia(pai)) continue;
    const dentro = []; const coletar = x => { for (const id of x.filhos) { const c = nos.get(id); if (c.isFolder) { dentro.push(c.name); coletar(c); } } }; coletar(n);
    passos.push({ op: 'lixeira', id: n.id, nome: n.name, de: caminhoOriginal(n), motivo: 'pasta vazia fora da estrutura (sem nenhum arquivo, nem nas subpastas)', subpastas: dentro });
  }
  return { truncou: false };
}

/**
 * @param {object} p
 * @param {string} p.raizId pasta do projeto no Drive
 * @param {(id:string) => Promise<{id:string,name:string,isFolder:boolean}[]>} p.listar filhos diretos (sem lixeira)
 * @param {{entregaVaziaParaLixeira?: boolean}} [p.opcoes] (entregaVaziaParaLixeira não muda mais nada: pasta vazia fora da estrutura sempre vai para a lixeira)
 */
export async function planejarProjeto({ raizId, listar, opcoes = {} }) {
  const cache = new Map();
  const ls = async id => { if (!cache.has(id)) cache.set(id, await listar(id)); return cache.get(id); };
  const achar = (lista, nome) => lista.find(f => f.isFolder && mesmoNome(f.name, nome)) ?? null;

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

  // 1) Alvos da raiz: reaproveita a pasta de mesmo nome, em maiúsculas ou não (ex.: um 00_Documentos que já existia), ou cria.
  const existe = {};
  for (const chave of ALVOS_RAIZ) {
    const achada = achar(raiz, NOMES[chave]);
    existe[chave] = achada;
    if (achada) { tratadas.add(achada.id); passos.push({ op: 'reusar', chave, id: achada.id, nome: achada.name }); registrar(chave, await ls(achada.id)); }
    else { passos.push({ op: 'criar', chave, nome: NOMES[chave], pai: 'raiz' }); registrar(chave, []); }
  }

  // 2) 02_Artes/01_Trilhas
  const trilhasJa = existe.artes ? achar(conteudo.artes, NOMES.trilhas) : null;
  if (trilhasJa) { passos.push({ op: 'reusar', chave: 'trilhas', id: trilhasJa.id, nome: trilhasJa.name }); registrar('trilhas', await ls(trilhasJa.id)); }
  else { passos.push({ op: 'criar', chave: 'trilhas', nome: NOMES.trilhas, pai: 'artes' }); registrar('trilhas', []); }
  nomesEm.artes.add(norm(NOMES.trilhas));

  // 3) 03_Export/01_Revisao e 02_Final: vêm de 06_ENTREGA quando existem lá
  const entregaPasta = raiz.find(f => f.isFolder && mesmoNome(f.name, '06_ENTREGA')) ?? null;
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
    passos.push({ op: 'mover', id: revisaoOld.id, nome: revisaoOld.name, tipo: 'pasta', de: '06_ENTREGA', para: 'export', renomearPara: NOMES.revisao, registra: 'revisao' });
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
      passos.push({ op: 'conflito', id: item.id, nome: item.name, tipo: item.isFolder ? 'pasta' : 'arquivo', de, para, motivo: `${CAMINHOS[para] ?? para} já tem "${item.name}"` });
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

  // 4) Backups de câmera nas pastas de entrega vão para 01_Bruto (antes do conteúdo de REDES/THUMB seguir para o FINAL)
  const subpastasEntrega = (entrega ?? []).filter(f => f.isFolder && ['03_redes', '04_thumb'].includes(norm(f.name)));
  for (const s of subpastasEntrega) varreduras.push([await ls(s.id), `06_ENTREGA/${s.name}`]);
  if (entrega) varreduras.push([entrega.filter(f => !f.isFolder), '06_ENTREGA']);
  for (const [filhos, de] of varreduras) {
    for (const f of filhos) if (!f.isFolder && ehBackupDeCamera(f.name) && !saem.has(f.id)) levar(f, 'bruto', de);
  }

  // 5) 06_ENTREGA/03_REDES e 04_THUMB: conteúdo → 02_Final; a pasta vai para a lixeira se ficar vazia
  for (const s of subpastasEntrega) {
    if (await esvaziar(s, 'final', `06_ENTREGA/${s.name}`)) lixeira(s, '06_ENTREGA', 'ficará vazia depois de mover o conteúdo para 02_Final');
  }

  // 6) Pastas antigas da raiz
  for (const f of raiz.filter(x => x.isFolder)) {
    if (tratadas.has(f.id) || f.id === entregaPasta?.id) continue;
    const n = norm(f.name);
    if (n.startsWith('06_')) { ignorados.push({ id: f.id, nome: f.name, motivo: 'pasta 06_ diferente de 06_ENTREGA; fica onde está' }); continue; }

    if (n === '05_pos_producao') {
      const filhos = await ls(f.id);
      if (!filhos.length) lixeira(f, 'raiz', 'está vazia');
      else levar(f, 'bruto', 'raiz', { conteudo: filhos.map(x => x.name), nota: 'tem conteúdo: não é apagada, vai inteira para 01_Bruto' });
      continue;
    }

    const para = destinoDaPastaAntiga(f.name);
    if (!para) { ignorados.push({ id: f.id, nome: f.name, motivo: 'nome fora do mapa; fica onde está' }); continue; }

    if (para === 'bruto') {
      // 03_*/BRUTO é redundante (a 03_* já é o "bruto"): a 03_* se dissolve em 01_Bruto. O conteúdo da BRUTO e tudo o
      // mais que houver na 03_* sobem direto para 01_Bruto, e as duas pastas, vazias, vão para a lixeira. Assim não
      // sobra um invólucro com nome antigo (01_Bruto/03_CAPTACAO/...) em volta de uma ou duas pastas. Sem BRUTO dentro,
      // a 03_* entra inteira em 01_Bruto, como as demais pastas antigas. O que não puder subir (conflito de nome) fica,
      // e então a 03_* não é apagada: segue inteira para 01_Bruto.
      const filhos = await ls(f.id);
      const interna = filhos.find(x => x.isFolder && norm(x.name) === 'bruto');
      if (!interna) { levar(f, 'bruto', 'raiz'); continue; }
      let tudoSubiu = await esvaziar(interna, 'bruto', `${f.name}/${interna.name}`);
      if (tudoSubiu) lixeira(interna, f.name, 'ficará vazia depois de subir o conteúdo para 01_Bruto');
      for (const outro of filhos) {
        if (outro.id === interna.id || saem.has(outro.id)) continue;
        if (!levar(outro, 'bruto', f.name)) tudoSubiu = false;
      }
      if (tudoSubiu) lixeira(f, 'raiz', 'ficará vazia: a BRUTO e o resto dela subiram para 01_Bruto');
      else levar(f, 'bruto', 'raiz');
      continue;
    }

    if (para === 'artes' && n.startsWith('04_')) {
      // 04_*/TRILHA(S) é mesclada em 02_Artes/01_Trilhas, sem duplicar a pasta
      if (nomesEm.artes.has(n)) { levar(f, 'artes', 'raiz'); continue; } // registra o CONFLITO e não mexe em nada dentro dela
      const trilha = (await ls(f.id)).find(x => x.isFolder && /^trilhas?$/.test(norm(x.name)));
      if (trilha && await esvaziar(trilha, 'trilhas', `${f.name}/${trilha.name}`)) lixeira(trilha, f.name, 'ficará vazia depois de mesclar em 01_Trilhas');
      levar(f, 'artes', 'raiz');
      continue;
    }

    // O destino já tem uma PASTA com o mesmo nome (ex.: OS da raiz e 00_Documentos/OS): em vez de conflitar, MESCLA.
    // O conteúdo da pasta antiga vai para a que já existe e a antiga, se ficar vazia, vai para a lixeira. Nome repetido
    // lá dentro continua sendo CONFLITO (nunca sobrescreve) e, então, a pasta antiga não é apagada.
    const igual = f.isFolder ? (conteudo[para] ?? []).find(x => x.isFolder && norm(x.name) === n) : null;
    if (igual && !saem.has(igual.id)) {
      const chaveMescla = `${CAMINHOS[para]}/${igual.name}`;
      passos.push({ op: 'reusar', chave: chaveMescla, id: igual.id, nome: igual.name });
      registrar(chaveMescla, await ls(igual.id));
      if (await esvaziar(f, chaveMescla, f.name)) lixeira(f, 'raiz', `ficará vazia depois de mesclar em ${chaveMescla}`);
      continue;
    }

    levar(f, para, 'raiz');
  }

  // 7) Arquivos soltos na raiz: não se mexe
  for (const f of raiz.filter(x => !x.isFolder)) ignorados.push({ id: f.id, nome: f.name, motivo: 'arquivo solto na raiz; fica onde está' });

  // 8) Pasta vazia que não é da estrutura → lixeira (a regra vale para tudo, inclusive 06_ENTREGA)
  const varredura = await varrerPastasVazias({ raizId, ls, passos });
  // pasta da raiz que ia "ficar onde está" e foi para a lixeira por estar vazia deixa de constar como ignorada
  const naLixeira = new Set(passos.filter(x => x.op === 'lixeira').map(x => x.id));
  for (let i = ignorados.length - 1; i >= 0; i--) if (naLixeira.has(ignorados[i].id)) ignorados.splice(i, 1);
  if (varredura.truncou) avisos.push(`Projeto com mais de ${LIMITE_PASTAS_VARREDURA} pastas: a varredura de pastas vazias NÃO foi feita (nenhuma pasta vazia irá para a lixeira por esta regra).`);

  // O que sobra em 06_ENTREGA depois dos movimentos
  const entregaFoiParaLixeira = !!entregaPasta && passos.some(x => x.op === 'lixeira' && x.id === entregaPasta.id);
  const sobraEmEntrega = entregaFoiParaLixeira ? [] : (entrega ?? []).filter(f => !saem.has(f.id)).map(f => ({ id: f.id, nome: f.name, pasta: f.isFolder }));
  if (entrega === null) avisos.push('Projeto sem 06_ENTREGA: 01_Revisao e 02_Final serão criadas vazias.');
  else if (entregaFoiParaLixeira) { /* já está no plano como LIXEIRA (vazia) */ }
  else if (sobraEmEntrega.length) avisos.push(`06_ENTREGA ainda terá ${sobraEmEntrega.length} item(ns) que não são 01_REVISAO/02_APROVADO.`);
  else avisos.push('06_ENTREGA ficará VAZIA, mas não foi para a lixeira porque a varredura de pastas vazias não rodou (projeto grande). Ela não será apagada.');

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
