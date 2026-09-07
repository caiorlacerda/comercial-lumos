import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { interpolarSecoes, type VariavelDef } from './interpolate';
import type { Secao } from './tipos';
import LeadSection from './sections/LeadSection';
import RowsSection from './sections/RowsSection';
import TwoPanelsSection from './sections/TwoPanelsSection';
import StepsSection from './sections/StepsSection';
import NoteSection from './sections/NoteSection';
import TipsSection from './sections/TipsSection';
import DateCardsSection from './sections/DateCardsSection';
import NextStepsSection from './sections/NextStepsSection';
import ProgressBar from './ProgressBar';
import BoasVindasLumos from '../BoasVindasLumos';

type ItemDoc = {
  item_key: string; group_key: string; titulo: string; descricao: string | null;
  requer_arquivo: boolean; sort_order: number; feito: boolean;
  nome_arquivo: string | null; concluido_em: string | null; concluido_por: string | null;
};

type Resposta = {
  error?: 'invalid' | 'precisa_login' | 'sem_acesso';
  cliente?: { id: string; nome: string };
  doc: { sections: Secao[]; variables: VariavelDef[]; values: Record<string, string> } | null;
  itens: ItemDoc[];
};

const MSG_ERRO = 'Não deu pra carregar essa página agora. Recarrega, ou tenta de novo em instantes.';

export default function WelcomeDocPage({ token, nomePessoa }: { token: string; nomePessoa: string }) {
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  // Recarga falha depois de uma primeira carga boa (o aoAtualizar do checklist)
  // não pode apagar a página inteira: guarda o erro e deixa o conteúdo que já
  // está na tela em pé — a mensagem aparece inline, do mesmo jeito que o
  // BoasVindasLumos já mostra os erros dele.
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_welcome_doc', { p_token: token });
    if (error || data?.error) {
      setErro(MSG_ERRO);
    } else {
      setErro(null);
      setResposta(data as Resposta);
    }
    setCarregando(false);
  }, [token]);

  useEffect(() => { carregar(); }, [carregar]);

  if (carregando) return <div className="boas-vindas"><p className="wd-lead">Carregando…</p></div>;
  if (erro && !resposta) return <div className="boas-vindas"><p className="wd-lead" style={{ color: 'var(--ajuste)' }}>{erro}</p></div>;
  if (!resposta?.doc) {
    return (
      <div className="boas-vindas">
        <p className="wd-lead">Seu material de boas-vindas está sendo preparado. Já te avisamos por aqui assim que estiver pronto.</p>
      </div>
    );
  }

  const secoes = interpolarSecoes(resposta.doc.sections, resposta.doc.values, resposta.doc.variables);
  const feitos = resposta.itens.filter(i => i.feito).length;

  return (
    <div className="boas-vindas">
      {/* Marca da página, igual pra todo cliente: mora aqui, não no checklist. */}
      <div className="hero-bv">
        <span className="feixe" aria-hidden="true" />
        <h1>BEM-VINDO<br /><span className="risca">À LUMOS</span></h1>
      </div>
      {erro && <p className="intro" style={{ color: 'var(--ajuste)' }}>{erro}</p>}
      {secoes.map(secao => {
        switch (secao.type) {
          case 'lead': {
            const { key, ...rest } = secao;
            return <LeadSection key={key} {...rest} />;
          }
          case 'rows': {
            const { key, ...rest } = secao;
            return <RowsSection key={key} {...rest} />;
          }
          case 'two-panels': {
            const { key, ...rest } = secao;
            return <TwoPanelsSection key={key} {...rest} />;
          }
          case 'steps': {
            const { key, ...rest } = secao;
            return <StepsSection key={key} {...rest} />;
          }
          case 'note': {
            const { key, ...rest } = secao;
            return <NoteSection key={key} {...rest} />;
          }
          case 'tips': {
            const { key, ...rest } = secao;
            return <TipsSection key={key} {...rest} />;
          }
          case 'date-cards': {
            const { key, ...rest } = secao;
            return <DateCardsSection key={key} {...rest} />;
          }
          case 'next-steps': {
            const { key, ...rest } = secao;
            return <NextStepsSection key={key} {...rest} />;
          }
          case 'checklist':
            return (
              <div className="wd-secao" key={secao.key}>
                <ProgressBar feitos={feitos} total={resposta.itens.length} />
                <BoasVindasLumos token={token} nomePessoa={nomePessoa} itens={resposta.itens} aoAtualizar={carregar} />
              </div>
            );
          default:
            // Tipo de seção desconhecido: ignora, não quebra a página do cliente.
            return null;
        }
      })}
    </div>
  );
}
