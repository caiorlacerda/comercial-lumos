// Rodar: node --test scripts/testes/ptax.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escolherCotacao, urlPtax } from '../../supabase/functions/cotacao/ptax.ts';

// Trecho da resposta real do Banco Central consultada em 2026-10-09.
const resposta = {
  value: [
    { cotacaoCompra: 4.9692, cotacaoVenda: 4.9698, dataHoraCotacao: '2026-10-06 13:03:21.267287' },
    { cotacaoCompra: 5.0113, cotacaoVenda: 5.0119, dataHoraCotacao: '2026-10-08 13:08:16.814037' },
    { cotacaoCompra: 4.9929, cotacaoVenda: 4.9935, dataHoraCotacao: '2026-10-07 13:05:23.249063' },
  ],
};

test('escolhe a cotação mais recente, mesmo fora de ordem', () => {
  assert.deepEqual(escolherCotacao(resposta), { data: '2026-10-08', compra: 5.0113, venda: 5.0119 });
});

test('ignora registros inválidos', () => {
  const r = { value: [
    { cotacaoCompra: 0, cotacaoVenda: 5, dataHoraCotacao: '2026-10-09 13:00:00' },
    { cotacaoCompra: 5, cotacaoVenda: 5.1, dataHoraCotacao: '2026-10-07 13:00:00' },
  ] };
  assert.deepEqual(escolherCotacao(r), { data: '2026-10-07', compra: 5, venda: 5.1 });
});

test('devolve null quando não há cotação', () => {
  assert.equal(escolherCotacao({ value: [] }), null);
  assert.equal(escolherCotacao({}), null);
  assert.equal(escolherCotacao(null), null);
});

test('monta o endereço com a janela de datas no formato do BC (MM-DD-AAAA)', () => {
  const url = urlPtax(new Date('2026-10-09T12:00:00Z'));
  assert.ok(url.includes("@dataInicial='09-29-2026'"));
  assert.ok(url.includes("@dataFinalCotacao='10-09-2026'"));
  assert.ok(url.startsWith('https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo'));
});

test('não usa $select (o firewall do Banco Central responde 403)', () => {
  assert.ok(!urlPtax(new Date()).includes('$select'));
});
