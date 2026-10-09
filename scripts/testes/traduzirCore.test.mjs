// Rodar: node --test scripts/testes/traduzirCore.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITES, validarPedido, dividirEmLotes, lerResposta, MODELO } from '../../supabase/functions/traduzir-orcamento/core.ts';

const item = (id, origem, tipo = 'texto') => ({ id, tipo, origem });

test('modelo é o Sonnet 5.5', () => {
  assert.equal(MODELO, 'claude-sonnet-5-5');
});

test('validarPedido aceita um pedido bom', () => {
  const r = validarPedido({ itens: [item('t0', 'Diária de câmera'), item('t1', '<p>Oi</p>', 'html')] });
  assert.equal(r.ok, true);
  assert.equal(r.itens.length, 2);
});

test('validarPedido recusa pedidos ruins com mensagem', () => {
  assert.equal(validarPedido(null).ok, false);
  assert.equal(validarPedido({}).ok, false);
  assert.equal(validarPedido({ itens: [] }).ok, false);
  assert.equal(validarPedido({ itens: [item('a', '')] }).ok, false);                    // origem vazia
  assert.equal(validarPedido({ itens: [{ id: 'a', tipo: 'x', origem: 'oi' }] }).ok, false); // tipo inválido
  assert.equal(validarPedido({ itens: [item('a', 'oi'), item('a', 'tchau')] }).ok, false);  // id repetido
  assert.equal(validarPedido({ itens: Array.from({ length: LIMITES.itens + 1 }, (_, i) => item('i' + i, 'x')) }).ok, false);
  assert.equal(validarPedido({ itens: [item('a', 'x'.repeat(LIMITES.caracteresPorItem + 1))] }).ok, false);
  const r = validarPedido({ itens: [item('a', 'x')], lixo: 1 });
  assert.equal(r.ok, true); // campos extras são ignorados
});

test('validarPedido recusa o total de caracteres acima do limite', () => {
  const grande = 'x'.repeat(LIMITES.caracteresPorItem);
  const itens = Array.from({ length: 7 }, (_, i) => item('i' + i, grande));
  const r = validarPedido({ itens });
  assert.equal(r.ok, false);
  assert.match(r.erro, /grande demais/i);
});

test('dividirEmLotes respeita itens e caracteres por lote e mantém a ordem', () => {
  const itens = Array.from({ length: LIMITES.itensPorLote * 2 + 3 }, (_, i) => item('i' + i, 'curto'));
  const lotes = dividirEmLotes(itens);
  assert.equal(lotes.length, 3);
  assert.deepEqual(lotes.flat().map((x) => x.id), itens.map((x) => x.id));
  const pesados = [item('a', 'x'.repeat(20000)), item('b', 'y'.repeat(20000)), item('c', 'z')];
  const l2 = dividirEmLotes(pesados);
  assert.equal(l2.length, 2);                     // 20000 + 20000 > 30000
  assert.deepEqual(l2.flat().map((x) => x.id), ['a', 'b', 'c']);
});

test('lerResposta: lê o tool_use e confere que todos os ids voltaram', () => {
  const json = { content: [
    { type: 'text', text: 'ok' },
    { type: 'tool_use', name: 'registrar_traducoes', input: { traducoes: [{ id: 't0', en: 'Camera day rate' }, { id: 't1', en: '<p>Hi</p>' }] } },
  ] };
  const r = lerResposta(json, ['t0', 't1']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.traducoes, { t0: 'Camera day rate', t1: '<p>Hi</p>' });
});

test('lerResposta: erro explícito quando falta id, vem vazio ou não há tool_use', () => {
  const falta = { content: [{ type: 'tool_use', input: { traducoes: [{ id: 't0', en: 'A' }] } }] };
  const r1 = lerResposta(falta, ['t0', 't1']);
  assert.equal(r1.ok, false);
  assert.match(r1.erro, /incompleta/i);
  const vazio = { content: [{ type: 'tool_use', input: { traducoes: [{ id: 't0', en: '   ' }] } }] };
  assert.equal(lerResposta(vazio, ['t0']).ok, false);
  assert.equal(lerResposta({ content: [{ type: 'text', text: 'oi' }] }, ['t0']).ok, false);
  assert.equal(lerResposta(null, ['t0']).ok, false);
  const extra = { content: [{ type: 'tool_use', input: { traducoes: [{ id: 't0', en: 'A' }, { id: 'zzz', en: 'B' }] } }] };
  assert.deepEqual(lerResposta(extra, ['t0']).traducoes, { t0: 'A' }); // id desconhecido é ignorado
});
