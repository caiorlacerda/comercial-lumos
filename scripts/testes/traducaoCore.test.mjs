// Rodar: node --test scripts/testes/traducaoCore.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chave, coletarTextos, faltantes, traduzir, sanitizarTraducao, mesclar } from '../../src/lib/traducaoCore.ts';
import { camposDeIdioma } from '../../src/utils/idioma.ts';

const version = {
  notes_client: '<p>Filmagem em <strong>dois dias</strong>.</p>',
  logistics_date: '12 e 13/10',
  logistics_time: '  ',
  logistics_location: 'São Paulo',
};
const items = [
  { name: 'Diária de câmera', description: 'Câmera cinema + operador', sort_order: 1 },
  { name: 'Diária de câmera', description: '', sort_order: 2 },       // nome repetido: não duplica
  { name: 'Edição', description: null, sort_order: 3 },
];

test('coleta os textos únicos a traduzir, na ordem, ignorando vazios', () => {
  const t = coletarTextos(version, items);
  assert.deepEqual(t.map((x) => x.origem), [
    '12 e 13/10', 'São Paulo',
    '<p>Filmagem em <strong>dois dias</strong>.</p>',
    'Diária de câmera', 'Câmera cinema + operador', 'Edição',
  ]);
  assert.equal(t.find((x) => x.origem.startsWith('<p>')).tipo, 'html');
  assert.equal(t.find((x) => x.origem === 'Edição').tipo, 'texto');
});

test('faltantes: o que ainda não tem tradução (inclusive tradução vazia)', () => {
  const coletados = coletarTextos(version, items);
  const traducoes = { versao: 1, textos: { 'Edição': 'Editing', 'São Paulo': '   ' } };
  const f = faltantes(coletados, traducoes).map((x) => x.origem);
  assert.equal(f.includes('Edição'), false);
  assert.equal(f.includes('São Paulo'), true);   // tradução só com espaços = faltando
  assert.equal(f.includes('Diária de câmera'), true);
  assert.equal(faltantes(coletados, null).length, coletados.length);
});

test('traduzir: usa a tradução, senão o original', () => {
  const tr = { versao: 1, textos: { 'Edição': 'Editing' } };
  assert.equal(traduzir(tr, 'Edição'), 'Editing');
  assert.equal(traduzir(tr, ' Edição '), 'Editing');         // chave ignora espaços nas pontas
  assert.equal(traduzir(tr, 'Roteiro'), 'Roteiro');
  assert.equal(traduzir(null, 'Roteiro'), 'Roteiro');
  assert.equal(traduzir(tr, ''), '');
  assert.equal(chave('  a  '), 'a');
});

test('sanitizarTraducao tira o que a fonte do PDF não cobre', () => {
  assert.equal(sanitizarTraducao('A → B ≥ 3 ✓'), 'A -> B >= 3');
  assert.equal(sanitizarTraducao('Great 😀 shot'), 'Great shot');
  assert.equal(sanitizarTraducao('Normal “text” — fine'), 'Normal “text” — fine');
});

test('mesclar junta as novas traduções às existentes, sanitizadas', () => {
  const base = { versao: 1, textos: { 'Edição': 'Editing' } };
  const r = mesclar(base, { 'Roteiro': 'Script →', 'Edição': 'Post' }, '2026-10-09T12:00:00Z', 'claude-sonnet-5-5');
  assert.equal(r.versao, 1);
  assert.equal(r.textos['Roteiro'], 'Script ->');
  assert.equal(r.textos['Edição'], 'Post');
  assert.equal(r.traduzido_em, '2026-10-09T12:00:00Z');
  assert.equal(r.modelo, 'claude-sonnet-5-5');
  assert.deepEqual(base.textos, { 'Edição': 'Editing' }); // não muta a entrada
  assert.equal(mesclar(null, { a: 'b' }).textos.a, 'b');
});

test('camposDeIdioma: padrão pt e sem traduções', () => {
  assert.deepEqual(camposDeIdioma(undefined), { pdf_language: 'pt', translations: null });
  assert.deepEqual(camposDeIdioma({ pdf_language: 'en', translations: { versao: 1, textos: {} } }),
    { pdf_language: 'en', translations: { versao: 1, textos: {} } });
  assert.equal(camposDeIdioma({ pdf_language: 'xx' }).pdf_language, 'pt');
});

test('sanitizarTraducao remove emoji da BMP e seletor de variação, preserva pontuação', () => {
  assert.equal(sanitizarTraducao('Done ✅ ✨ ⭐ ❤️ ok'), 'Done ok');
  assert.equal(sanitizarTraducao('A • B — C™'), 'A • B — C™');
  assert.equal(sanitizarTraducao('Café “ok” … ®©'), 'Café “ok” … ®©');
});

test('constructor e toString não contam como traduzidos', () => {
  const coletados = coletarTextos(null, [{ name: 'constructor' }, { name: 'toString' }]);
  const tr = { versao: 1, textos: {} };
  assert.deepEqual(faltantes(coletados, tr).map((x) => x.origem), ['constructor', 'toString']);
  assert.equal(traduzir(tr, 'constructor'), 'constructor');
  assert.equal(traduzir(tr, 'toString'), 'toString');
  assert.equal(faltantes(coletados, null).length, 2);
});

test('mesclar não apaga tradução boa com valor que fica vazio', () => {
  const base = { versao: 1, textos: { 'Edição': 'Editing' } };
  assert.equal(mesclar(base, { 'Edição': '  ' }).textos['Edição'], 'Editing');
  assert.equal(mesclar(base, { 'Edição': '✅' }).textos['Edição'], 'Editing');
});

test('notes_client só com espaços não entra; item sem sort_order entra', () => {
  assert.deepEqual(coletarTextos({ notes_client: '   ' }, []), []);
  const t = coletarTextos({ notes_client: '  ' }, [{ name: 'Sem ordem' }, { name: 'Com ordem', sort_order: 1 }]);
  assert.deepEqual(t.map((x) => x.origem), ['Sem ordem', 'Com ordem']);
});
