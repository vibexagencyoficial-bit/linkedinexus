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

export interface PendingOutreachContact {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  company: string;
  job_title: string;
  linkedin_url: string;
  rendered_message: string;
}

export interface PendingOutreachResponse {
  campaign_id: string;
  campaign_name: string;
  template: string;
  total_pending: number;
  contacts: PendingOutreachContact[];
}

export interface ReportSentRequest {
  contact_id: string;
  recipient_name: string;
  message_body: string;
  linkedin_url?: string;
  status?: string;
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

  constructor(baseUrl: string = 'http://localhost:8080/api/v1') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
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
      const errBody = await res.json().catch(() => ({ error: { message: res.statusText } }));
      const msg = errBody?.error?.message || errBody?.error || `HTTP ${res.status}: ${res.statusText}`;
      throw new Error(msg);
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
