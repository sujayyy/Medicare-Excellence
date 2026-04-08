import { format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, BellRing, CalendarClock, Copy, FileText, HeartPulse, MessagesSquare, Users } from "lucide-react";

import DashboardLayout from "@/components/DashboardLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/context/AuthContext";
import { acknowledgeAlert, ApiError, getDocuments, getEmergencies, getPatients, getStats, getVitals } from "@/lib/api";
import { useLiveAlertNotifications } from "@/hooks/useLiveAlertNotifications";
import { useToast } from "@/hooks/use-toast";
import type { DocumentRecord, PatientRecord, VitalRecord } from "@/types/api";

function formatDate(value?: string) {
  if (!value) {
    return "N/A";
  }

  return format(new Date(value), "MMM d, yyyy h:mm a");
}

function getRiskBadgeVariant(riskLevel?: string) {
  if (riskLevel === "Critical" || riskLevel === "High") {
    return "destructive" as const;
  }
  if (riskLevel === "Medium") {
    return "secondary" as const;
  }
  return "outline" as const;
}

function getAlertBadgeVariant(severity?: string) {
  if (severity === "critical" || severity === "high") {
    return "destructive" as const;
  }
  if (severity === "medium") {
    return "secondary" as const;
  }
  return "outline" as const;
}

function getAppointmentRiskBadgeVariant(riskLevel?: string) {
  if (riskLevel === "Critical" || riskLevel === "High") {
    return "destructive" as const;
  }
  if (riskLevel === "Medium") {
    return "secondary" as const;
  }
  return "outline" as const;
}

function formatAppointmentRiskScore(score?: number) {
  return typeof score === "number" && score > 0 ? `${score}/100` : "Not scored yet";
}

function compactList(values?: string[]) {
  return values && values.length > 0 ? values.join(", ") : "Not extracted yet";
}

function getSummaryPatients(patients: PatientRecord[]) {
  return [...patients]
    .filter((patient) => patient.summary_headline || patient.soap_summary || patient.clinical_summary)
    .slice(0, 4);
}

function getPrioritySchedulingPatients(patients: PatientRecord[]) {
  return [...patients]
    .filter(
      (patient) =>
        (patient.appointment_risk_score ?? 0) >= 35 ||
        patient.status.toLowerCase().includes("appointment") ||
        (patient.followup_priority && patient.followup_priority !== "Routine follow-up"),
    )
    .sort(
      (left, right) =>
        (right.appointment_risk_score ?? 0) - (left.appointment_risk_score ?? 0) ||
        (right.triage_score ?? 0) - (left.triage_score ?? 0),
    )
    .slice(0, 5);
}

export default function HospitalAdminDashboard() {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const statsQuery = useQuery({
    queryKey: ["hospital-admin-stats"],
    queryFn: () => getStats(token || ""),
    enabled: Boolean(token),
  });

  const patientsQuery = useQuery({
    queryKey: ["hospital-admin-patients"],
    queryFn: () => getPatients(token || ""),
    enabled: Boolean(token),
  });

  const emergenciesQuery = useQuery({
    queryKey: ["hospital-admin-emergencies"],
    queryFn: () => getEmergencies(token || ""),
    enabled: Boolean(token),
  });

  const documentsQuery = useQuery({
    queryKey: ["hospital-admin-documents"],
    queryFn: () => getDocuments(token || ""),
    enabled: Boolean(token),
  });

  const vitalsQuery = useQuery({
    queryKey: ["hospital-admin-vitals"],
    queryFn: () => getVitals(token || ""),
    enabled: Boolean(token),
  });

  const { alertsQuery, alerts, liveAlert } = useLiveAlertNotifications({
    token: token || "",
    queryKey: ["hospital-admin-alerts"],
    audienceLabel: "Hospital alert",
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (alertId: string) => acknowledgeAlert(token || "", alertId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["hospital-admin-alerts"] });
      void queryClient.invalidateQueries({ queryKey: ["hospital-admin-stats"] });
      toast({
        title: "Alert marked handled",
        description: "The alert was resolved and removed from the active hospital dashboard.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Unable to update alert",
        description: error instanceof ApiError ? error.message : "Please try again.",
      });
    },
  });

  const error = statsQuery.error || patientsQuery.error || emergenciesQuery.error || alertsQuery.error;
  const stats = statsQuery.data;
  const patients = patientsQuery.data?.patients || [];
  const emergencies = emergenciesQuery.data?.emergencies || [];
  const documents = documentsQuery.data?.documents || [];
  const vitals = vitalsQuery.data?.vitals || [];
  const summaryPatients = getSummaryPatients(patients);
  const prioritySchedulingPatients = getPrioritySchedulingPatients(patients);

  const copyClinicalNote = async (patient: PatientRecord) => {
    const note =
      patient.clinical_note ||
      patient.clinical_summary ||
      patient.soap_summary ||
      patient.last_summary ||
      "";
    if (!note) {
      toast({
        variant: "destructive",
        title: "No note available",
        description: "This patient does not have a clinical note yet.",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(note);
      toast({
        title: "Clinical note copied",
        description: `The note for ${patient.name} is ready to paste.`,
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Unable to copy note",
        description: "Clipboard access failed. Please try again.",
      });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">Hospital Operations Dashboard</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Live analytics, hospital-wide patient records, and escalations for {user?.name}.
            </p>
          </div>
          <Badge variant="secondary">Hospital Admin Access</Badge>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {error instanceof ApiError ? error.message : "Unable to load the hospital dashboard right now."}
            </AlertDescription>
          </Alert>
        )}

        {liveAlert && (
          <Alert variant={liveAlert.severity === "high" || liveAlert.severity === "critical" ? "destructive" : "default"}>
            <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">Live escalation: {liveAlert.title}</p>
                <p className="text-sm">
                  {liveAlert.patient_name || "Patient"}: {liveAlert.message}
                </p>
              </div>
              <Badge variant={getAlertBadgeVariant(liveAlert.severity)}>{alerts.length} active alerts</Badge>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {[
            { label: "Total Patients", value: stats?.totalPatients ?? 0, icon: Users },
            { label: "Open Emergencies", value: stats?.openEmergencies ?? 0, icon: AlertTriangle },
            { label: "Open Alerts", value: stats?.openAlerts ?? alerts.filter((entry) => entry.status === "open").length, icon: BellRing },
            { label: "Active Chats", value: stats?.activeChats ?? 0, icon: MessagesSquare },
            { label: "Appointment Requests", value: stats?.appointmentRequests ?? 0, icon: CalendarClock },
          ].map((item) => (
            <Card key={item.label} className="border-border/60 bg-card/95 shadow-card">
              <CardContent className="flex items-center gap-4 p-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent">
                  <item.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-display text-2xl font-bold text-foreground">{item.value}</p>
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-border/60 bg-card/95 shadow-elevated">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Hospital Patient Records</CardTitle>
              <Badge variant="outline">{patients.length} entries</Badge>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead>Symptoms</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Risk</TableHead>
                    <TableHead>Assigned Doctor</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {patients.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        No patient records available yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {patients.map((patient) => (
                    <TableRow key={patient.id || patient.email}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-foreground">{patient.name}</p>
                          <p className="text-xs text-muted-foreground">{patient.email || "No email on file"}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm text-foreground">{compactList(patient.symptoms)}</p>
                          <p className="text-xs text-muted-foreground">
                            {patient.duration_text || "No duration"} {patient.body_parts && patient.body_parts.length > 0 ? `· ${patient.body_parts.join(", ")}` : ""}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant="outline">{patient.status}</Badge>
                          <p className="text-xs text-muted-foreground">{patient.followup_priority || "Routine follow-up"}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getRiskBadgeVariant(patient.risk_level)}>{patient.risk_level}</Badge>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-foreground">{patient.assigned_doctor_name || "Unassigned"}</p>
                          <p className="text-xs text-muted-foreground">
                            {patient.triage_score ?? 0}/100 triage{patient.risk_trajectory ? ` · ${patient.risk_trajectory}` : ""}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Scheduling: {patient.appointment_risk_label || "Pending"} {formatAppointmentRiskScore(patient.appointment_risk_score)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Prediction: {patient.deterioration_prediction_label || "Low"} {patient.deterioration_prediction_score ?? 0}/100
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(patient.updated_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-border/60 bg-card/95 shadow-card">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="font-display text-lg">Priority Scheduling Queue</CardTitle>
                <Badge variant={prioritySchedulingPatients.length > 0 ? "secondary" : "outline"}>
                  {prioritySchedulingPatients.length} patients
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                {prioritySchedulingPatients.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Patients who may need quicker scheduling follow-up will appear here.
                  </p>
                )}
                {prioritySchedulingPatients.map((patient) => (
                  <div key={`schedule-${patient.id || patient.email}`} className="rounded-2xl border border-border/60 p-4">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{patient.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {patient.status} {patient.assigned_doctor_name ? `· ${patient.assigned_doctor_name}` : "· Unassigned"}
                        </p>
                      </div>
                      <Badge variant={getAppointmentRiskBadgeVariant(patient.appointment_risk_label)}>
                        {patient.appointment_risk_label || "Low"}
                      </Badge>
                    </div>
                    <p className="text-sm text-foreground">{patient.appointment_risk_reason || "No scheduling risk summary yet."}</p>
                    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>
                        Priority: {patient.followup_priority || "Routine follow-up"} · Score {formatAppointmentRiskScore(patient.appointment_risk_score)}
                      </span>
                      <span>Due {formatDate(patient.followup_due_at)}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/95 shadow-card">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="font-display text-lg">Vitals Oversight</CardTitle>
                <Badge variant="outline">{vitals.length} readings</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                {vitals.length === 0 && (
                  <p className="text-sm text-muted-foreground">Hospital-wide patient vitals will appear here.</p>
                )}
                {vitals.slice(0, 5).map((vital: VitalRecord) => (
                  <div key={vital.id} className="rounded-2xl border border-border/60 p-4">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{vital.patient_name || "Patient"}</p>
                        <p className="text-xs text-muted-foreground">
                          {vital.assigned_doctor_name || "Unassigned"} · Pulse {vital.pulse} · SpO2 {vital.spo2}%
                        </p>
                      </div>
                      <Badge variant={vital.severity === "critical" || vital.severity === "high" ? "destructive" : vital.severity === "medium" ? "secondary" : "outline"}>
                        {vital.severity || "normal"}
                      </Badge>
                    </div>
                    <p className="text-sm text-foreground">{vital.summary || "No summary available."}</p>
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                      <HeartPulse className="h-3.5 w-3.5" />
                      BP {vital.systolic_bp}/{vital.diastolic_bp} · Glucose {vital.glucose} · Temp {vital.temperature}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/95 shadow-card">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="font-display text-lg">Document Intake Queue</CardTitle>
                <Badge variant="outline">{documents.length} documents</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                {documents.length === 0 && (
                  <p className="text-sm text-muted-foreground">Patient-uploaded documents will appear here for hospital review.</p>
                )}
                {documents.slice(0, 5).map((document: DocumentRecord) => (
                  <div key={document.id} className="rounded-2xl border border-border/60 p-4">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{document.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {document.patient_name || "Patient"} {document.assigned_doctor_name ? `· ${document.assigned_doctor_name}` : ""}
                        </p>
                      </div>
                      <Badge variant={document.review_priority === "Urgent" ? "destructive" : document.review_priority === "Priority" ? "secondary" : "outline"}>
                        {document.review_priority || "Routine"}
                      </Badge>
                    </div>
                    <p className="text-sm text-foreground">{document.summary || "No summary available."}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(document.extracted_tags || []).map((tag) => (
                        <Badge key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/95 shadow-card">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="font-display text-lg">AI Patient Summaries</CardTitle>
                <Badge variant="outline">{summaryPatients.length} patients</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                {summaryPatients.length === 0 && (
                  <p className="text-sm text-muted-foreground">Clinical-style patient summaries will appear here as patients interact with the assistant.</p>
                )}
                {summaryPatients.map((patient) => (
                  <div key={`summary-${patient.id || patient.email}`} className="rounded-2xl border border-border/60 p-4">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{patient.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {patient.email || "No email on file"} {patient.assigned_doctor_name ? `· ${patient.assigned_doctor_name}` : ""}
                        </p>
                      </div>
                      <Badge variant={getRiskBadgeVariant(patient.risk_level)}>{patient.risk_level}</Badge>
                    </div>
                    <div className="space-y-2 text-sm">
                      <p className="font-medium text-foreground">{patient.summary_headline || "AI summary ready"}</p>
                      <p className="text-muted-foreground">{patient.soap_summary || patient.last_summary || "No patient summary yet."}</p>
                      <div className="rounded-xl bg-muted/50 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            <FileText className="h-3.5 w-3.5" />
                            Clinical note
                          </div>
                          <Button size="sm" variant="outline" onClick={() => void copyClinicalNote(patient)}>
                            <Copy className="h-3.5 w-3.5" />
                            Copy note
                          </Button>
                        </div>
                        <p className="whitespace-pre-line text-sm text-foreground">
                          {patient.clinical_note || patient.clinical_summary || "No clinical note generated yet."}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {patient.escalation_note || patient.recommended_action || "No escalation advice yet."}
                          {patient.worsening_flag ? " Trend is worsening." : patient.risk_trajectory ? ` Trend: ${patient.risk_trajectory}.` : ""}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Predicted deterioration: {patient.deterioration_prediction_label || "Low"} ({patient.deterioration_prediction_score ?? 0}/100) · {patient.predicted_followup_window || "Routine 72-hour review"}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/95 shadow-card">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="font-display text-lg">Hospital Alerts</CardTitle>
                <Badge variant={alerts.length > 0 ? "destructive" : "outline"}>{alerts.length} total</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                {alerts.length === 0 && (
                  <p className="text-sm text-muted-foreground">No hospital-level alerts have been created yet.</p>
                )}
                {alerts.slice(0, 6).map((alertItem) => (
                  <div key={alertItem.id} className="rounded-2xl border border-border/60 p-4">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{alertItem.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {alertItem.patient_name || "Unknown patient"} {alertItem.assigned_doctor_name ? `· Assigned to ${alertItem.assigned_doctor_name}` : ""}
                        </p>
                      </div>
                      <Badge variant={getAlertBadgeVariant(alertItem.severity)}>{alertItem.severity}</Badge>
                    </div>
                    <p className="text-sm text-foreground">{alertItem.message}</p>
                    {alertItem.recommended_action && (
                      <p className="mt-2 text-xs text-muted-foreground">Recommended action: {alertItem.recommended_action}</p>
                    )}
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox
                          checked={false}
                          disabled={acknowledgeMutation.isPending}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              acknowledgeMutation.mutate(alertItem.id);
                            }
                          }}
                        />
                        Mark handled
                      </label>
                      {alertItem.occurrence_count && alertItem.occurrence_count > 1 && (
                        <Badge variant="outline">Repeated {alertItem.occurrence_count}x</Badge>
                      )}
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span className="capitalize">{alertItem.type.replace(/_/g, " ")}</span>
                      <span>{formatDate(alertItem.created_at)}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/95 shadow-card">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="font-display text-lg">Emergency Logs</CardTitle>
                <Badge variant={emergencies.length > 0 ? "destructive" : "outline"}>{emergencies.length} total</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                {emergencies.length === 0 && (
                  <p className="text-sm text-muted-foreground">No emergency logs have been created yet.</p>
                )}
                {emergencies.slice(0, 5).map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-border/60 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{entry.patient_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {entry.email || "No email attached"} {entry.assigned_doctor_name ? `· ${entry.assigned_doctor_name}` : ""}
                        </p>
                      </div>
                      <Badge variant={entry.status === "open" ? "destructive" : "secondary"}>{entry.status}</Badge>
                    </div>
                    <p className="text-sm text-foreground">{entry.message}</p>
                    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>Severity: {entry.severity}</span>
                      <span>{formatDate(entry.created_at)}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/95 shadow-card">
              <CardHeader>
                <CardTitle className="font-display text-lg">Operational Pulse</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                {[
                  { label: "Total Users", value: stats?.totalUsers ?? 0 },
                  { label: "Tracked Emergencies", value: stats?.totalEmergencies ?? 0 },
                  { label: "Patients On Platform", value: stats?.totalPatients ?? 0 },
                  { label: "Open Alerts", value: stats?.openAlerts ?? 0 },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl bg-muted/50 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                    <div className="mt-2 flex items-center gap-3">
                      <Activity className="h-4 w-4 text-primary" />
                      <p className="font-display text-2xl font-bold text-foreground">{item.value}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
