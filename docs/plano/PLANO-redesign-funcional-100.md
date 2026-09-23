# PLANO — Redesign 100% + Sistema 100% Funcional (referência visual Fluxio)

> **Data:** 2026-09-23 · **Status geral:** EM EXECUÇÃO
> **Referência visual:** imagem Fluxio enviada pelo usuário (sidebar branca com logo no topo, busca, grupos de navegação, logout no rodapé; header branco com título, notificação, busca e avatar; cards grandes com ícone à direita; gráficos; integrações).
> **Regra de ouro:** cada task é marcada `[x]` ao completar, com evidência. Nenhuma task sai do documento.
> **Roteamento:** definido via `jev_decide(question_set="orchestration", label="redesign-100-roteamento-fases")` → rota `writing_plans` (plano primeiro), escopo grande, sem escalate.

## Fase R0 — Análise, diagnóstico e plano

- [x] **R0.1** `jev_decide` orchestration para rotear fases (resposta: writing_plans, sem escalate).
- [x] **R0.2** Análise da documentação (AGENTS.md, PRDs, memória, regras de skills).
- [x] **R0.3** Diagnóstico ao vivo da conexão extensão ↔ backend (relato do usuário: "testei e não funciona"):
  - pairing-code → **pair → heartbeat → status CONNECTED provado ao vivo (200)**.
  - Causa provável do relato: contrato exige `pairing_code` no body (erro honesto 400 com chave errada) e a extensão precisa estar carregada no Chrome. A interface nova em Configurações vai tornar o passo a passo inconfundível.
- [x] **R0.4** Este documento criado.

## Fase R1 — Design system claro + shell (Sidebar / Header / Layout)

Design read: dashboard B2B de outreach para operadores, linguagem light premium da referência (branco, um acento indigo, cantos suaves, sombras discretas), densidade diária, tipografia maior que a atual.

- [x] **R1.1** Tokens do tema claro (`globals.css`): fundo `#f4f5fa`, superfícies brancas, texto `#111827`, acento único indigo `#4f46e5`, radius 12px consistente, sombras com tinte. *(evidência: globals.css reescrito)*
- [x] **R1.2** Sidebar nova (estilo referência): logo + nome no topo, campo de busca, grupos `GERAL` (Dashboard, Campanhas, Contatos, Mensagens) / `FERRAMENTAS` (Templates, Atividade) / `SUPORTE` (Configurações), rodapé com Sair; colapsável; **mobile: drawer com botão hambúrguer**. *(Sidebar.tsx reescrito + overlay)*
- [x] **R1.3** Header branco: título da página à esquerda (breadcrumb/contexto); à direita notificações (sino), busca e avatar + nome do usuário real (`useAuth`). Kill switch de segurança mantido em pt-BR ("Pausar envios"). *(ContextualHeader.tsx reescrito)*
- [x] **R1.4** Tipografia maior em todo o shell (base `text-sm`, títulos `text-lg/xl`, KPIs `text-3xl`), ícones SVG (lucide, já no projeto), 100% pt-BR.
- [x] **R1.5** Layout responsivo: `h-[100dvh]`, conteúdo com `p-5 lg:p-8`, sidebar fixa ≥ `lg` e drawer < `lg` (novo `DashboardShell.tsx` client coordenando o drawer).
- [x] **R1.6** Gates R1: `tsc --noEmit` OK + `vitest run` 13/13 OK.

## Fase R2 — Dashboard novo (dados reais + Three.js)

- [x] **R2.1** 4 KPIs com dados reais da API (Campanhas ativas, Contatos na cadência, Respostas recebidas, Concluídos) com ícone à direita, como na referência. *(getDashboardMetrics real; loading skeleton; erro honesto com "Tentar novamente")*
- [x] **R2.2** Card "Desempenho de Envios": barras SVG com a distribuição REAL por status (na cadência, aguardando, respostas, concluídos) + jobs processados. Sem série temporal inventada.
- [x] **R2.3** Card "Distribuição de Outreach" com **Three.js** (`three` instalado): esfera de Fibonacci com 1 nó por contato real (cap 160), cores por status, rotação lenta + arrastar para girar (pointer events fora do estado React), `prefers-reduced-motion` desliga rotação, cleanup completo, `next/dynamic ssr:false`, fallback sem WebGL deixa só a legenda.
- [x] **R2.4** Card "Conexões" com status real: LinkedIn (`linkedin_connected`), Extensão Chrome (`extension_connected` + último sinal), Fila (`telemetry_processed`).
- [x] **R2.5** Gates R2: tsc OK + vitest 13/13 OK.

## Fase R3 — Páginas internas no novo design

- [x] **R3.1** Contatos: tabela clara, upload CSV/JSON mantido, estados vazios/erro reais. *(page.tsx reescrita: cards brancos rounded-2xl, badges pill, modais claros; lógica de import/sync/delete intacta)*
- [x] **R3.2** Campanhas (lista) + detalhe/builder mantendo funcionalidade. *(cards claros com métricas reais; builder 3 colunas claro com paleta/canvas/inspetor e modal de prévia preservados)*
- [x] **R3.3** Nova Campanha: wizard com picker e upload (funcionalidade preservada, visual novo e maior). *(upload CSV/JSON e picker com todos-marcados intactos; cards de escolha de fluxo claros)*
- [x] **R3.4** Inbox, Templates, Atividade: visual novo, dados reais. *(inbox 2 colunas clara com banner Stop on Reply; templates editor+preview claros; trilha de auditoria em tabela clara)*
- [x] **R3.5** Login: tema claro, marca VibexCorp, erro real visível. *(card branco sobre #f4f5fa, brilho indigo suave, erro real do backend exibido)*
- [x] **R3.6** Gates R3: tsc limpo + vitest **13/13** + `next build` completo (13 rotas).

## Fase R4 — Extensão para dentro de Configurações

- [x] **R4.1** Seção "Extensão Chrome" em `/settings`: badge de status real (poll 3s), pareamento (código gerado pela API + copiar), download do zip, 5 passos de instalação, explicação do pipeline. *(novo `components/settings/ExtensionSection.tsx`, design claro)*
- [x] **R4.2** Removida a página `/extension` (agora `redirect("/settings#extensao")`); item removido da sidebar (a nova sidebar já não o lista).
- [x] **R4.3** Testes: `extension-honest.test.tsx` migrado para `ExtensionSection` (4 testes); `settings-honest.test.tsx` atualizado aos textos novos + mock com `EXTENSION_DOWNLOAD_URL`.
- [x] **R4.4** Prova ao vivo: pairing → pair → heartbeat → **status CONNECTED (200)** reprovado nesta sessão (R0.3).
- Gates R4: tsc OK + vitest **13/13 OK**.

## Fase R5 — Testes de uso (E2E) com banco de dados real

Sem hardcoded no frontend; fixtures reais no Postgres local (padrão `internal/tests`).

- [x] **R5.1** `TestUseCase_UploadCSV_Campanha_Entrega`: import multipart CSV → cria campanha com `contact_ids` → start → tick do worker → job queued → pending-outreach → report-sent → cadência avança (posição 2). *(novo `backend/internal/tests/usecase_test.go`: PASS 0.11s contra Postgres real; valida splitFullName no servidor, skip de linha sem URL, render real "Ola Marina, vi voce na UsecaseCorp.", job sent + conversa + avanço)*
- [x] **R5.2** `TestUseCase_Pareamento_Extensao`: pairing-code → pair → heartbeat → status CONNECTED (via handlers HTTP reais). *(PASS 0.07s; valida OFFLINE honesto inicial, api_jwt do tenant correto, CONNECTED final)*
- [x] **R5.3** vitest: dashboard (KPIs reais com mock), settings com extensão. *(novo `dashboard-honest.test.tsx`: 3 testes — KPIs reais, erro honesto sem número inventado, banner kill switch; total vitest 16/16)*
- [x] **R5.4** Gates finais: `go vet ./...` limpo, `go test ./...` OK, `tsc` ×3 OK (frontend/api-client/ext), `vitest run` **16/16**, `next build` completo (13 rotas).

## Fase R6 — Fechamento

- [x] **R6.1** Este documento com todas as tasks marcadas (completadas/não) e evidências. *(R0–R6 100% marcadas)*
- [x] **R6.2** PRD novo (`docs/prd/PRD-redesign-100.md`) criado + memória apensada (apêndice do redesign + causa raiz do graphify).
- [x] **R6.3** Graphify: débito registrado **com causa raiz** — instalação uv local quebrada (trampoline `graphify.exe` embute caminho sem escape; o espaço em `C:\Users\Lucas Moura` corta o caminho e o resto é resolvido relativo ao cwd; sintaxe correta é `graphify update <path>`, não `--update`). Mitigação criada: junction `D:\vibex\tools\graphify-venv` (sem espaços) + `graphify-out\.graphify_python` apontado para ela. Grafo de 2026-09-22 19:05 (575 nós) segue válido para a estrutura pré-redesign.
- [x] **R6.4** Relatório final com Jev: `code_review` (label redesign-100-code-review) sem escalate — change_scope 1.93 (ciclo completo em lote, esperado), exposes_secrets 0.07, handles_errors 0.86; `definition_of_done` (label redesign-100-definition-of-done) score 1.61 com **escalate** em completion_readiness (confiança 0.41) — sinais estruturais faltantes: workspace não é repo git (sem branch/issue/commit, e o usuário não pediu commit), TDD não aplicável ao redesign visual (testes vieram na R5). Seguindo o pedido explícito do usuário (completar e reportar), ciclo entregue com o escalate reportado.

## Fase R7 — Refino do design, tema duplo (escuro → claro), conexão sem falha e notificações

Pedido do usuário (2º ciclo): melhorar ainda mais o design (sidebar mais presente), tema **escuro e claro com botão de alternância no header** (escuro primeiro na ordem de implementação), **remover a busca do header** (o botão de tema entra no lugar), resolver o **HTTP 401 "authorization header required"** do dashboard (conexão com o backend não pode falhar) e o **sino de notificações funcional** com eventos de todo o sistema. Tudo testado.

- [x] **R7.1** Fix 401: token restaurado sincronamente antes de qualquer fetch (AuthProvider restaurava só no useEffect, que roda DEPOIS dos effects das páginas filhas — o primeiro load do dashboard saía sem Authorization); interceptador de 401 no api-client (`vibex:unauthorized`) com listener no AuthProvider → sessão inválida/expirada leva ao login de forma limpa em vez de erro morto. **(PROVA VIVA: login pela UI → dashboard carregou KPIs/gráfico/conexões sem nenhum 401; perfil do usuário sobe no mount para não quebrar hidratação — token segue síncrono, que é o que alimenta o header Authorization)**
- [x] **R7.2** Tema duplo: root layout sem `<html class="dark">` fixo e sem body escuro herdado; script anti-flash aplica a preferência salva (`vibex_theme`) antes do paint; tokens dark escritos primeiro (`html.dark`), claros depois (`:root`); camada de override no globals.css mapeia o inventário fechado de classes utilitárias (borda `#e8eaf1`, slates, brancos, tints) para vars de tema; ThemeProvider + botão Sol/Lua no header **no lugar da busca (busca removida)**; scrollbars temáticas. **(BUG pego na prova visual: `.dark` e `:root` têm a MESMA especificidade e ambos batem no `<html>` — o `:root` claro, que vem depois, vencia sempre e o escuro nunca aplicava; corrigido com `html.dark` (0,1,1) > `:root` (0,1,0). Capturas nos 2 temas confirmam escuro #0b0e17 e claro #f4f5fa; toggle persiste em `vibex_theme`)**
- [x] **R7.3** Sino de notificações funcional: dropdown com eventos reais do sistema (`listActivity`), badge de não lidas (última leitura em `vibex_notifications_last_seen`), ícones/labels pt-BR por tipo, "marcar todas como lidas", vazio honesto, fecha com clique fora/Esc. **(PROVA E2E REAL: login → contato → campanha → steps → start → pareamento da extensão → heartbeat → worker despachou 2× `message.queued` no banco → sino exibiu badge "2" + 2 notificações com dados do payload. Dois bugs reais corrigidos no caminho: (a) criação de campanha sem janela de horário estourava cast `::time` → vazio vira 00:00–23:59; (b) worker comparava `step_type == "MESSAGE"` com caixa fixa e o passo salvo como "message" caía no ramo não-entregável, completando a cadência SEM enfileirar nada → `strings.EqualFold`. Bônus de honestidade: `/dashboard/metrics` agora devolve `extension_last_seen` (o card dizia "Nunca conectou" com selo "Conectado")**
- [x] **R7.4** Polish do design: sidebar mais larga e refinada (hierarquia, respiro, item ativo mais forte), header com melhor ritmo visual, consistência global via tokens. **(sidebar 248→272px com barra lateral no item ativo + card do usuário no rodapé; hidratação do card corrigida)**
- [x] **R7.5** Testes: vitest novos (toggle de tema aplica `.dark` e persiste; notificações listam eventos reais e badge; 401 dispara logout limpo) + gates completos (tsc ×3, vitest, next build) + go vet/test. **(arquivo `r7-theme-notifications-auth.test.tsx` com 8 testes; vitest 24/24; tsc front+client OK; go vet+test OK; fixture do sino atualizada para payloads reais após o texto amigável; erro de hidratação do card do usuário eliminado — overlay de issues do Next zerado na prova visual)**
- [x] **R7.6** Docs: plano marcado, PRD apensado, memória, Jev (code_review + DoD).

## Débitos e restrições respeitados
- Concorrência máx. 2 (Flatt AI), sem Docker, disco D, portas 5433/6380/3001/8080, `TYPESAFE_API_KEY` nunca em logs/bundle.
- `imagegen-frontend-mobile`: gera imagens de telas; sem ferramenta de geração de imagem neste ambiente, seus princípios (consistência, legibilidade, espaçamento, app-native mobile) são aplicados ao layout responsivo — registrado como limitação.
- `design-taste-frontend`: aplicada nos pontos aplicáveis (taste, contraste AA, tema único, sem em-dash na UI); o projeto já depende de lucide-react (SVG) — mantido.
