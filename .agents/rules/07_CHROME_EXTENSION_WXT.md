# Regra 07: Chrome Extension (WXT, Manifest V3, Thin Client)

> **Escopo:** Extensão complementar para navegador.

---

## 1. Princípio Arquitetural: Thin Client
- A extensão NÃO é um orquestrador nem fonte de verdade.
- Proibido implementar scheduler, lógica de cadência, retries autônomos ou controle de estado de campanha na extensão.
- Toda lógica decisória, elegibilidade e validação de limites pertence exclusivamente ao backend Go.

## 2. Tecnologias e Estrutura (WXT)
- Framework: WXT com React e TypeScript em Manifest V3.
- Módulos:
  - `popup`: Autenticação rápida, status da conta e atalho para o dashboard.
  - `sidepanel`: Painel interativo para captura de contatos e visualização de tarefas elegíveis.
  - `content scripts`: Leitura e interação contextual segura estritamente autorizada pelo usuário.
  - `background`: Service worker para comunicação com a API e armazenamento de tokens em `chrome.storage.local`.
  - `api`: Cliente HTTP gerado a partir de `api/openapi.yaml`.

## 3. Segurança e Auditoria
- Não armazenar senhas ou credenciais não autorizadas do LinkedIn.
- Todas as requisições para a API devem conter:
  - Headers `Authorization: Bearer <jwt>`
  - `X-Request-ID` para rastreamento
  - Identificação de dispositivo/extensão
- O fechamento da aba ou desinstalação da extensão não pode comprometer a consistência das campanhas no backend.
