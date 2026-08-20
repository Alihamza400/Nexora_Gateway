const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

interface ApiOptions {
  method?: string;
  body?: unknown;
  token?: string;
  apiKey?: string;
}

async function apiRequest<T = unknown>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, token, apiKey } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const data: any = await res.json();

  if (!res.ok) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    throw new Error(data.error?.message || data.message || 'Request failed');
  }

  return data as T;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  settlement_asset?: string;
  settlement_chain?: string;
  settlement_address?: string;
  accepted_chains?: string[];
  accepted_assets?: string[];
  webhook_url?: string;
}

export interface AuthResponse {
  success: boolean;
  data: {
    merchant_id: string;
    name: string;
    email: string;
    api_key?: string;
    token: string;
  };
  message?: string;
}

export interface ProfileResponse {
  success: boolean;
  data: {
    id: string;
    name: string;
    email: string;
    settlement_asset: string;
    settlement_chain: string;
    settlement_address: string;
    accepted_chains: string[];
    accepted_assets: string[];
    fee_percentage: string;
    kyc_threshold: string;
    quote_ttl_seconds: number;
    webhook_url: string | null;
    compliance_status: string;
    created_at: string;
    updated_at: string;
  };
}

export interface LoginRequest {
  email: string;
  password: string;
}

export const authApi = {
  register: (data: RegisterRequest) =>
    apiRequest<AuthResponse>('/api/v1/auth/register', { method: 'POST', body: data }),

  login: (data: LoginRequest) =>
    apiRequest<AuthResponse>('/api/v1/auth/login', { method: 'POST', body: data }),

  getProfile: (token: string) =>
    apiRequest<ProfileResponse>('/api/v1/auth/profile', { token }),

  regenerateKey: (apiKey: string) =>
    apiRequest<{ success: boolean; data: { api_key: string }; message: string }>(
      '/api/v1/auth/regenerate-key',
      { method: 'POST', apiKey },
    ),
};

// ─── Intents ─────────────────────────────────────────────────────────────────

export interface CreateIntentRequest {
  order_ref: string;
  target_amount: number;
  target_asset: string;
  target_chain: string;
  accepted_assets: string[];
}

export interface IntentResponse {
  intent_id: string;
  state: string;
  created_at: string;
}

export interface IntentDetail {
  intent_id: string;
  merchant_id: string;
  order_ref: string;
  state: string;
  target_amount: number;
  target_asset: string;
  target_chain: string;
  quoted_rate: number | null;
  quote_expires_at: string | null;
  created_at: string;
  updated_at: string;
  events: Array<{
    event_type: string;
    payload: Record<string, unknown>;
    created_at: string;
  }>;
}

export interface IntentListItem {
  intent_id: string;
  order_ref: string;
  state: string;
  target_amount: number;
  target_asset: string;
  created_at: string;
}

export interface QuoteRequest {
  rate: number;
  deposit_address: string;
  deposit_asset: string;
  deposit_chain: string;
}

export const intentsApi = {
  create: (data: CreateIntentRequest, token: string) =>
    apiRequest<IntentResponse>('/api/v1/intents', { method: 'POST', body: data, token }),

  getById: (id: string, token: string) =>
    apiRequest<IntentDetail>(`/api/v1/intents/${id}`, { token }),

  list: (token: string, limit = 20, offset = 0) =>
    apiRequest<{ intents: IntentListItem[] }>(
      `/api/v1/intents?limit=${limit}&offset=${offset}`,
      { token },
    ),

  generateQuote: (id: string, data: QuoteRequest, token: string) =>
    apiRequest<{ intent_id: string; state: string; quote: Record<string, unknown> }>(
      `/api/v1/intents/${id}/quote`,
      { method: 'POST', body: data, token },
    ),
};
