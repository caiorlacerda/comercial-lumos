# Migração de projetos antigos do Drive para a estrutura nova (v2)

Reorganiza **por dentro** a pasta de cada projeto antigo (layout v1) para a estrutura nova, **de um cliente por vez**.

- Só **move** pastas. O ID não muda, então vídeos, links e o banco continuam apontando para os mesmos arquivos.
- **Não copia, não apaga** e a única renomeação é `02_APROVADO` → `02_FINAL`. `06_ENTREGA` não é renomeada nem apagada.
- Lives e projetos que já são v2 são pulados.
- Não escreve no banco: gera um `.sql` para o Caio rodar no SQL Editor logo depois.

## Mapa

| Hoje (dentro da pasta do projeto) | Vai para |
|---|---|
| `00_*`, `01_*`, `02_*` e `OS` | dentro de `00_DOCUMENTOS` |
| `03_*` (ex.: `03_CAPTACAO`) | dentro de `01_BRUTO` |
| `04_*` e `05_*` | dentro de `02_ARTES` (e é criada `02_ARTES/01_TRILHAS`) |
| `06_ENTREGA/01_REVISAO` | `03_EXPORT/01_REVISAO` |
| `06_ENTREGA/02_APROVADO` | `03_EXPORT/02_FINAL` (renomeada) |

As pastas antigas entram **inteiras** dentro das novas (ex.: `00_DOCUMENTOS/00_GERAL`), sem mexer no conteúdo. Se já existir uma pasta com o nome exato do destino (ex.: um `00_DOCUMENTOS` antigo), ela vira o destino. Nome fora do mapa (`99_DUPLICADOS`, arquivos soltos) fica onde está. Se o destino já tiver uma pasta de mesmo nome, é marcado **CONFLITO** e a pasta não é movida.

## Passo a passo

**Precisa de:** Node 18 ou mais novo; a chave JSON da conta de serviço do Drive (o mesmo conteúdo do secret `GOOGLE_SERVICE_ACCOUNT_JSON`) salva em um arquivo **fora do repositório**; o ID do Drive compartilhado (`DRIVE_SHARED_DRIVE_ID`).

1. **Escolher o piloto.** No SQL Editor, rode a consulta **A** de [`consultas.sql`](consultas.sql).
2. **Exportar os projetos do cliente.** Rode a consulta **B** (trocando `NOME DO CLIENTE`), copie a célula do resultado e salve como `projetos.json`.
3. **Simulação** (não altera nada):
   ```bash
   node scripts/drive-migracao/migrar-projetos-v2.mjs --projetos projetos.json --sa /caminho/conta-de-servico.json --drive-id <ID_DO_DRIVE> --cliente "Nome do cliente"
   ```
   O plano aparece na tela e fica em `saida-drive/plano-*.md`. Confira com calma: cada linha diz o que será criado, movido ou deixado.
4. **Executar** (só depois do OK): o mesmo comando com `--executar`. Ele pede para digitar o nome do cliente. Para testar em um projeto só, acrescente `--projeto <id ou código>`.
5. **Rodar o SQL.** Logo depois, rode no SQL Editor o arquivo `saida-drive/atualizar-banco-*.sql`. Ele marca os projetos como `v2` e grava os IDs das subpastas. Entre o fim do passo 4 e este passo, **evite aprovar vídeos desses projetos** (a janela é de segundos).
6. **Conferir.** Abra um projeto migrado no app: "Abrir pasta no Drive", aba Entregas (os vídeos antigos aparecem) e um upload novo na revisão.

`--mover-para-mes` (desligado por padrão) também move a pasta do projeto para `Cliente/AAAA-MM/`. Cliente com marcas e projeto sem marca é pulado nessa etapa.

## Pastas antigas que ficam vazias
Ao fim da execução o script lista as `06_ENTREGA` que ficaram vazias. Elas **não** são apagadas: você decide depois.

## Desfazer
Cada execução salva `saida-drive/feito-*.json` com, para cada pasta movida, o nome e o pai antigos. Como só houve movimentos, dá para voltar à mão (ou pedir um script de reversão). O SQL do banco, se já rodado, volta com:

```sql
update public.projects set drive_layout = 'v1', drive_pastas = null where id = '<id do projeto>';
```
(`drive_upload_folder_id` continua válido: é o mesmo ID de `01_REVISAO`.)

## Testes
```bash
node scripts/drive-migracao/plano.test.mjs      # regras do plano
node scripts/drive-migracao/executor.test.mjs   # o executor inteiro contra um Drive falso em memória
```
