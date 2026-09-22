# Regra 06: Frontend Next.js 16, App Router e Design System

> **Escopo:** Interface web, estética premium VibexCorp e contratos de API.

---

## 1. Estética e Design System (VibexCorp Taste)
- **Identidade Visual**: Enterprise B2B, alta sofisticação, visual limpo, moderno, compatível com dark e light modes (Dark Slate / Obsidian / Cobalt).
- **Proibições Estéticas**:
  - Proibido layouts genéricos ou com cara de gerador automático ("AI generated look").
  - Proibido gradientes fluorescentes desnecessários ou cards inflados sem propósito.
  - Proibido tabelas cruas sem paginação, filtros inteligentes e estados vazios elegantes.
- **Tipografia e Espaçamento**: Inter / Geist para corpo e JetBrains Mono para códigos, status e IDs. Micro-animações sutis em transições de status e badges.

## 2. Padrões Técnicos
- Next.js 16 com App Router (`src/app`).
- Client-side data fetching via TanStack Query com invalidação cirúrgica de cache.
- Formulários validados com Zod e React Hook Form.
- Tipagem 100% alinhada com o contrato OpenAPI (`api/openapi.yaml`). Proibido recriar interfaces TypeScript manualmente.
- Atualizações em tempo real consumindo Server-Sent Events (SSE) via `/api/v1/events/stream`.

## 3. Telas Mandatórias
1. **Dashboard**: Métricas executivas em tempo real (campanhas ativas, contatos em sequência, follow-ups em espera, taxa de resposta, contatos finalizados, status da fila e circuit breaker).
2. **Campaign Flow Builder**: Construtor visual de fluxo (Recommended Preset & Custom Flow com Drag & Drop de MESSAGE, WAIT, CHECK_REPLY, END).
3. **Template Editor**: Editor minimalista com inserção rápida de tags (`{{first_name}}`, `{{company}}`, etc.) e simulador de preview com dados reais.
4. **Contacts Manager**: Importador inteligente (CSV / manual / extensão), deduplicação visual e filtros de status.
5. **Account Health & Settings**: Status de conexão, limites operacionais, histórico de auditoria e botão de emergência **Global Pause (Kill Switch)**.
