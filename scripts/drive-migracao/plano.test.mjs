// Rodar:  node scripts/drive-migracao/plano.test.mjs
import { NOMES, destinoDaPastaAntiga, mesDoProjeto, planejarProjeto, sqlDeAtualizacao } from './plano.mjs';

let falhas = 0;
const ok = (nome, cond) => { console.log((cond ? 'OK     ' : 'FALHA  ') + nome); if (!cond) falhas++; };
const pasta = (id, name) => ({ id, name, isFolder: true });
const arq = (id, name) => ({ id, name, isFolder: false });
const op = (r, o, extra = {}) => r.passos.filter(p => p.op === o && Object.entries(extra).every(([k, v]) => p[k] === v));

// ---- mapa de nomes
ok('00/01/02 e OS → documentos', ['00_GERAL', '01_ROTEIRO', '02_PRODUCAO', 'OS'].every(n => destinoDaPastaAntiga(n) === 'documentos'));
ok('03 → bruto', destinoDaPastaAntiga('03_CAPTACAO') === 'bruto');
ok('04 e 05 → artes', destinoDaPastaAntiga('04_EDICAO') === 'artes' && destinoDaPastaAntiga('05_ARTES') === 'artes');
ok('nomes fora do mapa não mexem', destinoDaPastaAntiga('99_DUPLICADOS') === null && destinoDaPastaAntiga('_ARQUIVOS') === null && destinoDaPastaAntiga('Fotos') === null);

// ---- projeto antigo típico
const tipico = planejarProjeto({
  filhos: [pasta('a0', '00_GERAL'), pasta('a1', '01_ROTEIRO'), pasta('a2', '02_PRODUCAO'), pasta('a3', '03_CAPTACAO'),
    pasta('a4', '04_EDICAO'), pasta('a5', '05_ARTES'), pasta('a6', '06_ENTREGA'), pasta('os', 'OS'), pasta('dup', '99_DUPLICADOS'), arq('f1', 'leia-me.txt')],
  filhosEntrega: [pasta('rev', '01_REVISAO'), pasta('apr', '02_APROVADO')],
});
ok('típico: cria documentos, bruto, artes, export e trilhas', ['documentos', 'bruto', 'artes', 'export', 'trilhas'].every(c => op(tipico, 'criar', { chave: c }).length === 1));
ok('típico: NÃO cria revisao/final (vêm de 06_ENTREGA)', op(tipico, 'criar', { chave: 'revisao' }).length === 0 && op(tipico, 'criar', { chave: 'final' }).length === 0);
ok('típico: 01_REVISAO é movida (mantém o nome, registra revisao)', op(tipico, 'mover', { id: 'rev', para: 'export', registra: 'revisao' }).length === 1 && !op(tipico, 'mover', { id: 'rev' })[0].renomearPara);
ok('típico: 02_APROVADO é movida e renomeada para 02_FINAL', op(tipico, 'mover', { id: 'apr', para: 'export', renomearPara: '02_FINAL', registra: 'final' }).length === 1);
ok('típico: 00/01/02 e OS vão para documentos', ['a0', 'a1', 'a2', 'os'].every(id => op(tipico, 'mover', { id, para: 'documentos' }).length === 1));
ok('típico: 03 → bruto; 04/05 → artes', op(tipico, 'mover', { id: 'a3', para: 'bruto' }).length === 1 && op(tipico, 'mover', { id: 'a4', para: 'artes' }).length === 1 && op(tipico, 'mover', { id: 'a5', para: 'artes' }).length === 1);
ok('típico: 06_ENTREGA não é movida nem renomeada', tipico.passos.every(p => p.id !== 'a6'));
ok('típico: 99_DUPLICADOS e arquivo solto ficam (ignorados)', tipico.ignorados.map(i => i.id).sort().join() === 'dup,f1');
ok('típico: nada sobra em 06_ENTREGA', tipico.sobraEmEntrega.length === 0);
ok('típico: só existem as operações criar/reusar/mover/conflito (nunca copiar nem apagar)', tipico.passos.every(p => ['criar', 'reusar', 'mover', 'conflito'].includes(p.op)));
ok('típico: nenhuma renomeação além de 02_APROVADO→02_FINAL', tipico.passos.filter(p => p.renomearPara).length === 1);

// ---- 00 já se chama 00_DOCUMENTOS: vira o alvo, não duplica
const igual = planejarProjeto({ filhos: [pasta('d', '00_DOCUMENTOS'), pasta('r', '01_ROTEIRO'), pasta('e', '06_ENTREGA')], filhosEntrega: [] });
ok('00_DOCUMENTOS existente é reaproveitada (sem criar outra)', op(igual, 'reusar', { chave: 'documentos', id: 'd' }).length === 1 && op(igual, 'criar', { chave: 'documentos' }).length === 0);
ok('...e 01_ROTEIRO entra nela', op(igual, 'mover', { id: 'r', para: 'documentos' }).length === 1);
ok('...a própria 00_DOCUMENTOS não é movida para dentro de si', op(igual, 'mover', { id: 'd' }).length === 0);

// ---- sem 06_ENTREGA
const semEntrega = planejarProjeto({ filhos: [pasta('a0', '00_GERAL')], filhosEntrega: null });
ok('sem 06_ENTREGA: cria revisao e final vazias + avisa', op(semEntrega, 'criar', { chave: 'revisao' }).length === 1 && op(semEntrega, 'criar', { chave: 'final' }).length === 1 && semEntrega.avisos.length === 1);

// ---- sobra em 06_ENTREGA
const sobra = planejarProjeto({ filhos: [pasta('e', '06_ENTREGA')], filhosEntrega: [pasta('rev', '01_REVISAO'), arq('x', 'entrega-final.zip'), pasta('o', 'Fotos')] });
ok('sobra em 06_ENTREGA é listada (não mexe)', sobra.sobraEmEntrega.map(s => s.id).sort().join() === 'o,x' && sobra.avisos.length >= 1);

// ---- conflito de nome no alvo
const conf = planejarProjeto({ filhos: [pasta('d', '00_DOCUMENTOS'), pasta('r', '01_ROTEIRO')], filhosEntrega: [], filhosDosAlvos: { documentos: [pasta('x', '01_ROTEIRO')] } });
ok('mesmo nome já no alvo → conflito (não move)', op(conf, 'conflito', { id: 'r' }).length === 1 && op(conf, 'mover', { id: 'r' }).length === 0);

// ---- já parcialmente migrado
const parcial = planejarProjeto({
  filhos: [pasta('d', '00_DOCUMENTOS'), pasta('b', '01_BRUTO'), pasta('ar', '02_ARTES'), pasta('ex', '03_EXPORT')], filhosEntrega: null,
  filhosDosAlvos: { artes: [pasta('tr', '01_TRILHAS')], export: [pasta('rv', '01_REVISAO'), pasta('fn', '02_FINAL')] },
});
ok('estrutura nova já existente: tudo reaproveitado, nada criado', parcial.passos.every(p => p.op === 'reusar') && parcial.passos.length === 7);

// ---- pasta 06_ diferente
const outra = planejarProjeto({ filhos: [pasta('x', '06_OUTRA')], filhosEntrega: null });
ok('06_ que não é ENTREGA fica (ignorada com motivo)', outra.ignorados.some(i => i.id === 'x'));

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
