/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpolarSecoes, type VariavelDef } from './interpolate.ts';

const OBRIGATORIA: VariavelDef = { key: 'CLIENTE', label: 'Cliente', type: 'text', required: true, group: 'geral' };
const OPCIONAL: VariavelDef = { key: 'ATENDIMENTO', label: 'Atendimento', type: 'text', required: false, group: 'geral' };

test('substitui variável obrigatória preenchida', () => {
  const out = interpolarSecoes([{ body: 'Olá {{CLIENTE}}' }], { CLIENTE: 'Vitru' }, [OBRIGATORIA]);
  assert.deepEqual(out, [{ body: 'Olá Vitru' }]);
});

test('variável opcional vazia colapsa o campo inteiro, não deixa frase pela metade', () => {
  const out = interpolarSecoes([{ footnote: 'Fale com {{ATENDIMENTO}} direto.' }], {}, [OPCIONAL]);
  assert.deepEqual(out, [{ footnote: '' }]);
});

test('nunca deixa {{VAR}} de opcional vazia visível dentro de outro texto', () => {
  const out = interpolarSecoes([{ body: 'Prazo combinado: {{ATENDIMENTO}}' }], {}, [OPCIONAL]);
  assert.ok(!(out[0] as { body: string }).body.includes('{{'));
});

test('interpola recursivamente dentro de arrays e objetos aninhados', () => {
  const out = interpolarSecoes(
    [{ rows: [{ name: '{{CLIENTE}}', role: 'Cliente' }] }],
    { CLIENTE: 'Vitru' },
    [OBRIGATORIA]
  );
  assert.deepEqual(out, [{ rows: [{ name: 'Vitru', role: 'Cliente' }] }]);
});

test('obrigatória vazia mantém o token visível em vez de esconder (nunca deveria acontecer — publicar bloqueia isso antes)', () => {
  const out = interpolarSecoes([{ body: '{{CLIENTE}}' }], {}, [OBRIGATORIA]);
  assert.deepEqual(out, [{ body: '{{CLIENTE}}' }]);
});

test('valores fora de string (number, boolean, null) atravessam sem alteração', () => {
  const out = interpolarSecoes([{ requer_arquivo: true, sort_order: 3, nota: null }], {}, []);
  assert.deepEqual(out, [{ requer_arquivo: true, sort_order: 3, nota: null }]);
});
