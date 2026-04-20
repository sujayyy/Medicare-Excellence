import { useState } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, BellRing, CalendarClock, Copy, Download, FileText, HeartPulse, MessagesSquare, Users } from "lucide-react";

import DashboardLayout from "@/components/DashboardLayout";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { acknowledgeAlert, ApiError, downloadDocumentFile, getAnalyticsOverview, getAppointments, getDocuments, getEmergencies, getPatients, getStats, getVitals, sendCareOutreach, updateAppointment, updateCareCoordination } from "@/lib/api";
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

function getSafetyBadgeVariant(level?: string) {
  const normalized = (level || "").toLowerCase();
  if (normalized === "critical" || normalized === "high") {
    return "destructive" as const;
  }
  if (normalized === "medium") {
    return "secondary" as const;
  }
  return "outline" as const;
}

function getWorkflowBadgeVariant(status?: string) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "escalated") {
    return "destructive" as const;
  }
  if (normalized === "acknowledged" || normalized === "monitoring") {
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
    .filter((patient) => {
      const status = (patient.status || "").toLowerCase();
      return (
        (patient.appointment_risk_score ?? 0) >= 35 ||
        status.includes("appointment") ||
        (patient.followup_priority && patient.followup_priority !== "Routine follow-up")
      );
    })
    .sort(
      (left, right) =>
        (right.appointment_risk_score ?? 0) - (left.appointment_risk_score ?? 0) ||
        (right.triage_score ?? 0) - (left.triage_score ?? 0),
    )
    .slice(0, 5);
}

function getHospitalOperationalBrief({
  immediateReviews,
  openEmergencies,
  urgentCoordinatorTasks,
  appointmentRequests,
}: {
  immediateReviews: number;
  openEmergencies: number;
  urgentCoordinatorTasks: number;
  appointmentRequests: number;
}) {
  if (openEmergencies > 0 || immediateReviews > 0) {
    return `Hospital command should focus first on ${openEmergencies} open emergenc${openEmergencies === 1 ? "y" : "ies"} and ${immediateReviews} immediate AI review case${immediateReviews === 1 ? "" : "s"}.`;
  }

  if (urgentCoordinatorTasks > 0) {
    return `${urgentCoordinatorTasks} urgent coordinator task${urgentCoordinatorTasks === 1 ? "" : "s"} need outreach or escalation follow-through today.`;
  }

  if (appointmentRequests > 0) {
    return `${appointmentRequests} appointment request${appointmentRequests === 1 ? "" : "s"} are active and should be routed to the right clinician queue.`;
  }

  return "No urgent hospital-wide blockers are active right now. This is a good window to review throughput, discharge follow-up, and staffing readiness.";
}

export default function HospitalAdminDashboard() {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [safetyWorkflowNotes, setSafetyWorkflowNotes] = useState<Record<string, string>>({});
  const [careCoordinatorNotes, setCareCoordinatorNotes] = useState<Record<string, string>>({});

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

  const appointmentsQuery = useQuery({
    queryKey: ["hospital-admin-appointments"],
    queryFn: () => getAppointments(token || ""),
    enabled: Boolean(token),
  });

  const overviewQuery = useQuery({
    queryKey: ["hospital-admin-analytics-overview"],
    queryFn: () => getAnalyticsOverview(token || ""),
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

  const updateAppointmentMutation = useMutation({
    mutationFn: ({ appointmentId, payload }: { appointmentId: string; payload: any }) =>
      updateAppointment(token || "", appointmentId, payload),
    onSuccess: async () => {
      await Promise.all([appointmentsQuery.refetch(), overviewQuery.refetch()]);
      toast({
        title: "Safety workflow updated",
        description: "The hospital review workflow was updated successfully.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Unable to update workflow",
        description: error instanceof ApiError ? error.message : "Please try again.",
      });
    },
  });

  const updateCareCoordinatorMutation = useMutation({
    mutationFn: ({ patientId, status, note }: { patientId: string; status: string; note?: string }) =>
      updateCareCoordination(token || "", patientId, { status, note }),
    onSuccess: async () => {
      await Promise.all([patientsQuery.refetch(), overviewQuery.refetch()]);
      toast({
        title: "Care coordinator task updated",
        description: "The outreach workflow was updated successfully.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Unable to update coordinator task",
        description: error instanceof ApiError ? error.message : "Please try again.",
      });
    },
  });

  const sendCareOutreachMutation = useMutation({
    mutationFn: ({ patientId, channel, note }: { patientId: string; channel: "email" | "whatsapp" | "phone"; note?: string }) =>
      sendCareOutreach(token || "", patientId, { channel, note }),
    onSuccess: async (result) => {
      await Promise.all([patientsQuery.refetch(), overviewQuery.refetch()]);
      if (result.attempt?.preview_url) {
        window.open(result.attempt.preview_url, "_blank", "noopener,noreferrer");
      }
      toast({
        title: "Outreach logged",
        description: `The ${result.attempt.channel} reminder was recorded with status ${result.attempt.status}.`,
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Unable to send outreach",
        description: error instanceof ApiError ? error.message : "Please try again.",
      });
    },
  });

  const error = statsQuery.error || patientsQuery.error || emergenciesQuery.error || alertsQuery.error || overviewQuery.error;
  const stats = statsQuery.data;
  const patients = patientsQuery.data?.patients || [];
  const emergencies = emergenciesQuery.data?.emergencies || [];
  const documents = documentsQuery.data?.documents || [];
  const vitals = vitalsQuery.data?.vitals || [];
  const appointments = appointmentsQuery.data?.appointments || [];
  const overview = overviewQuery.data;
  const summaryPatients = getSummaryPatients(patients);
  const prioritySchedulingPatients = getPrioritySchedulingPatients(patients);
  const predictionWatchlist = overview?.prediction_watchlist || [];
  const outbreakClusters = overview?.outbreak_clusters || [];
  const reviewQueueSummary = overview?.review_queue_summary;
  const clinicalSafetyWatch = overview?.clinical_safety_watch || [];
  const clinicalSafetySummary = overview?.clinical_safety_summary;
  const earlyWarningSummary = overview?.early_warning_summary;
  const earlyWarningWatchlist = overview?.early_warning_watchlist || [];
  const readmissionRiskSummary = overview?.readmission_risk_summary;
  const readmissionWatchlist = overview?.readmission_watchlist || [];
  const followupDropoutSummary = overview?.followup_dropout_summary;
  const followupDropoutWatchlist = overview?.followup_dropout_watchlist || [];
  const careCoordinatorSummary = overview?.care_coordinator_summary;
  const careCoordinatorQueue = overview?.care_coordinator_queue || [];
  const executiveSummary = overview?.executive_summary;
  const doctorWorkload = overview?.doctor_workload || [];
  const specialtyDemand = overview?.specialty_demand || [];
  const urgentCoordinatorTasks = careCoordinatorQueue.filter((task) => ["Critical", "High"].includes(task.priority)).length;
  const hospitalOperationalBrief = getHospitalOperationalBrief({
    immediateReviews: reviewQueueSummary?.immediate ?? 0,
    openEmergencies: stats?.openEmergencies ?? 0,
    urgentCoordinatorTasks,
    appointmentRequests: stats?.appointmentRequests ?? 0,
  });
  const doctorPerformance = Object.values(
    appointments.reduce<Record<string, { doctor: string; total: number; completed: number }>>((accumulator, appointment) => {
      const key = appointment.assigned_doctor_id || appointment.assigned_doctor_name || "unassigned";
      if (!accumulator[key]) {
        accumulator[key] = {
          doctor: appointment.assigned_doctor_name || "Unassigned",
          total: 0,
          completed: 0,
        };
      }
      accumulator[key].total += 1;
      if ((appointment.status || "").toLowerCase() === "completed") {
        accumulator[key].completed += 1;
      }
      return accumulator;
    }, {}),
  );
  const fadeUp = {
    hidden: { opacity: 0, y: 18 },
    visible: (index: number) => ({
      opacity: 1,
      y: 0,
      transition: { delay: index * 0.06, duration: 0.35, ease: "easeOut" as const },
    }),
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

  const updateSafetyWorkflow = (appointmentId?: string | null, workflowStatus?: string, existingNote?: string) => {
    if (!appointmentId || !workflowStatus) {
      return;
    }

    updateAppointmentMutation.mutate({
      appointmentId,
      payload: {
        safety_workflow_status: workflowStatus,
        safety_workflow_note: safetyWorkflowNotes[appointmentId] ?? existingNote ?? "",
      },
    });
  };

  return (
    <DashboardLayout>
      <motion.div initial="hidden" animate="visible" className="space-y-6">
        <motion.div variants={fadeUp} custom={0} className="dashboard-hero rounded-[2rem] px-6 py-6 sm:px-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground shadow-sm">
                <Activity className="h-3.5 w-3.5 text-primary" />
                Hospital Operations
              </div>
              <h1 className="mt-4 font-display text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-[2.35rem]">
                Hospital Command Center
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                A focused view of urgent cases, bookings, and follow-up activity for {user?.name}.
              </p>
              <p className="mt-3 max-w-2xl rounded-2xl border border-white/80 bg-white/65 px-4 py-3 text-sm text-foreground shadow-sm">
                {hospitalOperationalBrief}
              </p>
            </div>
            <Badge variant="secondary">Hospital Admin Access</Badge>
          </div>
        </motion.div>

        {error && (
          <Alert variant="destructive" className="cinematic-alert">
            <AlertDescription>
              {error instanceof ApiError ? error.message : "Unable to load the hospital dashboard right now."}
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

        <motion.div variants={fadeUp} custom={1} className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {[
            { label: "Total Patients", value: stats?.totalPatients ?? 0, icon: Users },
            { label: "Open Emergencies", value: stats?.openEmergencies ?? 0, icon: AlertTriangle },
            { label: "Open Alerts", value: stats?.openAlerts ?? alerts.filter((entry) => entry.status === "open").length, icon: BellRing },
            { label: "Active Chats", value: stats?.activeChats ?? 0, icon: MessagesSquare },
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
              <div>
                <CardTitle className="font-display text-lg">Executive Operations View</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Track consultation throughput, slot utilization, and where specialty demand is building across the hospital.</p>
              </div>
              <Badge variant="outline">{executiveSummary?.total_doctors ?? 0} doctors</Badge>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {[
                  { label: "Scheduled Consultations", value: executiveSummary?.scheduled_consultations ?? 0, icon: CalendarClock },
                  { label: "Completed Today", value: executiveSummary?.completed_today ?? 0, icon: Activity },
                  { label: "Slot Utilization", value: `${executiveSummary?.slot_utilization ?? 0}%`, icon: HeartPulse },
                  { label: "Open Capacity", value: executiveSummary?.available_capacity ?? 0, icon: Users },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl bg-muted/40 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                        <p className="mt-2 font-display text-2xl font-semibold text-foreground">{item.value}</p>
                      </div>
                      <item.icon className="h-5 w-5 text-primary" />
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
                <div className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="font-medium text-foreground">Doctor workload</p>
                    <Badge variant="outline">{doctorWorkload.length} clinicians</Badge>
                  </div>
                  <div className="space-y-3">
                    {doctorWorkload.slice(0, 6).map((entry) => (
                      <div key={entry.doctor_id} className="rounded-xl bg-muted/30 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-medium text-foreground">{entry.doctor_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatLabel(entry.specialty)} {entry.doctor_code ? `· ${entry.doctor_code}` : ""}
                            </p>
                          </div>
                          <Badge variant={entry.open_requests > 0 ? "secondary" : "outline"}>{entry.open_requests} pending</Badge>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {entry.booked_appointments} booked · {entry.in_consultation} in consultation · {entry.completed_today} completed today · {entry.upcoming_slots} live slots
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="font-medium text-foreground">Specialty demand</p>
                    <Badge variant="outline">{specialtyDemand.length} specialties</Badge>
                  </div>
                  <div className="space-y-3">
                    {specialtyDemand.length === 0 && (
                      <p className="text-sm text-muted-foreground">Specialty demand will appear here once appointment requests build up.</p>
                    )}
                    {specialtyDemand.map((entry) => (
                      <div key={entry.specialty} className="rounded-xl bg-muted/30 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-foreground">{formatLabel(entry.specialty)}</p>
                          <Badge variant="outline">{entry.count}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={fadeUp} custom={3} className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="premium-section shadow-card">
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Immediate attention</p>
                    <p className="mt-2 font-display text-3xl font-semibold text-foreground">
                      {(reviewQueueSummary?.immediate ?? 0) + (stats?.openEmergencies ?? 0)}
                    </p>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent">
                    <AlertTriangle className="h-5 w-5 text-primary" />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {stats?.openEmergencies ?? 0} emergency case{(stats?.openEmergencies ?? 0) === 1 ? "" : "s"} and {reviewQueueSummary?.immediate ?? 0} patient review{(reviewQueueSummary?.immediate ?? 0) === 1 ? "" : "s"} are waiting.
                </p>
              </CardContent>
            </Card>

            <Card className="premium-section shadow-card">
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Follow-up workload</p>
                    <p className="mt-2 font-display text-3xl font-semibold text-foreground">{careCoordinatorQueue.length}</p>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent">
                    <BellRing className="h-5 w-5 text-primary" />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {urgentCoordinatorTasks} urgent outreach task{urgentCoordinatorTasks === 1 ? "" : "s"} and {((followupDropoutSummary?.high ?? 0) + (followupDropoutSummary?.critical ?? 0))} higher-risk follow-up case{((followupDropoutSummary?.high ?? 0) + (followupDropoutSummary?.critical ?? 0)) === 1 ? "" : "s"} need coordination.
                </p>
              </CardContent>
            </Card>

            <Card className="premium-section shadow-card">
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Bookings and capacity</p>
                    <p className="mt-2 font-display text-3xl font-semibold text-foreground">{stats?.appointmentRequests ?? 0}</p>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent">
                    <CalendarClock className="h-5 w-5 text-primary" />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {prioritySchedulingPatients.length} patient{prioritySchedulingPatients.length === 1 ? "" : "s"} currently need faster scheduling review or clearer routing.
                </p>
              </CardContent>
            </Card>
          </div>

          <Accordion type="multiple" className="rounded-[1.75rem] border border-white/70 bg-card/80 px-5 shadow-card backdrop-blur">
            <AccordionItem value="operations">
              <AccordionTrigger className="text-sm font-medium text-foreground">Operations and safety details</AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="grid gap-6 xl:grid-cols-4">
          <Card className="premium-section shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Priority Review Queue</CardTitle>
              <Badge variant="outline">Review timing</Badge>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Immediate", value: reviewQueueSummary?.immediate ?? 0 },
                { label: "6 Hours", value: reviewQueueSummary?.within_6_hours ?? 0 },
                { label: "24 Hours", value: reviewQueueSummary?.within_24_hours ?? 0 },
                { label: "Routine", value: reviewQueueSummary?.routine ?? 0 },
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

          <Card className="premium-section shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Population Trend Signals</CardTitle>
              <Badge variant={outbreakClusters.length > 0 ? "secondary" : "outline"}>{outbreakClusters.length} clusters</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {outbreakClusters.length === 0 && (
                <p className="text-sm text-muted-foreground">No outbreak-style symptom cluster is currently above the recent baseline.</p>
              )}
              {outbreakClusters.slice(0, 3).map((cluster) => (
                <div key={cluster.cluster} className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{cluster.cluster}</p>
                      <p className="text-xs text-muted-foreground">
                        {cluster.top_symptoms?.length ? `Top symptoms: ${cluster.top_symptoms.join(", ")}` : "Cluster activity detected"}
                      </p>
                    </div>
                    <Badge variant={cluster.severity === "high" ? "destructive" : "secondary"}>{cluster.severity}</Badge>
                  </div>
                  <p className="text-sm text-foreground">{cluster.summary}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Recent: {cluster.recent_count} · Baseline/day: {cluster.baseline_daily_avg} · Score: {cluster.anomaly_score}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="premium-section shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Safety Review</CardTitle>
              <Badge variant={clinicalSafetyWatch.length > 0 ? "secondary" : "outline"}>{clinicalSafetyWatch.length} patients</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: "Critical", value: clinicalSafetySummary?.critical ?? 0 },
                  { label: "High", value: clinicalSafetySummary?.high ?? 0 },
                  { label: "Medium", value: clinicalSafetySummary?.medium ?? 0 },
                  { label: "Low", value: clinicalSafetySummary?.low ?? 0 },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl bg-muted/50 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                    <div className="mt-2 flex items-center gap-3">
                      <AlertTriangle className="h-4 w-4 text-primary" />
                      <p className="font-display text-2xl font-bold text-foreground">{item.value}</p>
                    </div>
                  </div>
                ))}
              </div>
              {clinicalSafetyWatch.length === 0 && (
                <p className="text-sm text-muted-foreground">No hospital-wide clinical safety conflicts are active right now.</p>
              )}
              {clinicalSafetyWatch.slice(0, 2).map((entry) => (
                <div key={`admin-safety-${entry.id || entry.email}`} className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{entry.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.assigned_doctor_name || "Unassigned"} {entry.email ? `· ${entry.email}` : ""}
                      </p>
                    </div>
                    <Badge variant={getSafetyBadgeVariant(entry.clinical_alert_level)}>{entry.clinical_alert_level}</Badge>
                  </div>
                  <p className="text-sm text-foreground">{entry.safety_recommendation}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge variant={getWorkflowBadgeVariant(entry.safety_workflow?.status)}>
                      Workflow: {entry.safety_workflow?.status ? entry.safety_workflow.status.replace(/_/g, " ") : "open"}
                    </Badge>
                    {entry.safety_workflow?.updated_by && (
                      <span className="text-xs text-muted-foreground">
                        Last updated by {entry.safety_workflow.updated_by}
                      </span>
                    )}
                  </div>
                  {entry.appointment_id && (
                    <>
                      <Textarea
                        className="mt-3"
                        value={safetyWorkflowNotes[entry.appointment_id] ?? entry.safety_workflow?.note ?? ""}
                        onChange={(event) =>
                          setSafetyWorkflowNotes((current) => ({
                            ...current,
                            [entry.appointment_id as string]: event.target.value,
                          }))
                        }
                        placeholder="Add hospital review note, escalation reason, or closure comment."
                        rows={2}
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => updateSafetyWorkflow(entry.appointment_id, "acknowledged", entry.safety_workflow?.note)}>
                          Acknowledge
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => updateSafetyWorkflow(entry.appointment_id, "monitoring", entry.safety_workflow?.note)}>
                          Monitor
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => updateSafetyWorkflow(entry.appointment_id, "resolved", entry.safety_workflow?.note)}>
                          Resolve
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="premium-section shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Urgency Watch</CardTitle>
              <Badge variant={earlyWarningWatchlist.length > 0 ? "secondary" : "outline"}>{earlyWarningWatchlist.length} patients</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: "Critical", value: earlyWarningSummary?.critical ?? 0 },
                  { label: "High", value: earlyWarningSummary?.high ?? 0 },
                  { label: "Medium", value: earlyWarningSummary?.medium ?? 0 },
                  { label: "Low", value: earlyWarningSummary?.low ?? 0 },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl bg-muted/50 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                    <div className="mt-2 flex items-center gap-3">
                      <HeartPulse className="h-4 w-4 text-primary" />
                      <p className="font-display text-2xl font-bold text-foreground">{item.value}</p>
                    </div>
                  </div>
                ))}
              </div>
              {earlyWarningWatchlist.length === 0 && (
                <p className="text-sm text-muted-foreground">No hospital patient currently has an elevated early-warning score.</p>
              )}
              {earlyWarningWatchlist.slice(0, 2).map((entry) => (
                <div key={`admin-ew-${entry.id || entry.email}`} className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{entry.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.assigned_doctor_name || "Unassigned"} {entry.email ? `· ${entry.email}` : ""}
                      </p>
                    </div>
                    <Badge variant={getRiskBadgeVariant(entry.early_warning_priority)}>
                      {entry.early_warning_priority} · {entry.early_warning_score}/12
                    </Badge>
                  </div>
                  <p className="text-sm text-foreground">{entry.early_warning_summary}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {entry.early_warning_response} · {entry.early_warning_monitoring_window}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="followup">
              <AccordionTrigger className="text-sm font-medium text-foreground">Recovery and follow-up details</AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="grid gap-6 xl:grid-cols-3">
          <Card className="premium-section shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Return Risk Watch</CardTitle>
              <Badge variant={readmissionWatchlist.length > 0 ? "secondary" : "outline"}>{readmissionWatchlist.length} patients</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: "Critical", value: readmissionRiskSummary?.critical ?? 0 },
                  { label: "High", value: readmissionRiskSummary?.high ?? 0 },
                  { label: "Medium", value: readmissionRiskSummary?.medium ?? 0 },
                  { label: "Low", value: readmissionRiskSummary?.low ?? 0 },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl bg-muted/50 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                    <div className="mt-2 flex items-center gap-3">
                      <Activity className="h-4 w-4 text-primary" />
                      <p className="font-display text-2xl font-bold text-foreground">{item.value}</p>
                    </div>
                  </div>
                ))}
              </div>
              {readmissionWatchlist.length === 0 && (
                <p className="text-sm text-muted-foreground">No hospital patient currently has elevated relapse or readmission risk.</p>
              )}
              {readmissionWatchlist.slice(0, 2).map((entry) => (
                <div key={`admin-readmission-${entry.id || entry.email}`} className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{entry.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.assigned_doctor_name || "Unassigned"} {entry.email ? `· ${entry.email}` : ""}
                      </p>
                    </div>
                    <Badge variant={getRiskBadgeVariant(entry.readmission_risk_label)}>
                      {entry.readmission_risk_label} · {entry.readmission_risk_score}/100
                    </Badge>
                  </div>
                  <p className="text-sm text-foreground">{entry.readmission_risk_summary}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Review window: {entry.relapse_risk_window}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="premium-section shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Follow-up Reliability</CardTitle>
              <Badge variant={followupDropoutWatchlist.length > 0 ? "secondary" : "outline"}>{followupDropoutWatchlist.length} patients</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: "Critical", value: followupDropoutSummary?.critical ?? 0 },
                  { label: "High", value: followupDropoutSummary?.high ?? 0 },
                  { label: "Medium", value: followupDropoutSummary?.medium ?? 0 },
                  { label: "Low", value: followupDropoutSummary?.low ?? 0 },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl bg-muted/50 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                    <div className="mt-2 flex items-center gap-3">
                      <CalendarClock className="h-4 w-4 text-primary" />
                      <p className="font-display text-2xl font-bold text-foreground">{item.value}</p>
                    </div>
                  </div>
                ))}
              </div>
              {followupDropoutWatchlist.length === 0 && (
                <p className="text-sm text-muted-foreground">No hospital patient currently shows elevated risk of dropping out before the next review.</p>
              )}
              {followupDropoutWatchlist.slice(0, 2).map((entry) => (
                <div key={`admin-followup-${entry.id || entry.email}`} className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{entry.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.assigned_doctor_name || "Unassigned"} {entry.email ? `· ${entry.email}` : ""}
                      </p>
                    </div>
                    <Badge variant={getRiskBadgeVariant(entry.followup_dropout_risk_label)}>
                      {entry.followup_dropout_risk_label} · {entry.followup_dropout_risk_score}/100
                    </Badge>
                  </div>
                  <p className="text-sm text-foreground">{entry.followup_dropout_risk_summary}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Outreach: {entry.followup_outreach_window}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="premium-section shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Care Outreach Queue</CardTitle>
              <Badge variant={careCoordinatorQueue.length > 0 ? "secondary" : "outline"}>{careCoordinatorQueue.length} tasks</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                This queue turns prediction signals into real outreach work so no patient is left without a response path.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: "Critical", value: careCoordinatorSummary?.critical ?? 0 },
                  { label: "High", value: careCoordinatorSummary?.high ?? 0 },
                  { label: "Medium", value: careCoordinatorSummary?.medium ?? 0 },
                  { label: "Low", value: careCoordinatorSummary?.low ?? 0 },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl bg-muted/50 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                    <div className="mt-2 flex items-center gap-3">
                      <BellRing className="h-4 w-4 text-primary" />
                      <p className="font-display text-2xl font-bold text-foreground">{item.value}</p>
                    </div>
                  </div>
                ))}
              </div>
              {careCoordinatorQueue.length === 0 && (
                <p className="text-sm text-muted-foreground">No coordinator actions are pending right now. New dropout-risk, return-risk, or safety follow-ups will queue here automatically.</p>
              )}
              {careCoordinatorQueue.slice(0, 3).map((task) => (
                <div key={`coord-${task.patient_id || task.patient_email}-${task.task_type}`} className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{task.patient_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {task.assigned_doctor_name || "Unassigned"} {task.patient_email ? `· ${task.patient_email}` : ""}
                      </p>
                    </div>
                    <Badge variant={getRiskBadgeVariant(task.priority)}>
                      {task.priority} · {task.score}/100
                    </Badge>
                  </div>
                  <p className="text-sm text-foreground">{task.summary}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Action: {formatLabel(task.task_type)} · {task.outreach_window}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{task.suggested_action}</p>
                  {task.patient_id && (
                    <>
                      <Textarea
                        className="mt-3"
                        value={careCoordinatorNotes[task.patient_id] ?? task.workflow?.note ?? ""}
                        onChange={(event) =>
                          setCareCoordinatorNotes((current) => ({
                            ...current,
                            [task.patient_id as string]: event.target.value,
                          }))
                        }
                        placeholder="Add outreach note, response update, or escalation reason."
                        rows={2}
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            sendCareOutreachMutation.mutate({
                              patientId: task.patient_id as string,
                              channel: "email",
                              note: careCoordinatorNotes[task.patient_id as string] ?? task.workflow?.note ?? "",
                            })
                          }
                        >
                          Email
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            sendCareOutreachMutation.mutate({
                              patientId: task.patient_id as string,
                              channel: "whatsapp",
                              note: careCoordinatorNotes[task.patient_id as string] ?? task.workflow?.note ?? "",
                            })
                          }
                        >
                          WhatsApp
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            sendCareOutreachMutation.mutate({
                              patientId: task.patient_id as string,
                              channel: "phone",
                              note: careCoordinatorNotes[task.patient_id as string] ?? task.workflow?.note ?? "",
                            })
                          }
                        >
                          Log Call
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateCareCoordinatorMutation.mutate({
                              patientId: task.patient_id as string,
                              status: "contacted",
                              note: careCoordinatorNotes[task.patient_id as string] ?? task.workflow?.note ?? "",
                            })
                          }
                        >
                          Contacted
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateCareCoordinatorMutation.mutate({
                              patientId: task.patient_id as string,
                              status: "no_response",
                              note: careCoordinatorNotes[task.patient_id as string] ?? task.workflow?.note ?? "",
                            })
                          }
                        >
                          No Response
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateCareCoordinatorMutation.mutate({
                              patientId: task.patient_id as string,
                              status: "rescheduled",
                              note: careCoordinatorNotes[task.patient_id as string] ?? task.workflow?.note ?? "",
                            })
                          }
                        >
                          Rescheduled
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateCareCoordinatorMutation.mutate({
                              patientId: task.patient_id as string,
                              status: "escalated",
                              note: careCoordinatorNotes[task.patient_id as string] ?? task.workflow?.note ?? "",
                            })
                          }
                        >
                          Escalate
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateCareCoordinatorMutation.mutate({
                              patientId: task.patient_id as string,
                              status: "resolved",
                              note: careCoordinatorNotes[task.patient_id as string] ?? task.workflow?.note ?? "",
                            })
                          }
                        >
                          Resolve
                        </Button>
                      </div>
                      {task.workflow && (
                        <div className="mt-3 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Badge variant={getRiskBadgeVariant(formatLabel(task.workflow.status))}>
                              {formatLabel(task.workflow.status)}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground">
                              {task.workflow.updated_at ? formatDate(task.workflow.updated_at) : "No update yet"}
                            </span>
                          </div>
                          {(task.workflow.history || []).slice(0, 2).map((entry, index) => (
                            <div key={`${task.patient_id}-coord-history-${index}`} className="rounded-lg border border-border/60 px-3 py-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <Badge variant="outline">{formatLabel(entry.status)}</Badge>
                                <span className="text-[11px] text-muted-foreground">{formatDate(entry.created_at)}</span>
                              </div>
                              <p className="mt-2 text-sm text-foreground">{entry.note || "No note added."}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {(task.outreach_history || []).length > 0 && (
                        <div className="mt-3 space-y-2">
                          {(task.outreach_history || []).slice(0, 2).map((entry, index) => (
                            <div key={`${task.patient_id}-outreach-${index}`} className="rounded-lg border border-border/60 px-3 py-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <Badge variant="outline">{formatLabel(entry.channel)}</Badge>
                                <span className="text-[11px] text-muted-foreground">{formatDate(entry.created_at)}</span>
                              </div>
                              <p className="mt-2 text-sm text-foreground">
                                {entry.status} {entry.target ? `· ${entry.target}` : ""}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </motion.div>

        <motion.div variants={fadeUp} custom={3} className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="premium-section shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Hospital Appointment Flow</CardTitle>
              <Badge variant="outline">{appointments.length} total bookings</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {appointments.length === 0 && (
                <p className="text-sm text-muted-foreground">Doctor-linked appointments will appear here once patients start booking them.</p>
              )}
              {appointments.slice(0, 6).map((appointment: AppointmentRecord) => (
                <div key={appointment.id} className="rounded-2xl border border-border/60 p-4">
                  {(() => {
                    const linkedVitals = vitals.filter((entry) => entry.appointment_id === appointment.id);
                    const linkedDocuments = documents.filter((entry) => entry.appointment_id === appointment.id);
                    return (
                      <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{appointment.patient_name || "Patient"} · {appointment.assigned_doctor_name || "Unassigned"}</p>
                      <p className="text-sm text-muted-foreground">
                        {(appointment.assigned_doctor_specialty || "general_medicine").replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase())}
                        {appointment.assigned_doctor_code ? ` · ${appointment.assigned_doctor_code}` : ""}
                      </p>
                    </div>
                    <Badge variant="outline">{appointment.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-foreground">{appointment.reason || "No reason provided"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {appointment.appointment_date || "Date pending"} · {appointment.appointment_time || "Time pending"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Linked clinician records: {linkedVitals.length} vitals · {linkedDocuments.length} documents
                  </p>
                  {appointment.doctor_copilot?.clinical_safety && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Safety: {appointment.doctor_copilot.clinical_safety.clinical_alert_level} · {appointment.doctor_copilot.clinical_safety.safety_recommendation}
                    </p>
                  )}
                  {appointment.doctor_copilot?.clinical_safety?.medication_risk_level && appointment.doctor_copilot?.clinical_safety?.medication_risk_level !== "Low" && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Medication risk: {appointment.doctor_copilot.clinical_safety.medication_risk_level} · {appointment.doctor_copilot.clinical_safety.medication_risk_summary}
                    </p>
                  )}
                  {(appointment.diagnosis_summary || appointment.prescription_summary || appointment.vitals_summary) && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {appointment.diagnosis_summary || appointment.vitals_summary || appointment.prescription_summary}
                    </p>
                  )}
                      </>
                    );
                  })()}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="premium-section shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Doctor Performance Snapshot</CardTitle>
              <Badge variant="outline">{doctorPerformance.length} doctors</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {doctorPerformance.length === 0 && (
                <p className="text-sm text-muted-foreground">Doctor workload will appear here after appointments are created.</p>
              )}
              {doctorPerformance.map((entry) => (
                <div key={entry.doctor} className="rounded-2xl border border-border/60 p-4">
                  <p className="font-medium text-foreground">{entry.doctor}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {entry.total} booked patients · {entry.completed} completed consultations
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </motion.div>

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
                            Safety: {patient.clinical_alert_level || "Low"} · {patient.safety_recommendation || "Routine safety review"}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Scheduling: {patient.appointment_risk_label || "Pending"} {formatAppointmentRiskScore(patient.appointment_risk_score)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Prediction: {patient.deterioration_prediction_label || "Low"} {patient.deterioration_prediction_score ?? 0}/100
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Return risk: {patient.readmission_risk_label || "Low"} {patient.readmission_risk_score ?? 0}/100
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Dropout risk: {patient.followup_dropout_risk_label || "Low"} {patient.followup_dropout_risk_score ?? 0}/100
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
                <CardTitle className="font-display text-lg">Predicted Worsening Watchlist</CardTitle>
                <Badge variant={predictionWatchlist.length > 0 ? "secondary" : "outline"}>
                  {predictionWatchlist.length} patients
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                {predictionWatchlist.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Patients with the highest near-term deterioration risk will appear here.
                  </p>
                )}
                {predictionWatchlist.slice(0, 4).map((patient) => (
                  <div key={`watch-${patient.id || patient.email}`} className="rounded-2xl border border-border/60 p-4">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{patient.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {patient.assigned_doctor_name ? `${patient.assigned_doctor_name} · ` : ""}{patient.triage_label ? `Triage ${patient.triage_label}` : "Predicted review"}
                        </p>
                      </div>
                      <Badge variant={getRiskBadgeVariant(patient.deterioration_prediction_label)}>
                        {patient.deterioration_prediction_label || "Low"}
                      </Badge>
                    </div>
                    <p className="text-sm text-foreground">{patient.deterioration_prediction_reason || "No prediction summary yet."}</p>
                    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>
                        Follow-up: {patient.predicted_followup_window || "Routine 72-hour review"} · Score {patient.deterioration_prediction_score ?? 0}/100
                      </span>
                      <span>{patient.worsening_flag ? "Worsening" : patient.risk_trajectory || "Stable"}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

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
                    {document.document_type === "lab_report" && (
                      <div className="mt-3 rounded-xl bg-background/80 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Lab alert</p>
                          <Badge variant={getRiskBadgeVariant(document.lab_alert_level === "critical" ? "Critical" : document.lab_alert_level === "high" ? "High" : document.lab_alert_level === "medium" ? "Medium" : "Low")}>
                            {document.lab_alert_level || "low"}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm text-foreground">
                          {document.abnormal_value_count ? `${document.abnormal_value_count} abnormal value(s) detected.` : "No abnormal lab value count was strongly detected."}
                        </p>
                      </div>
                    )}
                    {document.document_type === "discharge_note" && (
                      <div className="mt-3 rounded-xl bg-background/80 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Discharge risk</p>
                          <Badge variant={getRiskBadgeVariant(document.discharge_risk_level === "high" ? "High" : document.discharge_risk_level === "medium" ? "Medium" : "Low")}>
                            {document.discharge_risk_level || "low"}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm text-foreground">
                          {document.discharge_risk_summary || "No high-risk discharge wording was auto-detected."}
                        </p>
                      </div>
                    )}
                    {(document.abnormal_findings?.length || 0) > 0 && (
                      <div className="mt-3 rounded-xl bg-destructive/5 p-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-destructive">Abnormal findings</p>
                        <p className="mt-2 text-sm text-foreground">{document.abnormal_findings?.slice(0, 2).join(" ")}</p>
                      </div>
                    )}
                    {(document.follow_up_recommendations?.length || 0) > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Follow-up: {document.follow_up_recommendations?.slice(0, 2).join(" ")}
                      </p>
                    )}
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
      </motion.div>
    </DashboardLayout>
  );
}
