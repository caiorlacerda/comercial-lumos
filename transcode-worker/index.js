// Worker de transcodificação (Cloud Run + ffmpeg) — Lumos.
//
// Disparado pelo trigger trg_call_transcode (pg_net) quando entra um .mov/ProRes
// em video_versions. Baixa o original do Drive, gera um proxy MP4 H.264 e grava
// proxy_file_id + transcode_status='ready'. A review-stream passa a servir o proxy.
//
// Responde 202 na hora e processa em background — por isso o Cloud Run deve ser
// deployado com --no-cpu-throttling (CPU sempre alocada).
//
// Env: TRANSCODE_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      GOOGLE_SERVICE_ACCOUNT_JSON (o mesmo JSON do service account do Drive).

import express from 'express';
import { JWT, GoogleAuth } from 'google-auth-library';
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHmac, timingSafeEqual } from 'node:crypto';

const PORT = process.env.PORT || 8080;
const SECRET = process.env.TRANSCODE_SECRET || '';
// Mesmo valor do secret DRIVE_WEBHOOK_SECRET das Edge Functions: é com ele que a
// stream-ingest assina o endereço temporário que o Cloudflare Stream usa pra
// buscar o vídeo (rota /pull abaixo).
const PULL_SECRET = process.env.PULL_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SA = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
  : null;

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive'];

async function driveToken() {
  // Se o JSON do service account foi passado, usa ele. Senão, usa a identidade
  // do Cloud Run (ADC) — deploy com --service-account=<email-do-SA-do-Drive>.
  if (SA?.client_email && SA?.private_key) {
    const client = new JWT({ email: SA.client_email, key: SA.private_key, scopes: DRIVE_SCOPES });
    const { access_token } = await client.authorize();
    return access_token;
  }
  const auth = new GoogleAuth({ scopes: DRIVE_SCOPES });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

function runFfmpeg(inPath, outPath) {
  return new Promise((resolve, reject) => {
    // H.264 até 1080p, faststart (streaming progressivo), áudio AAC.
    const args = [
      '-y', '-i', inPath,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
      '-pix_fmt', 'yuv420p',
      '-vf', "scale='min(1920,iw)':-2",
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart',
      outPath,
    ];
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg exit ' + code))));
  });
}

async function uploadToDrive(token, filePath, name, parent) {
  const metadata = { name, mimeType: 'video/mp4', ...(parent ? { parents: [parent] } : {}) };
  const initRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(metadata),
    }
  );
  if (!initRes.ok) throw new Error('drive init upload ' + initRes.status);
  const session = initRes.headers.get('location');
  const size = (await stat(filePath)).size;
  const putRes = await fetch(session, {
    method: 'PUT',
    headers: { 'Content-Length': String(size), 'Content-Type': 'video/mp4' },
    body: createReadStream(filePath),
    duplex: 'half',
  });
  if (!putRes.ok) throw new Error('drive put upload ' + putRes.status);
  const j = await putRes.json();
  return j.id;
}

async function processVersion(versionId) {
  const dir = await mkdtemp(join(tmpdir(), 'tx-'));
  const inPath = join(dir, 'in.src');
  const outPath = join(dir, 'out.mp4');
  try {
    const { data: v } = await supa
      .from('video_versions')
      .select('drive_file_id, file_name')
      .eq('id', versionId)
      .maybeSingle();
    if (!v?.drive_file_id) throw new Error('version not found');

    await supa.from('video_versions').update({ transcode_status: 'processing', transcode_error: null }).eq('id', versionId);

    const token = await driveToken();

    // Pasta de destino = mesma do original.
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${v.drive_file_id}?fields=parents,name&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const meta = await metaRes.json();
    const parent = meta.parents?.[0];

    // Download do original.
    const dlRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${v.drive_file_id}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!dlRes.ok || !dlRes.body) throw new Error('download failed ' + dlRes.status);
    await pipeline(dlRes.body, createWriteStream(inPath));

    // Transcode.
    await runFfmpeg(inPath, outPath);

    // Upload do proxy.
    const proxyName = (v.file_name || 'video').replace(/\.[^.]+$/, '') + '__proxy.mp4';
    const proxyId = await uploadToDrive(token, outPath, proxyName, parent);

    await supa.from('video_versions').update({ proxy_file_id: proxyId, transcode_status: 'ready' }).eq('id', versionId);
    console.log('transcode ready', versionId, '->', proxyId);
  } catch (err) {
    console.error('transcode error', versionId, err);
    await supa
      .from('video_versions')
      .update({ transcode_status: 'error', transcode_error: String(err && err.message ? err.message : err).slice(0, 500) })
      .eq('id', versionId);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const app = express();
app.use(express.json());

app.get('/', (_req, res) => res.send('lumos transcode worker ok'));

// --- Busca assinada: o Cloudflare Stream puxa o vídeo por aqui ---------------
// Antes o Stream buscava o arquivo pela Edge Function review-stream, e o arquivo
// inteiro saía pela cota de egress do Supabase. Aqui os bytes vão Drive → Cloud
// Run → Cloudflare, sem passar pelo Supabase. Mesma assinatura da review-stream:
// HMAC-SHA256 hex de `${versionId}.${exp}`, válida só pra UMA versão e por pouco
// tempo. Responde a Range (o Stream pode pedir em pedaços) e a HEAD.
function assinaturaPull(versionId, exp) {
  return createHmac('sha256', PULL_SECRET).update(`${versionId}.${exp}`).digest('hex');
}

app.get('/pull', async (req, res) => {
  const { v: versionId, exp, sig } = req.query;
  if (!PULL_SECRET) return res.status(503).send('pull desabilitado');
  if (typeof versionId !== 'string' || typeof exp !== 'string' || typeof sig !== 'string') {
    return res.status(400).send('parâmetros faltando');
  }
  if (!(Number(exp) >= Date.now())) return res.status(403).send('link expirado');
  const esperada = Buffer.from(assinaturaPull(versionId, exp));
  const recebida = Buffer.from(sig);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) {
    return res.status(403).send('assinatura inválida');
  }

  const abort = new AbortController();
  res.on('close', () => abort.abort());

  try {
    const { data: v } = await supa
      .from('video_versions')
      .select('drive_file_id, proxy_file_id, transcode_status')
      .eq('id', versionId)
      .maybeSingle();
    if (!v?.drive_file_id) return res.status(404).send('not found');
    // Mesma regra da review-stream: se o proxy MP4 está pronto, ele é mais leve.
    const usaProxy = !!v.proxy_file_id && v.transcode_status === 'ready';
    const fileId = usaProxy ? v.proxy_file_id : v.drive_file_id;

    const token = await driveToken();
    const ehHead = req.method === 'HEAD';
    // HEAD: pede só 1 byte ao Drive e deduz o tamanho total; não baixa o vídeo.
    const range = ehHead ? 'bytes=0-0' : req.headers.range;
    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${token}`, ...(range ? { Range: range } : {}) },
        signal: abort.signal,
      }
    );

    res.status(ehHead ? 200 : driveRes.status);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    const contentRange = driveRes.headers.get('content-range');
    if (ehHead) {
      const total = contentRange?.split('/')[1] ?? driveRes.headers.get('content-length');
      if (total && total !== '*') res.setHeader('Content-Length', total);
      await driveRes.body?.cancel().catch(() => {});
      return res.end();
    }
    if (contentRange) res.setHeader('Content-Range', contentRange);
    const contentLength = driveRes.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (!driveRes.body) return res.end();
    await pipeline(Readable.fromWeb(driveRes.body), res);
  } catch (err) {
    // Cliente que desistiu (o Stream fecha a conexão) não é erro nosso.
    if (abort.signal.aborted) return;
    console.error('pull error', versionId, err);
    if (!res.headersSent) res.status(502).send('falha ao buscar o vídeo');
    else res.destroy();
  }
});

app.post('/transcode', (req, res) => {
  if ((req.headers['x-transcode-secret'] || '') !== SECRET) {
    return res.status(401).send('unauthorized');
  }
  const versionId = req.body?.version_id;
  if (!versionId) return res.status(400).send('missing version_id');
  // Responde já e processa em background (Cloud Run com --no-cpu-throttling).
  res.status(202).json({ accepted: true });
  processVersion(versionId).catch((e) => console.error('unhandled', e));
});

app.listen(PORT, () => console.log('transcode worker listening on', PORT));
