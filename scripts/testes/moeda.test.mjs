// Rodar: node --test scripts/testes/moeda.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPREAD_PADRAO, calcCotacaoTravada, converterValor, formatarMoeda,
  formatarValorDaVersao, moedaDaVersao, taxaDaVersao, camposDeMoeda, diasDesde,
} from '../../src/utils/moeda.ts';

const semNbsp = (s) => s.replace(/ /g, ' ');
const usd = { currency: 'USD', fx_rate: 4.85 };

test('margem de segurança padrão é 3%', () => {
  assert.equal(SPREAD_PADRAO, 0.03);
});

test('cotação travada = mercado menos a margem, em 4 casas', () => {
  assert.equal(calcCotacaoTravada(5, 0.03), 4.85);
  assert.equal(calcCotacaoTravada(5.0119, 0.03), 4.8615);
  assert.equal(calcCotacaoTravada(5, 0), 5);
});

test('converte reais em dólar pela cotação travada', () => {
  assert.equal(converterValor(50000, usd), 10309.28);
  assert.equal(converterValor(2000, usd), 412.37);
  assert.equal(converterValor(50000, { currency: 'USD', fx_rate: '4.85' }), 10309.28);
});

test('em R$ o valor passa sem mudança', () => {
  assert.equal(converterValor(1234.5678, { currency: 'BRL', fx_rate: 4.85 }), 1234.5678);
  assert.equal(converterValor(1234.5678, undefined), 1234.5678);
});

test('USD sem cotação válida é tratado como R$', () => {
  assert.equal(moedaDaVersao({ currency: 'USD', fx_rate: null }), 'BRL');
  assert.equal(moedaDaVersao({ currency: 'USD', fx_rate: 0 }), 'BRL');
  assert.equal(taxaDaVersao({ currency: 'USD', fx_rate: -1 }), null);
  assert.equal(converterValor(100, { currency: 'USD', fx_rate: null }), 100);
});

test('formata em R$ e em US$', () => {
  assert.equal(semNbsp(formatarMoeda(1234.5, 'BRL')), 'R$ 1.234,50');
  assert.equal(semNbsp(formatarMoeda(10309.28, 'USD')), 'US$ 10.309,28');
  assert.equal(semNbsp(formatarValorDaVersao(50000, usd)), 'US$ 10.309,28');
  assert.equal(semNbsp(formatarValorDaVersao(50000, { currency: 'BRL' })), 'R$ 50.000,00');
});

test('campos de moeda para gravar', () => {
  assert.deepEqual(camposDeMoeda(undefined), {
    currency: 'BRL', fx_market_rate: null, fx_spread_pct: 0.03,
    fx_rate: null, fx_rate_at: null, fx_source: null,
  });
  assert.deepEqual(
    camposDeMoeda({ currency: 'USD', fx_market_rate: 5, fx_spread_pct: 0.03, fx_rate: 4.85, fx_rate_at: '2026-10-09T12:00:00Z', fx_source: 'ptax' }),
    { currency: 'USD', fx_market_rate: 5, fx_spread_pct: 0.03, fx_rate: 4.85, fx_rate_at: '2026-10-09T12:00:00Z', fx_source: 'ptax' },
  );
});

test('dias desde a cotação', () => {
  assert.equal(diasDesde('2026-10-01T00:00:00Z', new Date('2026-10-09T00:00:00Z')), 8);
  assert.equal(diasDesde(null), null);
  assert.equal(diasDesde('lixo'), null);
});
