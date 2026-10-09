// Textos fixos do PDF da proposta, em português e em inglês americano.
// Sem imports: roda no navegador, no PDF e nos testes de linha de comando.
//
// Português: IDÊNTICO ao que o BudgetPDF imprimia antes (regressão testada).
// Inglês: tradução em inglês americano, em estilo contratual dos EUA. As
// cláusulas são texto CONTRATUAL: precisam de revisão do jurídico antes de ir
// a um cliente. Os números do contrato (7 dias, 70%, 10%, 1% ao mês, 48 horas,
// 20%) são os mesmos nos dois idiomas.

export type Idioma = 'pt' | 'en';

export interface ClausulaPdf {
  titulo: string;
  /** Parágrafos numerados à mão ("1.1. ..."). A cláusula 4 contém `{taxaRemarcacao}`. */
  itens: string[];
}

export interface TextosPdf {
  /** Locale de números e valores (Intl). */
  locale: 'pt-BR' | 'en-US';
  /** Formato (date-fns) da data de emissão e do mês do cronograma de fee mensal. */
  formatoData: string;
  formatoMes: string;
  tituloDocumento: (codigo: string, detalhado: boolean) => string;

  emissao: string;
  projeto: string;
  cliente: string;
  categoria: string;
  contato: string;
  clienteFallback: string;

  escopo: string;
  datas: string;
  horario: string;
  local: string;

  tituloFinanceiro: string;
  colItem: string;
  colDescricao: string;
  colQtd: string;
  colUnid: string;
  colValorUnit: string;
  colTotal: string;
  subtotal: string;
  totalProjeto: string;
  grupos: { equipe: string; equipamentos: string; producao: string; edicao: string };
  /** Categoria do orçamento (slug → rótulo). Em português vazio: capitaliza o slug, como hoje. */
  categorias: Record<string, string>;
  /** Unidade do item (slug → rótulo). Em português vazio: imprime o slug cru, como hoje. */
  unidades: Record<string, string>;

  condicoesTitulo: string;
  clausulas: ClausulaPdf[];
  /** Valor mínimo da taxa de remarcação quando a proposta está em R$ (em US$ é convertido). */
  taxaRemarcacaoBRL: string;

  feeTitulo: string;
  feeMes: string;
  feeValorMensal: string;
  feeAdendo: string;

  termoTitulo: string;
  aprovadoPor: string;
  contatoFallback: string;
  dataLinha: string;
  produtoraLumos: string;
  equipeFallback: string;
}

const pt: TextosPdf = {
  locale: 'pt-BR',
  formatoData: "dd 'de' MMMM 'de' yyyy",
  formatoMes: 'MMM/yyyy',
  tituloDocumento: (codigo, detalhado) => `PROPOSTA_LUMOS_${codigo}${detalhado ? '_DETALHADA' : ''}`,

  emissao: 'Emissão',
  projeto: 'Projeto',
  cliente: 'Cliente',
  categoria: 'Categoria',
  contato: 'Contato',
  clienteFallback: 'Cliente',

  escopo: 'Escopo e Briefing',
  datas: 'Data(s)',
  horario: 'Horário',
  local: 'Local / Endereço',

  tituloFinanceiro: 'Proposta Financeira Detalhada',
  colItem: 'Item / Serviço',
  colDescricao: 'Descrição',
  colQtd: 'Qtd',
  colUnid: 'Unid.',
  colValorUnit: 'Valor unit.',
  colTotal: 'Total',
  subtotal: 'Subtotal',
  totalProjeto: 'Investimento Total do Projeto',
  grupos: { equipe: 'Equipe', equipamentos: 'Equipamentos', producao: 'Produção', edicao: 'Pós-produção' },
  categorias: {},
  unidades: {},

  condicoesTitulo: 'CONDIÇÕES GERAIS',
  clausulas: [
    {
      titulo: '1. Prazos e alterações',
      itens: [
        '1.1. Esta Proposta Comercial terá validade por 7 dias corridos, a partir da celebração do contrato entre as partes. Após este período, os investimentos estarão sujeitos a alterações.',
        '1.2. Eventuais alterações nas especificações dos trabalhos a serem realizados podem alterar o valor desta Proposta Comercial.',
      ],
    },
    {
      titulo: '2. Cancelamento e rescisão',
      itens: [
        '2.1. Aprovada esta Proposta Comercial, em qualquer hipótese de cancelamento da prestação dos serviços, por parte do CLIENTE, será devida multa, em favor da LUMOS, em valor correspondente a 70% (setenta por cento) do valor total devido pelo CLIENTE, sem prejuízo do pagamento de todas as despesas já realizadas pela LUMOS, na execução dos serviços objeto da presente Proposta Comercial.',
        '2.2. Para quaisquer finalidades que se façam necessárias, a presente Proposta Comercial, considerar-se-á aprovada pelo CLIENTE, em qualquer hipótese de manifestação deste, concordando com seus termos e condições, seja por concordância manifestada por e-mail ou outros meios, tais como mas não limitados a aplicativos de troca de mensagens, mensagens de texto, etc., seja por manifestação tácita da vontade do CLIENTE, no sentido deste ter ciência do início do cumprimento das obrigações constantes da Proposta Comercial, pela LUMOS, sem que se manifeste em contrário.',
      ],
    },
    {
      titulo: '3. Pagamento',
      itens: [
        '3.1. O pagamento deverá ocorrer de acordo com prazo de pagamento combinado entre o CLIENTE e a LUMOS no ato do aceite da presente Proposta Comercial, dentro das opções disponíveis nesta.',
        '3.2. O atraso no pagamento sujeitará o CLIENTE à multa de 10% (dez por cento) e juros de 1% a.m. sobre o valor do débito.',
      ],
    },
    {
      titulo: '4. Taxa de Remarcação',
      itens: [
        '4.1. Caso o CLIENTE altere a data prevista para a execução do serviço, sem respeitar o prazo máximo de 48 horas de antecedência, será cobrada uma taxa de remarcação no valor mínimo de {taxaRemarcacao} ou 20% do valor total do projeto.',
      ],
    },
    {
      titulo: '5. Direitos autorais e uso',
      itens: [
        '5.1. Todo o material produzido pela LUMOS permanece de propriedade desta até a quitação integral do valor contratado.',
        '5.2. A cessão de direitos de uso do material produzido está limitada ao território e período de veiculação descritos nesta Proposta.',
      ],
    },
    {
      titulo: '6. Créditos',
      itens: [
        '6.1. A LUMOS reserva-se o direito de utilizar o material produzido em seu portfólio e materiais de divulgação, salvo expressa proibição do CLIENTE formalizada por escrito.',
      ],
    },
    {
      titulo: '7. Responsabilidades',
      itens: [
        '7.1. A LUMOS não se responsabiliza por atrasos ou impedimentos causados por fatores externos ao seu controle, como condições climáticas, restrições de locação ou atrasos por parte do CLIENTE na entrega de materiais necessários à produção.',
      ],
    },
  ],
  taxaRemarcacaoBRL: 'R$2.000,00',

  feeTitulo: 'Cronograma de pagamento (fee mensal)',
  feeMes: 'Mês',
  feeValorMensal: 'Valor mensal',
  feeAdendo: 'Adendo',

  termoTitulo: 'Termo de Aceite e Aprovação',
  aprovadoPor: 'Aprovado por:',
  contatoFallback: 'NOME DO RESPONSÁVEL',
  dataLinha: 'DATA: ____/____/____',
  produtoraLumos: 'Produtora Lumos',
  equipeFallback: 'Equipe de Produção',
};

const en: TextosPdf = {
  locale: 'en-US',
  formatoData: 'MMMM d, yyyy',
  formatoMes: 'MMM yyyy',
  tituloDocumento: (codigo, detalhado) => `LUMOS_PROPOSAL_${codigo}${detalhado ? '_DETAILED' : ''}`,

  emissao: 'Issued',
  projeto: 'Project',
  cliente: 'Client',
  categoria: 'Category',
  contato: 'Contact',
  clienteFallback: 'Client',

  escopo: 'Scope & Brief',
  datas: 'Date(s)',
  horario: 'Time',
  local: 'Location / Address',

  tituloFinanceiro: 'Detailed Financial Proposal',
  colItem: 'Item / Service',
  colDescricao: 'Description',
  colQtd: 'Qty',
  colUnid: 'Unit',
  colValorUnit: 'Unit price',
  colTotal: 'Total',
  subtotal: 'Subtotal',
  totalProjeto: 'Total Project Investment',
  grupos: { equipe: 'Crew', equipamentos: 'Equipment', producao: 'Production', edicao: 'Post-production' },
  categorias: { digital: 'Digital', filme: 'Film', live: 'Live' },
  unidades: { diaria: 'day', hora: 'hour', video: 'video', unidade: 'unit', pacote: 'package' },

  condicoesTitulo: 'GENERAL TERMS AND CONDITIONS',
  clausulas: [
    {
      titulo: '1. Term and Changes',
      itens: [
        '1.1. This Commercial Proposal will remain valid for seven (7) calendar days from the date the agreement between the parties is executed. After that period, the fees stated herein are subject to change.',
        '1.2. Any change to the scope of work to be performed may result in a change to the price set forth in this Commercial Proposal.',
      ],
    },
    {
      titulo: '2. Cancellation and Termination',
      itens: [
        '2.1. Once this Commercial Proposal has been approved, if CLIENT cancels the services for any reason, CLIENT shall pay LUMOS a cancellation fee equal to seventy percent (70%) of the total amount owed by CLIENT, without prejudice to reimbursement of all expenses already incurred by LUMOS in performing the services covered by this Commercial Proposal.',
        '2.2. For all purposes, this Commercial Proposal shall be deemed accepted by CLIENT upon any expression of acceptance of its terms and conditions, whether by email or by other means (including, without limitation, messaging apps and text messages), or by implied acceptance, where CLIENT is aware that LUMOS has begun performing its obligations under this Commercial Proposal and does not object.',
      ],
    },
    {
      titulo: '3. Payment',
      itens: [
        '3.1. Payment shall be made in accordance with the payment terms agreed between CLIENT and LUMOS upon acceptance of this Commercial Proposal, from among the options available herein.',
        '3.2. Late payments shall be subject to a late fee of ten percent (10%) plus interest at one percent (1%) per month on the outstanding balance.',
      ],
    },
    {
      titulo: '4. Rescheduling Fee',
      itens: [
        '4.1. If CLIENT changes the scheduled date of service without giving at least 48 hours prior notice, a rescheduling fee will be charged in a minimum amount of {taxaRemarcacao} or 20% of the total project price.',
      ],
    },
    {
      titulo: '5. Copyright and Use',
      itens: [
        '5.1. All material produced by LUMOS remains the property of LUMOS until the contract price has been paid in full.',
        '5.2. The license to use the material produced is limited to the territory and term of distribution described in this Proposal.',
      ],
    },
    {
      titulo: '6. Credits',
      itens: [
        '6.1. LUMOS reserves the right to use the material produced in its portfolio and promotional materials, unless CLIENT expressly prohibits such use in writing.',
      ],
    },
    {
      titulo: '7. Responsibilities',
      itens: [
        '7.1. LUMOS shall not be liable for delays or impediments caused by factors beyond its reasonable control, such as weather conditions, location restrictions, or delays by CLIENT in delivering materials necessary for production.',
      ],
    },
  ],
  taxaRemarcacaoBRL: 'R$2,000.00',

  feeTitulo: 'Payment schedule (monthly retainer)',
  feeMes: 'Month',
  feeValorMensal: 'Monthly fee',
  feeAdendo: 'Add-on',

  termoTitulo: 'Acceptance and Approval',
  aprovadoPor: 'Approved by:',
  contatoFallback: 'CONTACT NAME',
  dataLinha: 'DATE: ____/____/____',
  produtoraLumos: 'Produtora Lumos',
  equipeFallback: 'Production Team',
};

export const TEXTOS: Record<Idioma, TextosPdf> = { pt, en };

/** Textos do idioma pedido; qualquer coisa que não seja 'en' é português. */
export function getTextos(lang?: string | null): TextosPdf {
  return lang === 'en' ? TEXTOS.en : TEXTOS.pt;
}
