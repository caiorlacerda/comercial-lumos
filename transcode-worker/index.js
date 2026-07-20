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
import { JWT } from 'google-auth-library';
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const PORT = process.env.PORT || 8080;
const SECRET = process.env.TRANSCODE_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SA = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

async function driveToken() {
  const client = new JWT({
    email: SA.client_email,
    key: SA.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  const { access_token } = await client.authorize();
  return access_token;
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
