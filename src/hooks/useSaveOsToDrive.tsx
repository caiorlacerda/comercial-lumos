import { useCallback } from 'react';
import { pdf } from '@react-pdf/renderer';
import { supabase } from '@/lib/supabase';
import { useGoogleDrive } from '@/hooks/useGoogleDrive';
import { useAuth } from '@/hooks/useAuth';
import { ServiceOrderPDF } from '@/components/editor/ServiceOrderPDF';
import { formatBudgetCode } from '@/utils/formatters';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface SaveOsResult { ok: boolean; skipped?: boolean; url?: string; error?: string; }

// Gera a OS (PDF, no navegador) e salva na subpasta "OS" da pasta do projeto no
// Drive, registrando também na seção Documentos do projeto.
// - interactive=true (botão): pede login do Google se preciso (abre popup).
// - interactive=false (auto na aprovação): só roda se já estiver logado; senão
//   retorna { skipped:true } sem incomodar.
export function useSaveOsToDrive() {
  const { ensureAuth, isAuthenticated, uploadToDrive, listFiles, createFolder } = useGoogleDrive();
  const { profile } = useAuth();

  // Garante a pasta do projeto no Drive (provisiona sob demanda e aguarda).
  const resolveProjectFolder = useCallback(async (projectId: string): Promise<string | null> => {
    const { data } = await supabase.from('projects').select('drive_folder_id').eq('id', projectId).single();
    if (data?.drive_folder_id) return data.drive_folder_id;
    // toca no projeto pra disparar o provisionamento
    await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId);
    for (let i = 0; i < 14; i++) {
      await sleep(1500);
      const { data: d } = await supabase.from('projects').select('drive_folder_id').eq('id', projectId).single();
      if (d?.drive_folder_id) return d.drive_folder_id;
    }
    return null;
  }, []);

  const resolveOsSubfolder = useCallback(async (projectFolderId: string): Promise<string> => {
    const res = await listFiles(`'${projectFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = 'OS' and trashed = false`);
    return res.files?.[0]?.id || (await createFolder('OS', projectFolderId)).id;
  }, [listFiles, createFolder]);

  const saveOsToDrive = useCallback(async (opts: { budgetId: string; projectId: string; interactive: boolean }): Promise<SaveOsResult> => {
    const { budgetId, projectId, interactive } = opts;
    if (!budgetId || !projectId) return { ok: false, error: 'sem orçamento/projeto' };

    // No modo automático, não incomoda: só sobe se já autenticado.
    if (interactive) {
      if (!(await ensureAuth())) return { ok: false, error: 'Não foi possível conectar a conta Google.' };
    } else {
      if (!isAuthenticated()) return { ok: false, skipped: true };
      // Evita duplicar OS na re-aprovação: se já tem uma OS registrada, pula.
      const { data: existing } = await supabase.from('project_documents')
        .select('id').eq('project_id', projectId).ilike('name', 'OS %').limit(1);
      if (existing && existing.length > 0) return { ok: false, skipped: true };
    }

    try {
      const { data: budget } = await supabase.from('budgets').select('*, clients(*)').eq('id', budgetId).single();
      if (!budget?.active_version_id) return { ok: false, error: 'Orçamento sem versão ativa.' };
      const { data: version } = await supabase.from('budget_versions').select('*').eq('id', budget.active_version_id).single();
      const { data: items } = await supabase.from('budget_items').select('*').eq('version_id', budget.active_version_id).order('sort_order', { ascending: true });
      if (!version) return { ok: false, error: 'Versão do orçamento não encontrada.' };

      const folderId = await resolveProjectFolder(projectId);
      if (!folderId) return { ok: false, error: 'A pasta do projeto no Drive ainda não está pronta.' };
      const osFolder = await resolveOsSubfolder(folderId);

      const blob = await pdf(
        <ServiceOrderPDF budget={budget} version={version} contact={null} items={items || []} />
      ).toBlob();

      const codeStr = budget.code ? formatBudgetCode(budget.code) : '';
      const name = `OS ${codeStr ? codeStr + ' - ' : ''}${budget.project_name || budget.clients?.name || 'Lumos'}.pdf`.trim();
      const res = await uploadToDrive(blob, name, 'application/pdf', osFolder);
      const url = res.webViewLink || `https://drive.google.com/file/d/${res.id}/view`;

      await supabase.from('project_documents').insert([{
        project_id: projectId, name, url, kind: 'file', tag: 'geral',
        drive_file_id: res.id, mime_type: 'application/pdf', created_by: profile?.id || null,
      }]);

      return { ok: true, url };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Falha ao salvar a OS no Drive.' };
    }
  }, [ensureAuth, isAuthenticated, uploadToDrive, resolveProjectFolder, resolveOsSubfolder, profile?.id]);

  return { saveOsToDrive };
}
