# Reembolso: extração automática dos dados da nota por IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anexar a nota de um reembolso já preenche Fornecedor, Categoria, Valor e Data sozinho, lendo o recibo com Claude — sobra só o Motivo e o Projeto pra quem pede.

**Architecture:** Duas colunas novas em `reimbursements` (`supplier`, `category`, reaproveitando o enum `expense_category` já usado em `project_expenses`/`payables`). Uma Edge Function nova (`extract-receipt`) recebe o arquivo em base64, chama a API da Anthropic com o arquivo como conteúdo de visão/documento e uma ferramenta forçada (`tool_choice`) pra garantir resposta estruturada, e devolve os quatro campos (nunca falha "feio" — campos `null` em qualquer problema). `Reembolso.tsx` chama essa função assim que o arquivo é anexado (inclusive foto tirada pela câmera no celular), mostra "Lendo a nota com IA…", e pré-preenche os campos, todos editáveis.

**Tech Stack:** React + TypeScript (frontend), Supabase Edge Functions em Deno (backend), Postgres/RLS (dados), API da Anthropic (extração).

**Spec:** [docs/superpowers/specs/2026-09-30-reembolso-extracao-ia-design.md](../specs/2026-09-30-reembolso-extracao-ia-design.md)

## Global Constraints

- Este projeto não tem framework de teste automatizado (sem Jest/Vitest/Testing Library) — a verificação de cada tarefa é `npx tsc --noEmit` (frontend) e teste manual (navegador / `curl`), igual ao resto do projeto.
- **SQL é sempre rodado à mão pelo Caio, nunca pela IA** — a Tarefa 1 termina com a migration pronta em arquivo; rodar contra o banco é um passo manual dele.
- **Segredos e deploy de Edge Function também são manuais do Caio** (`supabase secrets set`, `supabase functions deploy`) — não são comandos que o executor deste plano roda sozinho.
- Não alterar nada em `Reembolso.tsx` além do que este plano pede (regra do `CLAUDE.md`: nada de refactor de oportunidade).
- Usar sempre os tokens `lumos-*` do Tailwind já usados no resto do arquivo — nunca cor crua.
- Terminar cada tarefa com `npx tsc --noEmit` limpo antes de seguir pra próxima.

---

## Task 1: Migration — `supplier` e `category` em `reimbursements`

**Files:**
- Create: `supabase/migrations/2026093356_reembolso_fornecedor_categoria.sql`

**Interfaces:**
- Produces: colunas `reimbursements.supplier text` (nullable) e `reimbursements.category expense_category` (nullable, mesmo enum já usado por `project_expenses`/`payables`: `equipe, equipamento, locacao, transporte, alimentacao, hospedagem, marketing, software, impostos, servicos_terceiros, manutencao, outro`).

- [ ] **Step 1: Escrever a migration**

```sql
-- Reembolso: extração automática por IA passa a sugerir fornecedor e
-- categoria na hora de anexar a nota. As duas colunas ficam opcionais —
-- reembolsos já existentes continuam válidos com os dois campos em branco.
-- Reaproveita o enum expense_category que project_expenses e payables já
-- usam, em vez de criar uma taxonomia nova só pra reembolso.
ALTER TABLE public.reimbursements
  ADD COLUMN IF NOT EXISTS supplier text,
  ADD COLUMN IF NOT EXISTS category expense_category;

-- Conferência: as duas colunas têm que aparecer.
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'reimbursements'
  AND column_name IN ('supplier', 'category')
ORDER BY column_name;
```

- [ ] **Step 2: Handoff pro Caio**

Cole o SQL acima na mensagem pro Caio rodar no SQL Editor do Supabase (nunca
execute você mesmo). Peça o resultado da consulta de conferência — tem que
voltar duas linhas: `category` (`udt_name = expense_category`) e `supplier`
(`udt_name = text`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026093356_reembolso_fornecedor_categoria.sql
git commit -m "feat: adiciona fornecedor e categoria em reimbursements para extração por IA"
```

---

## Task 2: Edge Function `extract-receipt`

**Files:**
- Create: `supabase/functions/extract-receipt/index.ts`

**Interfaces:**
- Consumes: secret `ANTHROPIC_API_KEY` (configurado manualmente pelo Caio no Supabase); `SUPABASE_URL` e `SUPABASE_ANON_KEY`, já disponíveis em toda Edge Function.
- Produces: endpoint chamado via `supabase.functions.invoke('extract-receipt', { body: { file_base64: string, mime_type: string } })`. Retorna sempre HTTP 200 com `{ supplier: string | null, amount: number | null, expense_date: string | null, category: string | null }` quando a chamada é válida (mesmo que a leitura falhe — nesse caso os quatro campos vêm `null`). Retorna 400/401/403 só pra erro de uso (sem arquivo, sem login, usuário inativo).

- [ ] **Step 1: Escrever a função**

```typescript
// supabase/functions/extract-receipt/index.ts
//
// Lê um recibo/nota (imagem ou PDF) com Claude e devolve fornecedor, valor,
// data e uma categoria sugerida — pra pré-preencher o formulário de
// Reembolso. Chamada autenticada pelo próprio app (JWT de quem está
// logado); qualquer funcionário ATIVO pode chamar, não só admin.
//
// Nunca falha "feio": se a leitura não for possível (imagem ruim, não é bem
// um recibo, erro de rede com a Anthropic), devolve os quatro campos como
// null com status 200 — a tela trata isso como "preenche à mão".

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

const VALID_CATEGORIES = [
  'equipe', 'equipamento', 'locacao', 'transporte', 'alimentacao',
  'hospedagem', 'marketing', 'software', 'impostos', 'servicos_terceiros',
  'manutencao', 'outro',
]

const EMPTY = { supplier: null, amount: null, expense_date: null, category: null }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

    // 1. Autoriza: qualquer funcionário ativo (não precisa ser admin).
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401)
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user: caller } } = await callerClient.auth.getUser()
    if (!caller) return json({ error: 'Sessão inválida.' }, 401)
    const { data: callerProfile } = await callerClient
      .from('app_users').select('id, status').eq('auth_user_id', caller.id).single()
    if (!callerProfile || callerProfile.status !== 'ativo') {
      return json({ error: 'Usuário inativo.' }, 403)
    }

    // 2. Corpo: arquivo em base64 + mime type.
    const { file_base64, mime_type } = await req.json().catch(() => ({}))
    if (!file_base64 || typeof file_base64 !== 'string') {
      return json({ error: 'Arquivo é obrigatório.' }, 400)
    }
    // ~15MB de arquivo original (base64 é ~33% maior).
    if (file_base64.length > 20_000_000) {
      return json({ error: 'Arquivo muito grande.' }, 400)
    }
    const mime = typeof mime_type === 'string' && mime_type ? mime_type : 'image/jpeg'

    if (!ANTHROPIC_API_KEY) {
      console.error('extract-receipt: ANTHROPIC_API_KEY não configurada')
      return json(EMPTY)
    }

    // 3. Pergunta pro Claude, com a resposta forçada em formato de
    //    ferramenta (tool_choice) — sem isso, o modelo às vezes embrulha o
    //    JSON em texto solto ou crase de markdown, e quebraria o parse.
    const isPdf = mime === 'application/pdf'
    const content = [
      isPdf
        ? { type: 'document', source: { type: 'base64', media_type: mime, data: file_base64 } }
        : { type: 'image', source: { type: 'base64', media_type: mime, data: file_base64 } },
      { type: 'text', text: 'Extraia os dados deste recibo ou nota fiscal.' },
    ]

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: 'Você lê recibos e notas fiscais brasileiras (fotos, prints de ' +
          'app de delivery/transporte, PDFs) e extrai os dados do gasto. Se não ' +
          'conseguir identificar um campo com confiança, deixe ele de fora — ' +
          'nunca invente um valor.',
        messages: [{ role: 'user', content }],
        tools: [{
          name: 'registrar_dados_recibo',
          description: 'Registra os dados extraídos do recibo.',
          input_schema: {
            type: 'object',
            properties: {
              supplier: { type: 'string', description: 'Nome do estabelecimento/fornecedor, ex.: "Cabana Burger"' },
              amount: { type: 'number', description: 'Valor TOTAL pago, em reais, como número decimal (ex.: 55.9). Ponto, nunca vírgula.' },
              expense_date: { type: 'string', description: 'Data da compra/pedido, no formato YYYY-MM-DD.' },
              category: { type: 'string', enum: VALID_CATEGORIES, description: 'Categoria do gasto que melhor descreve este recibo.' },
            },
          },
        }],
        tool_choice: { type: 'tool', name: 'registrar_dados_recibo' },
      }),
    })

    if (!anthropicRes.ok) {
      console.error('extract-receipt: Anthropic respondeu', anthropicRes.status, await anthropicRes.text().catch(() => ''))
      return json(EMPTY)
    }
    const data = await anthropicRes.json()
    const toolUse = (data.content ?? []).find((b: any) => b?.type === 'tool_use')
    const input = toolUse?.input ?? {}

    return json({
      supplier: typeof input.supplier === 'string' && input.supplier.trim() ? input.supplier.trim() : null,
      amount: typeof input.amount === 'number' && isFinite(input.amount) ? input.amount : null,
      expense_date: typeof input.expense_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.expense_date) ? input.expense_date : null,
      category: VALID_CATEGORIES.includes(input.category) ? input.category : null,
    })
  } catch (err) {
    console.error('extract-receipt:', err)
    return json(EMPTY)
  }
})
```

- [ ] **Step 2: Handoff pro Caio — secret e deploy**

Peça pro Caio rodar (ele, não você):

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy extract-receipt
```

A chave é a mesma que ele já usa pra API da Anthropic — confirme com ele qual
é a certa antes de pedir pra rodar.

- [ ] **Step 3: Verificar com curl**

Depois do deploy, peça pro Caio (ou rode você, se tiver um token de sessão à
mão) confirmar que a função responde — precisa de um JWT válido de um usuário
ativo:

```bash
curl -i -X POST \
  "https://<PROJECT_REF>.supabase.co/functions/v1/extract-receipt" \
  -H "Authorization: Bearer <JWT_DE_UM_USUARIO_LOGADO>" \
  -H "Content-Type: application/json" \
  -d '{"file_base64": "", "mime_type": "image/jpeg"}'
```

Esperado: `400 {"error":"Arquivo é obrigatório."}` (confirma que a autenticação
passou e a validação de corpo funciona, sem gastar uma chamada de verdade à
Anthropic). Depois, testar com o base64 de uma foto de recibo real deve
voltar `200` com os quatro campos preenchidos.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/extract-receipt/index.ts
git commit -m "feat: adiciona extract-receipt, extração de dados de recibo via Claude"
```

---

## Task 3: Frontend — Reembolso.tsx

**Files:**
- Modify: `src/pages/Reembolso.tsx`

**Interfaces:**
- Consumes: `supabase.functions.invoke('extract-receipt', { body: { file_base64, mime_type } })` → `{ supplier: string|null, amount: number|null, expense_date: string|null, category: string|null }` (Task 2). Colunas `supplier`/`category` em `reimbursements` (Task 1).

- [ ] **Step 1: Rótulo "Motivo do gasto" e novo estado**

Modificar `formData` (linha 67-75) pra incluir os dois campos novos:

```typescript
  const [formData, setFormData] = useState({
    description: '',
    amount: 0,
    expense_date: new Date().toISOString().split('T')[0],
    project_id: '',
    payment_method: 'pix',
    notes: '',
    attachment: null as File | null,
    supplier: '',
    category: ''
  });
```

Adicionar, logo depois da linha de `uploading` (linha 76):

```typescript
  const [extracting, setExtracting] = useState(false);
```

Atualizar `resetForm` (linha 371-374) pra incluir os campos novos:

```typescript
  const resetForm = () => {
    setFormData({ description: '', amount: 0, expense_date: new Date().toISOString().split('T')[0], project_id: '', payment_method: 'pix', notes: '', attachment: null, supplier: '', category: '' });
    setProjectSearch('');
  };
```

- [ ] **Step 2: Constante de categorias**

Adicionar logo antes de `export default function Reembolso()` (depois do
`StatusBadge`, linha 54):

```typescript
const EXPENSE_CATEGORY_OPTIONS = [
  { value: 'alimentacao', label: 'Alimentação' },
  { value: 'transporte', label: 'Transporte' },
  { value: 'hospedagem', label: 'Hospedagem' },
  { value: 'equipamento', label: 'Equipamento' },
  { value: 'equipe', label: 'Equipe' },
  { value: 'locacao', label: 'Locação' },
  { value: 'software', label: 'Software' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'servicos_terceiros', label: 'Serviços de terceiros' },
  { value: 'manutencao', label: 'Manutenção' },
  { value: 'impostos', label: 'Impostos' },
  { value: 'outro', label: 'Outro' },
];
const categoryLabel = (value: string) => EXPENSE_CATEGORY_OPTIONS.find(o => o.value === value)?.label || value;
```

- [ ] **Step 3: Função de extração**

Adicionar logo antes de `handleSubmit` (antes da linha 142):

```typescript
  const fileToBase64 = (file: File): Promise<{ base64: string; mime: string }> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1] || '';
        resolve({ base64, mime: file.type || 'application/octet-stream' });
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const extractReceiptData = async (file: File) => {
    setExtracting(true);
    try {
      const { base64, mime } = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke('extract-receipt', {
        body: { file_base64: base64, mime_type: mime },
      });
      if (error) throw error;
      setFormData(prev => ({
        ...prev,
        supplier: data?.supplier || prev.supplier,
        amount: typeof data?.amount === 'number' ? data.amount : prev.amount,
        expense_date: data?.expense_date || prev.expense_date,
        category: data?.category || prev.category,
      }));
      if (!data?.supplier && data?.amount == null && !data?.expense_date && !data?.category) {
        toast.error('Não consegui ler os dados automaticamente, preenche os campos.');
      }
    } catch (err) {
      console.error('extract-receipt falhou:', err);
      toast.error('Não consegui ler os dados automaticamente, preenche os campos.');
    } finally {
      setExtracting(false);
    }
  };
```

- [ ] **Step 4: Rodar tsc pra conferir que as funções novas compilam**

Run: `npx tsc --noEmit`
Expected: sem erro novo relacionado a `Reembolso.tsx` (os únicos erros
aceitáveis são os pré-existentes de dependências faltando, ex.:
`@tiptap/extension-mention`, `hls.js`, `pdfjs-dist` — não relacionados a
este arquivo).

- [ ] **Step 5: Incluir `supplier`/`category` no insert**

Modificar o insert em `handleSubmit` (linha 169-181):

```typescript
      const { error } = await supabase.from('reimbursements').insert([{
        requester_id: profile.id,
        description: formData.description,
        amount: formData.amount,
        expense_date: formData.expense_date,
        project_id: formData.project_id === 'interno' ? null : (formData.project_id || null),
        payment_method: formData.payment_method,
        notes: formData.project_id === 'interno' ? `${formData.notes}\n[Gasto Interno]`.trim() : formData.notes,
        attachments: formData.project_id === 'interno' && attachmentData
          ? attachmentData.map((a: any) => ({ ...a, interno: true })) 
          : attachmentData,
        supplier: formData.supplier || null,
        category: formData.category || null,
        status: 'pendente'
      }]);
```

- [ ] **Step 6: Ligar a extração no input de arquivo, e permitir câmera no celular**

Modificar o input de comprovante (linha 780-786):

```typescript
              <input 
                type="file" 
                className="hidden" 
                id="receipt-upload" 
                capture="environment"
                onChange={e => {
                  const file = e.target.files?.[0] || null;
                  setFormData(prev => ({ ...prev, attachment: file }));
                  if (file) void extractReceiptData(file);
                }}
                accept="image/*,application/pdf"
              />
```

Adicionar logo abaixo do label do upload (depois da linha 802, antes do
bloco `{isAuthenticated() ? (...`), o indicador de leitura:

```typescript
            {extracting && (
              <p className="text-[10px] text-lumos-yellow flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 border-2 border-lumos-yellow/30 border-t-lumos-yellow rounded-full animate-spin" />
                Lendo a nota com IA…
              </p>
            )}
```

- [ ] **Step 7: Campos novos no formulário — Fornecedor e Categoria, e rótulo "Motivo do gasto"**

Trocar o rótulo da descrição (linha 625):

```typescript
            <label className="text-xs font-bold text-lumos-text-secondary uppercase">Motivo do gasto</label>
```

Adicionar um grid novo logo depois do bloco de Projeto (depois da linha 766,
antes do grid de Valor/Data que começa na linha 767):

```typescript
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Fornecedor</label>
              <input type="text" className="input-lumos w-full" placeholder="Ex.: Cabana Burger"
                value={formData.supplier} onChange={e => setFormData({ ...formData, supplier: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Tipo de despesa</label>
              <Select value={formData.category} onChange={v => setFormData({ ...formData, category: v })}
                className="input-lumos w-full" placeholder="Selecione"
                options={EXPENSE_CATEGORY_OPTIONS} />
            </div>
          </div>
```

- [ ] **Step 8: Mostrar Fornecedor e Categoria na tabela (desktop)**

Adicionar duas colunas no cabeçalho (depois de "Descrição", linha 410):

```typescript
                <th className="px-6 py-4">Descrição</th>
                <th className="px-6 py-4">Fornecedor</th>
                <th className="px-6 py-4">Categoria</th>
```

Atualizar os dois `colSpan` das linhas de loading/vazio (linhas 418 e 420) de
`isAdmin ? 7 : 5` para `isAdmin ? 9 : 7`.

Adicionar as duas células correspondentes na linha da tabela, depois da
célula de descrição (depois da linha 456, antes da célula de Valor):

```typescript
                    <td className="px-6 py-4 text-sm text-lumos-text-secondary">{r.supplier || '—'}</td>
                    <td className="px-6 py-4">
                      {r.category ? (
                        <span className="text-[10px] font-bold uppercase tracking-widest text-lumos-text-secondary bg-lumos-text-primary/5 border border-lumos-border rounded-full px-2 py-0.5">
                          {categoryLabel(r.category)}
                        </span>
                      ) : '—'}
                    </td>
```

- [ ] **Step 9: Mostrar Fornecedor e Categoria no card mobile**

Adicionar logo depois da linha do nome do projeto no card mobile (depois da
linha 507, dentro do `MobileCard`):

```typescript
                {(r.supplier || r.category) && (
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {r.supplier && <span className="text-[10px] text-lumos-text-secondary truncate">{r.supplier}</span>}
                    {r.category && (
                      <span className="text-[9px] font-bold uppercase tracking-widest text-lumos-text-secondary bg-lumos-text-primary/5 border border-lumos-border rounded-full px-1.5 py-0.5">
                        {categoryLabel(r.category)}
                      </span>
                    )}
                  </div>
                )}
```

- [ ] **Step 10: Rodar tsc de novo**

Run: `npx tsc --noEmit`
Expected: mesmo resultado do Step 4 (sem erro novo em `Reembolso.tsx`).

- [ ] **Step 11: Teste manual no navegador**

Com a migration e o deploy da função já feitos pelo Caio: abrir
`/financeiro/reembolso`, clicar em "Nova Solicitação", anexar uma foto de
recibo legível e conferir que Fornecedor, Categoria, Valor e Data vêm
preenchidos; testar de novo anexando uma imagem que não é recibo nenhum
(ex.: uma foto qualquer) e conferir que os campos ficam em branco com o
aviso, sem travar o envio; enviar um reembolso e conferir que ele aparece na
lista com Fornecedor e Categoria.

- [ ] **Step 12: Commit**

```bash
git add src/pages/Reembolso.tsx
git commit -m "feat: extração automática de fornecedor, valor, data e categoria ao anexar a nota"
```
