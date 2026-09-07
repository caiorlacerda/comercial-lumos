import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

type ItemKey = string;

type ItemStatus = {
  item_key: ItemKey;
  tipo: 'arquivo' | 'manual';
  nome_arquivo: string | null;
  concluido_em: string | null;
  concluido_por: string | null;
};

type ItemDoWelcomeDoc = {
  item_key: string; group_key: string; titulo: string; descricao: string | null;
  requer_arquivo: boolean; feito: boolean; nome_arquivo: string | null;
  concluido_em: string | null; concluido_por: string | null;
};

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/boas-vindas-upload`;

// Mesmo teto que a edge function aplica do lado de lá, pra mensagem bater.
const MAX_BYTES = 25 * 1024 * 1024;
const MSG_GRANDE = 'Esse arquivo passa de 25MB. Manda uma versão menor, ou o link do Drive/WeTransfer por WhatsApp.';
const MSG_LOGIN = 'Você precisa estar logado nesse portal pra enviar isso. Atualiza a página e entra de novo.';

export default function BoasVindasLumos({
  token, nomePessoa, itens: itensIniciais, aoAtualizar,
}: {
  token: string; nomePessoa: string; itens: ItemDoWelcomeDoc[]; aoAtualizar: () => void;
}) {
  const [enviando, setEnviando] = useState<ItemKey | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const itens: Record<string, ItemStatus> = {};
  for (const it of itensIniciais) {
    if (it.feito) {
      itens[it.item_key] = {
        item_key: it.item_key as ItemKey, tipo: it.requer_arquivo ? 'arquivo' : 'manual',
        nome_arquivo: it.nome_arquivo, concluido_em: it.concluido_em, concluido_por: it.concluido_por,
      };
    }
  }

  const enviarArquivo = useCallback(async (key: ItemKey, arquivo: File) => {
    setEnviando(key);
    setErro(null);
    try {
      // Portal com login exigido: a sessão precisa chegar na edge function,
      // senão ela devolve precisa_login. Sem login (caso comum), não existe
      // sessão e nenhum header é mandado — igual antes.
      const { data: { session } } = await supabase.auth.getSession();
      const form = new FormData();
      form.append('token', token);
      form.append('item_key', key);
      form.append('nome_pessoa', nomePessoa);
      form.append('arquivo', arquivo);
      const res = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        body: form,
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'falha ao enviar');
      aoAtualizar();
    } catch (err) {
      const codigo = (err as Error)?.message;
      if (codigo === 'precisa_login' || codigo === 'sem_acesso') {
        setErro(MSG_LOGIN);
      } else if (codigo === 'arquivo muito grande, o limite é 25MB') {
        setErro(MSG_GRANDE);
      } else {
        setErro('Não deu pra enviar agora. Tenta de novo, ou manda por WhatsApp/e-mail enquanto isso.');
      }
    } finally {
      setEnviando(null);
    }
  }, [token, nomePessoa, aoAtualizar]);

  const marcarManual = useCallback(async (key: ItemKey) => {
    setEnviando(key);
    setErro(null);
    try {
      const { data, error } = await supabase.rpc('marcar_item_boas_vindas', {
        p_token: token, p_item_key: key, p_nome_pessoa: nomePessoa,
      });
      if (error || data?.error) throw new Error(data?.error || 'falha ao marcar');
      aoAtualizar();
    } catch (err) {
      setErro('Não deu pra marcar agora. Tenta de novo em instantes.');
    } finally {
      setEnviando(null);
    }
  }, [token, nomePessoa, aoAtualizar]);

  return (
    <div className="boas-vindas">
      {erro && <p className="intro" style={{ color: 'var(--ajuste)' }}>{erro}</p>}
      <div className="itens">
        {itensIniciais.map(def => {
          const status = itens[def.item_key];
          const concluido = !!status;
          const carregandoEste = enviando === def.item_key;
          return (
            <div className="item-bv" key={def.item_key}>
              <div>
                <div className="nome">{def.titulo}</div>
                <div className="desc">{def.descricao}</div>
                {concluido && (
                  <div className="feito">
                    {status.nome_arquivo || 'Concluído'} · {status.concluido_por || 'cliente'}
                  </div>
                )}
              </div>
              <div className="status">
                {def.requer_arquivo ? (
                  <>
                    <input
                      ref={el => { inputRefs.current[def.item_key] = el; }}
                      type="file"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f && f.size > MAX_BYTES) setErro(MSG_GRANDE);
                        else if (f) enviarArquivo(def.item_key, f);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      className={concluido ? 'reenviar' : 'botao'}
                      disabled={carregandoEste}
                      onClick={() => inputRefs.current[def.item_key]?.click()}
                    >
                      {carregandoEste ? 'Enviando…' : concluido ? 'Reenviar' : 'Enviar arquivo'}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={concluido ? 'reenviar' : 'botao'}
                    disabled={carregandoEste || concluido}
                    onClick={() => marcarManual(def.item_key)}
                  >
                    {carregandoEste ? 'Marcando…' : concluido ? 'Concluído' : 'Marcar como feito'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
