export type UserRole = "patient" | "doctor" | "hospital_admin";

export type ChatRole = "user" | "assistant";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  email_verified?: boolean;
  email_verified_at?: string | null;
  verification_sent_at?: string | null;
  hospital_id?: string;
  specialty?: string | null;
  doctor_code?: string | null;
  phone?: string | null;
  dob?: string | null;
  gender?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface VisitHistoryEntry {
  appointment_id: string;
  completed_at?: string;
  appointment_date?: string;
  appointment_time?: string;
  doctor_name?: string;
  doctor_specialty?: string;
  doctor_code?: string;
  visit_reason?: string;
  consultation_notes?: string;
  diagnosis_summary?: string;
  vitals_summary?: string;
  prescription_summary?: string;
  scan_summary?: string;
  follow_up_plan?: string;
  clinician_updated_by?: string;
}

export interface PatientProfile {
  id?: string;
  user_id?: string;
  hospital_id?: string;
  assigned_doctor_id?: string | null;
  assigned_doctor_name?: string;
  assigned_doctor_specialty?: string;
  assigned_doctor_code?: string;
  name: string;
  email: string;
  phone?: string;
  dob?: string;
  gender?: string;
  age?: number | null;
  status: string;
  risk_level: string;
  triage_score?: number;
  triage_label?: string;
  triage_reason?: string;
  recommended_action?: string;
  triage_updated_at?: string;
  symptoms?: string[];
  duration_text?: string;
  body_parts?: string[];
  medications_mentioned?: string[];
  red_flags?: string[];
  extracted_entities_updated_at?: string;
  summary_headline?: string;
  soap_summary?: string;
  clinical_summary?: string;
  clinical_note?: string;
  escalation_note?: string;
  summary_updated_at?: string;
  follow_up_questions?: string[];
  follow_up_updated_at?: string;
  risk_trajectory?: string;
  worsening_flag?: boolean;
  repeat_symptom_count?: number;
  repeated_symptoms?: string[];
  appointment_risk_score?: number;
  appointment_risk_label?: string;
  appointment_risk_reason?: string;
  followup_priority?: string;
  followup_due_at?: string;
  appointment_risk_updated_at?: string;
  missed_followup_count?: number;
  deterioration_prediction_score?: number;
  deterioration_prediction_label?: string;
  deterioration_prediction_reason?: string;
  predicted_followup_window?: string;
  prediction_next_check_at?: string;
  prediction_updated_at?: string;
  appointments_requested: number;
  emergency_count: number;
  last_summary?: string;
  visit_history?: VisitHistoryEntry[];
  last_engagement_at?: string;
  last_interaction_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  created_at?: string;
}

export interface ChatHistoryResponse {
  chat: {
    id?: string;
    user_id?: string;
    created_at?: string;
    updated_at?: string;
    last_message_at?: string;
    latest_triage?: {
      triage_score?: number;
      triage_label?: string;
      triage_reason?: string;
      recommended_action?: string;
    };
    latest_entities?: {
      symptoms?: string[];
      duration_text?: string;
      body_parts?: string[];
      medications_mentioned?: string[];
      red_flags?: string[];
    };
    messages: ChatMessage[];
  };
  messages: ChatMessage[];
  patient: PatientProfile | null;
}

export interface AuthResponse {
  token?: string;
  role: UserRole;
  user?: AuthUser | null;
  profile?: PatientProfile | null;
  requires_approval?: boolean;
  requires_verification?: boolean;
  message?: string;
  email?: string;
  preview_url?: string;
  delivery?: "email" | "preview";
  request?: DoctorAccessRequest;
}

export interface BasicMessageResponse {
  message: string;
  email?: string;
  preview_url?: string;
  delivery?: "email" | "preview";
}

export interface MeResponse {
  role: UserRole;
  user: AuthUser;
  profile: PatientProfile | null;
}

export interface StatsResponse {
  totalUsers: number;
  totalPatients: number;
  totalEmergencies: number;
  openEmergencies: number;
  activeChats: number;
  appointmentRequests: number;
  openAlerts: number;
}

export interface PatientRecord extends PatientProfile {}

export interface EmergencyRecord {
  id: string;
  user_id?: string | null;
  hospital_id?: string;
  assigned_doctor_id?: string | null;
  assigned_doctor_name?: string;
  patient_name: string;
  email?: string;
  message: string;
  severity: string;
  status: string;
  source: string;
  created_at?: string;
  updated_at?: string;
}

export interface AlertRecord {
  id: string;
  type: string;
  title: string;
  message: string;
  status: string;
  occurrence_count?: number;
  severity: string;
  source?: string;
  hospital_id?: string;
  target_role?: UserRole;
  target_user_id?: string;
  patient_user_id?: string | null;
  patient_name?: string;
  patient_email?: string;
  assigned_doctor_id?: string | null;
  assigned_doctor_name?: string;
  triage_label?: string;
  triage_score?: number;
  recommended_action?: string;
  acknowledged_at?: string;
  acknowledged_by_user_id?: string;
  acknowledged_by_name?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DocumentRecord {
  id: string;
  appointment_id?: string;
  patient_user_id?: string;
  patient_name?: string;
  patient_email?: string;
  uploaded_by_user_id?: string;
  uploaded_by_name?: string;
  hospital_id?: string;
  assigned_doctor_id?: string | null;
  assigned_doctor_name?: string;
  document_type: string;
  title: string;
  notes?: string;
  file_name?: string;
  content_type?: string;
  file_size?: number;
  storage_key?: string;
  storage_gridfs_file_id?: string;
  content_text?: string;
  summary?: string;
  prescription_summary?: string;
  medication_schedule?: Array<{
    drug_name: string;
    dosage: string;
    timing: string;
  }>;
  extracted_tags?: string[];
  review_priority?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface VitalRecord {
  id: string;
  appointment_id?: string;
  patient_user_id?: string;
  patient_name?: string;
  patient_email?: string;
  hospital_id?: string;
  assigned_doctor_id?: string | null;
  assigned_doctor_name?: string;
  pulse: number;
  spo2: number;
  temperature: number;
  systolic_bp: number;
  diastolic_bp: number;
  glucose: number;
  notes?: string;
  severity?: string;
  anomaly_flags?: string[];
  summary?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DoctorRecord {
  id: string;
  name: string;
  email?: string;
  specialty?: string;
  specialty_label?: string;
  doctor_code?: string;
  hospital_id?: string;
}

export interface DoctorAccessRequest {
  id: string;
  name: string;
  email: string;
  requested_role: "doctor";
  specialty?: string;
  hospital_id?: string;
  status: "pending" | "approved" | "rejected";
  doctor_user_id?: string;
  doctor_code?: string;
  approved_by_name?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AppointmentRecord {
  id: string;
  hospital_id?: string;
  patient_user_id?: string;
  patient_name?: string;
  patient_email?: string;
  patient_phone?: string;
  patient_age?: number | null;
  appointment_date?: string;
  appointment_time?: string;
  preferred_slot?: string;
  reason?: string;
  patient_notes?: string;
  status: string;
  requested_specialty?: string;
  assigned_doctor_id?: string | null;
  assigned_doctor_name?: string;
  assigned_doctor_specialty?: string;
  assigned_doctor_code?: string;
  consultation_notes?: string;
  diagnosis_summary?: string;
  vitals_summary?: string;
  prescription_summary?: string;
  scan_summary?: string;
  follow_up_plan?: string;
  consultation_started_at?: string | null;
  completed_at?: string | null;
  clinician_updated_by?: string;
  clinician_updated_by_user_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AnalyticsMetric {
  name: string;
  count: number;
}

export interface CareFunnelStage {
  stage: string;
  value: number;
}

export interface PriorityPatientSignal {
  id?: string;
  name: string;
  email?: string;
  summary_headline: string;
  clinical_summary: string;
  escalation_note: string;
  risk_level: string;
  assigned_doctor_name?: string;
  deterioration_prediction_label?: string;
  deterioration_prediction_score?: number;
  predicted_followup_window?: string;
  updated_at?: string;
}

export interface DemandForecast {
  projected_patient_load: number;
  projected_emergency_load: number;
  staffing_pressure: string;
  forecast_window: string;
}

export interface AnomalySignal {
  signal: string;
  recent_count: number;
  baseline_count: number;
  severity: string;
  summary: string;
}

export interface AnalyticsOverviewResponse {
  symptom_distribution: AnalyticsMetric[];
  red_flag_distribution: AnalyticsMetric[];
  risk_distribution: AnalyticsMetric[];
  care_funnel: CareFunnelStage[];
  priority_patients: PriorityPatientSignal[];
  demand_forecast: DemandForecast;
  anomaly_signals: AnomalySignal[];
  operational_flags: {
    high_risk_patients: number;
    predicted_high_risk_patients: number;
    open_alerts: number;
    open_emergencies: number;
  };
}
