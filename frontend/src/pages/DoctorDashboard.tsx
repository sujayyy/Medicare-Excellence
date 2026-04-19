import { useState } from "react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BellRing, CalendarClock, Copy, Download, FileText, HeartPulse, Stethoscope, Users } from "lucide-react";

import DashboardLayout from "@/components/DashboardLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/context/AuthContext";
import {
  acknowledgeAlert,
  ApiError,
  createVital,
  downloadDocumentFile,
  getAppointments,
  getDocuments,
  getEmergencies,
  getPatients,
  getStats,
  getVitals,
  updateAppointment,
  uploadDocument,
} from "@/lib/api";
import { useLiveAlertNotifications } from "@/hooks/useLiveAlertNotifications";
import { useToast } from "@/hooks/use-toast";
import type { AppointmentRecord, DocumentRecord, PatientRecord, VitalRecord } from "@/types/api";

function formatDate(value?: string) {
  if (!value) {
    return "N/A";
  }

  return format(new Date(value), "MMM d, yyyy h:mm a");
}

function formatLabel(value?: string) {
  if (!value) {
    return "";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
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

function isOperationalAppointmentOnly(patient: PatientRecord) {
  const status = (patient.status || "").toLowerCase();
  return status.includes("appointment") && (!patient.symptoms || patient.symptoms.length === 0) && (!patient.red_flags || patient.red_flags.length === 0);
}

function getSummaryPatients(patients: PatientRecord[]) {
  return [...patients]
    .filter((patient) => !isOperationalAppointmentOnly(patient))
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
    .slice(0, 4);
}

function getRecentVisitEntries(patients: PatientRecord[]) {
  return patients
    .flatMap((patient) =>
      (patient.visit_history || []).map((visit) => ({
        ...visit,
        patient_name: patient.name,
        patient_email: patient.email,
      })),
    )
    .sort((left, right) => (right.completed_at || "").localeCompare(left.completed_at || ""))
    .slice(0, 6);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read the selected file."));
    reader.readAsDataURL(file);
  });
}

type AppointmentWorkflowDraft = Partial<AppointmentRecord> & {
  vital_pulse?: string;
  vital_spo2?: string;
  vital_temperature?: string;
  vital_systolic_bp?: string;
  vital_diastolic_bp?: string;
  vital_glucose?: string;
  vital_notes?: string;
  document_title?: string;
  document_type?: string;
  document_notes?: string;
  document_content_text?: string;
};

export default function DoctorDashboard() {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [appointmentDrafts, setAppointmentDrafts] = useState<Record<string, AppointmentWorkflowDraft>>({});
  const [appointmentFiles, setAppointmentFiles] = useState<Record<string, File | null>>({});

  const statsQuery = useQuery({
    queryKey: ["doctor-stats"],
    queryFn: () => getStats(token || ""),
    enabled: Boolean(token),
  });

  const patientsQuery = useQuery({
    queryKey: ["doctor-patients"],
    queryFn: () => getPatients(token || ""),
    enabled: Boolean(token),
  });

  const emergenciesQuery = useQuery({
    queryKey: ["doctor-emergencies"],
    queryFn: () => getEmergencies(token || ""),
    enabled: Boolean(token),
  });

  const documentsQuery = useQuery({
    queryKey: ["doctor-documents"],
    queryFn: () => getDocuments(token || ""),
    enabled: Boolean(token),
  });

  const vitalsQuery = useQuery({
    queryKey: ["doctor-vitals"],
    queryFn: () => getVitals(token || ""),
    enabled: Boolean(token),
  });

  const appointmentsQuery = useQuery({
    queryKey: ["doctor-appointments"],
    queryFn: () => getAppointments(token || ""),
    enabled: Boolean(token),
  });

  const { alertsQuery, alerts, liveAlert } = useLiveAlertNotifications({
    token: token || "",
    queryKey: ["doctor-alerts"],
    audienceLabel: "Doctor alert",
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (alertId: string) => acknowledgeAlert(token || "", alertId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["doctor-alerts"] });
      void queryClient.invalidateQueries({ queryKey: ["doctor-stats"] });
      toast({
        title: "Alert marked handled",
        description: "The alert was resolved and removed from your active dashboard.",
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

  const updateAppointmentMutation = useMutation({
    mutationFn: ({ appointmentId, payload }: { appointmentId: string; payload: any }) => updateAppointment(token || "", appointmentId, payload),
    onSuccess: async () => {
      await appointmentsQuery.refetch();
      toast({
        title: "Appointment updated",
        description: "The appointment timeline is now updated for the doctor and hospital team.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Unable to update appointment",
        description: error instanceof ApiError ? error.message : "Please try again.",
      });
    },
  });

  const createVitalMutation = useMutation({
    mutationFn: ({ appointmentId, payload }: { appointmentId: string; payload: Parameters<typeof createVital>[1] }) =>
      createVital(token || "", payload),
    onSuccess: async (_, variables) => {
      await Promise.all([vitalsQuery.refetch(), appointmentsQuery.refetch()]);
      void queryClient.invalidateQueries({ queryKey: ["hospital-admin-vitals"] });
      setAppointmentDrafts((current) => ({
        ...current,
        [variables.appointmentId]: {
          ...current[variables.appointmentId],
          vital_pulse: "",
          vital_spo2: "",
          vital_temperature: "",
          vital_systolic_bp: "",
          vital_diastolic_bp: "",
          vital_glucose: "",
          vital_notes: "",
        },
      }));
      toast({
        title: "Consultation vitals saved",
        description: "This appointment now has a linked vitals record.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Unable to save vitals",
        description: error instanceof ApiError ? error.message : "Please try again.",
      });
    },
  });

  const createDocumentMutation = useMutation({
    mutationFn: ({ appointmentId, payload }: { appointmentId: string; payload: Parameters<typeof uploadDocument>[1] }) =>
      uploadDocument(token || "", payload),
    onSuccess: async (_, variables) => {
      await Promise.all([documentsQuery.refetch(), appointmentsQuery.refetch()]);
      void queryClient.invalidateQueries({ queryKey: ["hospital-admin-documents"] });
      setAppointmentFiles((current) => ({ ...current, [variables.appointmentId]: null }));
      setAppointmentDrafts((current) => ({
        ...current,
        [variables.appointmentId]: {
          ...current[variables.appointmentId],
          document_title: "",
          document_type: "prescription",
          document_notes: "",
          document_content_text: "",
        },
      }));
      toast({
        title: "Consultation record added",
        description: "The appointment now includes a linked clinician document.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Unable to add consultation document",
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
  const appointments = appointmentsQuery.data?.appointments || [];
  const summaryPatients = getSummaryPatients(patients);
  const prioritySchedulingPatients = getPrioritySchedulingPatients(patients);
  const recentVisitEntries = getRecentVisitEntries(patients);
  const fadeUp = {
    hidden: { opacity: 0, y: 18 },
    visible: (index: number) => ({
      opacity: 1,
      y: 0,
      transition: { delay: index * 0.06, duration: 0.35, ease: "easeOut" as const },
    }),
  };

  const setAppointmentDraft = (appointmentId: string, field: keyof AppointmentWorkflowDraft, value: string) => {
    setAppointmentDrafts((current) => ({
      ...current,
      [appointmentId]: {
        ...current[appointmentId],
        [field]: value,
      },
    }));
  };

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

  const saveAppointmentVitals = (appointmentId: string) => {
    const draft = appointmentDrafts[appointmentId] || {};
    const vitalPayload = {
      appointment_id: appointmentId,
      pulse: Number(draft.vital_pulse),
      spo2: Number(draft.vital_spo2),
      temperature: Number(draft.vital_temperature),
      systolic_bp: Number(draft.vital_systolic_bp),
      diastolic_bp: Number(draft.vital_diastolic_bp),
      glucose: Number(draft.vital_glucose),
      notes: String(draft.vital_notes || ""),
    };

    if (
      !vitalPayload.pulse ||
      !vitalPayload.spo2 ||
      !vitalPayload.temperature ||
      !vitalPayload.systolic_bp ||
      !vitalPayload.diastolic_bp ||
      !vitalPayload.glucose
    ) {
      toast({
        variant: "destructive",
        title: "Missing vitals",
        description: "Please fill in pulse, SpO2, temperature, blood pressure, and glucose before saving.",
      });
      return;
    }

    createVitalMutation.mutate({ appointmentId, payload: vitalPayload });
  };

  const saveAppointmentDocument = (appointmentId: string) => {
    const draft = appointmentDrafts[appointmentId] || {};
    const selectedFile = appointmentFiles[appointmentId];
    const title = String(draft.document_title || "").trim();
    const contentText = String(draft.document_content_text || "").trim();
    if (!title) {
      toast({
        variant: "destructive",
        title: "Document title required",
        description: "Add a short title like Prescription, Scan findings, or Consultation summary.",
      });
      return;
    }

    void (async () => {
      try {
        const fileDataUrl = selectedFile ? await readFileAsDataUrl(selectedFile) : "";
        createDocumentMutation.mutate({
          appointmentId,
          payload: {
            appointment_id: appointmentId,
            title,
            document_type: String(draft.document_type || "prescription"),
            notes: String(draft.document_notes || ""),
            file_name: selectedFile?.name,
            content_type: selectedFile?.type,
            file_size: selectedFile?.size,
            file_data_url: fileDataUrl,
            content_text: contentText,
          },
        });
      } catch {
        toast({
          variant: "destructive",
          title: "Unable to read file",
          description: "Please choose the file again and retry.",
        });
      }
    })();
  };

  const handleAppointmentFilePick = (appointmentId: string, file: File | null) => {
    setAppointmentFiles((current) => ({ ...current, [appointmentId]: file }));
    if (file) {
      setAppointmentDrafts((current) => ({
        ...current,
        [appointmentId]: {
          ...current[appointmentId],
          document_title: current[appointmentId]?.document_title || file.name.replace(/\.[^.]+$/, ""),
        },
      }));
    }
  };

  const handleDocumentDownload = async (document: DocumentRecord) => {
    if (!token) {
      return;
    }

    try {
      const fileBlob = await downloadDocumentFile(token, document.id);
      const downloadUrl = URL.createObjectURL(fileBlob);
      const link = window.document.createElement("a");
      link.href = downloadUrl;
      link.download = document.file_name || `${document.title}.bin`;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Unable to download file",
        description: error instanceof ApiError ? error.message : "Please try again.",
      });
    }
  };

  return (
    <DashboardLayout>
      <motion.div initial="hidden" animate="visible" className="space-y-6">
        <motion.div variants={fadeUp} custom={0} className="dashboard-hero rounded-[2rem] px-6 py-6 sm:px-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground shadow-sm">
                <Stethoscope className="h-3.5 w-3.5 text-primary" />
                Clinician Workspace
              </div>
              <h1 className="mt-4 font-display text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-[2.35rem]">
                Doctor Care Dashboard
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                Assigned patient updates, care alerts, and emergency escalations for Dr. {user?.name}.
              </p>
            </div>
            <Badge variant="secondary">Doctor Access</Badge>
          </div>
        </motion.div>

        {error && (
          <Alert variant="destructive" className="cinematic-alert">
            <AlertDescription>
              {error instanceof ApiError ? error.message : "Unable to load the doctor dashboard right now."}
            </AlertDescription>
          </Alert>
        )}

        {liveAlert && (
          <Alert className="cinematic-alert" variant={liveAlert.severity === "high" || liveAlert.severity === "critical" ? "destructive" : "default"}>
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

        <motion.div variants={fadeUp} custom={1} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Assigned Patients", value: stats?.totalPatients ?? 0, icon: Users },
            { label: "Open Alerts", value: stats?.openAlerts ?? alerts.filter((entry) => entry.status === "open").length, icon: BellRing },
            { label: "Open Emergencies", value: stats?.openEmergencies ?? 0, icon: AlertTriangle },
            { label: "Appointment Requests", value: stats?.appointmentRequests ?? 0, icon: CalendarClock },
          ].map((item) => (
            <Card key={item.label} className="metric-card metric-card-hover border-white/70 bg-card/95 shadow-card">
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
        </motion.div>

        <motion.div variants={fadeUp} custom={2}>
        <Card className="premium-section shadow-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-display text-lg">Doctor Appointment Queue</CardTitle>
            <Badge variant="outline">{appointments.length} bookings</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {appointments.length === 0 && (
              <p className="text-sm text-muted-foreground">Booked slots for this doctor will appear here once patients request them.</p>
            )}

            {appointments.map((appointment) => {
              const draft = appointmentDrafts[appointment.id] || {};
              const linkedVitals = vitals.filter((entry) => entry.appointment_id === appointment.id);
              const linkedDocuments = documents.filter((entry) => entry.appointment_id === appointment.id);
              return (
                <div key={appointment.id} className="rounded-2xl border border-border/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{appointment.patient_name || "Patient"}</p>
                      <p className="text-sm text-muted-foreground">
                        {appointment.patient_email || "No email"} {appointment.patient_phone ? `· ${appointment.patient_phone}` : ""}
                      </p>
                    </div>
                    <Badge variant={getAppointmentRiskBadgeVariant((appointment.status || "").toLowerCase() === "completed" ? "Low" : "Medium")}>
                      {appointment.status}
                    </Badge>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl bg-muted/40 p-3 text-sm">
                      <p><span className="font-medium text-foreground">Slot:</span> {appointment.appointment_date || "Date pending"} · {appointment.appointment_time || "Time pending"}</p>
                      <p className="mt-1"><span className="font-medium text-foreground">Reason:</span> {appointment.reason || "Not provided"}</p>
                      <p className="mt-1"><span className="font-medium text-foreground">Age:</span> {appointment.patient_age || "N/A"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Linked records: {linkedVitals.length} vitals · {linkedDocuments.length} documents
                      </p>
                    </div>
                    <div className="grid gap-2">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => updateAppointmentMutation.mutate({ appointmentId: appointment.id, payload: { status: "confirmed" } })}>
                          Confirm
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => updateAppointmentMutation.mutate({ appointmentId: appointment.id, payload: { status: "in_consultation" } })}>
                          Start consultation
                        </Button>
                        <Button size="sm" variant="hero" onClick={() => updateAppointmentMutation.mutate({ appointmentId: appointment.id, payload: { status: "completed", ...draft } })}>
                          Complete
                        </Button>
                      </div>
                      <Textarea
                        value={String(draft.diagnosis_summary || appointment.diagnosis_summary || "")}
                        onChange={(event) => setAppointmentDraft(appointment.id, "diagnosis_summary", event.target.value)}
                        placeholder="Diagnosis / findings"
                        rows={2}
                      />
                      <Textarea
                        value={String(draft.vitals_summary || appointment.vitals_summary || "")}
                        onChange={(event) => setAppointmentDraft(appointment.id, "vitals_summary", event.target.value)}
                        placeholder="Vitals / scan notes / exam observations"
                        rows={2}
                      />
                      <Textarea
                        value={String(draft.prescription_summary || appointment.prescription_summary || "")}
                        onChange={(event) => setAppointmentDraft(appointment.id, "prescription_summary", event.target.value)}
                        placeholder="Prescription / medication plan / follow-up"
                        rows={2}
                      />
                      <div className="rounded-2xl border border-border/60 bg-muted/30 p-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Consultation vitals</p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          <Input value={String(draft.vital_pulse || "")} onChange={(event) => setAppointmentDraft(appointment.id, "vital_pulse", event.target.value)} placeholder="Pulse" />
                          <Input value={String(draft.vital_spo2 || "")} onChange={(event) => setAppointmentDraft(appointment.id, "vital_spo2", event.target.value)} placeholder="SpO2" />
                          <Input value={String(draft.vital_temperature || "")} onChange={(event) => setAppointmentDraft(appointment.id, "vital_temperature", event.target.value)} placeholder="Temp" />
                          <Input value={String(draft.vital_systolic_bp || "")} onChange={(event) => setAppointmentDraft(appointment.id, "vital_systolic_bp", event.target.value)} placeholder="Systolic BP" />
                          <Input value={String(draft.vital_diastolic_bp || "")} onChange={(event) => setAppointmentDraft(appointment.id, "vital_diastolic_bp", event.target.value)} placeholder="Diastolic BP" />
                          <Input value={String(draft.vital_glucose || "")} onChange={(event) => setAppointmentDraft(appointment.id, "vital_glucose", event.target.value)} placeholder="Glucose" />
                        </div>
                        <Textarea
                          className="mt-2"
                          value={String(draft.vital_notes || "")}
                          onChange={(event) => setAppointmentDraft(appointment.id, "vital_notes", event.target.value)}
                          placeholder="Optional vital notes"
                          rows={2}
                        />
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <p className="text-xs text-muted-foreground">Save bedside vitals directly against this booked appointment.</p>
                          <Button size="sm" variant="outline" onClick={() => saveAppointmentVitals(appointment.id)} disabled={createVitalMutation.isPending}>
                            Save vitals
                          </Button>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-border/60 bg-muted/30 p-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Clinician records</p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-[1.1fr_0.9fr]">
                          <Input
                            value={String(draft.document_title || "")}
                            onChange={(event) => setAppointmentDraft(appointment.id, "document_title", event.target.value)}
                            placeholder="Prescription, scan findings, consultation note..."
                          />
                          <select
                            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                            value={String(draft.document_type || "prescription")}
                            onChange={(event) => setAppointmentDraft(appointment.id, "document_type", event.target.value)}
                          >
                            <option value="prescription">Prescription</option>
                            <option value="lab_report">Lab report</option>
                            <option value="discharge_note">Discharge note</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                        <Textarea
                          className="mt-2"
                          value={String(draft.document_notes || "")}
                          onChange={(event) => setAppointmentDraft(appointment.id, "document_notes", event.target.value)}
                          placeholder="Short clinician notes"
                          rows={2}
                        />
                        <Textarea
                          className="mt-2"
                          value={String(draft.document_content_text || "")}
                          onChange={(event) => setAppointmentDraft(appointment.id, "document_content_text", event.target.value)}
                          placeholder="Paste prescription text, scan findings, medication instructions, or exam summary"
                          rows={3}
                        />
                        <Input
                          className="mt-2"
                          type="file"
                          onChange={(event) => handleAppointmentFilePick(appointment.id, event.target.files?.[0] || null)}
                        />
                        {appointmentFiles[appointment.id] && (
                          <p className="mt-1 text-xs text-muted-foreground">Attached file: {appointmentFiles[appointment.id]?.name}</p>
                        )}
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <p className="text-xs text-muted-foreground">These records stay attached to the appointment for doctor and hospital review.</p>
                          <Button size="sm" variant="outline" onClick={() => saveAppointmentDocument(appointment.id)} disabled={createDocumentMutation.isPending}>
                            Add record
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
        </motion.div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-border/60 bg-card/95 shadow-elevated">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Assigned Patients</CardTitle>
              <Badge variant="outline">{patients.length} patients</Badge>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead>Symptoms</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Risk</TableHead>
                    <TableHead>Triage</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {patients.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        No patients are assigned yet.
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
                          <p className="font-medium text-foreground">{patient.triage_score ?? 0}/100</p>
                          <p className="text-xs text-muted-foreground">
                            {patient.recommended_action || patient.triage_reason || "No triage yet"}
                            {patient.risk_trajectory ? ` · Trend: ${patient.risk_trajectory}` : ""}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Previous visits: {patient.visit_history?.length || 0}
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
                    Patients who need quicker scheduling follow-up will appear here.
                  </p>
                )}
                {prioritySchedulingPatients.map((patient) => (
                  <div key={`schedule-${patient.id || patient.email}`} className="rounded-2xl border border-border/60 p-4">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{patient.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {patient.status} {patient.assigned_doctor_name ? `· ${patient.assigned_doctor_name}` : ""}
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
                <CardTitle className="font-display text-lg">Previous Visit History</CardTitle>
                <Badge variant="outline">{recentVisitEntries.length} records</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                {recentVisitEntries.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Completed consultation history will appear here and help you review returning patients faster.
                  </p>
                )}
                {recentVisitEntries.map((visit) => (
                  <div key={`${visit.patient_email}-${visit.appointment_id}`} className="rounded-2xl border border-border/60 p-4">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{visit.patient_name || "Patient"}</p>
                        <p className="text-xs text-muted-foreground">
                          {visit.visit_reason || visit.diagnosis_summary || "Consultation review"}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">{formatDate(visit.completed_at)}</span>
                    </div>
                    <p className="text-sm text-foreground">
                      {visit.follow_up_plan || visit.prescription_summary || visit.vitals_summary || visit.consultation_notes || "Visit details saved for care continuity."}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {visit.doctor_name || user?.name || "Doctor"} {visit.doctor_specialty ? `· ${formatLabel(visit.doctor_specialty)}` : ""}
                      {visit.doctor_code ? ` · ${visit.doctor_code}` : ""}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/95 shadow-card">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="font-display text-lg">Vitals Monitoring</CardTitle>
                <Badge variant="outline">{vitals.length} readings</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                {vitals.length === 0 && (
                  <p className="text-sm text-muted-foreground">Assigned patient vitals will appear here.</p>
                )}
                {vitals.slice(0, 4).map((vital: VitalRecord) => (
                  <div key={vital.id} className="rounded-2xl border border-border/60 p-4">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{vital.patient_name || "Patient"}</p>
                        <p className="text-xs text-muted-foreground">
                          Pulse {vital.pulse} · SpO2 {vital.spo2}% · BP {vital.systolic_bp}/{vital.diastolic_bp}
                        </p>
                      </div>
                      <Badge variant={vital.severity === "critical" || vital.severity === "high" ? "destructive" : vital.severity === "medium" ? "secondary" : "outline"}>
                        {vital.severity || "normal"}
                      </Badge>
                    </div>
                    <p className="text-sm text-foreground">{vital.summary || "No summary available."}</p>
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                      <HeartPulse className="h-3.5 w-3.5" />
                      Glucose {vital.glucose} · Temp {vital.temperature}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/95 shadow-card">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="font-display text-lg">Document Review Queue</CardTitle>
                <Badge variant="outline">{documents.length} documents</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                {documents.length === 0 && (
                  <p className="text-sm text-muted-foreground">Patient-uploaded documents assigned to you will appear here.</p>
                )}
                {documents.slice(0, 4).map((document: DocumentRecord) => (
                  <div key={document.id} className="rounded-2xl border border-border/60 p-4">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{document.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {document.patient_name || "Patient"} {document.file_name ? `· ${document.file_name}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {document.storage_key && (
                          <Button size="sm" variant="outline" onClick={() => void handleDocumentDownload(document)}>
                            <Download className="h-3.5 w-3.5" />
                            Open
                          </Button>
                        )}
                        <Badge variant={document.review_priority === "Urgent" ? "destructive" : document.review_priority === "Priority" ? "secondary" : "outline"}>
                          {document.review_priority || "Routine"}
                        </Badge>
                      </div>
                    </div>
                    <p className="text-sm text-foreground">{document.summary || "No summary available."}</p>
                    {document.document_type === "prescription" && (document.medication_schedule?.length || 0) > 0 && (
                      <div className="mt-3 space-y-2 rounded-xl bg-muted/50 p-3">
                        {(document.medication_schedule || []).slice(0, 3).map((entry) => (
                          <div key={`${document.id}-${entry.drug_name}`} className="text-xs text-foreground">
                            <span className="font-medium">{entry.drug_name}</span>
                            <span className="text-muted-foreground"> · {entry.dosage} · {entry.timing}</span>
                          </div>
                        ))}
                      </div>
                    )}
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
                <CardTitle className="font-display text-lg">AI Summary Board</CardTitle>
                <Badge variant="outline">{summaryPatients.length} patients</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                {summaryPatients.length === 0 && (
                  <p className="text-sm text-muted-foreground">Summaries will appear here as assigned patients chat or request care.</p>
                )}
                {summaryPatients.map((patient) => (
                  <div key={`summary-${patient.id || patient.email}`} className="rounded-2xl border border-border/60 p-4">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{patient.name}</p>
                        <p className="text-xs text-muted-foreground">{patient.email || "No email on file"}</p>
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
                <CardTitle className="font-display text-lg">Assigned Alerts</CardTitle>
                <Badge variant={alerts.length > 0 ? "destructive" : "outline"}>{alerts.length} total</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                {alerts.length === 0 && (
                  <p className="text-sm text-muted-foreground">No alerts are assigned to you right now.</p>
                )}
                {alerts.slice(0, 6).map((alertItem) => (
                  <div key={alertItem.id} className="rounded-2xl border border-border/60 p-4">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{alertItem.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {alertItem.patient_name || "Unknown patient"} {alertItem.patient_email ? `· ${alertItem.patient_email}` : ""}
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
                <CardTitle className="font-display text-lg">Emergency Queue</CardTitle>
                <Badge variant={emergencies.length > 0 ? "destructive" : "outline"}>{emergencies.length} total</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                {emergencies.length === 0 && (
                  <p className="text-sm text-muted-foreground">No emergency escalations are assigned to you right now.</p>
                )}
                {emergencies.slice(0, 5).map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-border/60 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{entry.patient_name}</p>
                        <p className="text-xs text-muted-foreground">{entry.email || "No email attached"}</p>
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
                <CardTitle className="font-display text-lg">Care Snapshot</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                {[
                  { label: "Active Chats", value: stats?.activeChats ?? 0 },
                  { label: "Tracked Emergencies", value: stats?.totalEmergencies ?? 0 },
                  { label: "Open Alerts", value: stats?.openAlerts ?? 0 },
                  { label: "Clinical Queue", value: patients.length + alerts.length },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl bg-muted/50 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                    <div className="mt-2 flex items-center gap-3">
                      <Stethoscope className="h-4 w-4 text-primary" />
                      <p className="font-display text-2xl font-bold text-foreground">{item.value}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </motion.div>
    </DashboardLayout>
  );
}
