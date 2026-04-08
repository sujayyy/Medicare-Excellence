import type {
  AlertRecord,
  AnalyticsOverviewResponse,
  AuthResponse,
  ChatHistoryResponse,
  DocumentRecord,
  EmergencyRecord,
  MeResponse,
  PatientRecord,
  StatsResponse,
  VitalRecord,
} from "@/types/api";

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:5001").replace(/\/$/, "");

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface RequestOptions extends RequestInit {
  token?: string | null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { token, headers, body, ...rest } = options;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(data?.error || "Something went wrong. Please try again.", response.status);
  }

  return data as T;
}

export function signup(payload: { name: string; email: string; password: string; role: "patient" | "doctor" | "hospital_admin"; specialty?: string }) {
  return request<AuthResponse>("/signup", { method: "POST", body: JSON.stringify(payload) });
}

export function login(payload: { email: string; password: string }) {
  return request<AuthResponse>("/login", { method: "POST", body: JSON.stringify(payload) });
}

export function getCurrentSession(token: string) {
  return request<MeResponse>("/me", { token });
}

export function getChatHistory(token: string) {
  return request<ChatHistoryResponse>("/chat/history", { token });
}

export function sendChatMessage(token: string, message: string) {
  return request<{ response: string }>("/chat", {
    method: "POST",
    token,
    body: JSON.stringify({ message }),
  });
}

export function getStats(token: string) {
  return request<StatsResponse>("/stats", { token });
}

export function getPatients(token: string) {
  return request<{ patients: PatientRecord[] }>("/patients", { token });
}

export function getEmergencies(token: string) {
  return request<{ emergencies: EmergencyRecord[] }>("/emergencies", { token });
}

export function getAlerts(token: string) {
  return request<{ alerts: AlertRecord[] }>("/alerts", { token });
}

export function acknowledgeAlert(token: string, alertId: string) {
  return request<{ alert: AlertRecord }>(`/alerts/${alertId}/acknowledge`, {
    method: "POST",
    token,
  });
}

export function getAnalyticsOverview(token: string) {
  return request<AnalyticsOverviewResponse>("/analytics/overview", { token });
}

export function getDocuments(token: string) {
  return request<{ documents: DocumentRecord[] }>("/documents", { token });
}

export function uploadDocument(
  token: string,
  payload: {
    title: string;
    document_type: string;
    notes?: string;
    file_name?: string;
    content_type?: string;
    file_size?: number;
    content_text?: string;
  },
) {
  return request<{ document: DocumentRecord }>("/documents", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export function getVitals(token: string) {
  return request<{ vitals: VitalRecord[] }>("/vitals", { token });
}

export function createVital(
  token: string,
  payload: {
    pulse: number;
    spo2: number;
    temperature: number;
    systolic_bp: number;
    diastolic_bp: number;
    glucose: number;
    notes?: string;
  },
) {
  return request<{ vital: VitalRecord }>("/vitals", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}
