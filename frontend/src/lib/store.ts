import { create } from "zustand";

export interface FlowNode {
  id: string;
  type: "message" | "wait" | "check_reply" | "end";
  name: string;
  templateBody: string;
  delayAmount: number;
  delayUnit: "hours" | "days";
  conditions: Record<string, unknown>;
}

interface FlowState {
  nodes: FlowNode[];
  selectedNodeId: string | null;
  isSimulating: boolean;
  addNode: (type: FlowNode["type"]) => void;
  updateNode: (id: string, updates: Partial<FlowNode>) => void;
  removeNode: (id: string) => void;
  selectNode: (id: string | null) => void;
  loadRecommendedPreset: () => void;
  reorderNodes: (startIndex: number, endIndex: number) => void;
  setSimulating: (sim: boolean) => void;
}

const RECOMMENDED_PRESET: FlowNode[] = [
  {
    id: "preset-step-1",
    type: "message",
    name: "Mensagem Inicial de Conexão",
    templateBody: "Olá {{first_name}}, vi que você atua na {{company}} como {{job_title}} e queria trocar uma ideia rápida...",
    delayAmount: 0,
    delayUnit: "days",
    conditions: {},
  },
  {
    id: "preset-step-2",
    type: "wait",
    name: "Aguardar Janela de Resposta",
    templateBody: "",
    delayAmount: 2,
    delayUnit: "days",
    conditions: {},
  },
  {
    id: "preset-step-3",
    type: "check_reply",
    name: "Verificar Resposta (Stop on Reply)",
    templateBody: "",
    delayAmount: 0,
    delayUnit: "days",
    conditions: { stop_if_replied: true },
  },
  {
    id: "preset-step-4",
    type: "message",
    name: "Follow-up #1: Compartilhar Valor",
    templateBody: "Oi {{first_name}}, passando novamente para saber se teve tempo de avaliar minha mensagem anterior...",
    delayAmount: 0,
    delayUnit: "days",
    conditions: {},
  },
  {
    id: "preset-step-5",
    type: "wait",
    name: "Aguardar Janela de Resposta #2",
    templateBody: "",
    delayAmount: 4,
    delayUnit: "days",
    conditions: {},
  },
  {
    id: "preset-step-6",
    type: "check_reply",
    name: "Verificar Resposta (Stop on Reply)",
    templateBody: "",
    delayAmount: 0,
    delayUnit: "days",
    conditions: { stop_if_replied: true },
  },
  {
    id: "preset-step-7",
    type: "message",
    name: "Follow-up Final: Breakup",
    templateBody: "{{first_name}}, não quero lotar sua caixa de entrada. Deixo meu contato aberto caso queira conversar no futuro!",
    delayAmount: 0,
    delayUnit: "days",
    conditions: {},
  },
  {
    id: "preset-step-8",
    type: "end",
    name: "Fim da Cadência",
    templateBody: "",
    delayAmount: 0,
    delayUnit: "days",
    conditions: {},
  },
];

export const useFlowStore = create<FlowState>((set) => ({
  nodes: RECOMMENDED_PRESET,
  selectedNodeId: "preset-step-1",
  isSimulating: false,

  addNode: (type) =>
    set((state) => {
      const newNode: FlowNode = {
        id: `node-${Date.now()}`,
        type,
        name:
          type === "message"
            ? "Novo Follow-up"
            : type === "wait"
            ? "Aguardar Intervalo"
            : type === "check_reply"
            ? "Checar Resposta"
            : "Finalizar Sequência",
        templateBody:
          type === "message"
            ? "Olá {{first_name}}, passando para dar continuidade à nossa conversa..."
            : "",
        delayAmount: type === "wait" ? 2 : 0,
        delayUnit: "days",
        conditions: type === "check_reply" ? { stop_if_replied: true } : {},
      };
      return {
        nodes: [...state.nodes, newNode],
        selectedNodeId: newNode.id,
      };
    }),

  updateNode: (id, updates) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id ? { ...node, ...updates } : node
      ),
    })),

  removeNode: (id) =>
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== id),
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
    })),

  selectNode: (id) => set({ selectedNodeId: id }),

  loadRecommendedPreset: () =>
    set({
      nodes: RECOMMENDED_PRESET,
      selectedNodeId: RECOMMENDED_PRESET[0].id,
    }),

  reorderNodes: (startIndex, endIndex) =>
    set((state) => {
      const result = Array.from(state.nodes);
      const [removed] = result.splice(startIndex, 1);
      result.splice(endIndex, 0, removed);
      return { nodes: result };
    }),

  setSimulating: (isSimulating) => set({ isSimulating }),
}));
