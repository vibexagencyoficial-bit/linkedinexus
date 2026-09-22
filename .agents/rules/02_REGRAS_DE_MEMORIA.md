# Regra 02: Protocolo da Pasta memory/ e Limite de Linhas

> **Escopo:** Governança contínua de memória e histórico do projeto.

---

## 1. Localização e Nomenclatura
- Todos os registros históricos residem na pasta `memory/` na raiz do workspace.
- O documento inicial e ativo é `memory/001_registro_continuo_memoria.md`.

## 2. Registro Único e Contínuo (PROIBIDO Fragmentar)
- É TERMINANTEMENTE PROIBIDO criar um novo arquivo `.md` a cada tarefa, bug fix ou refatoração.
- Toda alteração deve ser apensada sequencialmente ao final do documento ativo (`001_registro_continuo_memoria.md`).
- Cada nova seção deve conter:
  - Data / Timestamp
  - Título da Tarefa / Sessão
  - Decisões de Arquitetura Tomadas
  - Arquivos Criados ou Alterados
  - Testes Executados e Resultados
  - Status da Entrega (Definition of Done)

## 3. Limite Estrito de 2500 Linhas por Documento
- O arquivo ativo deve acumular registros até atingir estritamente 2500 linhas.
- Somente ao atingir ou exceder 2500 linhas, deve-se criar o próximo arquivo sequencial (`memory/002_registro_continuo_memoria.md`).
- O novo arquivo deve obrigatoriamente referenciar no topo o link para o anterior:
  `> Referência anterior: [001_registro_continuo_memoria.md](./001_registro_continuo_memoria.md)`.
