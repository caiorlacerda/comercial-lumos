// Rodar: node --test scripts/testes/linkDaTarefa.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caminhoDaTarefa, urlDaTarefa, ehCaminhoDeTarefa, guardarDestinoDoLogin, consumirDestinoDoLogin } from '../../src/lib/linkDaTarefa.ts';

const ID = '3f2b1c4d-1a2b-4c5d-8e9f-0123456789ab';

test('link da tarefa leva só o id', () => {
  assert.equal(caminhoDaTarefa(ID), `/tarefa/${ID}`);
  assert.equal(urlDaTarefa('https://app.exemplo.com/', ID), `https://app.exemplo.com/tarefa/${ID}`);
});

test('só link de tarefa vale como destino depois do login', () => {
  assert.ok(ehCaminhoDeTarefa(`/tarefa/${ID}`));
  for (const ruim of ['/', '/tarefa/abc', `/tarefa/${ID}/x`, `//evil.com/tarefa/${ID}`, `https://evil.com/tarefa/${ID}`, '/financeiro', `/tarefa/${ID}?x=1`]) {
    assert.equal(ehCaminhoDeTarefa(ruim), false, ruim);
  }
});

test('destino do login vale uma vez só e ignora valor adulterado', () => {
  const m = new Map();
  globalThis.sessionStorage = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
  assert.equal(consumirDestinoDoLogin(), '/');
  guardarDestinoDoLogin('/financeiro');
  assert.equal(consumirDestinoDoLogin(), '/');
  guardarDestinoDoLogin(`/tarefa/${ID}`);
  assert.equal(consumirDestinoDoLogin(), `/tarefa/${ID}`);
  assert.equal(consumirDestinoDoLogin(), '/');
  m.set('lumos_destino_apos_login', 'https://evil.com');
  assert.equal(consumirDestinoDoLogin(), '/');
  delete globalThis.sessionStorage;
  assert.equal(consumirDestinoDoLogin(), '/');   // sem armazenamento: Home
});

