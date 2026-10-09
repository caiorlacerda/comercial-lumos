// Rodar: node --test scripts/testes/pdfTextos.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEXTOS, getTextos } from '../../src/lib/pdfTextos.ts';

const pt = TEXTOS.pt;
const en = TEXTOS.en;

test('getTextos: padrão é português; en devolve inglês', () => {
  assert.equal(getTextos(undefined), pt);
  assert.equal(getTextos('pt'), pt);
  assert.equal(getTextos('xx'), pt);
  assert.equal(getTextos('en'), en);
});

test('os dois idiomas têm as mesmas chaves e nenhum texto vazio', () => {
  assert.deepEqual(Object.keys(pt).sort(), Object.keys(en).sort());
  const vazios = (obj, caminho = '') => Object.entries(obj).flatMap(([k, v]) => {
    if (typeof v === 'string') return v.trim() === '' ? [caminho + k] : [];
    if (Array.isArray(v)) return v.flatMap((x, i) => typeof x === 'string'
      ? (x.trim() === '' ? [`${caminho}${k}[${i}]`] : [])
      : vazios(x, `${caminho}${k}[${i}].`));
    if (v && typeof v === 'object') return vazios(v, `${caminho}${k}.`);
    return [];
  });
  assert.deepEqual(vazios(pt), []);
  assert.deepEqual(vazios(en), []);
});

test('7 cláusulas nos dois idiomas, com o mesmo número de itens', () => {
  assert.equal(pt.clausulas.length, 7);
  assert.equal(en.clausulas.length, 7);
  pt.clausulas.forEach((c, i) => assert.equal(c.itens.length, en.clausulas[i].itens.length, `cláusula ${i + 1}`));
});

test('o marcador da taxa de remarcação aparece exatamente uma vez, na cláusula 4', () => {
  for (const t of [pt, en]) {
    const todos = t.clausulas.flatMap((c) => c.itens).join('\n');
    assert.equal(todos.split('{taxaRemarcacao}').length - 1, 1);
    assert.ok(t.clausulas[3].itens[0].includes('{taxaRemarcacao}'));
  }
});

test('português mantém os textos de hoje (amostra)', () => {
  assert.equal(pt.clausulas[0].titulo, '1. Prazos e alterações');
  assert.ok(pt.clausulas[1].itens[0].startsWith('2.1. Aprovada esta Proposta Comercial'));
  assert.equal(pt.condicoesTitulo, 'CONDIÇÕES GERAIS');
  assert.equal(pt.totalProjeto, 'Investimento Total do Projeto');
  assert.equal(pt.tituloDocumento('2026-001', true), 'PROPOSTA_LUMOS_2026-001_DETALHADA');
  assert.equal(pt.tituloDocumento('2026-001', false), 'PROPOSTA_LUMOS_2026-001');
  assert.equal(pt.taxaRemarcacaoBRL, 'R$2.000,00');
});

test('inglês: títulos, unidades, categorias e valores-chave', () => {
  assert.equal(en.condicoesTitulo, 'GENERAL TERMS AND CONDITIONS');
  assert.equal(en.totalProjeto, 'Total Project Investment');
  assert.equal(en.unidades.diaria, 'day');
  assert.equal(en.unidades.pacote, 'package');
  assert.equal(en.categorias.filme, 'Film');
  assert.equal(en.tituloDocumento('2026-001', true), 'LUMOS_PROPOSAL_2026-001_DETAILED');
  assert.equal(en.taxaRemarcacaoBRL, 'R$2,000.00');
  assert.equal(en.locale, 'en-US');
});

test('inglês preserva os números do contrato (7 dias, 70%, 10%, 1% ao mês, 48 horas, 20%)', () => {
  const todos = en.clausulas.flatMap((c) => c.itens).join('\n');
  for (const trecho of ['seven (7) calendar days', '70%', '10%', '1%', '48 hours', '20%']) {
    assert.ok(todos.includes(trecho), `faltou "${trecho}"`);
  }
});

test('inglês só usa caracteres que as fontes do PDF cobrem', () => {
  const todos = JSON.stringify(en);
  assert.equal(/[→←≥≤✓✔]/u.test(todos), false);
  assert.equal(/[\u{10000}-\u{10FFFF}]/u.test(todos), false);
});
