/**
 * Testes de honestidade do dashboard redesign (R5.3):
 * - KPIs mostram SOMENTE os números reais devolvidos por getDashboardMetrics;
 * - falha da API → erro honesto + "Tentar novamente", sem número inventado;
 * - kill switch ativo → banner de pausa global visível.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import React from "react";

// Hoist seguro: o mock precisa existir antes dos imports do módulo.
const mocks = vi.hoisted(() => ({
  getDashboardMetrics: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getDashboardMetrics: mocks.getDashboardMetrics,
  },
}));

// O Orbit 3D depende de WebGL (inexistente no jsdom): stub determinístico.
vi.mock("@/components/dashboard/OutreachOrb", () => ({
  default: () => <div data-testid="orb-stub" />,
}));

// Router do Next: AuthProvider chama useRouter (push) — stub sem navegar.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
}));

import DashboardPage from "@/app/(dashboard)/page";
import { AuthProvider } from "@/lib/auth-context";

// DashboardPage usa useAuth (token do SSE): envolve no AuthProvider real.
// Token nulo = SSE desligado; os testes validam a UI, não o stream.

const METRICS_OK = {
  active_campaigns: 3,
  contacts_in_seq: 12,
  waiting_followups: 4,
  replies: 7,
  completed: 5,
  telemetry_processed: 21,
  kill_switch_active: false,
  extension_connected: true,
  extension_last_seen: "2026-09-22T12:00:00Z",
  linkedin_connected: true,
  linkedin_status: "connected",
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("Dashboard (redesign claro)", () => {
  it("renderiza os KPIs com os números reais da API e o status das conexões", async () => {
    mocks.getDashboardMetrics.mockResolvedValue(METRICS_OK);

    render(<AuthProvider><DashboardPage /></AuthProvider>);

    await waitFor(() => {
      expect(screen.getAllByText("Campanhas ativas").length).toBeGreaterThanOrEqual(1);
    });
    // Os KPIs e as barras de distribuição mostram os mesmos dados reais:
    // getAllByText aceita as ocorrências legítimas do mesmo valor.
    expect(screen.getAllByText("3").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Contatos na cadência").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("12").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Respostas recebidas").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("7").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Concluídos").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("5").length).toBeGreaterThanOrEqual(1);

    // Conexões reais (LinkedIn + extensão conectadas, fila ativa).
    expect(screen.getByText("21 jobs processados")).toBeTruthy();
    // LinkedIn e extensão conectadas: dois badges "Conectado" legítimos.
    expect(screen.getAllByText("Conectado").length).toBe(2);

    // Sem banner de pausa quando o kill switch está desligado.
    expect(screen.queryByText(/pausa global está ativa/i)).toBeNull();
  });

  it("falha honesta: API fora do ar → mensagem de erro e nenhum número inventado", async () => {
    mocks.getDashboardMetrics.mockRejectedValue(new Error("Network Error"));

    render(<AuthProvider><DashboardPage /></AuthProvider>);

    await waitFor(() => {
      expect(screen.getByText("Network Error")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /tentar novamente/i })).toBeTruthy();

    // Nenhum KPI fabricado enquanto os dados reais não chegam.
    expect(screen.queryByText("Campanhas ativas")).toBeNull();
    expect(screen.queryByText("Respostas recebidas")).toBeNull();
  });

  it("kill switch ativo → banner de pausa global visível", async () => {
    mocks.getDashboardMetrics.mockResolvedValue({ ...METRICS_OK, kill_switch_active: true });

    render(<AuthProvider><DashboardPage /></AuthProvider>);

    await waitFor(() => {
      expect(screen.getByText(/pausa global está ativa/i)).toBeTruthy();
    });
  });
});
