# Regra 08: Platform Safety, Rate Limiting e Circuit Breaker

> **Escopo:** Blindagem operacional, proteção de contas e gestão de riscos.

---

## 1. Diretriz Ética e Técnica Anti-Bypass
- É TERMINANTEMENTE PROIBIDO implementar qualquer mecanismo de:
  - Burlar CAPTCHA ou mascarar assinaturas de rede.
  - Alterar artificialmente fingerprints do navegador.
  - Rotacionar identidades para fugir de limites da plataforma.
  - Tentar continuar enviando após alertas de restrição da plataforma.
- A segurança é mantida por meio de conformidade, ritmo saudável, pausas e respeito aos limites.

## 2. PlatformSafetyService e Pipeline de Execução
Antes de cada job ser executado, ele deve passar pelo pipeline obrigatório:
```
JOB RECEBIDO
  ↓
1. Verificação da Campanha (Ativa? Pausada? Cancelada?)
  ↓
2. Verificação de Resposta (Stop on Reply ativado?)
  ↓
3. Verificação da Conta (Conectada? Restrita?)
  ↓
4. Platform Safety & Circuit Breaker (Estado CLOSED?)
  ↓
5. Rate Limiter (Token Bucket / Sliding Window)
  ↓
6. Elegibilidade de Horário / Fuso Horário
  ↓
7. Renderização Segura do Template (Campos obrigatórios preenchidos?)
  ↓
EXECUÇÃO CONTROLADA
```

## 3. Circuit Breaker por Conta
- **Estados**:
  - `CLOSED`: Operação normal.
  - `OPEN`: Disparado após erros de plataforma (`RATE_LIMITED`, `PLATFORM_RESTRICTION`, `ACTION_REQUIRED`). Pausa imediata de todas as ações da conta.
  - `HALF_OPEN`: Período de teste após cooldown com ações controladas.
- O frontend e a extensão devem exibir alertas imediatos de `ACTION_REQUIRED` ou `RESTRICTED`.

## 4. Backpressure e Escala de Banco
- Escala de banco de dados (`10.000 contatos`) não significa taxa de execução externa acelerada.
- Se o tamanho da fila no Redis exceder o limite seguro ou os workers registrarem atrasos, o agendador aplica backpressure, pausando a injeção de novos jobs até que a fila normalize.
