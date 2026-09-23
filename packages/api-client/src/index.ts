/**
 * VibexCorp LinkedIn Outreach - OpenAPI 3.x Typed Client
 * Shared by Next.js 16 Frontend and WXT Chrome Extension (Thin Client)
 */

export interface User {
  id: string;
  organization_id: string;
  email: string;
  name: string;
  role: string;
}

export interface LoginResponse {
  token: string;
  refresh_token?: string;
  expires_in?: number;
  user: User;
}

export interface DashboardMetrics {
  active_campaigns: number;
  contacts_in_seq: number;
  waiting_followups: number;
  replies: number;
  completed: number;
  telemetry_processed: number;
  kill_switch_active: boolean;
  extension_connected?: boolean;
  extension_last_seen?: string | null;
  linkedin_connected?: boolean;
  linkedin_status?: string;
  // Métrica do Jev: média de jev_ms nos message.sent recentes + amostras.
  // Ausente/0 amostras = vazio honesto (nunca 0ms inventado).
  jev_avg_ms?: number | null;
  jev_samples?: number;
}

export interface LinkedInAccount {
  connected: boolean;
  id?: string;
  display_name?: string;
  connection_status: 'disconnected' | 'connecting' | 'connected' | 'reauth_required' | 'restricted';
  circuit_breaker_state?: string;
  daily_limit?: number;
  last_seen_at?: string;
  capabilities?: {
    profile_read: boolean;
    connections_read: boolean;
    messaging_available: boolean;
  };
}

export interface ExtensionStatus {
  status: 'CONNECTED' | 'OFFLINE';
  connected: boolean;
  device_name?: string;
  last_seen_at?: string;
}

// Dispatch real (worker → extensão): job enfileirado pelo backend com a
// mensagem já renderizada para o contato.
export interface PendingOutreachJob {
  job_id: string;
  contact_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  company: string;
  job_title: string;
  linkedin_url: string;
  rendered_message: string;
}

// Parâmetros de comportamento humano (assist Typesafe/Jev ou fallback
// determinístico — `source` e `assist_available` dizem quem guiou).
export interface HumanizeParams {
  assist_available: boolean;
  source: 'typesafe' | 'fallback';
  click_delay_ms: number;
  type_cps_min: number;
  type_cps_max: number;
  pause_every_min_chars: number;
  pause_every_max_chars: number;
  pause_ms_min: number;
  pause_ms_max: number;
  mouse_steps_min: number;
  mouse_steps_max: number;
  scroll_dwell_ms: number;
  suggested_selector?: string;
  page_state?: string;
  confidence?: number;
  pacing_level?: string;
  jev_ms?: number;
  assist_total_ms?: number;
  cached?: boolean;
}

export interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  company: string;
  job_title: string;
  linkedin_url: string;
  status: 'pending' | 'active' | 'waiting' | 'contacted' | 'replied' | 'completed' | 'paused' | 'failed' | 'needs_review';
  created_at: string;
}

export interface ContactInput {
  first_name: string;
  last_name?: string;
  full_name?: string;
  company?: string;
  job_title?: string;
  linkedin_url: string;
  metadata?: Record<string, unknown>;
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled';
  daily_limit: number;
  timezone: string;
  created_at: string;
  total_contacts?: number;
  active_contacts?: number;
  replied_contacts?: number;
  completed_contacts?: number;
}

export interface CampaignInput {
  name: string;
  description?: string;
  daily_limit?: number;
  allowed_start_time?: string;
  allowed_end_time?: string;
  timezone?: string;
  is_flow_custom?: boolean;
  /** Contatos desta cadência; vazio = todos os contatos da organização. */
  contact_ids?: string[];
}

export interface CampaignStep {
  id?: string;
  position: number;
  step_type: 'MESSAGE' | 'WAIT' | 'CHECK_REPLY' | 'END';
  name: string;
  template_body: string;
  delay_amount: number;
  delay_unit: string;
  conditions?: Record<string, unknown>;
}

export interface CampaignPreviewResult {
  previews: Array<{
    contact_name: string;
    company: string;
    rendered: string;
    blocked: boolean;
    missing_var?: string;
  }>;
  can_launch: boolean;
}

export interface ActivityEvent {
  id: string;
  entity_type?: string;
  entity_id?: string;
  event_type: string;
  description?: string;
  payload?: Record<string, unknown>;
  created_at: string;
}

export interface TemplateRenderResult {
  rendered_text: string;
  needs_review: boolean;
  missing_vars: string[] | null;
  error: string | null;
}

export interface PendingOutreachResponse {
  has_campaign: boolean;
  campaign_id: string;
  campaign_name: string;
  queue_remaining: number;
  daily_remaining: number;
  job: PendingOutreachJob | null;
}

/**
 * Contrato honesto (PRD-honestidade-conexao, fases A2–D): códigos de erro
 * que a API retorna e o openapi.yaml documenta. O request() abaixo propaga
 * code+message para a UI exibir o erro real (nuncaFallback silencioso).
 */
export type HonestErrorCode =
  | 'STORE_UNAVAILABLE'
  | 'UNAUTHENTICATED'
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_TOKEN_GENERATION_FAILED'
  | 'AUTH_TOKEN_REFRESH_FAILED'
  | 'INVALID_PAIRING_CODE'
  | 'EVIDENCE_REQUIRED'
  | 'CONTACT_NOT_FOUND'
  | 'CAMPAIGN_NOT_FOUND'
  | 'CONVERSATION_NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'VALIDATION_FAILED'
  | 'INVALID_CAMPAIGN_ID'
  | 'INVALID_CONTACT_ID'
  | 'INVALID_CONVERSATION_ID'
  | 'FILE_REQUIRED'
  | 'CSV_PARSE_FAILED';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: string, message: string, status: number, details?: unknown) {
    super(`${code}: ${message}`);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface ReportSentRequest {
  contact_id: string;
  recipient_name: string;
  message_body: string;
  linkedin_url?: string;
  status?: string;
  job_id?: string;
  error?: string;
  assist_source?: string;
  assist_confidence?: number;
  assist_page_state?: string;
  jev_ms?: number;
  assist_total_ms?: number;
  assist_roundtrip_ms?: number;
}

export interface ConversationMessage {
  id: string;
  direction: 'outbound' | 'inbound';
  content: string;
  sentAt: string;
  stepTag?: string;
}

export interface ConversationItem {
  id: string;
  contact_id?: string;
  leadName: string;
  company: string;
  jobTitle: string;
  linkedinUrl: string;
  lastMessage: string;
  lastMessageTime: string;
  status: 'replied' | 'open' | 'archived';
  hasReplied: boolean;
  messages: ConversationMessage[];
}

export class VibexApiClient {
  private baseUrl: string;
  private token: string | null = null;
  private refreshInFlight: Promise<string | null> | null = null;

  constructor(baseUrl: string = 'http://localhost:8080/api/v1') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  setToken(token: string | null) {
    this.token = token;
  }

  // Access tokens são TEMPORÁRIOS (15min): em 401, renovamos com o refresh
  // token (7d, rotacionado no banco) e repetimos a request 1x — sem logout
  // a cada 15 minutos.
  private getRefreshToken(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return localStorage.getItem('vibex_refresh_token');
    } catch {
      return null;
    }
  }

  private storeSession(token?: string, refreshToken?: string) {
    if (typeof window === 'undefined') return;
    try {
      if (token) localStorage.setItem('vibex_auth_token', token);
      if (refreshToken) localStorage.setItem('vibex_refresh_token', refreshToken);
    } catch {
      /* storage indisponível */
    }
  }

  private async tryRefresh(): Promise<string | null> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      const rt = this.getRefreshToken();
      if (!rt) return null;
      const res = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { token?: string; refresh_token?: string };
      if (!data.token) return null;
      this.token = data.token;
      this.storeSession(data.token, data.refresh_token);
      return data.token;
    })();
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private async request<T>(path: string, options: RequestInit = {}, retried = false): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      // 401 com refresh disponível: renova e repete UMA vez antes de derrubar
      // a sessão (rota de auth não se renova a si mesma).
      if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
        const newToken = await this.tryRefresh().catch(() => null);
        if (newToken) {
          return this.request<T>(path, options, true);
        }
      }
      const errBody = await res.json().catch(() => ({ error: { message: res.statusText } }));
      // Contrato honesto: propaga code + message + details para a UI exibir
      // o erro real (A1/D); ApiError carrega o status HTTP (401/404/428/503).
      const code = errBody?.error?.code || `HTTP_${res.status}`;
      const msg = errBody?.error?.message || errBody?.error || `HTTP ${res.status}: ${res.statusText}`;
      // 401 definitivo (sem refresh possível): evento global para a app limpar
      // a sessão e levar ao login (o próprio /auth/login não emite o evento).
      if (res.status === 401 && !path.startsWith('/auth/')) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('vibex:unauthorized', { detail: { code, message: msg } }));
        }
      }
      throw new ApiError(code, msg, res.status, errBody?.error?.details);
    }

    return res.json() as Promise<T>;
  }

  // --- Auth ---
  async login(email: string, password: string): Promise<LoginResponse> {
    const res = await this.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.setToken(res.token);
    return res;
  }

  async logout(): Promise<void> {
    await this.request('/auth/logout', { method: 'POST' }).catch(() => {});
    this.setToken(null);
  }

  async getMe(): Promise<{ user: User }> {
    return this.request<{ user: User }>('/auth/me');
  }

  // --- Realtime Metrics & Activity ---
  async getDashboardMetrics(): Promise<DashboardMetrics> {
    return this.request<DashboardMetrics>('/dashboard/metrics');
  }

  async listActivity(): Promise<{ activity: ActivityEvent[] }> {
    return this.request<{ activity: ActivityEvent[] }>('/activity');
  }

  // --- LinkedIn Account ---
  async getCurrentAccount(): Promise<LinkedInAccount> {
    return this.request<LinkedInAccount>('/accounts/current');
  }

  async connectAccount(data: { display_name?: string; profile_url?: string; session_key?: string }): Promise<{ status: string }> {
    return this.request<{ status: string }>('/accounts/connect', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async disconnectAccount(): Promise<{ status: string }> {
    return this.request<{ status: string }>('/accounts/disconnect', {
      method: 'POST',
    });
  }

  // --- Extension Pairing ---
  async generatePairingCode(): Promise<{ pairing_code: string; expires_at: string }> {
    return this.request<{ pairing_code: string; expires_at: string }>('/extension/pairing-code', {
      method: 'POST',
    });
  }

  async pairExtension(pairingCode: string, deviceName?: string): Promise<{ device_id: string; extension_token: string }> {
    return this.request<{ device_id: string; extension_token: string }>('/extension/pair', {
      method: 'POST',
      body: JSON.stringify({ pairing_code: pairingCode, device_name: deviceName }),
    });
  }

  async getExtensionStatus(): Promise<ExtensionStatus> {
    return this.request<ExtensionStatus>('/extension/status');
  }

  // --- Contacts ---
  async listContacts(status?: string, search?: string): Promise<{ contacts: Contact[]; total: number }> {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (search) params.append('search', search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request<{ contacts: Contact[]; total: number }>(`/contacts${qs}`);
  }

  async createContact(input: ContactInput): Promise<{ id: string; status: string; message: string }> {
    return this.request<{ id: string; status: string; message: string }>('/contacts', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async deleteContact(id: string): Promise<{ status: string }> {
    return this.request<{ status: string }>(`/contacts/${id}`, {
      method: 'DELETE',
    });
  }

  async syncLinkedInContacts(connections: ContactInput[]): Promise<{ status: string; synced: number }> {
    return this.request<{ status: string; synced: number }>('/contacts/sync-linkedin', {
      method: 'POST',
      body: JSON.stringify({ connections }),
    });
  }

  // Upload real de arquivo (.csv multipart; .json vai como sync-linkedin).
  async importContactsFile(file: File): Promise<{ inserted?: number; imported?: number; synced?: number; skipped?: number; status?: string }> {
    if (file.name.toLowerCase().endsWith('.json')) {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const connections = Array.isArray(parsed) ? parsed : (parsed as { connections?: ContactInput[] }).connections ?? [];
      return this.syncLinkedInContacts(connections as ContactInput[]);
    }
    // multipart: sem Content-Type fixa (o browser define o boundary).
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${this.baseUrl}/contacts/import`, {
      method: 'POST',
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : undefined,
      body: form,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: { message: res.statusText } }));
      const code = errBody?.error?.code || `HTTP_${res.status}`;
      const msg = errBody?.error?.message || `HTTP ${res.status}: ${res.statusText}`;
      if (res.status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('vibex:unauthorized', { detail: { code, message: msg } }));
      }
      throw new ApiError(code, msg, res.status, errBody?.error?.details);
    }
    return res.json() as Promise<{ inserted?: number; imported?: number; skipped?: number; status?: string }>;
  }

  // --- Limites globais (settings reais) ---
  async getDailyLimits(): Promise<{ daily_limit: number; allowed_start_time: string; allowed_end_time: string; timezone: string; server_max_limit: number; server_min_limit: number }> {
    return this.request('/settings/daily-limits');
  }

  async saveDailyLimits(data: { daily_limit: number; allowed_start_time: string; allowed_end_time: string; timezone?: string }): Promise<{ status: string; daily_limit: number }> {
    return this.request('/settings/daily-limits', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // --- Dispatch (extensão consome via fetch direto; painel usa para diagnóstico) ---
  async assistHumanize(data: { action: string; selectors?: string[]; page_fingerprint?: string; language?: string }): Promise<HumanizeParams> {
    return this.request<HumanizeParams>('/assist/humanize', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  static readonly EXTENSION_DOWNLOAD_URL = '/downloads/extension.zip';

  // --- Campaigns ---
  async listCampaigns(): Promise<{ campaigns: Campaign[] }> {
    return this.request<{ campaigns: Campaign[] }>('/campaigns');
  }

  async createCampaign(input: CampaignInput): Promise<{ id: string; status: string }> {
    return this.request<{ id: string; status: string }>('/campaigns', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async getCampaign(id: string): Promise<Campaign> {
    return this.request<Campaign>(`/campaigns/${id}`);
  }

  async getCampaignSteps(id: string): Promise<{ steps: CampaignStep[] }> {
    return this.request<{ steps: CampaignStep[] }>(`/campaigns/${id}/steps`);
  }

  async saveCampaignSteps(id: string, steps: CampaignStep[]): Promise<{ status: string }> {
    return this.request<{ status: string }>(`/campaigns/${id}/steps`, {
      method: 'PUT',
      body: JSON.stringify({ steps }),
    });
  }

  async previewCampaign(id: string): Promise<CampaignPreviewResult> {
    return this.request<CampaignPreviewResult>(`/campaigns/${id}/preview`);
  }

  async startCampaign(id: string): Promise<{ status: string; message: string }> {
    return this.request<{ status: string; message: string }>(`/campaigns/${id}/start`, {
      method: 'POST',
    });
  }

  async pauseCampaign(id: string): Promise<{ status: string }> {
    return this.request<{ status: string }>(`/campaigns/${id}/pause`, {
      method: 'POST',
    });
  }

  async resumeCampaign(id: string): Promise<{ status: string }> {
    return this.request<{ status: string }>(`/campaigns/${id}/resume`, {
      method: 'POST',
    });
  }

  async setGlobalKillSwitch(pauseAll: boolean): Promise<{ kill_switch_active: boolean; message: string }> {
    return this.request<{ kill_switch_active: boolean; message: string }>('/settings/kill-switch', {
      method: 'POST',
      body: JSON.stringify({ pause_all: pauseAll }),
    });
  }

  async previewTemplate(templateBody: string, sampleData: Record<string, unknown>): Promise<TemplateRenderResult> {
    return this.request<TemplateRenderResult>('/templates/preview', {
      method: 'POST',
      body: JSON.stringify({ template_body: templateBody, sample_data: sampleData }),
    });
  }

  // --- Apollo-Style Messaging & Inbox ---
  async getPendingOutreach(): Promise<PendingOutreachResponse> {
    return this.request<PendingOutreachResponse>('/messaging/pending-outreach');
  }

  async reportSentMessage(data: ReportSentRequest): Promise<{ status: string; message: string; contact_id: string }> {
    return this.request<{ status: string; message: string; contact_id: string }>('/messaging/report-sent', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async reportReply(contactId: string, recipientName: string, replyBody: string): Promise<{ status: string; stop_on_reply: boolean }> {
    return this.request<{ status: string; stop_on_reply: boolean }>('/messaging/report-reply', {
      method: 'POST',
      body: JSON.stringify({ contact_id: contactId, recipient_name: recipientName, reply_body: replyBody }),
    });
  }

  async listConversations(): Promise<{ conversations: ConversationItem[]; total: number }> {
    return this.request<{ conversations: ConversationItem[]; total: number }>('/conversations');
  }

  async getConversation(id: string): Promise<ConversationItem> {
    return this.request<ConversationItem>(`/conversations/${id}`);
  }
}
