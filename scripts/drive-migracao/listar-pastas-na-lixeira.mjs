// SÓ LEITURA. Lista os projetos cuja pasta de revisão gravada no banco (drive_upload_folder_id e, no v2,
// drive_pastas.revisao) está na lixeira do Drive (ou por pai na lixeira) ou não existe mais.
//
// 1) Exporte os projetos do banco (só leitura):
//      supabase db query --linked -f scripts/drive-migracao/projetos-com-pasta.sql > /tmp/projetos.json
// 2) Rode (a chave da conta de serviço fica num arquivo SEU; o script só pede o escopo drive.readonly):
//      GOOGLE_SERVICE_ACCOUNT_FILE=/caminho/chave.json node scripts/drive-migracao/listar-pastas-na-lixeira.mjs /tmp/projetos.json
//
// Nunca grava nada, nem no Drive nem no banco.
import crypto from 'node:crypto';
import fs from 'node:fs';

const b64 = x => Buffer.from(x).toString('base64url');
async function token(sa) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const c = b64(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(`${h}.${c}`).sign(sa.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${h}.${c}.${sig}` });
  return (await r.json()).access_token;
}

const arquivo = process.argv[2];
if (!arquivo || !process.env.GOOGLE_SERVICE_ACCOUNT_FILE) { console.error('uso: GOOGLE_SERVICE_ACCOUNT_FILE=chave.json node listar-pastas-na-lixeira.mjs projetos.json'); process.exit(1); }
const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
const projetos = Array.isArray(dados) ? dados : dados.rows;
const tk = await token(JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_FILE, 'utf8')));

async function estado(id) {
  if (!id) return 'sem_id';
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,trashed,mimeType&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${tk}` } });
  if (r.status === 404) return 'nao_existe';
  if (!r.ok) return `erro_${r.status}`;
  const f = await r.json();
  return f.trashed ? 'NA_LIXEIRA' : 'viva';
}

const saida = [];
for (const p of projetos) {
  const ids = new Set([p.drive_upload_folder_id, p.drive_layout === 'v2' ? p.drive_pastas?.revisao : null].filter(Boolean));
  for (const id of ids) {
    const e = await estado(id);
    if (e !== 'viva') saida.push({ projeto: p.name, codigo: p.code, status: p.status, layout: p.drive_layout, pasta_id: id, estado: e });
  }
}
console.log(JSON.stringify(saida, null, 2));
console.error(`${projetos.length} projetos conferidos; ${saida.length} com pasta de revisão fora do ar.`);
