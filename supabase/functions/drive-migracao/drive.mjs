// Cliente mínimo do Google Drive para a migração (conta de serviço, sem dependências).
// Usa só fetch + WebCrypto, então roda igual no Deno (edge function) e no Node (script e testes).
// Com somenteLeitura = true qualquer chamada que não seja GET é recusada aqui dentro: a simulação não consegue escrever.

const FOLDER = 'application/vnd.google-apps.folder';

const b64u = dados => {
  const bytes = typeof dados === 'string' ? new TextEncoder().encode(dados) : dados;
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/**
 * @param {object} o
 * @param {{client_email:string, private_key:string}} o.sa conta de serviço (nunca é registrada nem devolvida)
 * @param {string} o.driveId ID do Drive compartilhado
 * @param {boolean} [o.somenteLeitura]
 * @param {string} [o.apiBase] só muda nos testes (Drive falso)
 * @param {string} [o.tokenUrl] só muda nos testes
 */
export function criarDrive({ sa, driveId, somenteLeitura = false, apiBase = 'https://www.googleapis.com/drive/v3', tokenUrl = 'https://oauth2.googleapis.com/token' }) {
  if (!sa?.client_email || !sa?.private_key) throw new Error('conta de serviço do Google ausente ou inválida');
  if (!driveId) throw new Error('ID do Drive compartilhado ausente');
  let cache = null;

  async function token() {
    const agora = Math.floor(Date.now() / 1000);
    if (cache && cache.exp > agora + 60) return cache.token;
    const cab = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const corpo = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/drive', aud: 'https://oauth2.googleapis.com/token', iat: agora, exp: agora + 3600 }));
    const pem = String(sa.private_key).replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
    const raw = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
    const chave = await crypto.subtle.importKey('pkcs8', raw.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const assinatura = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', chave, new TextEncoder().encode(`${cab}.${corpo}`)));
    const r = await fetch(tokenUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${cab}.${corpo}.${b64u(assinatura)}`,
    });
    const j = await r.json().catch(() => ({}));
    if (!j.access_token) throw new Error(`não consegui o token do Google (${r.status})`);
    cache = { token: j.access_token, exp: agora + 3500 };
    return cache.token;
  }

  async function api(caminho, init = {}, tentativa = 1) {
    const metodo = (init.method || 'GET').toUpperCase();
    if (somenteLeitura && metodo !== 'GET') throw new Error(`modo somente leitura: ${metodo} ${caminho.split('?')[0]} bloqueado`);
    const sep = caminho.includes('?') ? '&' : '?';
    const r = await fetch(`${apiBase}/${caminho}${sep}supportsAllDrives=true`, {
      ...init, headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    if ((r.status === 429 || r.status >= 500) && tentativa <= 4) { await new Promise(x => setTimeout(x, tentativa * 1200)); return api(caminho, init, tentativa + 1); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Drive ${r.status} em ${caminho.split('?')[0]}: ${JSON.stringify(j.error?.message || j).slice(0, 220)}`);
    return j;
  }

  /** Filhos diretos (sem os que estão na lixeira). */
  async function listar(paiId) {
    const itens = []; let pagina = '';
    do {
      const q = encodeURIComponent(`'${paiId}' in parents and trashed=false`);
      const j = await api(`files?q=${q}&fields=files(id,name,mimeType),nextPageToken&pageSize=200&includeItemsFromAllDrives=true&corpora=drive&driveId=${driveId}${pagina ? `&pageToken=${pagina}` : ''}`);
      itens.push(...(j.files || []).map(f => ({ id: f.id, name: f.name, isFolder: f.mimeType === FOLDER })));
      pagina = j.nextPageToken || '';
    } while (pagina);
    return itens;
  }

  const criarPasta = async (paiId, nome) => (await api('files?fields=id', { method: 'POST', body: JSON.stringify({ name: nome, mimeType: FOLDER, parents: [paiId] }) })).id;

  /** Move (e, se pedido, renomeia). O ID do item NÃO muda. */
  async function mover(id, novoPaiId, novoNome) {
    const atual = await api(`files/${id}?fields=parents,name`);
    const paisAntigos = atual.parents || [];
    await api(`files/${id}?addParents=${novoPaiId}${paisAntigos.length ? `&removeParents=${paisAntigos.join(',')}` : ''}&fields=id`, {
      method: 'PATCH', body: JSON.stringify(novoNome ? { name: novoNome } : {}),
    });
    return { paisAntigos, nomeAntigo: atual.name };
  }

  /** Só renomeia (o ID não muda). */
  const renomear = (id, novoNome) => api(`files/${id}?fields=id`, { method: 'PATCH', body: JSON.stringify({ name: novoNome }) });

  /** Manda para a LIXEIRA (recuperável). Nunca exclui de vez: não existe DELETE neste cliente. */
  const paraLixeira = id => api(`files/${id}?fields=id`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) });

  return { listar, criarPasta, mover, renomear, paraLixeira };
}
