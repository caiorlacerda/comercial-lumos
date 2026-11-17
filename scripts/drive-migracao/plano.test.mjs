// Testa o planejador (supabase/functions/drive-migracao/plano.mjs) contra árvores de Drive em memória. Nada de rede.
// Rodar:  node scripts/drive-migracao/plano.test.mjs
import {
  LIMITE_PASTAS_VARREDURA, NOMES, caminhoDoMes, destinoDaPastaAntiga, ehBackupDeCamera, mesDoProjeto, planejarMarcaDoCliente, planejarProjeto, sqlDeAtualizacao,
} from '../../supabase/functions/drive-migracao/plano.mjs';

let falhas = 0;
const ok = (nome, cond) => { console.log((cond ? 'OK     ' : 'FALHA  ') + nome); if (!cond) falhas++; };

// ---- Drive falso: cada árvore é um Map id → {id,name,pai,pasta}
function drive() {
  const nos = new Map();
  const api = {
    nos,
    pasta: (id, name, pai) => { nos.set(id, { id, name, pai, isFolder: true }); return api; },
    arq: (id, name, pai) => { nos.set(id, { id, name, pai, isFolder: false }); return api; },
    listar: async pai => [...nos.values()].filter(n => n.pai === pai).map(({ id, name, isFolder }) => ({ id, name, isFolder })),
  };
  return api;
}
// Regra nova (16/11): pasta vazia fora da estrutura vai para a lixeira. Por isso os cenários de MOVIMENTAÇÃO abaixo usam `plano`,
// que antes dá um arquivo a cada pasta que estaria vazia (senão ela seria lixeirada em vez de movida). Os cenários da regra
// de pasta vazia usam `planoPuro`, que lê a árvore exatamente como foi montada.
const planoPuro = (d, opcoes) => planejarProjeto({ raizId: 'P', listar: d.listar, opcoes });
const plano = (d, opcoes) => {
  for (const n of [...d.nos.values()]) if (n.isFolder && ![...d.nos.values()].some(c => c.pai === n.id)) d.arq(`arq-${n.id}`, `arq-${n.id}.txt`, n.id);
  return planoPuro(d, opcoes);
};
const op = (r, o, extra = {}) => r.passos.filter(p => p.op === o && Object.entries(extra).every(([k, v]) => p[k] === v));
const moveu = (r, id, para) => op(r, 'mover', { id, para }).length === 1;

/**
 * Regra de segurança, conferida em TODO plano: uma pasta só vai para a lixeira se tudo o que há nela
 * também sai (movido ou lixeira) no mesmo plano; e o plano nunca tem operação de exclusão.
 */
function seguro(d, r) {
  const saem = new Set(r.passos.filter(p => p.op === 'mover' || p.op === 'lixeira').map(p => p.id));
  const lixeiras = op(r, 'lixeira');
  const nadaDeApagar = r.passos.every(p => ['criar', 'reusar', 'mover', 'conflito', 'lixeira'].includes(p.op));
  // lixeira só com pasta sem ARQUIVO nenhum (nem nas subpastas) depois do plano: o que tem arquivo precisa ter saído
  const semArquivo = id => [...d.nos.values()].filter(n => n.pai === id).every(f => saem.has(f.id) || (f.isFolder && semArquivo(f.id)));
  const vazias = lixeiras.every(l => semArquivo(l.id));
  return nadaDeApagar && vazias;
}

// ---- mapa de nomes
ok('00/01/02 e OS → documentos', ['00_GERAL', '01_ROTEIRO', '02_PRODUCAO', 'OS'].every(n => destinoDaPastaAntiga(n) === 'documentos'));
ok('03 → bruto', destinoDaPastaAntiga('03_CAPTACAO') === 'bruto');
ok('04 e 05 → artes (05_POS_PRODUCAO é tratada à parte no plano)', destinoDaPastaAntiga('04_EDICAO') === 'artes' && destinoDaPastaAntiga('05_ARTES') === 'artes');
ok('nomes fora do mapa não mexem', destinoDaPastaAntiga('99_DUPLICADOS') === null && destinoDaPastaAntiga('_ARQUIVOS') === null && destinoDaPastaAntiga('Fotos') === null);
ok('backup de câmera: padrão CAM_<id>_BKP_…', ehBackupDeCamera('CAM_1A_BKP_2610211103_0002.mp4') && ehBackupDeCamera('cam_B_bkp_x.mov') && !ehBackupDeCamera('CAMERA_final.mp4') && !ehBackupDeCamera('video_BKP.mp4') && !ehBackupDeCamera('CAM_1A_final.mp4'));

// ---- projeto antigo típico
{
  const d = drive().pasta('P', 'proj', null);
  for (const [id, n] of [['a0', '00_GERAL'], ['a1', '01_ROTEIRO'], ['a2', '02_PRODUCAO'], ['a3', '03_CAPTACAO'], ['a4', '04_EDICAO'], ['a5', '05_ARTES'], ['a6', '06_ENTREGA'], ['os', 'OS'], ['dup', '99_DUPLICADOS']]) d.pasta(id, n, 'P');
  d.arq('f1', 'leia-me.txt', 'P').pasta('rev', '01_REVISAO', 'a6').pasta('apr', '02_APROVADO', 'a6');
  const t = await plano(d);
  ok('típico: cria documentos, bruto, artes, export e trilhas', ['documentos', 'bruto', 'artes', 'export', 'trilhas'].every(c => op(t, 'criar', { chave: c }).length === 1));
  ok('típico: NÃO cria revisao/final (vêm de 06_ENTREGA)', op(t, 'criar', { chave: 'revisao' }).length === 0 && op(t, 'criar', { chave: 'final' }).length === 0);
  ok('típico: 01_REVISAO é movida e renomeada para 01_Revisao (registra revisao)', op(t, 'mover', { id: 'rev', para: 'export', renomearPara: '01_Revisao', registra: 'revisao' }).length === 1);
  ok('típico: 02_APROVADO é movida e renomeada para 02_Final', op(t, 'mover', { id: 'apr', para: 'export', renomearPara: '02_Final', registra: 'final' }).length === 1);
  ok('típico: 00/01/02 e OS vão para documentos', ['a0', 'a1', 'a2', 'os'].every(id => moveu(t, id, 'documentos')));
  ok('típico: 03 → bruto; 04/05 → artes', moveu(t, 'a3', 'bruto') && moveu(t, 'a4', 'artes') && moveu(t, 'a5', 'artes'));
  ok('típico: 06_ENTREGA não é movida nem renomeada (vai para a lixeira, vazia depois de mover 01_REVISAO e 02_APROVADO)', t.passos.every(p => p.id !== 'a6' || p.op === 'lixeira'));
  ok('típico: 99_DUPLICADOS e arquivo solto ficam (ignorados)', t.ignorados.map(i => i.id).sort().join() === 'dup,f1');
  ok('típico: 06_ENTREGA vazia fora da estrutura → LIXEIRA (regra de 16/11), sem aviso de pendência', t.sobraEmEntrega.length === 0 && op(t, 'lixeira', { id: 'a6' }).length === 1 && !t.avisos.some(a => /VAZIA/.test(a)));
  ok('típico: só duas renomeações: 01_REVISAO→01_Revisao e 02_APROVADO→02_Final', t.passos.filter(p => p.renomearPara).map(p => p.renomearPara).sort().join() === '01_Revisao,02_Final');
  ok('típico: segurança (sem exclusão; lixeira só de pasta vazia)', seguro(d, t));
  const comOpcao = await plano(d, { entregaVaziaParaLixeira: true });
  ok('a opção entrega_vazia_para_lixeira não muda mais nada: o plano é o mesmo (a regra já vale sempre)', op(comOpcao, 'lixeira', { id: 'a6' }).length === 1 && JSON.stringify(comOpcao.passos) === JSON.stringify(t.passos) && seguro(d, comOpcao));
}

// ---- 00 já se chama 00_Documentos: vira o alvo, não duplica
{
  const d = drive().pasta('P', 'proj', null).pasta('d', '00_Documentos', 'P').pasta('r', '01_ROTEIRO', 'P').pasta('e', '06_ENTREGA', 'P');
  const t = await plano(d);
  ok('00_Documentos existente é reaproveitada (sem criar outra)', op(t, 'reusar', { chave: 'documentos', id: 'd' }).length === 1 && op(t, 'criar', { chave: 'documentos' }).length === 0);
  ok('...e 01_ROTEIRO entra nela; ela não é movida para dentro de si', moveu(t, 'r', 'documentos') && op(t, 'mover', { id: 'd' }).length === 0);
}

// ---- nomes ANTIGOS em caixa alta (criados antes de 16/11): são reconhecidos, nunca duplicados
{
  const d = drive().pasta('P', 'proj', null).pasta('d', '00_DOCUMENTOS', 'P').pasta('b', '01_BRUTO', 'P').pasta('ar', '02_ARTES', 'P').pasta('tr', '01_TRILHAS', 'ar')
    .pasta('ex', '03_EXPORT', 'P').pasta('rv', '01_REVISAO', 'ex').pasta('fn', '02_FINAL', 'ex').pasta('r', '01_ROTEIRO', 'P').pasta('e', '06_ENTREGA', 'P');
  const t = await plano(d);
  ok('nome antigo: 00_DOCUMENTOS, 01_BRUTO, 02_ARTES e 03_EXPORT são reaproveitadas, nenhuma é criada de novo', ['documentos', 'bruto', 'artes', 'export'].every(c => op(t, 'reusar', { chave: c }).length === 1) && op(t, 'criar').length === 0);
  ok('nome antigo: 01_TRILHAS, 01_REVISAO e 02_FINAL de dentro também são reaproveitadas', ['trilhas', 'revisao', 'final'].every(c => op(t, 'reusar', { chave: c }).length === 1));
  ok('nome antigo: a 00_DOCUMENTOS não é movida para dentro de si e o 01_ROTEIRO entra nela', op(t, 'mover', { id: 'd' }).length === 0 && moveu(t, 'r', 'documentos'));
}
{
  const d = drive().pasta('P', 'proj', null).pasta('ar', '02_artes', 'P').pasta('as', '04_ASSETS', 'P').pasta('tr', 'TRILHA', 'as').arq('m1', 'tema.wav', 'tr');
  const t = await plano(d);
  ok('caixa baixa (02_artes) também é a mesma pasta de 02_Artes', op(t, 'reusar', { chave: 'artes', id: 'ar' }).length === 1 && op(t, 'criar', { chave: 'artes' }).length === 0);
}

// ---- REGRA (Caio, 16/11): pasta vazia que NÃO é da estrutura vai para a lixeira. "Vazia" = nenhum arquivo, nem nas subpastas.
{
  // pasta vazia solta na raiz, e 04_ASSETS vazia: vão direto para a lixeira, sem serem movidas
  const d = drive().pasta('P', 'proj', null).pasta('v', '99_VAZIA', 'P').pasta('as', '04_ASSETS', 'P').pasta('os', 'OS', 'P').arq('o1', 'os.pdf', 'os');
  const t = await planoPuro(d);
  ok('regra: pasta vazia fora da estrutura (99_VAZIA) vai para a lixeira', op(t, 'lixeira', { id: 'v' }).length === 1 && t.ignorados.every(i => i.id !== 'v'));
  ok('regra: 04_ASSETS vazia vai para a lixeira em vez de ser movida para 02_Artes', op(t, 'lixeira', { id: 'as' }).length === 1 && op(t, 'mover', { id: 'as' }).length === 0);
  ok('regra: pasta com arquivo (OS) continua sendo movida, nunca lixeira', moveu(t, 'os', 'documentos') && op(t, 'lixeira', { id: 'os' }).length === 0);
  ok('regra: o motivo diz que é pasta vazia fora da estrutura', /vazia fora da estrutura/.test(op(t, 'lixeira', { id: 'v' })[0].motivo) && op(t, 'lixeira', { id: 'v' })[0].de === 'raiz');
  ok('regra: nada de exclusão definitiva e lixeira só de pasta sem arquivo', seguro(d, t));
}
{
  // pasta que só tem subpastas vazias (em qualquer profundidade): vai a de cima, com as subpastas junto, uma lixeira só
  const d = drive().pasta('P', 'proj', null).pasta('a', '99_A', 'P').pasta('b', 'B', 'a').pasta('c', 'C', 'b').pasta('b2', 'B2', 'a');
  const t = await planoPuro(d);
  ok('regra: só a pasta mais alta do trecho vazio vai para a lixeira (99_A), e lista as subpastas', op(t, 'lixeira').filter(l => l.id !== undefined && ['a', 'b', 'c', 'b2'].includes(l.id)).map(l => l.id).join() === 'a' && JSON.stringify(op(t, 'lixeira', { id: 'a' })[0].subpastas.sort()) === JSON.stringify(['B', 'B2', 'C']));
  ok('regra: trecho vazio, segurança', seguro(d, t));
}
{
  // arquivo lá no fundo: nada do caminho é lixeira
  const d = drive().pasta('P', 'proj', null).pasta('a', '99_A', 'P').pasta('b', 'B', 'a').pasta('c', 'C', 'b').arq('f', 'cena.mov', 'c');
  const t = await planoPuro(d);
  ok('regra: arquivo no fundo da árvore → nenhuma pasta do caminho vai para a lixeira', op(t, 'lixeira').length === 0 && t.ignorados.some(i => i.id === 'a'));
}
{
  // subpasta vazia dentro de pasta que tem arquivo: só a subpasta vai para a lixeira
  const d = drive().pasta('P', 'proj', null).pasta('a', '99_A', 'P').arq('f', 'cena.mov', 'a').pasta('x', 'Vazia', 'a').pasta('y', 'Cheia', 'a').arq('g', 'b.mov', 'y');
  const t = await planoPuro(d);
  ok('regra: subpasta vazia dentro de pasta com arquivo vai para a lixeira; a pasta e a Cheia ficam', op(t, 'lixeira').map(l => l.id).join() === 'x' && op(t, 'lixeira', { id: 'x' })[0].de === '99_A');
}
{
  // a ESTRUTURA fica sempre, mesmo vazia: 00_Documentos, 01_Bruto, 02_Artes, 01_Trilhas, 03_Export, 01_Revisao e 02_Final existentes
  const d = drive().pasta('P', 'proj', null).pasta('d', '00_Documentos', 'P').pasta('b', '01_BRUTO', 'P').pasta('ar', '02_Artes', 'P').pasta('tr', '01_Trilhas', 'ar')
    .pasta('ex', '03_Export', 'P').pasta('rv', '01_Revisao', 'ex').pasta('fn', '02_Final', 'ex');
  const t = await planoPuro(d);
  ok('regra: a estrutura vazia (até com nome antigo em caixa alta) NUNCA vai para a lixeira', op(t, 'lixeira').length === 0 && op(t, 'criar').length === 0);
}
{
  // 06_ENTREGA e as subpastas dela, vazias: uma lixeira só (a 06_ENTREGA), e o plano não fala mais em "pendência"
  const d = drive().pasta('P', 'proj', null).pasta('e', '06_ENTREGA', 'P').pasta('rev', '01_REVISAO', 'e').arq('v', 'v1.mp4', 'rev').pasta('f', 'Fotos', 'e');
  const t = await planoPuro(d);
  ok('regra: 06_ENTREGA só com uma subpasta vazia (Fotos) vai para a lixeira inteira, e a 01_REVISAO (com vídeo) segue para 03_Export', op(t, 'lixeira').map(l => l.id).join() === 'e' && op(t, 'mover', { id: 'rev', para: 'export' }).length === 1 && t.sobraEmEntrega.length === 0 && t.avisos.length === 0);
  ok('regra: 06_ENTREGA com subpasta vazia, segurança', seguro(d, t));
}
{
  // conflito de nome com uma pasta VAZIA: não vira CONFLITO, vai para a lixeira
  const d = drive().pasta('P', 'proj', null).pasta('ar', '02_Artes', 'P').pasta('x', '04_ASSETS', 'ar').arq('xf', 'a.png', 'x').pasta('as', '04_ASSETS', 'P');
  const t = await planoPuro(d);
  ok('regra: 04_ASSETS vazia que daria CONFLITO vai para a lixeira, sem CONFLITO', op(t, 'conflito').length === 0 && op(t, 'lixeira', { id: 'as' }).length === 1 && op(t, 'mover', { id: 'as' }).length === 0);
}
{
  // projeto grande demais: não varre, avisa, não manda nada para a lixeira por esta regra
  const d = drive().pasta('P', 'proj', null).pasta('g', '99_GRANDE', 'P');
  for (let i = 0; i <= LIMITE_PASTAS_VARREDURA; i++) d.pasta(`p${i}`, `sub${i}`, 'g');
  const t = await planoPuro(d);
  ok(`regra: mais de ${LIMITE_PASTAS_VARREDURA} pastas → não varre, avisa e não manda nada para a lixeira`, op(t, 'lixeira').length === 0 && t.avisos.some(a => /varredura de pastas vazias NÃO foi feita/.test(a)));
}
{
  // o plano nunca contém exclusão, em nenhum dos casos acima: só criar, reusar, mover, conflito e lixeira
  const d = drive().pasta('P', 'proj', null).pasta('v', 'Vazia', 'P');
  const t = await planoPuro(d);
  ok('regra: os passos são só criar/reusar/mover/conflito/lixeira (nunca exclusão definitiva)', t.passos.every(p => ['criar', 'reusar', 'mover', 'conflito', 'lixeira'].includes(p.op)));
}

// ---- sem 06_ENTREGA
{
  const d = drive().pasta('P', 'proj', null).pasta('a0', '00_GERAL', 'P');
  const t = await plano(d);
  ok('sem 06_ENTREGA: cria revisao e final vazias + avisa', op(t, 'criar', { chave: 'revisao' }).length === 1 && op(t, 'criar', { chave: 'final' }).length === 1 && t.avisos.length === 1);
}

// ---- sobra em 06_ENTREGA (itens fora do mapa não mexem)
{
  const d = drive().pasta('P', 'proj', null).pasta('e', '06_ENTREGA', 'P').pasta('rev', '01_REVISAO', 'e').arq('x', 'entrega-final.zip', 'e').pasta('o', 'Fotos', 'e');
  const t = await plano(d);
  ok('sobra em 06_ENTREGA é listada (não mexe)', t.sobraEmEntrega.map(s => s.id).sort().join() === 'o,x' && t.avisos.length >= 1 && op(t, 'lixeira').length === 0);
}

// ---- pasta do mesmo nome já no destino (OS da raiz × 00_Documentos/OS): MESCLA, não conflita (decisão do Caio, 16/11)
{
  // pastas de mesmo nome com um arquivo cada: o conteúdo da OS da raiz vai para a de dentro e a da raiz, que sobra vazia, vai para a lixeira
  const d = drive().pasta('P', 'proj', null).pasta('d', '00_Documentos', 'P').pasta('os', 'OS', 'P').pasta('os2', 'OS', 'd').pasta('r', '01_ROTEIRO', 'P').pasta('x', '01_ROTEIRO', 'd');
  const t = await plano(d);
  ok('mesmo nome (pasta) no alvo → sem conflito; a da raiz, que sobra vazia, vai para a lixeira', op(t, 'conflito').length === 0 && op(t, 'lixeira', { id: 'os' }).length === 1 && op(t, 'lixeira', { id: 'r' }).length === 1 && op(t, 'mover', { id: 'os' }).length === 0);
  ok('mesclar reaproveita a pasta que já existe no destino', op(t, 'reusar', { id: 'os2' }).length === 1 && op(t, 'reusar', { id: 'x' }).length === 1 && seguro(d, t));
}
{
  // OS da raiz com um PDF, 00_Documentos/OS já existe vazia: o PDF vai para lá e a OS da raiz vai para a lixeira
  const d = drive().pasta('P', 'proj', null).pasta('d', '00_Documentos', 'P').pasta('os', 'OS', 'P').arq('pdf', 'OS-279.pdf', 'os').pasta('os2', 'OS', 'd');
  const t = await plano(d);
  const mov = op(t, 'mover', { id: 'pdf' })[0];
  ok('OS da raiz com PDF: o PDF vai para 00_Documentos/OS', !!mov && mov.para === '00_Documentos/OS');
  ok('...e a OS da raiz, esvaziada, vai para a lixeira (nada é apagado)', op(t, 'lixeira', { id: 'os' }).length === 1 && op(t, 'conflito').length === 0 && seguro(d, t));
  ok('a pasta OS de dentro é reaproveitada (mesmo ID) e vem ANTES do movimento', op(t, 'reusar', { id: 'os2' }).length === 1 && t.passos.findIndex(p => p.op === 'reusar' && p.id === 'os2') < t.passos.findIndex(p => p.op === 'mover' && p.id === 'pdf'));
}
{
  // arquivo de mesmo nome já dentro de 00_Documentos/OS: esse continua sendo CONFLITO e a OS da raiz NÃO é apagada
  const d = drive().pasta('P', 'proj', null).pasta('d', '00_Documentos', 'P').pasta('os', 'OS', 'P').arq('pdf', 'OS-279.pdf', 'os').arq('pdf2', 'OS-279.pdf', 'os').pasta('os2', 'OS', 'd').arq('ja', 'os-279.pdf', 'os2');
  const t = await plano(d);
  ok('nome repetido DENTRO da OS: conflito, nunca sobrescreve', op(t, 'conflito').length >= 1 && op(t, 'mover', { id: 'pdf' }).length + op(t, 'mover', { id: 'pdf2' }).length === 0);
  ok('...e a OS da raiz não vai para a lixeira (ainda tem coisa)', op(t, 'lixeira', { id: 'os' }).length === 0 && seguro(d, t));
}

// ---- 06_ENTREGA/03_REDES e 04_THUMB: conteúdo → 02_Final, pastas vazias → lixeira
{
  const d = drive().pasta('P', 'proj', null).pasta('e', '06_ENTREGA', 'P').pasta('apr', '02_APROVADO', 'e').arq('v', 'filme.mp4', 'apr')
    .pasta('rd', '03_REDES', 'e').arq('r1', 'reels.mp4', 'rd').pasta('r2', 'stories', 'rd')
    .pasta('th', '04_THUMB', 'e').arq('t1', 'capa.jpg', 'th');
  const t = await plano(d);
  ok('REDES/THUMB: cada item do conteúdo vai para 02_Final', moveu(t, 'r1', 'final') && moveu(t, 'r2', 'final') && moveu(t, 't1', 'final'));
  ok('REDES/THUMB: as pastas, esvaziadas, vão para a lixeira (e não são movidas)', op(t, 'lixeira', { id: 'rd' }).length === 1 && op(t, 'lixeira', { id: 'th' }).length === 1 && op(t, 'mover', { id: 'rd' }).length === 0);
  ok('REDES/THUMB: a lixeira vem depois dos movimentos do conteúdo', t.passos.findIndex(p => p.op === 'lixeira' && p.id === 'rd') > t.passos.findIndex(p => p.op === 'mover' && p.id === 'r2'));
  ok('REDES/THUMB: não saem mais da 06_ENTREGA nenhuma sobra', t.sobraEmEntrega.length === 0);
  ok('REDES/THUMB: segurança', seguro(d, t));
}
// nomes iguais entre REDES e THUMB, e nome já existente no FINAL: conflito, não sobrescreve, pasta fica
{
  const d = drive().pasta('P', 'proj', null).pasta('e', '06_ENTREGA', 'P').pasta('apr', '02_APROVADO', 'e').arq('v', 'capa.jpg', 'apr')
    .pasta('rd', '03_REDES', 'e').arq('r1', 'teaser.mp4', 'rd').arq('r2', 'capa.jpg', 'rd')
    .pasta('th', '04_THUMB', 'e').arq('t1', 'teaser.mp4', 'th').arq('t2', 'thumb.png', 'th');
  const t = await plano(d);
  ok('conflito com o que já está no FINAL: o item de REDES fica e a pasta REDES não vai para a lixeira', op(t, 'conflito', { id: 'r2' }).length === 1 && op(t, 'lixeira', { id: 'rd' }).length === 0 && moveu(t, 'r1', 'final'));
  ok('conflito entre REDES e THUMB (mesmo nome): o segundo fica e THUMB não vai para a lixeira', op(t, 'conflito', { id: 't1' }).length === 1 && moveu(t, 't2', 'final') && op(t, 'lixeira', { id: 'th' }).length === 0);
  ok('conflito: as duas pastas continuam em 06_ENTREGA (sobra listada)', t.sobraEmEntrega.map(s => s.id).sort().join() === 'rd,th');
  ok('conflito: segurança', seguro(d, t));
}
// REDES/THUMB sem 02_APROVADO: o FINAL é criado e recebe o conteúdo
{
  const d = drive().pasta('P', 'proj', null).pasta('e', '06_ENTREGA', 'P').pasta('rd', '03_REDES', 'e').arq('r1', 'reels.mp4', 'rd');
  const t = await plano(d);
  ok('sem 02_APROVADO: cria 02_Final e leva o conteúdo de REDES para ela', op(t, 'criar', { chave: 'final' }).length === 1 && moveu(t, 'r1', 'final') && op(t, 'lixeira', { id: 'rd' }).length === 1);
}
// nomes de REDES/THUMB com outra caixa; outras pastas de 06_ENTREGA não entram nessa regra
{
  const d = drive().pasta('P', 'proj', null).pasta('e', '06_ENTREGA', 'P').pasta('rd', '03_redes', 'e').arq('r1', 'a.mp4', 'rd').pasta('x', '05_OUTRA', 'e').arq('x1', 'b.mp4', 'x');
  const t = await plano(d);
  ok('03_redes (caixa baixa) também vale; 05_OUTRA dentro de 06_ENTREGA não é tocada', moveu(t, 'r1', 'final') && op(t, 'mover', { id: 'x1' }).length === 0 && t.sobraEmEntrega.some(s => s.id === 'x'));
}

// ---- backup de câmera → 01_Bruto
{
  const d = drive().pasta('P', 'proj', null).pasta('e', '06_ENTREGA', 'P').pasta('apr', '02_APROVADO', 'e')
    .arq('c1', 'CAM_1A_BKP_2610211103_0002.mp4', 'apr').arq('ok1', 'filme.mp4', 'apr').pasta('cf', 'CAM_1B_BKP_pasta', 'apr')
    .pasta('rd', '03_REDES', 'e').arq('c2', 'CAM_2A_BKP_0001.mov', 'rd').arq('r1', 'reels.mp4', 'rd')
    .arq('solto', 'CAM_9Z_BKP_0009.mp4', 'P');
  const t = await plano(d);
  ok('CAM_…_BKP_ em 02_APROVADO vai para 01_Bruto (e ficam de fora o filme e a PASTA com esse nome)', moveu(t, 'c1', 'bruto') && op(t, 'mover', { id: 'ok1' }).length === 0 && op(t, 'mover', { id: 'cf' }).length === 0);
  ok('CAM_…_BKP_ dentro de REDES vai para 01_Bruto, não para 02_Final', moveu(t, 'c2', 'bruto') && !moveu(t, 'c2', 'final') && moveu(t, 'r1', 'final'));
  ok('CAM_…_BKP_ solto na raiz do projeto não é tocado (só se olha a entrega)', op(t, 'mover', { id: 'solto' }).length === 0 && t.ignorados.some(i => i.id === 'solto'));
  ok('backup de câmera: cada item é movido uma vez só', t.passos.filter(p => p.op === 'mover').map(p => p.id).every((id, i, a) => a.indexOf(id) === i));
  ok('backup de câmera: segurança', seguro(d, t));
}
{
  const d = drive().pasta('P', 'proj', null).pasta('b', '01_Bruto', 'P').arq('ja', 'CAM_1A_BKP_x.mp4', 'b').pasta('e', '06_ENTREGA', 'P').pasta('apr', '02_APROVADO', 'e').arq('c1', 'CAM_1A_BKP_x.mp4', 'apr');
  const t = await plano(d);
  ok('backup de câmera com nome que já existe em 01_Bruto: CONFLITO, não sobrescreve', op(t, 'conflito', { id: 'c1' }).length === 1 && op(t, 'mover', { id: 'c1' }).length === 0);
}

// ---- 05_POS_PRODUCAO
{
  const d = drive().pasta('P', 'proj', null).pasta('pp', '05_POS_PRODUCAO', 'P').pasta('o', '05_OUTRA', 'P').arq('o1', 'x.psd', 'o');
  const t = await planoPuro(d);
  ok('05_POS_PRODUCAO vazia → lixeira (não é movida)', op(t, 'lixeira', { id: 'pp' }).length === 1 && op(t, 'mover', { id: 'pp' }).length === 0);
  ok('outras 05_* continuam indo para 02_Artes', moveu(t, 'o', 'artes'));
  ok('05_POS_PRODUCAO vazia: segurança', seguro(d, t));
  d.arq('p1', 'corte.prproj', 'pp').pasta('p2', 'Projetos', 'pp');
  const t2 = await plano(d);
  ok('05_POS_PRODUCAO com conteúdo: NÃO vai para a lixeira, vai inteira para 01_Bruto', op(t2, 'lixeira', { id: 'pp' }).length === 0 && moveu(t2, 'pp', 'bruto'));
  ok('05_POS_PRODUCAO com conteúdo: o plano lista o que há dentro', JSON.stringify(op(t2, 'mover', { id: 'pp' })[0].conteudo.sort()) === JSON.stringify(['Projetos', 'corte.prproj']) && /não é apagada/.test(op(t2, 'mover', { id: 'pp' })[0].nota));
  ok('05_POS_PRODUCAO com conteúdo: segurança', seguro(d, t2));
}

// ---- 03_CAPTACAO/BRUTO redundante
{
  const d = drive().pasta('P', 'proj', null).pasta('c', '03_CAPTACAO', 'P').pasta('b', 'BRUTO', 'c').pasta('d1', 'DIA 1', 'b').arq('f1', 'cena.mov', 'b');
  const t = await plano(d);
  ok('03_CAPTACAO só com BRUTO: o conteúdo da BRUTO vai direto para 01_Bruto', moveu(t, 'd1', 'bruto') && moveu(t, 'f1', 'bruto'));
  ok('...BRUTO e 03_CAPTACAO, esvaziadas, vão para a lixeira (BRUTO antes), e 03_CAPTACAO não é movida', op(t, 'lixeira', { id: 'b' }).length === 1 && op(t, 'lixeira', { id: 'c' }).length === 1 && op(t, 'mover', { id: 'c' }).length === 0 && t.passos.findIndex(p => p.id === 'b' && p.op === 'lixeira') < t.passos.findIndex(p => p.id === 'c' && p.op === 'lixeira'));
  ok('...segurança', seguro(d, t));
  d.pasta('x', 'AUDIO', 'c').arq('x1', 'leia-me.txt', 'c');
  const t2 = await plano(d);
  ok('03_CAPTACAO com BRUTO e mais coisas (AUDIO, arquivo): tudo sobe para 01_Bruto, sem invólucro com nome antigo', moveu(t2, 'f1', 'bruto') && moveu(t2, 'x', 'bruto') && moveu(t2, 'x1', 'bruto') && op(t2, 'mover', { id: 'c' }).length === 0);
  ok('...BRUTO e depois 03_CAPTACAO, vazias, vão para a lixeira', op(t2, 'lixeira', { id: 'b' }).length === 1 && op(t2, 'lixeira', { id: 'c' }).length === 1 && t2.passos.findIndex(p => p.id === 'b' && p.op === 'lixeira') < t2.passos.findIndex(p => p.id === 'c' && p.op === 'lixeira'));
  ok('...segurança', seguro(d, t2));
  const dc = drive().pasta('P', 'proj', null).pasta('bb', '01_Bruto', 'P').pasta('au0', 'AUDIO', 'bb').pasta('c', '03_CAPTACAO', 'P').pasta('b', 'BRUTO', 'c').arq('f1', 'cena.mov', 'b').pasta('au', 'AUDIO', 'c');
  const tc = await plano(dc);
  ok('irmã da BRUTO com nome que já existe em 01_Bruto: conflito, 03_CAPTACAO NÃO vai para a lixeira e entra inteira em 01_Bruto', op(tc, 'conflito', { id: 'au' }).length === 1 && moveu(tc, 'f1', 'bruto') && op(tc, 'lixeira', { id: 'c' }).length === 0 && moveu(tc, 'c', 'bruto') && op(tc, 'lixeira', { id: 'b' }).length === 1);
  ok('...segurança', seguro(dc, tc));
  const d3 = drive().pasta('P', 'proj', null).pasta('bb', '01_Bruto', 'P').arq('ja', 'cena.mov', 'bb').pasta('c', '03_CAPTACAO', 'P').pasta('b', 'bruto', 'c').arq('f1', 'cena.mov', 'b').arq('f2', 'outra.mov', 'b');
  const t3 = await plano(d3);
  ok('nome repetido ao subir a BRUTO: conflito (não sobrescreve), a BRUTO NÃO vai para a lixeira e 03_CAPTACAO segue inteira', op(t3, 'conflito', { id: 'f1' }).length === 1 && moveu(t3, 'f2', 'bruto') && op(t3, 'lixeira').length === 0 && moveu(t3, 'c', 'bruto'));
  ok('...segurança', seguro(d3, t3));
  const d4 = drive().pasta('P', 'proj', null).pasta('c', '03_CAPTACAO', 'P').arq('f', 'cena.mov', 'c');
  const t4 = await plano(d4);
  ok('03_CAPTACAO sem BRUTO: vai inteira para 01_Bruto, como antes', moveu(t4, 'c', 'bruto') && op(t4, 'lixeira').length === 0);
}

// ---- 04_ASSETS/TRILHA
{
  const d = drive().pasta('P', 'proj', null).pasta('as', '04_ASSETS', 'P').pasta('tr', 'TRILHA', 'as').arq('m1', 'tema.wav', 'tr').arq('m2', 'fundo.mp3', 'tr').pasta('lg', 'LOGOS', 'as');
  const t = await plano(d);
  ok('04_ASSETS/TRILHA: o conteúdo vai para 02_Artes/01_Trilhas (mesclado)', moveu(t, 'm1', 'trilhas') && moveu(t, 'm2', 'trilhas'));
  ok('...a TRILHA vazia vai para a lixeira (não duplica) e 04_ASSETS segue inteira para 02_Artes', op(t, 'lixeira', { id: 'tr' }).length === 1 && moveu(t, 'as', 'artes') && op(t, 'mover', { id: 'tr' }).length === 0);
  ok('...segurança', seguro(d, t));
  const d2 = drive().pasta('P', 'proj', null).pasta('ar', '02_Artes', 'P').pasta('tt', '01_Trilhas', 'ar').arq('x', 'tema.wav', 'tt')
    .pasta('as', '04_ASSETS', 'P').pasta('tr', 'trilhas', 'as').arq('m1', 'tema.wav', 'tr').arq('m2', 'novo.wav', 'tr');
  const t2 = await plano(d2);
  ok('01_Trilhas já existente é reaproveitada; arquivo de mesmo nome → conflito e a TRILHA fica (sem lixeira)', op(t2, 'reusar', { chave: 'trilhas', id: 'tt' }).length === 1 && op(t2, 'conflito', { id: 'm1' }).length === 1 && moveu(t2, 'm2', 'trilhas') && op(t2, 'lixeira').length === 0);
  ok('...segurança', seguro(d2, t2));
  const d3 = drive().pasta('P', 'proj', null).pasta('ar', '02_Artes', 'P').pasta('as', '04_ASSETS', 'P').pasta('tr', 'TRILHA', 'as').arq('m1', 'tema.wav', 'tr').pasta('as2', '04_ASSETS', 'ar');
  const t3 = await plano(d3);
  ok('04_ASSETS já existe dentro de 02_Artes: conflito e a TRILHA nem é mexida', op(t3, 'conflito', { id: 'as' }).length === 1 && op(t3, 'mover', { id: 'm1' }).length === 0 && op(t3, 'lixeira').length === 0);
  const d4 = drive().pasta('P', 'proj', null).pasta('ed', '04_EDICAO', 'P').pasta('tr', 'TRILHA', 'ed').arq('m', 'a.wav', 'tr');
  ok('TRILHA só é mesclada dentro de pasta 04_*; em outra pasta nada acontece com ela', moveu(await plano(d4), 'm', 'trilhas') && op(await plano(drive().pasta('P', 'proj', null).pasta('x', '03_CAPT', 'P').pasta('tr', 'TRILHA', 'x')), 'lixeira').length === 0);
}

// ---- já parcialmente migrado
{
  const d = drive().pasta('P', 'proj', null).pasta('d', '00_Documentos', 'P').pasta('b', '01_Bruto', 'P').pasta('ar', '02_Artes', 'P').pasta('tt', '01_Trilhas', 'ar')
    .pasta('ex', '03_Export', 'P').pasta('rv', '01_REVISAO', 'ex').pasta('fn', '02_Final', 'ex');
  const t = await plano(d);
  ok('estrutura nova já existente: tudo reaproveitado, nada criado nem movido', t.passos.every(p => p.op === 'reusar') && t.passos.length === 7);
}
{
  const d = drive().pasta('P', 'proj', null).pasta('x', '06_OUTRA', 'P');
  ok('06_ que não é ENTREGA fica (ignorada com motivo)', (await plano(d)).ignorados.some(i => i.id === 'x'));
}

// ---- caminho até o mês: Cliente › Projetos › [sub-marca] › AAAA-MM
ok('caminho sem marca: Projetos/AAAA-MM', caminhoDoMes(null, '2026-10').join('/') === 'Projetos/2026-10' && caminhoDoMes('  ', '2026-10').join('/') === 'Projetos/2026-10');
ok('caminho com sub-marca DENTRO de Projetos', caminhoDoMes('Uniasselvi', '2026-10').join('/') === 'Projetos/Uniasselvi/2026-10');
ok('caminho: barra na marca não cria nível extra', caminhoDoMes('A/B', '2026-10').join('/') === 'Projetos/A-B/2026-10');

// ---- pasta de materiais fixos do cliente (_ASSETS → Marca)
const pasta = (id, name) => ({ id, name, isFolder: true });
ok('_ASSETS sozinha → renomear (mesmo ID)', JSON.stringify(planejarMarcaDoCliente([pasta('as', '_ASSETS'), pasta('x', '2026-10')])) === JSON.stringify({ acao: 'renomear', id: 'as', de: '_ASSETS', para: 'Marca' }));
ok('MARCA e _ASSETS juntas → conflito (não renomeia)', planejarMarcaDoCliente([pasta('as', '_ASSETS'), pasta('m', 'MARCA')]).acao === 'conflito');
ok('duas _ASSETS → conflito', planejarMarcaDoCliente([pasta('a1', '_ASSETS'), pasta('a2', '_ASSETS')]).acao === 'conflito');
ok('já é MARCA (nome antigo) → nada a fazer', planejarMarcaDoCliente([pasta('m', 'MARCA')]).acao === 'ja-esta');
ok('já é Marca (nome novo) → nada a fazer', planejarMarcaDoCliente([pasta('m', 'Marca')]).acao === 'ja-esta');
ok('_assets em minúsculas também é reconhecida e renomeada', planejarMarcaDoCliente([pasta('as', '_assets')]).acao === 'renomear');
ok('Marca e _ASSETS juntas (nome novo) → conflito', planejarMarcaDoCliente([pasta('as', '_ASSETS'), pasta('m', 'Marca')]).acao === 'conflito');
ok('sem nenhuma das duas → nada', planejarMarcaDoCliente([pasta('x', 'Projetos')]).acao === 'nada');
ok('arquivo chamado _ASSETS não conta como pasta', planejarMarcaDoCliente([{ id: 'f', name: '_ASSETS', isFolder: false }]).acao === 'nada');

// ---- mês
ok('mês: data_inicio pura', mesDoProjeto('2026-11-01', '2026-10-01T12:00:00Z') === '2026-11');
ok('mês: created_at em São Paulo (01/11 01:00 UTC = 31/10)', mesDoProjeto(null, '2026-11-01T01:00:00Z') === '2026-10');
let erro = false; try { mesDoProjeto(null, null); } catch { erro = true; }
ok('mês: sem datas → erro', erro);

// ---- SQL
const ids = Object.fromEntries(Object.keys(NOMES).map(k => [k, 'id_' + k]));
const sql = sqlDeAtualizacao("p'1", ids);
ok('SQL: v2, upload=revisão, jsonb, filtro v1, aspas escapadas', /drive_layout = 'v2'/.test(sql) && /drive_upload_folder_id = 'id_revisao'/.test(sql) && /::jsonb/.test(sql) && /drive_layout = 'v1'/.test(sql) && /id = 'p''1'/.test(sql));
let err2 = false; try { sqlDeAtualizacao('p', { ...ids, final: '' }); } catch { err2 = true; }
ok('SQL: ID faltando → erro (não gera SQL pela metade)', err2);

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo');
process.exit(falhas ? 1 : 0);
