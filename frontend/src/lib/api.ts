import type {
  AlertRecord,
  AnalyticsOverviewResponse,
  AppointmentRecord,
  AuthResponse,
  BasicMessageResponse,
  ChatHistoryResponse,
  DoctorAccessRequest,
  DoctorRecord,
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
  data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
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
    throw new ApiError(data?.error || "Something went wrong. Please try again.", response.status, data);
  }

  return data as T;
}

async function requestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const { token, headers, ...rest } = options;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(data?.error || "Unable to download the requested file.", response.status);
  }

  return response.blob();
}

export function signup(payload: {
  name: string;
  email: string;
  password: string;
  role: "patient" | "doctor" | "hospital_admin";
  specialty?: string;
  phone?: string;
  dob?: string;
  gender?: string;
}) {
  return request<AuthResponse>("/signup", { method: "POST", body: JSON.stringify(payload) });
}

export function login(payload: { email: string; password: string }) {
  return request<AuthResponse>("/login", { method: "POST", body: JSON.stringify(payload) });
}

export function resendVerification(payload: { email: string }) {
  return request<BasicMessageResponse>("/resend-verification", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function verifyEmail(payload: { token: string }) {
  return request<BasicMessageResponse & { role?: "patient" | "doctor" | "hospital_admin" }>("/verify-email", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function forgotPassword(payload: { email: string }) {
  return request<BasicMessageResponse>("/forgot-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function resetPassword(payload: { token: string; password: string }) {
  return request<BasicMessageResponse>("/reset-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getCurrentSession(token: string) {
  return request<MeResponse>("/me", { token });
}

export function getChatHistory(token: string) {
  return request<ChatHistoryResponse>("/chat/history", { token });
}

export function sendChatMessage(token: string, message: string, languagePreference?: string) {
  return request<{ response: string }>("/chat", {
    method: "POST",
    token,
    body: JSON.stringify({ message, language_preference: languagePreference }),
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
    appointment_id?: string;
    notes?: string;
    file_name?: string;
    content_type?: string;
    file_size?: number;
    file_data_url?: string;
    content_text?: string;
  },
) {
  return request<{ document: DocumentRecord }>("/documents", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export function downloadDocumentFile(token: string, documentId: string) {
  return requestBlob(`/documents/${documentId}/download`, { token });
}

export function getVitals(token: string) {
  return request<{ vitals: VitalRecord[] }>("/vitals", { token });
}

export function createVital(
  token: string,
  payload: {
    appointment_id?: string;
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

export function getDoctors(token: string, specialty?: string) {
  const query = specialty ? `?specialty=${encodeURIComponent(specialty)}` : "";
  return request<{ doctors: DoctorRecord[] }>(`/doctors${query}`, { token });
}

export function getAppointments(token: string) {
  return request<{ appointments: AppointmentRecord[] }>("/appointments", { token });
}

export function createAppointment(
  token: string,
  payload: {
    doctor_id: string;
    appointment_date: string;
    appointment_time: string;
    reason: string;
    notes?: string;
  },
) {
  return request<{ appointment: AppointmentRecord }>("/appointments", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export function updateAppointment(
  token: string,
  appointmentId: string,
  payload: {
    status?: string;
    consultation_notes?: string;
    diagnosis_summary?: string;
    vitals_summary?: string;
    prescription_summary?: string;
    scan_summary?: string;
    follow_up_plan?: string;
  },
) {
  return request<{ appointment: AppointmentRecord }>(`/appointments/${appointmentId}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(payload),
  });
}

export function getAccessRequests(token: string) {
  return request<{ requests: DoctorAccessRequest[] }>("/access-requests", { token });
}

export function approveAccessRequest(token: string, requestId: string) {
  return request<{ request: DoctorAccessRequest }>(`/access-requests/${requestId}/approve`, {
    method: "POST",
    token,
  });
}

export function rejectAccessRequest(token: string, requestId: string) {
  return request<{ request: DoctorAccessRequest }>(`/access-requests/${requestId}/reject`, {
    method: "POST",
    token,
  });
}
