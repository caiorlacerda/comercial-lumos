// Rodar: node --test scripts/testes/ordemDasTarefas.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ordenarTarefas, planejarMovimento } from '../../src/lib/ordemDasTarefas.ts';

const t = (id, ordem, created_at = '2026-01-01') => ({ id, ordem, created_at });
const aplicar = (lista, mud) => ordenarTarefas(lista.map(x => ({ ...x, ordem: mud.find(m => m.id === x.id)?.ordem ?? x.ordem }))).map(x => x.id);
const ids = l => ordenarTarefas(l).map(x => x.id);

test('subir e descer com folga grava só a tarefa movida', () => {
  const l = [t('a', 10), t('b', 20), t('c', 30), t('d', 40)];
  for (const [id, dir, esperado] of [
    ['c', 'subir', ['a', 'c', 'b', 'd']], ['b', 'descer', ['a', 'c', 'b', 'd']],
    ['b', 'subir', ['b', 'a', 'c', 'd']], ['c', 'descer', ['a', 'b', 'd', 'c']],
  ]) {
    const m = planejarMovimento(l, ids(l), id, dir);
    assert.equal(m.length, 1, `${id} ${dir}`);
    assert.equal(m[0].id, id);
    assert.deepEqual(aplicar(l, m), esperado, `${id} ${dir}`);
  }
});

test('na ponta não há para onde ir', () => {
  const l = [t('a', 10), t('b', 20)];
  assert.deepEqual(planejarMovimento(l, ['a', 'b'], 'a', 'subir'), []);
  assert.deepEqual(planejarMovimento(l, ['a', 'b'], 'b', 'descer'), []);
  assert.deepEqual(planejarMovimento(l, ['a', 'b'], 'nao-existe', 'subir'), []);
});

test('todas com o mesmo número (tarefas sem ordem): renumera e a ordem fica certa', () => {
  const l = [t('a', 0, '2026-01-01'), t('b', 0, '2026-01-02'), t('c', 0, '2026-01-03')];
  const m = planejarMovimento(l, ids(l), 'c', 'subir');
  assert.deepEqual(aplicar(l, m), ['a', 'c', 'b']);
});

test('com filtro, passa na frente da vizinha visível sem bagunçar as escondidas', () => {
  const l = [t('a', 10), t('x', 20), t('y', 30), t('b', 40)];
  const m = planejarMovimento(l, ['a', 'b'], 'b', 'subir');
  assert.deepEqual(aplicar(l, m), ['b', 'a', 'x', 'y']);
  const n = planejarMovimento(l, ['a', 'b'], 'a', 'descer');
  assert.deepEqual(aplicar(l, n), ['x', 'y', 'b', 'a']);
});

test('em milhares de listas ao acaso (com repetidos e filtros) o resultado é sempre o pedido', () => {
  let semente = 7;
  const sorteio = n => (semente = (semente * 48271) % 2147483647) % n;
  for (let caso = 0; caso < 4000; caso++) {
    const n = 2 + sorteio(7);
    const l = Array.from({ length: n }, (_, k) => t(`t${k}`, sorteio(6) * (sorteio(2) ? 1 : 10), `2026-01-0${1 + sorteio(3)}`));
    const ordem = ids(l);
    const visiveis = ordem.filter(() => sorteio(3) > 0);
    if (visiveis.length < 2) continue;
    const i = sorteio(visiveis.length);
    const dir = sorteio(2) ? 'subir' : 'descer';
    const alvo = visiveis[dir === 'subir' ? i - 1 : i + 1];
    const m = planejarMovimento(l, visiveis, visiveis[i], dir);
    if (!alvo) { assert.deepEqual(m, []); continue; }
    const esperado = ordem.filter(x => x !== visiveis[i]);
    esperado.splice(esperado.indexOf(alvo) + (dir === 'subir' ? 0 : 1), 0, visiveis[i]);
    assert.deepEqual(aplicar(l, m), esperado, JSON.stringify({ l, visiveis, id: visiveis[i], dir }));
  }
});
