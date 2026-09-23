# Organizador de Listas de Contatos (`normalize.mjs`)

Transforma qualquer lista bagunçada de contatos (Google Sheets, Apollo,
planilha exportada do LinkedIn Sales Navigator, CSV de CRM) nos arquivos
limpos que o painel aceita no upload.

## Uso

```bash
node scripts/list/normalize.mjs minha-lista.csv
node scripts/list/normalize.mjs exportacao-apollo.json -o ./saida
```

- Zero dependências (Node 18+).
- Saída: `contatos-<timestamp>.json` e `contatos-<timestamp>.csv` na pasta
  informada em `-o` (padrão `./normalizados`).
- Depois, faça o upload de um dos dois no painel:
  - **Contatos → Importar CSV/JSON**, ou
  - **Campanhas → Criar Nova Campanha → Fazer Upload de Lista (CSV ou JSON)**.

## O que ele faz

1. **CSV ou JSON** — detecta delimitador (`;`, `,` ou TAB), lida com BOM de
   export do Excel/Sheets, campos com vírgula/quebra de linha entre aspas.
2. **Infere as colunas** por aliases em pt-BR e en (`Nome Completo` →
   `full_name`, `Empresa` → `company`, `Perfil do LinkedIn` →
   `linkedin_url`, etc.), com fallback fuzzy para a URL.
3. **Limpa** — espaços duplicados, zero-width, `Sobrenome, Nome` invertido,
   URL normalizada (adiciona `https://`, remove `?trk=...` e barra final).
4. **Deduplica** por URL do LinkedIn (mantém a primeira).
5. **Descarta com relatório** — linhas sem URL válida de perfil
   (`linkedin.com/in/...`) ou sem nome aparecem no resumo, nunca entram
   silenciosamente no arquivo.

## Formato aceito

CSV com qualquer um destes cabeçalhos (ordem livre):

```
Nome Completo | Empresa | Cargo | Perfil do LinkedIn
Full Name     | Company | Title | LinkedIn URL
first_name + last_name ...
```

JSON: array de objetos (ou `{ "connections": [...] }`) com chaves livres —
o script mapeia pelos mesmos aliases.

## Amostras

`samples/bagunca-ptbr.csv` e `samples/bagunca-links.json` demonstram o pior
caso (pontuação errada, `;`, aspas, duplicatas, URL de Twitter, sem URL).
Rode contra elas para ver o relatório:

```bash
node scripts/list/normalize.mjs scripts/list/samples/bagunca-ptbr.csv -o /tmp/t
```
