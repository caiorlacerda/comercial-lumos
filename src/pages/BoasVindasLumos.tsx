import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

type ItemKey = 'logo' | 'brand_book' | 'guidelines' | 'acessos';

type ItemStatus = {
  item_key: ItemKey;
  tipo: 'arquivo' | 'manual';
  nome_arquivo: string | null;
  concluido_em: string | null;
  concluido_por: string | null;
};

const ITENS: { key: ItemKey; nome: string; desc: string; tipo: 'arquivo' | 'manual' }[] = [
  { key: 'logo', nome: 'Logo', desc: 'Em alta resolução, de preferência vetorial (AI, EPS ou SVG), ou um PNG bem grande se não tiver outro.', tipo: 'arquivo' },
  { key: 'brand_book', nome: 'Brand book', desc: 'O documento com as diretrizes visuais da sua marca, se você tiver um.', tipo: 'arquivo' },
  { key: 'guidelines', nome: 'Guidelines de conteúdo', desc: 'Como sua marca fala, o que evitar, referências de tom.', tipo: 'arquivo' },
  { key: 'acessos', nome: 'Acessos', desc: 'Convide contato@produtoralumos.com.br como editor nas contas que vamos mexer (redes sociais, Drive etc.), e marca aqui quando fizer.', tipo: 'manual' },
];

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/boas-vindas-upload`;

export default function BoasVindasLumos({ token, nomePessoa }: { token: string; nomePessoa: string }) {
  const [itens, setItens] = useState<Record<string, ItemStatus>>({});
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState<ItemKey | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.rpc('get_boas_vindas_lumos', { p_token: token });
    if (!error && data && !data.error) {
      const mapa: Record<string, ItemStatus> = {};
      for (const it of data.itens as ItemStatus[]) mapa[it.item_key] = it;
      setItens(mapa);
    }
    setCarregando(false);
  }, [token]);

  useEffect(() => { carregar(); }, [carregar]);

  const enviarArquivo = useCallback(async (key: ItemKey, arquivo: File) => {
    setEnviando(key);
    setErro(null);
    try {
      const form = new FormData();
      form.append('token', token);
      form.append('item_key', key);
      form.append('nome_pessoa', nomePessoa);
      form.append('arquivo', arquivo);
      const res = await fetch(EDGE_FUNCTION_URL, { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'falha ao enviar');
      await carregar();
    } catch (err) {
      setErro('Não deu pra enviar agora. Tenta de novo, ou manda por WhatsApp/e-mail enquanto isso.');
    } finally {
      setEnviando(null);
    }
  }, [token, nomePessoa, carregar]);

  const marcarManual = useCallback(async (key: ItemKey) => {
    setEnviando(key);
    setErro(null);
    try {
      const { data, error } = await supabase.rpc('marcar_item_boas_vindas', {
        p_token: token, p_item_key: key, p_nome_pessoa: nomePessoa,
      });
      if (error || data?.error) throw new Error(data?.error || 'falha ao marcar');
      await carregar();
    } catch (err) {
      setErro('Não deu pra marcar agora. Tenta de novo em instantes.');
    } finally {
      setEnviando(null);
    }
  }, [token, nomePessoa, carregar]);

  if (carregando) return <div className="boas-vindas"><p className="intro">Carregando…</p></div>;

  return (
    <div className="boas-vindas">
      <p className="intro">
        Que bom te ter por aqui. Antes de começarmos a gravar, precisamos de algumas coisas
        suas, pra já sair com a cara certa desde o primeiro vídeo. Manda o que puder abaixo,
        no seu tempo, a gente avisa o time a cada item recebido.
      </p>
      {erro && <p className="intro" style={{ color: 'var(--ajuste)' }}>{erro}</p>}
      <div className="itens">
        {ITENS.map(def => {
          const status = itens[def.key];
          const concluido = !!status;
          const carregandoEste = enviando === def.key;
          return (
            <div className="item-bv" key={def.key}>
              <div>
                <div className="nome">{def.nome}</div>
                <div className="desc">{def.desc}</div>
                {concluido && (
                  <div className="feito">
                    {status.nome_arquivo || 'Concluído'} · {status.concluido_por || 'cliente'}
                  </div>
                )}
              </div>
              <div className="status">
                {def.tipo === 'arquivo' ? (
                  <>
                    <input
                      ref={el => { inputRefs.current[def.key] = el; }}
                      type="file"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) enviarArquivo(def.key, f);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      className={concluido ? 'reenviar' : 'botao'}
                      disabled={carregandoEste}
                      onClick={() => inputRefs.current[def.key]?.click()}
                    >
                      {carregandoEste ? 'Enviando…' : concluido ? 'Reenviar' : 'Enviar arquivo'}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={concluido ? 'reenviar' : 'botao'}
                    disabled={carregandoEste || concluido}
                    onClick={() => marcarManual(def.key)}
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
