// Rodar: node --test scripts/testes/traduzirCore.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITES, validarPedido, dividirEmLotes, lerResposta, montarCorpo, MODELO } from '../../supabase/functions/traduzir-orcamento/core.ts';

const item = (id, origem, tipo = 'texto') => ({ id, tipo, origem });

test('modelo é o Sonnet 5.5', () => {
  assert.equal(MODELO, 'claude-sonnet-5-5');
});

test('LIMITES têm os valores acordados', () => {
  assert.deepEqual(LIMITES, {
    itens: 100,
    caracteresPorItem: 8000,
    caracteresTotal: 40000,
    itensPorLote: 20,
    caracteresPorLote: 8000,
    concorrencia: 3,
    prazoTotalMs: 110000,
    timeoutPorChamadaMs: 55000,
  });
});

test('validarPedido aceita um pedido bom', () => {
  const r = validarPedido({ itens: [item('t0', 'Diária de câmera'), item('t1', '<p>Oi</p>', 'html')] });
  assert.equal(r.ok, true);
  assert.equal(r.itens.length, 2);
});

test('validarPedido recusa pedidos ruins com mensagem exata', () => {
  const vazio = 'Envie ao menos um texto para traduzir.';
  assert.deepEqual(validarPedido(null), { ok: false, erro: vazio });
  assert.deepEqual(validarPedido({}), { ok: false, erro: vazio });
  assert.deepEqual(validarPedido({ itens: [] }), { ok: false, erro: vazio });
  assert.deepEqual(validarPedido({ itens: [item('a', '')] }), { ok: false, erro: 'Há texto vazio no pedido.' });
  assert.deepEqual(validarPedido({ itens: [{ id: 'a', tipo: 'x', origem: 'oi' }] }), { ok: false, erro: 'Tipo de texto inválido.' });
  assert.deepEqual(validarPedido({ itens: [item('a', 'oi'), item('a', 'tchau')] }), { ok: false, erro: 'Cada texto precisa de um id único.' });
  assert.deepEqual(validarPedido({ itens: [item('', 'oi')] }), { ok: false, erro: 'Cada texto precisa de um id único.' });
  assert.deepEqual(
    validarPedido({ itens: Array.from({ length: LIMITES.itens + 1 }, (_, i) => item('i' + i, 'x')) }),
    { ok: false, erro: `Textos demais (máximo ${LIMITES.itens}).` },
  );
  assert.deepEqual(
    validarPedido({ itens: [item('a', 'x'.repeat(LIMITES.caracteresPorItem + 1))] }),
    { ok: false, erro: 'Há um texto grande demais.' },
  );
  const r = validarPedido({ itens: [item('a', 'x')], lixo: 1 });
  assert.equal(r.ok, true); // campos extras são ignorados
});

test('validarPedido aceita ids como constructor e __proto__ (são ids comuns, não chaves especiais)', () => {
  const r = validarPedido({ itens: [item('constructor', 'a'), item('__proto__', 'b')] });
  assert.equal(r.ok, true);
  assert.equal(r.itens.length, 2);
});

test('validarPedido recusa o total de caracteres acima do limite', () => {
  const grande = 'x'.repeat(LIMITES.caracteresPorItem);
  const itens = Array.from({ length: 7 }, (_, i) => item('i' + i, grande));
  assert.deepEqual(validarPedido({ itens }), { ok: false, erro: 'O pedido é grande demais.' });
});

test('dividirEmLotes respeita itens e caracteres por lote e mantém a ordem', () => {
  const itens = Array.from({ length: LIMITES.itensPorLote * 2 + 3 }, (_, i) => item('i' + i, 'curto'));
  const lotes = dividirEmLotes(itens);
  assert.equal(lotes.length, 3);
  assert.deepEqual(lotes.flat().map((x) => x.id), itens.map((x) => x.id));
  // Dois itens de 5/8 do lote somam mais que o lote: o segundo abre outro lote.
  const pesado = Math.floor(LIMITES.caracteresPorLote * 5 / 8);
  const pesados = [item('a', 'x'.repeat(pesado)), item('b', 'y'.repeat(pesado)), item('c', 'z')];
  const l2 = dividirEmLotes(pesados);
  assert.equal(l2.length, 2);
  assert.deepEqual(l2.map((lote) => lote.map((x) => x.id)), [['a'], ['b', 'c']]);
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

test('lerResposta: stop_reason max_tokens vira erro mesmo com tool_use completo', () => {
  const json = {
    stop_reason: 'max_tokens',
    content: [{ type: 'tool_use', input: { traducoes: [{ id: 't0', en: 'A' }] } }],
  };
  const r = lerResposta(json, ['t0']);
  assert.equal(r.ok, false);
  assert.match(r.erro, /cortada/i);
});

test('montarCorpo: pedido aceito pelo claude-sonnet-5-5 (tool_choice auto, thinking mínimo, ferramenta estrita)', () => {
  const lote = [item('t0', 'Diária de câmera'), item('t1', '<p>Oi</p>', 'html')];
  const corpo = montarCorpo(lote);
  assert.equal(corpo.model, 'claude-sonnet-5-5');
  assert.equal(corpo.max_tokens, 8192);
  assert.deepEqual(corpo.thinking, { type: 'between_tools' });
  assert.deepEqual(corpo.tool_choice, { type: 'auto' });
  assert.equal(corpo.tools.length, 1);
  assert.equal(corpo.tools[0].strict, true);
  assert.equal(corpo.tools[0].name, 'registrar_traducoes');
  assert.equal(corpo.tools[0].input_schema.additionalProperties, false);
  assert.equal(corpo.tools[0].input_schema.properties.traducoes.items.additionalProperties, false);
  assert.deepEqual(corpo.tools[0].input_schema.properties.traducoes.items.required, ['id', 'en']);
  assert.deepEqual(corpo.messages, [{ role: 'user', content: JSON.stringify({ itens: lote }) }]);
  assert.match(corpo.system, /exactly once/);
  for (const proibido of ['temperature', 'top_p', 'top_k']) {
    assert.equal(Object.hasOwn(corpo, proibido), false);
  }
});

test('lerResposta: só texto (sem tool_use) dá erro marcado semFerramenta; outros erros não', () => {
  const r = lerResposta({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here are the translations...' }] }, ['t0']);
  assert.equal(r.ok, false);
  assert.equal(r.semFerramenta, true);
  assert.equal(r.erro, 'A IA não devolveu as traduções.');
  const incompleta = lerResposta({ content: [{ type: 'tool_use', input: { traducoes: [] } }] }, ['t0']);
  assert.equal(incompleta.ok, false);
  assert.equal(incompleta.semFerramenta, undefined);
  const cortada = lerResposta({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'x' }] }, ['t0']);
  assert.equal(cortada.semFerramenta, undefined);
});

test('lerResposta: id constructor pedido e omitido continua sendo erro', () => {
  const json = { content: [{ type: 'tool_use', input: { traducoes: [] } }] };
  const r = lerResposta(json, ['constructor']);
  assert.equal(r.ok, false);
  assert.match(r.erro, /incompleta/i);
});

test('lerResposta: __proto__ omitido e constructor omitido continuam sendo erro', () => {
  const omitido = { content: [{ type: 'tool_use', input: { traducoes: [{ id: 'outro', en: 'X' }] } }] };
  assert.equal(lerResposta(omitido, ['__proto__']).ok, false);
  const parcial = { content: [{ type: 'tool_use', input: { traducoes: [{ id: '__proto__', en: 'Olá' }] } }] };
  const r = lerResposta(parcial, ['constructor', '__proto__']);
  assert.equal(r.ok, false);
  assert.match(r.erro, /incompleta/i);
});

test('lerResposta: id __proto__ traduzido vira propriedade própria', () => {
  const json = { content: [{ type: 'tool_use', input: { traducoes: [{ id: '__proto__', en: 'Olá' }] } }] };
  const r = lerResposta(json, ['__proto__']);
  assert.equal(r.ok, true);
  assert.equal(Object.hasOwn(r.traducoes, '__proto__'), true);
  assert.equal(Object.getOwnPropertyDescriptor(r.traducoes, '__proto__').value, 'Olá');
});
