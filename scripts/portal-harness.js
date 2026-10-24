// scripts/portal-harness.js
// Como usar (sem tocar em produção):
//   VITE_SUPABASE_URL=http://127.0.0.1:9 VITE_SUPABASE_ANON_KEY=teste npx vite --port 5199 --strictPort
//   Abrir http://localhost:5199/portal/teste123 (aparece "Tentar de novo"), colar este arquivo no console.
// Devolve um objeto com o que a tela mostrou. Compare o resultado antes e depois de mexer.
// Cuidados:
//   - Depois de subir o vite, a primeira carga pode dar 504 "Outdated Optimize Dep": recarregue uma vez antes de colar o roteiro.
//   - Recarregue a página antes de colar o roteiro de novo (ele embrulha o `fetch`).
//   - Rodar o vite altera `node_modules/.vite`, que é versionado no git: restaure com
//     `git checkout -- node_modules/.vite` antes de commitar.
(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const fake = {
    cliente: { nome: 'Cliente Teste' },
    portal: { show_financeiro: false, blocks: {}, exige_login: false },
    voce: null, abrir_projeto: null,
    projetos: [
      { id: 'p1', nome: 'Campanha Alfa', code: 'A', status: 'em_andamento', data_inicio: null, data_fim: '2026-11-20',
        entregas: [
          { file_name: 'video_um.mp4', versao: 1, status: 'EM_REVISAO_CLIENTE', largura: 1920, altura: 1080, client_decision: null, client_decided_by: null, client_decided_at: null, entregue_em: '2026-10-20T10:00:00', review_token: 'rev1', allow_download: false },
          { file_name: 'video_dois.mp4', versao: 2, status: 'APROVADO', largura: 1080, altura: 1920, client_decision: 'aprovado', client_decided_by: 'Ana', client_decided_at: '2026-10-21T10:00:00', entregue_em: '2026-10-19T10:00:00', review_token: 'rev2', allow_download: false },
        ],
        cronograma: [
          { etapa: 'em_progresso', n: 2, inicio: '2026-10-10', fim: '2026-10-25', prazo_cliente: null },
          { etapa: 'revisao_cliente', n: 1, inicio: null, fim: null, prazo_cliente: '2026-11-05' },
        ],
        stages: { em_progresso: 2, revisao_cliente: 1 },
        escopo: [{ rotulo: 'Reels', meta: 0, realizado: 3 }, { rotulo: 'Posts', meta: 4, realizado: 1 }],
        arquivos: [] },
      { id: 'p2', nome: 'Projeto Beta', code: 'B', status: 'em_andamento', data_inicio: null, data_fim: null, entregas: [], cronograma: [], stages: {}, escopo: [], arquivos: [] },
    ],
    contatos: [{ nome: 'Marina', email: 'marina@lumos.com', cargo: 'Atendimento', foto: null, whatsapp: '11999990000', slack: null }],
    financeiro: null,
    atividade: [{ tipo: 'entrega', projeto: 'Campanha Alfa', file_name: 'video_um.mp4', quando: '2026-10-20T10:00:00' }],
  };
  const visao = window.__visao || null; // PR 4: defina window.__visao antes de rodar para simular portal_visao_projetos
  const orig = window.fetch.bind(window);
  window.fetch = async (url, opts) => {
    const u = String(url);
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('rpc/get_client_portal_v2')) return json(fake);
    if (u.includes('rpc/portal_visao_projetos')) return json(visao);
    // Um dia livre daqui a 10 dias: com dias: [] o calendário (.mes) não renderiza.
    const livre = new Date(Date.now() + 10 * 864e5);
    const dataLivre = `${livre.getFullYear()}-${String(livre.getMonth() + 1).padStart(2, '0')}-${String(livre.getDate()).padStart(2, '0')}`;
    if (u.includes('rpc/portal_agenda')) return json({ antecedencia_dias: 2, dias: [{ data: dataLivre, estado: 'livre' }], agendadas: [], pacote: null, pedidos: [] });
    if (u.includes('rpc/portal_capas')) return json([]);
    if (u.includes('rpc/')) return json(null);
    return orig(url, opts);
  };
  document.querySelector('button.botao')?.click();      // "Tentar de novo"
  await wait(1200);
  const campo = document.querySelector('input');          // tela "Como te chamamos?"
  if (campo) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(campo, 'Teste');
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(200);
    document.querySelector('button.botao').click();
    await wait(800);
  }
  const nav = () => [...document.querySelectorAll('nav.navegacao .link')];
  const out = {};
  out.abaInicial = nav().filter(b => b.getAttribute('aria-current') === 'true').map(b => b.textContent);
  nav()[1].click(); await wait(500);                       // Início
  out.inicio = !!document.querySelector('.chamada');
  out.projHref = document.querySelector('a.proj')?.getAttribute('href');
  document.querySelector('a.proj').click(); await wait(500);       // abre Campanha Alfa
  out.projeto = document.querySelector('.cabeca-proj h2')?.textContent;
  out.escopo = [...document.querySelectorAll('.secao .proj')].map(e => e.textContent).join(' | ');
  out.nan = document.body.innerHTML.includes('NaN');
  out.etapas = [...document.querySelectorAll('.etapas .etapa')].map(e => e.className.replace('etapa ', '') + ':' + e.textContent).join(' | ');
  const abas = [...document.querySelectorAll('.fita-proj .link')];
  out.abasProjeto = abas.map(b => b.textContent);
  abas.find(b => b.textContent.startsWith('Entregas'))?.click(); await wait(300);
  out.entregas = document.querySelectorAll('a.quadro').length;
  abas.find(b => b.textContent.startsWith('Diárias'))?.click(); await wait(800);
  out.diarias = !!document.querySelector('.mes');
  nav()[4].click(); await wait(400);                       // Atendimento (índice 4: com vídeos no fake, o menu ganha o botão Catálogo na posição 2)
  out.atendimento = document.querySelector('.pessoa .nm')?.textContent;
  nav()[0].click(); await wait(400);                       // Bem-vindo
  out.bemVindo = !!document.querySelector('.folha');
  return out;
})()
