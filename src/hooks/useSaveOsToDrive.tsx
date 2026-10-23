import { useCallback } from 'react';
import { pdf } from '@react-pdf/renderer';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { ServiceOrderPDF } from '@/components/editor/ServiceOrderPDF';
import { getPdfFileName } from '@/utils/pdfFileName';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface SaveOsResult { ok: boolean; skipped?: boolean; url?: string; error?: string; }

// Gera a OS (PDF, no navegador) e manda pra função `drive-os-upload`, que salva na
// subpasta "OS" da pasta do projeto no Drive com a conta de serviço — não depende
// de a pessoa estar logada no Google. Também registra na seção Documentos.
// Não duplica: se o projeto já tem uma OS registrada, pula.
export function useSaveOsToDrive() {
  const { profile } = useAuth();

  // Garante a pasta do projeto no Drive (provisiona sob demanda e aguarda).
  const resolveProjectFolder = useCallback(async (projectId: string): Promise<{ folderId: string | null; name: string }> => {
    const { data } = await supabase.from('projects').select('drive_folder_id, name').eq('id', projectId).single();
    if (data?.drive_folder_id) return { folderId: data.drive_folder_id, name: data.name || '' };
    // toca no projeto pra disparar o provisionamento
    await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId);
    for (let i = 0; i < 14; i++) {
      await sleep(1500);
      const { data: d } = await supabase.from('projects').select('drive_folder_id').eq('id', projectId).single();
      if (d?.drive_folder_id) return { folderId: d.drive_folder_id, name: data?.name || '' };
    }
    return { folderId: null, name: data?.name || '' };
  }, []);

  const saveOsToDrive = useCallback(async (opts: { budgetId: string; projectId: string }): Promise<SaveOsResult> => {
    const { budgetId, projectId } = opts;
    if (!budgetId || !projectId) return { ok: false, error: 'sem orçamento/projeto' };

    try {
      // Evita duplicar OS (re-aprovação, dois acessos ao mesmo tempo).
      const { data: existing } = await supabase.from('project_documents')
        .select('id').eq('project_id', projectId).ilike('name', 'OS %').limit(1);
      if (existing && existing.length > 0) return { ok: false, skipped: true };

      const { data: budget } = await supabase.from('budgets').select('*, clients(*)').eq('id', budgetId).single();
      if (!budget?.active_version_id) return { ok: false, error: 'Orçamento sem versão ativa.' };
      const { data: version } = await supabase.from('budget_versions').select('*').eq('id', budget.active_version_id).single();
      const { data: items } = await supabase.from('budget_items').select('*').eq('version_id', budget.active_version_id).order('sort_order', { ascending: true });
      if (!version) return { ok: false, error: 'Versão do orçamento não encontrada.' };

      const { folderId, name: projectName } = await resolveProjectFolder(projectId);
      if (!folderId) return { ok: false, error: 'A pasta do projeto no Drive ainda não está pronta.' };

      const blob = await pdf(
        <ServiceOrderPDF budget={budget} version={version} contact={null} items={items || []} projectName={projectName} />
      ).toBlob();

      const name = getPdfFileName(
        budget.code,
        budget.clients?.name || 'Cliente',
        budget.clients?.agency_name,
        budget.project_name || projectName,
        'OS ',
      );

      const { data: { session } } = await supabase.auth.getSession();
      const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/drive-os-upload?project_id=${encodeURIComponent(projectId)}&file_name=${encodeURIComponent(name)}`,
        { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || anon}`, apikey: anon, 'Content-Type': 'application/pdf' }, body: blob },
      );
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out?.id) return { ok: false, error: out?.error || `Falha ao salvar a OS no Drive (${res.status}).` };

      const url = out.webViewLink || `https://drive.google.com/file/d/${out.id}/view`;

      await supabase.from('project_documents').insert([{
        project_id: projectId, name, url, kind: 'file', tag: 'geral',
        drive_file_id: out.id, mime_type: 'application/pdf', created_by: profile?.id || null,
      }]);

      return { ok: true, url };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Falha ao salvar a OS no Drive.' };
    }
  }, [resolveProjectFolder, profile?.id]);

  return { saveOsToDrive };
}
