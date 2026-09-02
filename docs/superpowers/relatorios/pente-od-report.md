# Pente fino na Ordem do Dia

Arquivo revisado: `src/pages/OrdemDoDiaDetalhe.tsx` (1.187 linhas antes, 1.318 depois dos dois consertos).
As nove abas foram lidas no código e abertas no navegador (desktop 1440px e 375px), na OD real
"Uniasselvi, Diária 03 | Social Vídeos" (só leitura) e numa OD de teste criada e apagada no projeto Produção Teste.

Os números de linha abaixo são **do arquivo já com os dois consertos aplicados**.

---

## O que foi consertado (fora da lista)

### 1. Cronograma principal, a linha inteira

**Diagnóstico confirmado no navegador.** A célula da hora pedia 140px numa coluna de 130px
(`span.scrollWidth = 140`, `clientWidth = 130`): dois `input[type="time"]` de 62px, mais o traço e dois
gaps de 4px. O Chrome desenha um ícone de relógio dentro do campo, então "11:00" virava "11:0(".

**O que mudei:**

- **A coluna TIPO deixou de existir.** Escolhi tirar em vez de alargar: 44px mostrando só um ícone
  colorido era um cabeçalho prometendo uma informação que a célula não entregava, e no celular a
  coluna já era escondida, ou seja, o tipo simplesmente não existia no dia da gravação. Agora o tipo é
  um **chip com ícone e nome** ("Gravação", "Deslocamento", "Almoço"…) na linha de chips embaixo da
  descrição, junto da locação e do "paralelo". Ganhos: fica legível, ganha o celular pela primeira vez,
  e devolve 52px (44 + gap) para a coluna da hora sem tirar nada da descrição.
- **A coluna da hora foi de 130px para 192px**, e cada campo de 62px para 84px. Medido no Chrome
  rodando: o campo pede 74px, então sobram **10px de folga por campo**, e a célula usa 184px dos 192px.
  A grade total é a mesma de antes (`130+8+70+8+44 = 260` virou `192+8+76 = 276`, os 16px extras saem
  do `1fr` da descrição, que no desktop sobra de qualquer jeito).
- **Alinhamento vertical.** As células usavam `pt-1` / `pt-1.5` / `pt-2` chutados, cada uma com um
  respiro diferente. Troquei todos por `min-h-8 flex items-center`, a mesma altura do input de descrição
  (h-8). Os campos de hora também subiram de `h-7` para `h-8`. Agora hora, duração, descrição, ações e
  status assentam na mesma linha de base.
- **375px.** A grade mobile foi de `[110px_1fr_80px]` para `[96px_1fr_76px]`, e dentro da célula os dois
  campos de hora **empilham** (`max-lg:flex-col`, cada um `w-full`), com o traço escondido. Verificado:
  as duas horas aparecem inteiras, o chip do tipo aparece, e não há scroll horizontal
  (`documentElement.scrollWidth <= 375`). A descrição inclusive **ganhou ~18px** em relação ao layout
  anterior, então não é regressão.
- Os dois campos ganharam `aria-label` ("Hora de início" / "Hora de término"), que antes não tinham
  rótulo nenhum.

Linhas: 237 (cabeçalho), 249 a 302 (a linha).

### 2. Ficha técnica puxando fornecedor do cadastro geral

Botão novo **"Buscar no cadastro"** na aba Equipe, ao lado do "Puxar equipe do projeto", que continua
igual. Abre o componente `EscolherDoCadastro` (linhas 486 a 574), modelado no `EscalarModal` de
`src/components/producao/ProjectDiarias.tsx` para as duas telas se parecerem: uma busca só, lista
agrupada em **Equipe do projeto / Fornecedores / Time Lumos**, avatar com iniciais, subtítulo dizendo
se é Fornecedor ou Time Lumos mais a função, e o `UserPlus` à direita.

Detalhes:

- Busca em `fornecedores` (todos) e `app_users` (`status = 'ativo'`), não só em `project_members`.
  O `project_members` entra apenas para destacar quem já é do projeto e sugerir a função.
- A função sugerida vem do `project_members`, senão do `job_title` do usuário, senão "Freelancer"
  para fornecedor. Dá para ajustar depois no lápis do cartão.
- Quem já está na ficha não é oferecido de novo.
- **Trata erro do Supabase**: se `fornecedores` ou `app_users` falharem, mostra recado em vez de lista
  vazia silenciosa. Se só o `project_members` falhar, a lista completa continua servindo.
- O componente vive **fora** da função da página, pelo mesmo motivo documentado no `CardRegra`: o
  relógio de 1 segundo remontaria um componente declarado inline e o campo de busca perderia o foco a
  cada tique.
- Usa o `<Modal>` de `common/`, igual às telas vizinhas.
- A copy do estado vazio da ficha passou a citar o caminho novo.

Testado ponta a ponta numa OD de teste: um fornecedor que **não** está no projeto
("Adriano Ferreira / Boomer Studio") entrou na ficha como "Freelancer", com toast, e sobreviveu ao
reload. A OD de teste e a diária que nasceu com ela foram apagadas depois.

---

## A LISTA (não consertada), da maior à menor dor de quem usa a tela todo dia

### 1. Apagar não pergunta nada, em lugar nenhum
**Onde:** linhas 294 (momento do cronograma), 950 (call time), 1057 (locação), 1177 (membro da ficha),
1235 (elenco), 1298 (objeto/figurino/equipamento). `grep -c "confirm"` no arquivo devolve **zero**.
**O que acontece:** um toque na lixeira apaga na hora e grava no banco. Não há confirmação, não há desfazer.
**Por que incomoda:** é a tela aberta no celular, com a mão suja, no set. Um encosto no dedo e a locação
some do cronograma, do Maps e da previsão do tempo. A tela irmã (`ProjectDiarias`) confirma antes de
excluir uma diária, então nem consistente com o app é.
**Tamanho:** pequeno (um diálogo de confirmação reaproveitado nos seis pontos), ou médio se quiser desfazer.

### 2. `load()` engole o erro do Supabase e mostra "não encontrada"
**Onde:** linha 603, `const { data } = await supabase.from('ordens_do_dia')...` sem ler `error`.
**O que acontece:** se a rede cair, a policy de RLS barrar ou a migração faltar, `data` vem `null` e a
página cai no ramo "Ordem do dia não encontrada." com o botão "Voltar pra lista".
**Por que incomoda:** é exatamente a "falha de rede parecendo sucesso" que já mordeu este projeto três
vezes, só que na direção mais cruel: no dia da gravação a pessoa conclui que **apagaram a ordem dela**.
**Tamanho:** pequeno.

### 3. A notificação de "Ordem do Dia aprovada" dispara mesmo quando o salvamento falha
**Onde:** linhas 741 a 753. `void patch({ aprovacao: ... })` não é esperado, e o `notify()` roda logo em
seguida, dentro de um `if (aprovando)` que não sabe se o `patch` deu certo.
**O que acontece:** o `patch` falha, faz rollback do estado e mostra "Não foi possível salvar", mas o time
inteiro com permissão `ordem_do_dia` já recebeu "Ordem do Dia aprovada 🎬". O `.catch(() => {})` no fim
ainda apaga qualquer erro do próprio envio.
**Por que incomoda:** a equipe se organiza em cima dessa notificação e vai para um set com a OD ainda em
rascunho, invisível no portal do cliente.
**Tamanho:** pequeno (esperar o `patch` e só então notificar).

### 4. O PDF exportado não é a ordem do dia que está na tela
**Onde:** linhas 765 a 785, o objeto `ordem` montado para o `OrdemDoDiaPDF`.
**O que acontece:** o payload manda só `contatos`, `equipe`, `plano_acao`, `talentos`, o clima e **uma**
locação (a primeira incluída). Ficam de fora: as demais locações, `call_times`, `regras` (vestimenta,
redes, setup de câmera, outras), `objetos`, `figurino`, `equipamentos`, `roteiros` e a `nota_cliente`.
O `secoes_ativas` ainda é fixado com tudo `true`, dos campos antigos.
**Por que incomoda:** o PDF é o que se imprime e se manda no grupo na véspera. Metade do trabalho de
preencher as nove abas não aparece nele, e ninguém é avisado disso.
**Tamanho:** grande (mexe também no componente do PDF).

### 5. "Contatos" existe no dado e não existe na tela
**Onde:** `contatos` está no tipo `OD` (linha 50) e é usado só na linha 775, dentro do payload do PDF.
**O que acontece:** não há aba, cartão ou formulário para ver ou editar contatos. Só sai no PDF, com o
que quer que já esteja no banco.
**Por que incomoda:** numa call sheet, o telefone do produtor e do contato da locação é a informação de
emergência. Aqui ela é invisível e não editável pela tela.
**Tamanho:** médio.

### 6. Dois editando ao mesmo tempo: o último apaga o outro, em silêncio
**Onde:** `patch` (linhas 655 a 668) e `editarLista` (linha 703). Todo salvamento manda o **array inteiro**
(`plano_acao`, `equipe`, `locacoes`…) num `update`.
**O que acontece:** se o produtor mexe no cronograma no notebook e o assistente no celular, quem salvar
por último sobrescreve o array inteiro do outro. Não há `updated_at` comparado, nem realtime nesta página.
**Por que incomoda:** no dia da gravação é normal duas pessoas mexerem na mesma OD. As mudanças somem
sem mensagem nenhuma.
**Tamanho:** grande.

### 7. As mesmas cinco fichas de regras aparecem duas vezes, com nomes diferentes
**Onde:** linhas 986 a 999 (aba Cronograma) e 1312 a 1318 (aba Outras Observações). Mesmos campos
(`regras.vestimenta`, `regras.redes`, `regras.setup_camera`, `regras.outras`, `nota_cliente`).
**O que acontece:** os títulos divergem entre as duas cópias: "Vestimenta" ali, "Regras de vestimenta"
aqui; "Postagem em redes sociais" ali, "Regras de postagem da equipe em redes sociais" aqui. E a aba
chamada "Outras Observações" contém um cartão também chamado "Outras observações".
**Por que incomoda:** dá a impressão de serem campos diferentes. A pessoa preenche num lugar, vai no
outro e acha que precisa preencher de novo. Confirmado no navegador: editar num lado muda o outro.
**Tamanho:** pequeno (decidir de quem é a casa) ou médio (transformar em um componente com uma lista única).

### 8. O botão de aprovação tem cara de menu e é um interruptor
**Onde:** linhas 740 a 761. Um `<ChevronDown>` aparece quando `canManage`, mas o `onClick` só alterna
entre `aprovada` e `rascunho`.
**O que acontece:** a seta promete uma lista de status. O clique aprova ou desaprova direto.
**Por que incomoda:** desaprovar **tira a gravação do portal do cliente** (é a regra do `nota_cliente`),
e isso acontece num clique feito para abrir um menu, sem aviso e sem confirmação.
**Tamanho:** pequeno.

### 9. O estado vazio do cronograma descreve, mas não manda fazer nada
**Onde:** linha 234, "O minuto a minuto do dia: chegada, montagem, gravação, refeições, deslocamentos."
**O que acontece:** a frase lista exemplos e não diz que existe um botão "Novo momento" no canto. Para
quem não é `canManage`, o botão nem existe, e a frase fica sugerindo uma ação impossível.
**Por que incomoda:** é o bloco mais importante da tela, e o primeiro contato dele não ensina nada.
**Tamanho:** pequeno.

### 10. A aba não fica na URL
**Onde:** `const [aba, setAba] = useState<Aba>('cronograma')` (linha 589).
**O que acontece:** recarregar a página, ou voltar do Maps no celular, joga sempre de volta no Cronograma.
Não dá para mandar link direto para a aba Equipamentos.
**Por que incomoda:** no set se sai da aba o tempo todo para abrir o Maps ou o roteiro, e volta-se sempre
para o começo. E o resto do app já usa `?tab=` (`/producao/projetos?projectId=...&tab=ordemdia`).
**Tamanho:** pequeno.

### 11. Layout forçado a cada segundo, o ano inteiro
**Onde:** relógio na linha 641 (`setInterval` de 1s, sem condição), agulha nas linhas 127 a 143
(`getBoundingClientRect()` do wrapper mais um por linha, dentro de um efeito que depende de `agora`).
**O que acontece:** toda a página re-renderiza a cada segundo, o `useMemo` do `cron` (linha 670) reordena
e varre a lista de novo, e o efeito da agulha faz uma leitura síncrona de layout **por linha, por segundo**.
Numa OD de 30 momentos são 31 leituras forçadas por segundo. O relógio roda mesmo quando `cron.hoje`
é falso, ou seja, em 364 dos 365 dias não serve para nada.
**Por que incomoda:** aquece e come bateria no celular justamente no dia em que a tela fica aberta horas.
**Tamanho:** pequeno (parar o intervalo quando não é o dia) a médio (medir a agulha sem varrer o DOM).

### 12. Os dois modais do cronograma são feitos à mão, diferentes do resto do app
**Onde:** linhas 327 (picker de tipo) e 345 (configuração do momento), ambos
`fixed inset-0 z-50 bg-black/60 backdrop-blur-sm` escritos na unha.
**O que acontece:** não fecham no Esc, não travam o scroll do fundo (`Modal` faz as duas coisas), não têm
o X no canto nem o cabeçalho do padrão, e no celular são caixas centralizadas em vez do bottom sheet
que o CLAUDE.md define como convenção mobile.
**Por que incomoda:** o "Novo momento" é a ação mais repetida da tela e é a que menos se parece com o
resto do app.
**Tamanho:** médio.

### 13. Toda lista usa o índice como chave
**Onde:** linhas 248 (momentos), 910 (resumo de locações), 944 (call times), 974 (resumo da equipe),
1027 (locações), 1162 (ficha técnica), 1217 (elenco), 1288 (objetos/figurino/equipamentos).
**O que acontece:** `key={i}`. Reordenar (as setas ↑↓ existem em momentos e locações) ou apagar do meio
faz o React reaproveitar o nó errado.
**Por que incomoda:** nos momentos os inputs são **não controlados** (`defaultValue`), então o campo
mantém o valor da posição antiga: você sobe um momento e a hora dele parece ter ficado para trás até
recarregar. É um bug de dado visível, não só de performance.
**Tamanho:** médio (os itens não têm id; precisa gerar um na criação e migrar o que já existe).

### 14. Observação da locação é migrada e depois nunca mais aparece
**Onde:** o campo `obs` é preenchido na migração da locação antiga (linha 609) e faz parte do tipo `Loc`
(linha 30), mas nenhum formulário de locação o oferece (criar: linha 1011; editar: linha 1051) e
nenhum cartão o mostra.
**O que acontece:** quem já tinha observação de locação ("portaria pelos fundos", "não pode gravar antes
das 9h") continua com ela no banco, invisível.
**Por que incomoda:** é informação operacional que some sem avisar, e não dá para escrever de novo.
**Tamanho:** pequeno.

### 15. `hora_inicio` e `hora_fim` da OD não são editáveis em lugar nenhum
**Onde:** lidos nas linhas 672 e 673, usados como base do primeiro momento na linha 181, mas nenhum
controle escreve neles. O cartão Horário (linha 845) diz "Sai do cronograma principal, preencha lá
embaixo." sem link nem âncora.
**O que acontece:** com o cronograma vazio o cartão Horário fica permanentemente vazio, e o "lá embaixo"
é uma instrução de rolagem, não um caminho.
**Por que incomoda:** o horário da diária é a primeira coisa que se procura, e a tela responde com uma
indireta.
**Tamanho:** pequeno.

### 16. Estados vazios mais magros que os dos vizinhos
**Onde:** Elenco na linha 1213 ("Sem elenco nesta diária.", uma frase só) e
objetos/figurino/equipamentos na linha 1278 ("Nada por aqui ainda.", sem ícone).
**O que acontece:** Locações, Roteiros e Equipe têm ícone, título e uma segunda linha explicando o que
fazer. Essas duas não seguem o mesmo formato: Elenco não tem segunda linha, e o bloco de itens não tem ícone.
**Por que incomoda:** a mesma tela ensina em umas abas e cala em outras.
**Tamanho:** pequeno.

### 17. Travessão na copy, onde o projeto usa vírgula
**Onde:** linha 264 (`'—'` como duração vazia), 859 (`'—'` no horário da primeira atividade), 1104
(`'—'` como status "não está nesta diária"), e 185 (descrição gerada: `` t.label + ` — ${cfg.locacao}` ``).
**O que acontece:** o travessão aparece como **valor** em três lugares, dizendo "vazio" sem dizer vazio,
e uma vez como aposto dentro de texto gerado.
**Por que incomoda:** foge da regra de copy do projeto, e nos três primeiros casos um traço solto numa
coluna de status é menos claro que uma palavra ("sem duração", "não definido", "fora").
**Tamanho:** pequeno.

### 18. Cor crua onde já existe token
**Onde:** linhas 362 e 391, `className="accent-[#EFC700]"` nos dois checkboxes do modal de momento.
**O que acontece:** o amarelo Lumos escrito em hexadecimal na mão, duplicando `lumos-yellow`.
**Por que incomoda:** se o token mudar, esses dois checkboxes ficam para trás. (Os vermelhos, verdes,
âmbares e roxos do arquivo são cores semânticas usadas do mesmo jeito em `ProjectDiarias` e no resto do
app, então não conto como violação; o hexadecimal é.)
**Tamanho:** pequeno.

### 19. Código morto
**Onde:** `statusLinha` (linha 694, definida e nunca chamada, o `grep` acha uma ocorrência só) e
`salvandoRef` (linha 594, escrita nas linhas 657 e 660, nunca lida).
**O que acontece:** nada, e é justamente o problema: `salvandoRef` parece existir para impedir salvamento
concorrente, e não impede (ver item 6). Quem ler o arquivo depois vai achar que o problema já foi tratado.
**Tamanho:** pequeno.

### 20. A preferência de "altura relativa ao tempo" é global do aparelho
**Onde:** linhas 119 e 125, chave `lumos_od_altura` no `localStorage`.
**O que acontece:** o interruptor vale para **todas** as ordens do dia daquele navegador, não por OD nem
por usuário, e nunca chega ao banco.
**Por que incomoda:** liga na OD de uma diária curta, abre outra de 12 horas e a tela vem esticada sem
motivo aparente. Em máquina compartilhada, um muda para o outro.
**Tamanho:** pequeno.

### 21. Mexer na ordem das locações refaz a busca de previsão do tempo
**Onde:** efeito das linhas 646 a 650, dependência `[od?.locacoes, od?.data_producao]`.
**O que acontece:** o efeito olha a **primeira locação incluída**. Como qualquer `editarLista('locacoes', ...)`
cria um array novo, subir ou descer uma locação, editar o nome, ou ligar e desligar o interruptor
dispara geocodificação mais chamada de previsão de novo, mesmo quando a primeira locação não mudou.
**Por que incomoda:** rede à toa no celular do set, e o cartão pisca entre "Previsão disponível a partir
de 15 dias antes." e o valor.
**Tamanho:** pequeno (comparar o endereço, não o array).

### 22. Cálculo de trajeto que falha não conta o motivo
**Onde:** linhas 161 a 174, `calcularTrajeto`. O `catch` só faz `setCfg({ ..., manual: true })`.
**O que acontece:** o roteador público (OSRM, sem chave) ou o geocode falham, o botão "Calcular trajeto de
carro" some e o checkbox "Inserir tempo manualmente" aparece marcado, sem uma palavra.
**Por que incomoda:** parece que a pessoa clicou em algo errado. Um recado ("não deu para calcular o
trajeto, coloque o tempo na mão") resolveria.
**Tamanho:** pequeno.

### 23. "Puxar equipe do projeto" identifica gente pelo nome
**Onde:** linhas 1130 a 1137. `const jaTem = new Set(od.equipe.map(m => m.nome))` e o filtro por
`!jaTem.has(x.nome)`.
**O que acontece:** a comparação é exata e por nome. Dois "João Silva" viram um só; o mesmo nome com um
espaço a mais ou grafia diferente entra duplicado.
**Por que incomoda:** a ficha técnica é o que vira lista de chamada. (O botão novo que adicionei tem o
mesmo limite estrutural, porque `MembroEquipe` não tem id; anotei aqui em vez de mudar o tipo.)
**Tamanho:** médio (precisa de id em `MembroEquipe`).

### 24. `rowRefs` acumula referências mortas
**Onde:** linha 248, `ref={el => { rowRefs.current[i] = el; }}`, e o array nunca é encurtado.
**O que acontece:** apagar momentos deixa `rowRefs.current` maior que `rows`. O laço da agulha
(linha 133) itera por `rows.length`, então hoje não quebra, mas segura nós do DOM já desmontados.
**Por que incomoda:** vazamento pequeno numa tela que fica aberta o dia todo, e uma armadilha para a
próxima pessoa que mexer na agulha.
**Tamanho:** pequeno.

### 25. Nove abas numa faixa que rola sem dizer que rola
**Onde:** linhas 794 a 802, `overflow-x-auto no-scrollbar`.
**O que acontece:** a 375px cabem cerca de três abas. O `no-scrollbar` tira a barra e não entra nenhuma
sombra ou seta no lugar.
**Por que incomoda:** Figurino, Equipamentos e Outras Observações ficam escondidas sem pista nenhuma de
que existem. O CLAUDE.md descreve chips de sub-navegação como a convenção mobile do app.
**Tamanho:** pequeno (uma sombra nas bordas) a médio (adotar os chips).

### 26. Erros ignorados nas cargas secundárias
**Onde:** linhas 632 e 634 (`.then(({ data: p }) => ...)` do nome do projeto e dos roteiros) e linha 1124
(`const { data: members }` do "Puxar equipe do projeto"), todas sem ler `error`.
**O que acontece:** se a consulta falhar, o nome do projeto some do cabeçalho, a aba Roteiros mostra
"Nenhum roteiro no projeto." e o botão de puxar equipe diz "A equipe do projeto está vazia, monte na
aba Equipe do projeto." Três mentiras com cara de fato.
**Por que incomoda:** mesma família do item 2, com menos estrago, mas manda a pessoa procurar problema
no lugar errado (ir até o projeto conferir uma equipe que está lá).
**Tamanho:** pequeno.

---

## Fora de escopo, anotado de passagem

- `src/components/producao/ProjectDiarias.tsx` linha 67: o `load()` também faz
  `const { data } = await supabase.from('project_diarias')...` sem ler `error`. Mesmo padrão do item 2,
  em outro arquivo.
- `ProjectDiarias.tsx` linha 164: `salvar()` valida `mf <= mi` e faz `return` **sem** desligar o
  `setSalvando(true)` da linha anterior. O botão fica travado em "Salvar" com o spinner até fechar o modal.
