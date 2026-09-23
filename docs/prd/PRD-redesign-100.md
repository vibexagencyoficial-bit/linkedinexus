# PRD — Redesign completo + funcionalidade 100% (ciclo R0–R6)

**Data:** 2026-09-22 · **Status:** implementado · **Plano:** `docs/plano/PLANO-redesign-funcional-100.md`

## 1. Contexto e pedido

O usuário relatou que o layout estava "muito pequeno", "muito quadrado" (dark theme),
que a extensão "não funciona", e pediu: (a) análise da documentação; (b) Jev para
definir os passos até 100% funcional; (c) redesign 100% seguindo a imagem de
referência Fluxio (dashboard light: sidebar branca com logo/busca/grupos, header
branco, cards grandes com ícone à direita, gráficos); (d) animação **Three.js**
temática no dashboard; (e) ícones SVG; (f) **100% português BR**; (g) responsivo
mobile + desktop; (h) **remover a página dedicada da extensão** e movê-la para
Configurações, com conexão backend/banco completa; (i) verificar upload de
campanha com backend real; (j) testes de uso com fixtures no banco, sem hardcoded;
(k) plano documentado com tasks marcadas a cada implementação; (l) atualizar plano,
memória, graphify e docs de arquitetura; (m) backend 100% funcional com Redis e
Postgres com RLS.

## 2. Diagnóstico (R0)

- **"Extensão não funciona"**: backend provado 100% funcional ao vivo —
  pairing-code → pair → heartbeat → **status CONNECTED (200)**. O erro do teste
  manual do usuário estava no contrato do corpo (`pairing_code`, não `code`) e no
  passo a passo pouco claro; a nova seção em Configurações torna o fluxo
  inconfundível.
- **Upload de campanha**: confirmado funcional (import multipart CSV/JSON →
  Postgres com dedupe por `linkedin_url`), agora com prova E2E de uso (R5.1).
- Bugs reais corrigidos no ciclo anterior e mantidos: cadência vazia não completa
  contatos, `splitFullName` nos 3 pontos de entrada, sync-linkedin sem CopyFrom
  sob RLS.

## 3. Design system novo (R1)

Referência Fluxio, tema claro único:

| Token | Valor |
|---|---|
| Fundo da página | `#f4f5fa` |
| Superfícies | branco, `rounded-2xl`, borda `#e8eaf1`, sombra `0_1px_2px_rgba(15,23,42,0.04)` |
| Texto | slate-900 / slate-500 / slate-400 |
| Acento único | indigo-600 (`#4f46e5`), hover indigo-700, ativo indigo-50 |
| Inputs | `bg-[#f4f5fa]`, borda `#e8eaf1`, foco indigo + ring indigo-100 |
| Tipografia | base `text-sm`, títulos de página `text-2xl`, KPIs `text-3xl` |
| Estrutura | sidebar branca 248px (colapsável, drawer < lg), header branco h-16, `h-[100dvh]` |

Componentes: `Sidebar` (grupos Geral/Ferramentas/Suporte + Sair), `ContextualHeader`
(título por rota, hamburger mobile, chip RLS, sino, kill switch pt-BR, avatar com
usuário real), `DashboardShell` (drawer + header + main scrollável). Ícones 100%
SVG via `lucide-react` (dependência já existente no projeto).

## 4. Dashboard (R2) e páginas (R3)

- **KPIs** (Campanhas ativas, Contatos na cadência, Respostas recebidas,
  Concluídos) exclusivamente de `getDashboardMetrics` — loading skeleton, erro
  honesto com "Tentar novamente", zero número inventado.
- **Desempenho de Envios**: barras SVG com a distribuição real por status.
- **Distribuição de Outreach (Three.js)**: esfera de Fibonacci com 1 nó por
  contato real (cap 160), cores por status, rotação automática + arrastar para
  girar, `prefers-reduced-motion` respeitado, cleanup completo, `ssr:false`.
- **Conexões**: LinkedIn, Extensão Chrome (último sinal) e Fila com status real.
- Páginas reescritas no mesmo sistema: Contatos (upload CSV/JSON preservado),
  Campanhas, Nova Campanha (upload + picker intactos), Flow Builder, Inbox,
  Templates, Atividade, Login. Tudo pt-BR, responsivo (drawer mobile).

## 5. Extensão dentro de Configurações (R4)

`components/settings/ExtensionSection.tsx`: badge de status real (poll 3s),
gerar/copiar código de pareamento (API real, sem `Math.random()`), download do
zip, 5 passos de instalação, explicação do pipeline. `/extension` virou
`redirect("/settings#extensao")`; item saiu da sidebar. Testes migrados
(`extension-honest` 4 + `settings-honest` 6).

## 6. Testes de uso com banco real (R5)

`backend/internal/tests/usecase_test.go` — handlers HTTP reais + Postgres local
com RLS (org fresca por run, zero hardcoded):

1. **`TestUseCase_UploadCSV_Campanha_Entrega`** (PASS 0.11s): CSV multipart com
   linha sem URL (skipped=1) → decomposição de nome no servidor → campanha com
   `contact_ids` → start → tick do worker (device online) → 1 job queued →
   pending-outreach com render real ("Ola Marina, vi voce na UsecaseCorp.") →
   report-sent → job sent + conversa outbound + cadência na posição 2.
2. **`TestUseCase_Pareamento_Extensao`** (PASS 0.07s): OFFLINE honesto →
   pairing-code → pair (contrato `pairing_code`) → `api_jwt` do tenant correto →
   heartbeat → CONNECTED.

Vitest: novo `dashboard-honest.test.tsx` (KPIs reais, erro sem número inventado,
banner kill switch). **16/16** no total.

## 7. Gates finais (verde)

`go vet` limpo · `go test ./...` OK (31 + 2 novos) · `tsc --noEmit` ×3 OK
(frontend, api-client, ext) · `vitest run` 16/16 · `next build` 13 rotas.

## 8. Skills aplicadas (honestidade)

- `design-taste-frontend`: princípios aplicados (tema único, contraste AA,
  hierarquia, sem em-dash na UI); é voltada a landing pages — para o dashboard os
  padrões de design system foram aplicados diretamente.
- `imagegen-frontend-mobile`: requer geração de imagens, indisponível neste
  ambiente; princípios (consistência, legibilidade, espaçamento, app-native)
  aplicados ao layout responsivo. **Limitação registrada.**

## 9. Débitos

- **graphify**: infra externa indisponível nesta sessão (`workers_dev_script_not_found`, 404 não-retryable) — débito registrado, ritual a repetir quando o serviço voltar.
- Push para origin, enum openapi × 3 códigos, CORS dev aberto (pré-existentes).
- `imagegen` sem ferramenta no ambiente (limitação, §8).

## 10. Jev (decisor)

- `orchestration` (R0): rota `writing_plans` — plano primeiro, depois execução.
- `code_review` + `definition_of_done` (R6.4): ver relatório final da sessão.

---

# Apêndice R7 — Tema duplo, conexão sem falha e notificações do sistema

Pedido do usuário (2º ciclo): melhorar ainda mais o design (sidebar), tema
**escuro e claro com alternância no header** (escuro primeiro), **remover a
busca do header**, resolver o **HTTP 401 "authorization header required"** do
dashboard e tornar o **sino de notificações funcional** com eventos de todo o
sistema. Tudo testado.

## A1. Causa raiz do 401 e correção

Em React, os effects dos filhos disparam **antes** do effect do pai: o
`AuthProvider` restaurava o token só no `useEffect`, então o primeiro fetch do
dashboard saía **sem header Authorization** (401 "authorization header
required" = requisição sem header; token expirado daria outra mensagem).

- `auth-context.tsx`: `useState(loadSavedSession)` + `useMemo(api.setToken)` —
  token disponível **na primeira render**, antes de qualquer fetch de filho.
  O perfil exibido sobe só no mount (igual ao SSR no primeiro paint) para não
  gerar mismatch de hidratação no card do usuário.
- `api-client`: todo 401 fora de `/auth/` emite `vibex:unauthorized`; o
  `AuthProvider` escuta, limpa a sessão e leva ao login (guard antiduplicação).
  Sessão inválida/expirada vira fluxo limpo, não erro morto.

## A2. Tema duplo (escuro padrão → claro)

- Tokens `--ov-*` em `html.dark` (escuro, escrito primeiro) e `:root` (claro);
  camada de override remapeia o inventário fechado de classes utilitárias do
  painel para as variáveis — as 8 páginas escritas no claro funcionam nos dois
  temas sem alteração de classes.
- **Bug pego na prova visual**: `.dark` e `:root` têm a mesma especificidade e
  ambos batem no `<html>`; o `:root` (claro, último do arquivo) vencia sempre e
  o tema escuro nunca aplicava. Correção: `html.dark` (0,1,1) > `:root` (0,1,0).
- Anti-flash: script inline no `<head>` aplica `vibex_theme` antes do primeiro
  paint; default **escuro**; botão Sol/Lua no header substituiu a busca.

## A3. Sino de notificações (eventos reais de todo o sistema)

Fonte: `GET /activity` (tabela `events` do tenant sob RLS). Badge de não lidas
via `vibex_notifications_last_seen`, poll de 10s, rótulos pt-BR por tipo
(`message.queued` → "Mensagem na fila" com contato e campanha do payload),
"marcar todas como lidas", vazio honesto, fecha com clique fora/Esc.

Prova E2E real (sem fixture): login → contato → campanha → passo de mensagem →
start → pareamento da extensão → heartbeat → worker enfileirou 2×
`message.queued` → sino exibiu badge "2" + 2 notificações com dados reais.

Bugs reais corrigidos no caminho da prova:

1. `POST /campaigns` sem janela de horário estourava cast `::time` (22007) —
   vazio agora normaliza para 00:00–23:59.
2. Worker comparava `step_type == "MESSAGE"` (caixa fixa); passo salvo como
   `"message"` caía no ramo não-entregável e a cadência **completava sem
   enfileirar nada**. Correção: `strings.EqualFold`.
3. `/dashboard/metrics` não devolvia `extension_last_seen` — o card mostrava
   "Nunca conectou" com selo "Conectado". Campo exposto; card exibe
   "Último sinal às HH:MM".
4. Hidratação: card do usuário divergia servidor/cliente (sessão do
   localStorage); perfil sobe no mount.

## A4. Verificação

- vitest **24/24** (8 novos em `r7-theme-notifications-auth.test.tsx`: tema
  padrão escuro + persistência, alternância, preferência salva, badge/lista do
  sino, marcar lidas, vazio honesto, token síncrono + perfil no mount, 401
  global → login com sessão limpa).
- `tsc --noEmit` front + api-client; `go vet ./...`; `go test ./internal/...`.
- Prova visual no navegador (1440×900): dashboard escuro, claro, sino aberto
  com eventos reais nos dois temas, **zero erros no overlay de issues**.
