import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, FileUp, Loader2, Receipt, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

/**
 * PÁGINA PÚBLICA DA NOTA FISCAL — o fornecedor recebe este link por e-mail
 * 28 dias depois do serviço e sobe a nota por aqui, sem login. O arquivo cai
 * no bucket notas-fiscais e o financeiro é avisado dentro do app.
 */

interface NotaInfo {
  ok: boolean;
  error?: string;
  fornecedor?: string;
  projeto?: string | null;
  descricao?: string;
  valor?: number | null;
  pagar_em?: string;
  status?: string;
  arquivo?: string | null;
  pix_atual?: string | null;
}

const brl = (v?: number | null) =>
  v == null ? null : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const brData = (iso?: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

export default function NotaFiscalPublica() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<NotaInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState('');
  const [dadosPagamento, setDadosPagamento] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) return;
    supabase.rpc('get_nota_request', { p_token: token }).then(({ data, error }) => {
      const i = error ? { ok: false, error: error.message } : (data as NotaInfo);
      setInfo(i);
      if (i?.ok && i.pix_atual) setDadosPagamento(i.pix_atual);
      setLoading(false);
    });
  }, [token]);

  const pedirArquivo = () => {
    if (!dadosPagamento.trim()) {
      setErro('Antes de enviar a nota, confirme seus dados bancários e sua chave PIX no campo acima.');
      return;
    }
    setErro('');
    fileRef.current?.click();
  };

  const enviarArquivo = async (file: File) => {
    if (!token) return;
    if (file.size > 15 * 1024 * 1024) { setErro('O arquivo pode ter no máximo 15MB.'); return; }
    setErro('');
    setEnviando(true);
    try {
      const nomeLimpo = file.name.replace(/[^\w.\-()\s]/g, '_');
      const path = `${token}/${Date.now()}_${nomeLimpo}`;
      const { error: upErr } = await supabase.storage.from('notas-fiscais').upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      let { data, error } = await supabase.rpc('submit_nota', {
        p_token: token, p_path: path, p_file_name: file.name, p_dados_pagamento: dadosPagamento.trim() || null,
      });
      // Banco ainda na versão sem o campo de dados de pagamento: envia sem ele.
      if (error && /p_dados_pagamento|function|schema/i.test(error.message)) {
        ({ data, error } = await supabase.rpc('submit_nota', { p_token: token, p_path: path, p_file_name: file.name }));
      }
      if (error) throw error;
      if (!(data as any)?.ok) throw new Error('Link inválido ou cobrança encerrada.');
      setEnviado(true);
    } catch (err: any) {
      console.error(err);
      setErro(`Não conseguimos receber o arquivo: ${err.message || 'erro desconhecido'}. Tente de novo.`);
    } finally {
      setEnviando(false);
    }
  };

  const valorTxt = brl(info?.valor);

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white flex flex-col">
      <header className="px-6 py-5 border-b border-white/10">
        <img src="/logo/Logotipo-Branco-Alpha.svg" alt="Produtora Lumos" className="h-7" />
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        {loading ? (
          <Loader2 className="w-8 h-8 animate-spin text-[#EFC700]" />
        ) : !info?.ok ? (
          <div className="max-w-md w-full bg-white/5 border border-white/10 rounded-2xl p-8 text-center space-y-3">
            <AlertTriangle className="w-10 h-10 text-red-400 mx-auto" />
            <h1 className="text-lg font-bold">Link inválido</h1>
            <p className="text-sm text-white/60">
              Este link de envio de nota não existe ou foi cancelado. Se você recebeu por e-mail, fale com a produção da Lumos.
            </p>
          </div>
        ) : (
          <div className="max-w-md w-full bg-white/5 border border-white/10 rounded-2xl p-8 space-y-6">
            <div className="space-y-1.5">
              <div className="w-11 h-11 rounded-full bg-[#EFC700]/15 flex items-center justify-center">
                <Receipt className="w-5 h-5 text-[#EFC700]" />
              </div>
              <h1 className="text-xl font-bold pt-1">Olá, {info.fornecedor}!</h1>
              <p className="text-sm text-white/60 leading-relaxed">
                {info.status === 'paga'
                  ? 'O pagamento deste job já foi realizado. Obrigado!'
                  : <>Pra gente pagar o seu job em dia, precisamos da sua nota fiscal. Envie o arquivo aqui embaixo.</>}
              </p>
            </div>

            <div className="bg-black/30 border border-white/10 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-white/50">Job</span>
                <span className="font-semibold text-right">{info.descricao}</span>
              </div>
              {info.projeto && (
                <div className="flex justify-between gap-3">
                  <span className="text-white/50">Projeto</span>
                  <span className="font-semibold text-right">{info.projeto}</span>
                </div>
              )}
              {valorTxt && (
                <div className="flex justify-between gap-3">
                  <span className="text-white/50">Valor</span>
                  <span className="font-bold text-[#EFC700]">{valorTxt}</span>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <span className="text-white/50">Pagamento previsto</span>
                <span className="font-semibold">{brData(info.pagar_em)}</span>
              </div>
            </div>

            {info.status === 'paga' ? (
              <div className="flex items-center gap-2 text-green-400 text-sm font-bold justify-center py-2">
                <CheckCircle2 className="w-5 h-5" /> Pagamento realizado
              </div>
            ) : enviado || info.status === 'nota_recebida' ? (
              <div className="space-y-3 text-center">
                <div className="flex items-center gap-2 text-green-400 text-sm font-bold justify-center">
                  <CheckCircle2 className="w-5 h-5" />
                  {enviado ? 'Nota recebida, obrigado!' : `Nota já recebida${info.arquivo ? ` (${info.arquivo})` : ''}`}
                </div>
                <p className="text-xs text-white/50">
                  O pagamento segue previsto pra {brData(info.pagar_em)}. Se precisar corrigir o arquivo, é só enviar de novo.
                </p>
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={enviando}
                  className="text-xs font-bold text-white/70 hover:text-white underline underline-offset-4 disabled:opacity-50"
                >
                  {enviando ? 'Enviando…' : 'Enviar outro arquivo'}
                </button>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black uppercase tracking-wider text-white/50 block">
                    Seus dados bancários e chave PIX *
                  </label>
                  <textarea
                    value={dadosPagamento}
                    onChange={e => setDadosPagamento(e.target.value)}
                    rows={3}
                    placeholder="Ex: PIX (CPF): 000.000.000-00 · Banco Nubank, ag 0001, conta 1234567-8"
                    className="w-full bg-black/30 border border-white/15 focus:border-[#EFC700] rounded-xl p-3 text-sm outline-none resize-none placeholder:text-white/25"
                  />
                  <p className="text-[11px] text-white/40">Confira se está tudo certo, o pagamento vai cair aí.</p>
                </div>
                <button
                  onClick={pedirArquivo}
                  disabled={enviando}
                  className="w-full bg-[#EFC700] hover:bg-[#ffd91e] text-black font-black rounded-xl py-3.5 flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                >
                  {enviando ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileUp className="w-5 h-5" />}
                  {enviando ? 'Enviando…' : 'Enviar nota fiscal'}
                </button>
              </>
            )}

            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.xml,.jpg,.jpeg,.png"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) enviarArquivo(f); e.target.value = ''; }}
            />

            {erro && <p className="text-xs text-red-400 text-center">{erro}</p>}
            {info.status !== 'paga' && (
              <p className="text-[11px] text-white/40 text-center">
                Aceitamos PDF, XML ou foto da nota (até 15MB). Qualquer dúvida, fale com a produção da Lumos.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
