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

export interface MedicationScheduleEntry {
  drug_name: string;
  dosage: string;
  timing: string;
  duration?: string;
  source_line?: string;
}

export interface DoctorCopilotSoapNote {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  formatted: string;
}

export interface ClinicalSafetySnapshot {
  clinical_alert_level: string;
  safety_flags: string[];
  drug_risk_flags: string[];
  vital_risk_flags: string[];
  condition_risk_flags?: string[];
  medication_risk_level?: string;
  medication_risk_summary?: string;
  medication_interaction_flags?: string[];
  medication_contraindications?: string[];
  medication_monitoring_actions?: string[];
  interacting_medications?: string[];
  safety_recommendation: string;
  last_safety_check_at?: string;
  medication_count?: number;
  vitals_reviewed?: number;
  documents_reviewed?: number;
}

export interface EarlyWarningSnapshot {
  early_warning_score: number;
  early_warning_priority: string;
  early_warning_summary: string;
  early_warning_response: string;
  early_warning_monitoring_window: string;
  early_warning_components: string[];
  early_warning_updated_at?: string;
}

export interface ReadmissionRiskSnapshot {
  readmission_risk_score: number;
  readmission_risk_label: string;
  readmission_risk_summary: string;
  readmission_risk_factors: string[];
  relapse_risk_window: string;
  readmission_next_check_at?: string;
  readmission_prediction_updated_at?: string;
}

export interface FollowupDropoutSnapshot {
  followup_dropout_risk_score: number;
  followup_dropout_risk_label: string;
  followup_dropout_risk_summary: string;
  followup_dropout_risk_factors: string[];
  followup_outreach_window: string;
  followup_next_touch_at?: string;
  followup_dropout_updated_at?: string;
}

export interface DoctorCopilotSnapshot {
  care_focus: string;
  latest_patient_context: string;
  changes_since_last_visit: string[];
  suggested_diagnosis_buckets: string[];
  suggested_follow_up_plan: string[];
  medication_safety_reminders: string[];
  clinical_safety: ClinicalSafetySnapshot;
  early_warning?: EarlyWarningSnapshot;
  readmission_risk?: ReadmissionRiskSnapshot;
  followup_dropout_risk?: FollowupDropoutSnapshot;
  evidence_panel?: {
    triage_signal?: string;
    specialty_signal?: string;
    specialty_confidence?: number;
    longitudinal_signal?: string;
  };
  soap_note: DoctorCopilotSoapNote;
  copilot_status: string;
  source_summary?: {
    chat_messages_used?: number;
    vitals_used?: number;
    documents_used?: number;
    prior_visits_used?: number;
  };
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
  clinical_alert_level?: string;
  safety_flags?: string[];
  drug_risk_flags?: string[];
  vital_risk_flags?: string[];
  condition_risk_flags?: string[];
  safety_recommendation?: string;
  last_safety_check_at?: string;
  medication_risk_level?: string;
  medication_risk_summary?: string;
  medication_interaction_flags?: string[];
  medication_contraindications?: string[];
  medication_monitoring_actions?: string[];
  interacting_medications?: string[];
  early_warning_score?: number;
  early_warning_priority?: string;
  early_warning_summary?: string;
  early_warning_response?: string;
  early_warning_monitoring_window?: string;
  early_warning_components?: string[];
  early_warning_updated_at?: string;
  readmission_risk_score?: number;
  readmission_risk_label?: string;
  readmission_risk_summary?: string;
  readmission_risk_factors?: string[];
  relapse_risk_window?: string;
  readmission_next_check_at?: string;
  readmission_prediction_updated_at?: string;
  followup_dropout_risk_score?: number;
  followup_dropout_risk_label?: string;
  followup_dropout_risk_summary?: string;
  followup_dropout_risk_factors?: string[];
  followup_outreach_window?: string;
  followup_next_touch_at?: string;
  followup_dropout_updated_at?: string;
  care_coordinator_status?: string;
  care_coordinator_note?: string;
  care_coordinator_updated_at?: string;
  care_coordinator_updated_by?: string;
  care_coordinator_updated_by_user_id?: string;
  care_coordinator_history?: Array<{
    status: string;
    note?: string;
    actor_name?: string;
    actor_role?: string;
    actor_user_id?: string;
    created_at?: string;
  }>;
  care_outreach_history?: Array<{
    channel: string;
    status: string;
    target?: string;
    message_preview?: string;
    preview_url?: string;
    actor_name?: string;
    actor_role?: string;
    actor_user_id?: string;
    created_at?: string;
  }>;
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

export interface PatientTimelineEvent {
  type: "chat" | "appointment" | "vital" | "document" | "visit";
  timestamp?: string;
  title: string;
  detail: string;
  severity?: string;
}

export interface PatientDigitalTwin {
  journey_summary: string;
  care_phase: string;
  timeline_events: PatientTimelineEvent[];
  care_gaps: string[];
  counts: {
    messages: number;
    appointments: number;
    vitals: number;
    documents: number;
    visits: number;
  };
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
  digital_twin?: PatientDigitalTwin | null;
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
  medication_schedule?: MedicationScheduleEntry[];
  document_domain?: string;
  structured_findings?: string[];
  abnormal_findings?: string[];
  clinical_highlights?: string[];
  follow_up_recommendations?: string[];
  lab_alert_level?: string;
  abnormal_value_count?: number;
  analytes_detected?: string[];
  discharge_risk_level?: string;
  discharge_risk_summary?: string;
  discharge_key_diagnoses?: string[];
  discharge_procedures?: string[];
  discharge_red_flags?: string[];
  extracted_tags?: string[];
  review_priority?: string;
  ocr_status?: string;
  ocr_source?: string;
  ocr_text_excerpt?: string;
  extraction_model?: string;
  extraction_confidence?: number;
  ai_interpretation_notes?: string;
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
  open_slot_count?: number;
  next_open_slot?: DoctorSlot | null;
  booking_locations?: string[];
}

export interface DoctorSlot {
  id: string;
  date: string;
  time: string;
  label?: string;
  location?: string;
  capacity?: number;
  status?: string;
  booked_count?: number;
  available_count?: number;
  is_available?: boolean;
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
  slot_id?: string | null;
  slot_label?: string;
  appointment_location?: string;
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
  safety_workflow_status?: string;
  safety_workflow_note?: string;
  safety_workflow_updated_at?: string | null;
  safety_workflow_updated_by?: string;
  safety_workflow_updated_by_user_id?: string;
  safety_workflow_history?: SafetyWorkflowHistoryEntry[];
  doctor_copilot?: DoctorCopilotSnapshot;
  created_at?: string;
  updated_at?: string;
}

export interface SafetyWorkflowHistoryEntry {
  status: string;
  note?: string;
  actor_name?: string;
  actor_role?: string;
  actor_user_id?: string;
  created_at?: string;
}

export interface SafetyWorkflowSnapshot {
  status: string;
  note?: string;
  updated_at?: string | null;
  updated_by?: string;
  history: SafetyWorkflowHistoryEntry[];
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

export interface PredictionWatchlistEntry {
  id?: string;
  name: string;
  email?: string;
  assigned_doctor_name?: string;
  deterioration_prediction_label: string;
  deterioration_prediction_score: number;
  deterioration_prediction_reason: string;
  predicted_followup_window: string;
  prediction_next_check_at?: string;
  risk_trajectory?: string;
  worsening_flag?: boolean;
  triage_label?: string;
  summary_headline?: string;
}

export interface ReviewQueueSummary {
  immediate: number;
  within_6_hours: number;
  within_24_hours: number;
  routine: number;
}

export interface ClinicalSafetySummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface EarlyWarningSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface EarlyWarningWatchEntry {
  id?: string;
  name: string;
  email?: string;
  assigned_doctor_name?: string;
  early_warning_score: number;
  early_warning_priority: string;
  early_warning_summary: string;
  early_warning_response: string;
  early_warning_monitoring_window: string;
  updated_at?: string;
}

export interface ReadmissionRiskSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface FollowupDropoutSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface ReadmissionWatchEntry {
  id?: string;
  name: string;
  email?: string;
  assigned_doctor_name?: string;
  readmission_risk_score: number;
  readmission_risk_label: string;
  readmission_risk_summary: string;
  readmission_risk_factors: string[];
  relapse_risk_window: string;
  updated_at?: string;
}

export interface FollowupDropoutWatchEntry {
  id?: string;
  name: string;
  email?: string;
  assigned_doctor_name?: string;
  followup_dropout_risk_score: number;
  followup_dropout_risk_label: string;
  followup_dropout_risk_summary: string;
  followup_dropout_risk_factors: string[];
  followup_outreach_window: string;
  updated_at?: string;
}

export interface CareCoordinatorSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface CareCoordinatorTask {
  patient_id?: string;
  patient_name: string;
  patient_email?: string;
  assigned_doctor_name?: string;
  priority: string;
  task_type: string;
  score: number;
  summary: string;
  reason_factors: string[];
  suggested_action: string;
  outreach_window: string;
  next_action_at?: string;
  symptom_snapshot: string[];
  followup_priority?: string;
  workflow?: {
    status: string;
    note?: string;
    updated_at?: string;
    updated_by?: string;
    history: Array<{
      status: string;
      note?: string;
      actor_name?: string;
      actor_role?: string;
      actor_user_id?: string;
      created_at?: string;
    }>;
  };
  outreach_history?: Array<{
    channel: string;
    status: string;
    target?: string;
    message_preview?: string;
    preview_url?: string;
    actor_name?: string;
    actor_role?: string;
    actor_user_id?: string;
    created_at?: string;
  }>;
}

export interface ClinicalSafetyWatchEntry {
  id?: string;
  name: string;
  email?: string;
  appointment_id?: string | null;
  assigned_doctor_name?: string;
  clinical_alert_level: string;
  safety_recommendation: string;
  safety_flags: string[];
  drug_risk_flags: string[];
  vital_risk_flags: string[];
  safety_workflow?: SafetyWorkflowSnapshot;
  updated_at?: string;
}

export interface AnomalySignal {
  signal: string;
  recent_count: number;
  baseline_count: number;
  severity: string;
  summary: string;
}

export interface OutbreakCluster {
  cluster: string;
  recent_count: number;
  baseline_daily_avg: number;
  anomaly_score: number;
  severity: string;
  top_symptoms: string[];
  summary: string;
}

export interface OutbreakTimelinePoint {
  day: string;
  [cluster: string]: string | number;
}

export interface ModelSamplePrediction {
  text: string;
  expected_triage: string;
  predicted_triage: string;
  triage_confidence: number;
  expected_specialty: string;
  predicted_specialty: string;
  specialty_reason: string;
}

export interface ModelMetrics {
  dataset_size: number;
  embedding_backend: string;
  transformer_enabled: boolean;
  triage_model_version: string;
  specialty_model_version: string;
  artifact_path?: string;
  artifact_saved?: boolean;
  triage_accuracy: number;
  triage_macro_f1: number;
  triage_baseline_accuracy: number;
  specialty_accuracy: number;
  specialty_baseline_accuracy: number;
  triage_confusion_matrix: Array<Record<string, string | number>>;
  sample_predictions: ModelSamplePrediction[];
}

export interface DocumentIntelligenceSummary {
  total_documents: number;
  prescriptions: number;
  lab_reports: number;
  discharge_notes: number;
  flagged_documents: number;
}

export interface AnalyticsOverviewResponse {
  symptom_distribution: AnalyticsMetric[];
  red_flag_distribution: AnalyticsMetric[];
  risk_distribution: AnalyticsMetric[];
  deterioration_distribution: AnalyticsMetric[];
  care_funnel: CareFunnelStage[];
  priority_patients: PriorityPatientSignal[];
  prediction_watchlist: PredictionWatchlistEntry[];
  review_queue_summary: ReviewQueueSummary;
  clinical_safety_summary: ClinicalSafetySummary;
  clinical_safety_watch: ClinicalSafetyWatchEntry[];
  early_warning_summary: EarlyWarningSummary;
  early_warning_watchlist: EarlyWarningWatchEntry[];
  readmission_risk_summary: ReadmissionRiskSummary;
  readmission_watchlist: ReadmissionWatchEntry[];
  followup_dropout_summary: FollowupDropoutSummary;
  followup_dropout_watchlist: FollowupDropoutWatchEntry[];
  care_coordinator_summary: CareCoordinatorSummary;
  care_coordinator_queue: CareCoordinatorTask[];
  executive_summary: {
    total_doctors: number;
    scheduled_consultations: number;
    completed_today: number;
    slot_utilization: number;
    available_capacity: number;
  };
  doctor_workload: Array<{
    doctor_id: string;
    doctor_name: string;
    doctor_code?: string;
    specialty?: string;
    booked_appointments: number;
    open_requests: number;
    in_consultation: number;
    completed_today: number;
    upcoming_slots: number;
    avg_triage_score: number;
  }>;
  specialty_demand: Array<{
    specialty: string;
    count: number;
  }>;
  model_metrics: ModelMetrics;
  document_intelligence_summary: DocumentIntelligenceSummary;
  demand_forecast: DemandForecast;
  outbreak_clusters: OutbreakCluster[];
  outbreak_timeline: OutbreakTimelinePoint[];
  anomaly_signals: AnomalySignal[];
  operational_flags: {
    high_risk_patients: number;
    predicted_high_risk_patients: number;
    readmission_high_risk_patients: number;
    followup_dropout_high_risk_patients: number;
    care_coordinator_urgent_tasks: number;
    open_alerts: number;
    open_emergencies: number;
  };
}
