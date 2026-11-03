// Testa o planejador (supabase/functions/drive-migracao/plano.mjs) contra árvores de Drive em memória. Nada de rede.
// Rodar:  node scripts/drive-migracao/plano.test.mjs
import {
  NOMES, caminhoDoMes, destinoDaPastaAntiga, ehBackupDeCamera, mesDoProjeto, planejarMarcaDoCliente, planejarProjeto, sqlDeAtualizacao,
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
const plano = (d, opcoes) => planejarProjeto({ raizId: 'P', listar: d.listar, opcoes });
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
  const vazias = lixeiras.every(l => [...d.nos.values()].filter(n => n.pai === l.id).every(f => saem.has(f.id)));
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
  ok('típico: 01_REVISAO é movida (mantém o nome, registra revisao)', op(t, 'mover', { id: 'rev', para: 'export', registra: 'revisao' }).length === 1 && !op(t, 'mover', { id: 'rev' })[0].renomearPara);
  ok('típico: 02_APROVADO é movida e renomeada para 02_FINAL', op(t, 'mover', { id: 'apr', para: 'export', renomearPara: '02_FINAL', registra: 'final' }).length === 1);
  ok('típico: 00/01/02 e OS vão para documentos', ['a0', 'a1', 'a2', 'os'].every(id => moveu(t, id, 'documentos')));
  ok('típico: 03 → bruto; 04/05 → artes', moveu(t, 'a3', 'bruto') && moveu(t, 'a4', 'artes') && moveu(t, 'a5', 'artes'));
  ok('típico: 06_ENTREGA não é movida nem renomeada', t.passos.every(p => p.id !== 'a6'));
  ok('típico: 99_DUPLICADOS e arquivo solto ficam (ignorados)', t.ignorados.map(i => i.id).sort().join() === 'dup,f1');
  ok('típico: 06_ENTREGA ficará vazia e o plano avisa (NÃO a apaga sem a opção)', t.sobraEmEntrega.length === 0 && t.avisos.some(a => /VAZIA/.test(a)) && op(t, 'lixeira').length === 0);
  ok('típico: nenhuma renomeação além de 02_APROVADO→02_FINAL', t.passos.filter(p => p.renomearPara).length === 1);
  ok('típico: segurança (sem exclusão; lixeira só de pasta vazia)', seguro(d, t));
  const comOpcao = await plano(d, { entregaVaziaParaLixeira: true });
  ok('opção entrega_vazia_para_lixeira: 06_ENTREGA vazia vai para a lixeira, por último', op(comOpcao, 'lixeira', { id: 'a6' }).length === 1 && comOpcao.passos.at(-1).id === 'a6' && seguro(d, comOpcao));
}

// ---- 00 já se chama 00_DOCUMENTOS: vira o alvo, não duplica
{
  const d = drive().pasta('P', 'proj', null).pasta('d', '00_DOCUMENTOS', 'P').pasta('r', '01_ROTEIRO', 'P').pasta('e', '06_ENTREGA', 'P');
  const t = await plano(d);
  ok('00_DOCUMENTOS existente é reaproveitada (sem criar outra)', op(t, 'reusar', { chave: 'documentos', id: 'd' }).length === 1 && op(t, 'criar', { chave: 'documentos' }).length === 0);
  ok('...e 01_ROTEIRO entra nela; ela não é movida para dentro de si', moveu(t, 'r', 'documentos') && op(t, 'mover', { id: 'd' }).length === 0);
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

// ---- conflito: OS da raiz × 00_DOCUMENTOS/OS
{
  const d = drive().pasta('P', 'proj', null).pasta('d', '00_DOCUMENTOS', 'P').pasta('os', 'OS', 'P').pasta('os2', 'OS', 'd').pasta('r', '01_ROTEIRO', 'P').pasta('x', '01_ROTEIRO', 'd');
  const t = await plano(d);
  ok('mesmo nome já no alvo → conflito (não move, não sobrescreve)', op(t, 'conflito', { id: 'os' }).length === 1 && op(t, 'conflito', { id: 'r' }).length === 1 && op(t, 'mover', { id: 'os' }).length === 0 && op(t, 'mover', { id: 'r' }).length === 0);
}

// ---- 06_ENTREGA/03_REDES e 04_THUMB: conteúdo → 02_FINAL, pastas vazias → lixeira
{
  const d = drive().pasta('P', 'proj', null).pasta('e', '06_ENTREGA', 'P').pasta('apr', '02_APROVADO', 'e').arq('v', 'filme.mp4', 'apr')
    .pasta('rd', '03_REDES', 'e').arq('r1', 'reels.mp4', 'rd').pasta('r2', 'stories', 'rd')
    .pasta('th', '04_THUMB', 'e').arq('t1', 'capa.jpg', 'th');
  const t = await plano(d);
  ok('REDES/THUMB: cada item do conteúdo vai para 02_FINAL', moveu(t, 'r1', 'final') && moveu(t, 'r2', 'final') && moveu(t, 't1', 'final'));
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
  ok('sem 02_APROVADO: cria 02_FINAL e leva o conteúdo de REDES para ela', op(t, 'criar', { chave: 'final' }).length === 1 && moveu(t, 'r1', 'final') && op(t, 'lixeira', { id: 'rd' }).length === 1);
}
// nomes de REDES/THUMB com outra caixa; outras pastas de 06_ENTREGA não entram nessa regra
{
  const d = drive().pasta('P', 'proj', null).pasta('e', '06_ENTREGA', 'P').pasta('rd', '03_redes', 'e').arq('r1', 'a.mp4', 'rd').pasta('x', '05_OUTRA', 'e').arq('x1', 'b.mp4', 'x');
  const t = await plano(d);
  ok('03_redes (caixa baixa) também vale; 05_OUTRA dentro de 06_ENTREGA não é tocada', moveu(t, 'r1', 'final') && op(t, 'mover', { id: 'x1' }).length === 0 && t.sobraEmEntrega.some(s => s.id === 'x'));
}

// ---- backup de câmera → 01_BRUTO
{
  const d = drive().pasta('P', 'proj', null).pasta('e', '06_ENTREGA', 'P').pasta('apr', '02_APROVADO', 'e')
    .arq('c1', 'CAM_1A_BKP_2610211103_0002.mp4', 'apr').arq('ok1', 'filme.mp4', 'apr').pasta('cf', 'CAM_1B_BKP_pasta', 'apr')
    .pasta('rd', '03_REDES', 'e').arq('c2', 'CAM_2A_BKP_0001.mov', 'rd').arq('r1', 'reels.mp4', 'rd')
    .arq('solto', 'CAM_9Z_BKP_0009.mp4', 'P');
  const t = await plano(d);
  ok('CAM_…_BKP_ em 02_APROVADO vai para 01_BRUTO (e ficam de fora o filme e a PASTA com esse nome)', moveu(t, 'c1', 'bruto') && op(t, 'mover', { id: 'ok1' }).length === 0 && op(t, 'mover', { id: 'cf' }).length === 0);
  ok('CAM_…_BKP_ dentro de REDES vai para 01_BRUTO, não para 02_FINAL', moveu(t, 'c2', 'bruto') && !moveu(t, 'c2', 'final') && moveu(t, 'r1', 'final'));
  ok('CAM_…_BKP_ solto na raiz do projeto não é tocado (só se olha a entrega)', op(t, 'mover', { id: 'solto' }).length === 0 && t.ignorados.some(i => i.id === 'solto'));
  ok('backup de câmera: cada item é movido uma vez só', t.passos.filter(p => p.op === 'mover').map(p => p.id).every((id, i, a) => a.indexOf(id) === i));
  ok('backup de câmera: segurança', seguro(d, t));
}
{
  const d = drive().pasta('P', 'proj', null).pasta('b', '01_BRUTO', 'P').arq('ja', 'CAM_1A_BKP_x.mp4', 'b').pasta('e', '06_ENTREGA', 'P').pasta('apr', '02_APROVADO', 'e').arq('c1', 'CAM_1A_BKP_x.mp4', 'apr');
  const t = await plano(d);
  ok('backup de câmera com nome que já existe em 01_BRUTO: CONFLITO, não sobrescreve', op(t, 'conflito', { id: 'c1' }).length === 1 && op(t, 'mover', { id: 'c1' }).length === 0);
}

// ---- 05_POS_PRODUCAO
{
  const d = drive().pasta('P', 'proj', null).pasta('pp', '05_POS_PRODUCAO', 'P').pasta('o', '05_OUTRA', 'P').arq('o1', 'x.psd', 'o');
  const t = await plano(d);
  ok('05_POS_PRODUCAO vazia → lixeira (não é movida)', op(t, 'lixeira', { id: 'pp' }).length === 1 && op(t, 'mover', { id: 'pp' }).length === 0);
  ok('outras 05_* continuam indo para 02_ARTES', moveu(t, 'o', 'artes'));
  ok('05_POS_PRODUCAO vazia: segurança', seguro(d, t));
  d.arq('p1', 'corte.prproj', 'pp').pasta('p2', 'Projetos', 'pp');
  const t2 = await plano(d);
  ok('05_POS_PRODUCAO com conteúdo: NÃO vai para a lixeira, vai inteira para 01_BRUTO', op(t2, 'lixeira', { id: 'pp' }).length === 0 && moveu(t2, 'pp', 'bruto'));
  ok('05_POS_PRODUCAO com conteúdo: o plano lista o que há dentro', JSON.stringify(op(t2, 'mover', { id: 'pp' })[0].conteudo.sort()) === JSON.stringify(['Projetos', 'corte.prproj']) && /não é apagada/.test(op(t2, 'mover', { id: 'pp' })[0].nota));
  ok('05_POS_PRODUCAO com conteúdo: segurança', seguro(d, t2));
}

// ---- 03_CAPTACAO/BRUTO redundante
{
  const d = drive().pasta('P', 'proj', null).pasta('c', '03_CAPTACAO', 'P').pasta('b', 'BRUTO', 'c').pasta('d1', 'DIA 1', 'b').arq('f1', 'cena.mov', 'b');
  const t = await plano(d);
  ok('03_CAPTACAO só com BRUTO: o conteúdo da BRUTO vai direto para 01_BRUTO', moveu(t, 'd1', 'bruto') && moveu(t, 'f1', 'bruto'));
  ok('...BRUTO e 03_CAPTACAO, esvaziadas, vão para a lixeira (BRUTO antes), e 03_CAPTACAO não é movida', op(t, 'lixeira', { id: 'b' }).length === 1 && op(t, 'lixeira', { id: 'c' }).length === 1 && op(t, 'mover', { id: 'c' }).length === 0 && t.passos.findIndex(p => p.id === 'b' && p.op === 'lixeira') < t.passos.findIndex(p => p.id === 'c' && p.op === 'lixeira'));
  ok('...segurança', seguro(d, t));
  d.pasta('x', 'ANOTACOES', 'c');
  const t2 = await plano(d);
  ok('03_CAPTACAO com outras coisas além da BRUTO: o conteúdo da BRUTO sobe, e a 03_CAPTACAO (com o resto) vai inteira para 01_BRUTO', moveu(t2, 'f1', 'bruto') && moveu(t2, 'c', 'bruto') && op(t2, 'lixeira', { id: 'b' }).length === 1 && op(t2, 'lixeira', { id: 'c' }).length === 0);
  ok('...segurança', seguro(d, t2));
  const d3 = drive().pasta('P', 'proj', null).pasta('bb', '01_BRUTO', 'P').arq('ja', 'cena.mov', 'bb').pasta('c', '03_CAPTACAO', 'P').pasta('b', 'bruto', 'c').arq('f1', 'cena.mov', 'b').arq('f2', 'outra.mov', 'b');
  const t3 = await plano(d3);
  ok('nome repetido ao subir a BRUTO: conflito (não sobrescreve), a BRUTO NÃO vai para a lixeira e 03_CAPTACAO segue inteira', op(t3, 'conflito', { id: 'f1' }).length === 1 && moveu(t3, 'f2', 'bruto') && op(t3, 'lixeira').length === 0 && moveu(t3, 'c', 'bruto'));
  ok('...segurança', seguro(d3, t3));
  const d4 = drive().pasta('P', 'proj', null).pasta('c', '03_CAPTACAO', 'P').arq('f', 'cena.mov', 'c');
  const t4 = await plano(d4);
  ok('03_CAPTACAO sem BRUTO: vai inteira para 01_BRUTO, como antes', moveu(t4, 'c', 'bruto') && op(t4, 'lixeira').length === 0);
}

// ---- 04_ASSETS/TRILHA
{
  const d = drive().pasta('P', 'proj', null).pasta('as', '04_ASSETS', 'P').pasta('tr', 'TRILHA', 'as').arq('m1', 'tema.wav', 'tr').arq('m2', 'fundo.mp3', 'tr').pasta('lg', 'LOGOS', 'as');
  const t = await plano(d);
  ok('04_ASSETS/TRILHA: o conteúdo vai para 02_ARTES/01_TRILHAS (mesclado)', moveu(t, 'm1', 'trilhas') && moveu(t, 'm2', 'trilhas'));
  ok('...a TRILHA vazia vai para a lixeira (não duplica) e 04_ASSETS segue inteira para 02_ARTES', op(t, 'lixeira', { id: 'tr' }).length === 1 && moveu(t, 'as', 'artes') && op(t, 'mover', { id: 'tr' }).length === 0);
  ok('...segurança', seguro(d, t));
  const d2 = drive().pasta('P', 'proj', null).pasta('ar', '02_ARTES', 'P').pasta('tt', '01_TRILHAS', 'ar').arq('x', 'tema.wav', 'tt')
    .pasta('as', '04_ASSETS', 'P').pasta('tr', 'trilhas', 'as').arq('m1', 'tema.wav', 'tr').arq('m2', 'novo.wav', 'tr');
  const t2 = await plano(d2);
  ok('01_TRILHAS já existente é reaproveitada; arquivo de mesmo nome → conflito e a TRILHA fica (sem lixeira)', op(t2, 'reusar', { chave: 'trilhas', id: 'tt' }).length === 1 && op(t2, 'conflito', { id: 'm1' }).length === 1 && moveu(t2, 'm2', 'trilhas') && op(t2, 'lixeira').length === 0);
  ok('...segurança', seguro(d2, t2));
  const d3 = drive().pasta('P', 'proj', null).pasta('ar', '02_ARTES', 'P').pasta('as', '04_ASSETS', 'P').pasta('tr', 'TRILHA', 'as').arq('m1', 'tema.wav', 'tr').pasta('as2', '04_ASSETS', 'ar');
  const t3 = await plano(d3);
  ok('04_ASSETS já existe dentro de 02_ARTES: conflito e a TRILHA nem é mexida', op(t3, 'conflito', { id: 'as' }).length === 1 && op(t3, 'mover', { id: 'm1' }).length === 0 && op(t3, 'lixeira').length === 0);
  const d4 = drive().pasta('P', 'proj', null).pasta('ed', '04_EDICAO', 'P').pasta('tr', 'TRILHA', 'ed').arq('m', 'a.wav', 'tr');
  ok('TRILHA só é mesclada dentro de pasta 04_*; em outra pasta nada acontece com ela', moveu(await plano(d4), 'm', 'trilhas') && op(await plano(drive().pasta('P', 'proj', null).pasta('x', '03_CAPT', 'P').pasta('tr', 'TRILHA', 'x')), 'lixeira').length === 0);
}

// ---- já parcialmente migrado
{
  const d = drive().pasta('P', 'proj', null).pasta('d', '00_DOCUMENTOS', 'P').pasta('b', '01_BRUTO', 'P').pasta('ar', '02_ARTES', 'P').pasta('tt', '01_TRILHAS', 'ar')
    .pasta('ex', '03_EXPORT', 'P').pasta('rv', '01_REVISAO', 'ex').pasta('fn', '02_FINAL', 'ex');
  const t = await plano(d);
  ok('estrutura nova já existente: tudo reaproveitado, nada criado nem movido', t.passos.every(p => p.op === 'reusar') && t.passos.length === 7);
}
{
  const d = drive().pasta('P', 'proj', null).pasta('x', '06_OUTRA', 'P');
  ok('06_ que não é ENTREGA fica (ignorada com motivo)', (await plano(d)).ignorados.some(i => i.id === 'x'));
}

// ---- caminho até o mês: Cliente › PROJETOS › [sub-marca] › AAAA-MM
ok('caminho sem marca: PROJETOS/AAAA-MM', caminhoDoMes(null, '2026-10').join('/') === 'PROJETOS/2026-10' && caminhoDoMes('  ', '2026-10').join('/') === 'PROJETOS/2026-10');
ok('caminho com sub-marca DENTRO de PROJETOS', caminhoDoMes('Uniasselvi', '2026-10').join('/') === 'PROJETOS/Uniasselvi/2026-10');
ok('caminho: barra na marca não cria nível extra', caminhoDoMes('A/B', '2026-10').join('/') === 'PROJETOS/A-B/2026-10');

// ---- pasta de materiais fixos do cliente (_ASSETS → MARCA)
const pasta = (id, name) => ({ id, name, isFolder: true });
ok('_ASSETS sozinha → renomear (mesmo ID)', JSON.stringify(planejarMarcaDoCliente([pasta('as', '_ASSETS'), pasta('x', '2026-10')])) === JSON.stringify({ acao: 'renomear', id: 'as', de: '_ASSETS', para: 'MARCA' }));
ok('MARCA e _ASSETS juntas → conflito (não renomeia)', planejarMarcaDoCliente([pasta('as', '_ASSETS'), pasta('m', 'MARCA')]).acao === 'conflito');
ok('duas _ASSETS → conflito', planejarMarcaDoCliente([pasta('a1', '_ASSETS'), pasta('a2', '_ASSETS')]).acao === 'conflito');
ok('já é MARCA → nada a fazer', planejarMarcaDoCliente([pasta('m', 'MARCA')]).acao === 'ja-esta');
ok('sem nenhuma das duas → nada', planejarMarcaDoCliente([pasta('x', 'PROJETOS')]).acao === 'nada');
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
