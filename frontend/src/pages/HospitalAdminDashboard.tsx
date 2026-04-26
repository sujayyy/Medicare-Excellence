import { useMemo, useState } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, BellRing, CalendarClock, Download, HeartPulse, ShieldAlert, Stethoscope, Users } from "lucide-react";

import DashboardLayout from "@/components/DashboardLayout";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import {
  ApiError,
  downloadDocumentFile,
  getAccessRequests,
  getAnalyticsOverview,
  getAppointments,
  getDocuments,
  getEmergencies,
  getPatients,
  getStats,
  sendCareOutreach,
  updateCareCoordination,
} from "@/lib/api";
import { useLiveAlertNotifications } from "@/hooks/useLiveAlertNotifications";
import { useToast } from "@/hooks/use-toast";
import type { AppointmentRecord, DoctorAccessRequest, DocumentRecord, PatientRecord } from "@/types/api";

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

function compactList(values?: string[]) {
  return values && values.length > 0 ? values.join(", ") : "No issue summary yet";
}

function isOperationalAppointmentOnly(patient: PatientRecord) {
  const status = (patient.status || "").toLowerCase();
  return status.includes("appointment") && (!patient.symptoms || patient.symptoms.length === 0) && (!patient.red_flags || patient.red_flags.length === 0);
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
    return `Start with ${openEmergencies} open emergenc${openEmergencies === 1 ? "y" : "ies"} and ${immediateReviews} patient case${immediateReviews === 1 ? "" : "s"} waiting for faster review.`;
  }

  if (urgentCoordinatorTasks > 0) {
    return `${urgentCoordinatorTasks} follow-up task${urgentCoordinatorTasks === 1 ? "" : "s"} need outreach or escalation today.`;
  }

  if (appointmentRequests > 0) {
    return `${appointmentRequests} appointment request${appointmentRequests === 1 ? "" : "s"} are active and ready for routing.`;
  }

  return "No urgent hospital-wide blockers are active right now. This is a good window to review throughput, staffing, and follow-up readiness.";
}

export default function HospitalAdminDashboard() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
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

  const accessRequestsQuery = useQuery({
    queryKey: ["hospital-admin-access-requests"],
    queryFn: () => getAccessRequests(token || ""),
    enabled: Boolean(token),
    refetchInterval: 8000,
    refetchIntervalInBackground: true,
  });

  const { alertsQuery, alerts, liveAlert } = useLiveAlertNotifications({
    token: token || "",
    queryKey: ["hospital-admin-alerts"],
    audienceLabel: "Hospital alert",
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
  const appointments = appointmentsQuery.data?.appointments || [];
  const overview = overviewQuery.data;

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
  const documentIntelligenceSummary = overview?.document_intelligence_summary;

  const pendingDoctorRequests = (accessRequestsQuery.data?.requests || []).filter(
    (entry: DoctorAccessRequest) => entry.status === "pending",
  );

  const urgentCoordinatorTasks = careCoordinatorQueue.filter((task) => ["Critical", "High"].includes(task.priority)).length;
  const hospitalOperationalBrief = getHospitalOperationalBrief({
    immediateReviews: reviewQueueSummary?.immediate ?? 0,
    openEmergencies: stats?.openEmergencies ?? 0,
    urgentCoordinatorTasks,
    appointmentRequests: stats?.appointmentRequests ?? 0,
  });

  const patientRecords = useMemo(
    () =>
      [...patients]
        .filter((patient) => !isOperationalAppointmentOnly(patient))
        .sort((left, right) => {
          const leftTime = left.updated_at ? new Date(left.updated_at).getTime() : 0;
          const rightTime = right.updated_at ? new Date(right.updated_at).getTime() : 0;
          return rightTime - leftTime;
        }),
    [patients],
  );

  const bookingRequests = useMemo(
    () =>
      [...appointments]
        .filter((appointment) => !["completed", "cancelled"].includes((appointment.status || "").toLowerCase()))
        .sort((left, right) => {
          const leftTime = left.updated_at ? new Date(left.updated_at).getTime() : 0;
          const rightTime = right.updated_at ? new Date(right.updated_at).getTime() : 0;
          return rightTime - leftTime;
        }),
    [appointments],
  );

  const recentDocuments = useMemo(
    () =>
      [...documents].sort((left, right) => {
        const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
        const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
        return rightTime - leftTime;
      }),
    [documents],
  );

  const recentOutreachHistory = useMemo(
    () =>
      patients
        .flatMap((patient) =>
          (patient.care_outreach_history || []).map((entry) => ({
            ...entry,
            patient_name: patient.name,
            patient_email: patient.email,
            patient_id: patient.id,
          })),
        )
        .sort((left, right) => {
          const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
          const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
          return rightTime - leftTime;
        })
        .slice(0, 6),
    [patients],
  );

  const fadeUp = {
    hidden: { opacity: 0, y: 18 },
    visible: (index: number) => ({
      opacity: 1,
      y: 0,
      transition: { delay: index * 0.05, duration: 0.32, ease: "easeOut" as const },
    }),
  };

  const jumpTo = (sectionId: string) => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleTopAction = (target: string) => {
    if (target.startsWith("/")) {
      navigate(target);
      return;
    }
    jumpTo(target);
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
    } catch (downloadError) {
      toast({
        variant: "destructive",
        title: "Unable to download file",
        description: downloadError instanceof ApiError ? downloadError.message : "Please try again.",
      });
    }
  };

  const topActions = [
    {
      label: "Total Patients",
      value: stats?.totalPatients ?? patientRecords.length,
      helper: `${patientRecords.filter((patient) => ["High", "Critical"].includes(patient.risk_level)).length} need closer follow-up`,
      icon: Users,
      target: "admin-patients",
    },
    {
      label: "Total Doctors",
      value: executiveSummary?.total_doctors ?? doctorWorkload.length,
      helper: `${doctorWorkload.filter((doctor) => doctor.open_requests > 0).length} with active queues`,
      icon: Stethoscope,
      target: "/admin/doctors",
    },
    {
      label: "Open Emergencies",
      value: stats?.openEmergencies ?? emergencies.filter((entry) => entry.status === "open").length,
      helper: `${reviewQueueSummary?.immediate ?? 0} cases also need rapid review`,
      icon: AlertTriangle,
      target: "admin-attention-center",
    },
    {
      label: "Appointment Requests",
      value: stats?.appointmentRequests ?? bookingRequests.length,
      helper: `${bookingRequests.filter((entry) => !entry.assigned_doctor_name).length} still unassigned`,
      icon: CalendarClock,
      target: "admin-bookings",
    },
    {
      label: "Follow-up Workload",
      value: careCoordinatorQueue.length,
      helper: `${urgentCoordinatorTasks} marked urgent`,
      icon: BellRing,
      target: "admin-followup",
    },
  ];

  return (
    <DashboardLayout>
      <motion.div initial="hidden" animate="visible" className="space-y-6">
        <motion.div variants={fadeUp} custom={0} className="dashboard-hero rounded-[2rem] px-6 py-6 sm:px-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground shadow-sm backdrop-blur-xl">
                <Activity className="h-3.5 w-3.5 text-primary" />
                Hospital Operations
              </div>
              <h1 className="mt-4 font-display text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-[2.35rem]">
                Hospital Command Center
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                A focused view of urgent cases, doctor load, bookings, and follow-up work for {user?.name}.
              </p>
              <p className="mt-3 max-w-2xl rounded-2xl border border-border/60 bg-background/65 px-4 py-3 text-sm text-foreground shadow-sm backdrop-blur-xl">
                {hospitalOperationalBrief}
              </p>
            </div>
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
          <button
            type="button"
            onClick={() => jumpTo("admin-attention-center")}
            className="block w-full text-left"
          >
            <Alert
              className="cinematic-alert transition hover:border-primary/50"
              variant={liveAlert.severity === "high" || liveAlert.severity === "critical" ? "destructive" : "default"}
            >
              <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">Live escalation: {liveAlert.title}</p>
                  <p className="text-sm">
                    {liveAlert.patient_name || "Patient"}: {liveAlert.message}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={getAlertBadgeVariant(liveAlert.severity)}>{alerts.length} active alerts</Badge>
                  <span className="text-xs font-medium text-primary">Open attention center</span>
                </div>
              </AlertDescription>
            </Alert>
          </button>
        )}

        <motion.div variants={fadeUp} custom={1} className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {topActions.map((item) => (
            <button key={item.label} type="button" onClick={() => handleTopAction(item.target)} className="text-left">
              <Card className="metric-card metric-card-hover h-full border-border/60 bg-card/95 shadow-card">
                <CardContent className="flex items-center gap-4 p-5">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent">
                    <item.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-display text-2xl font-bold text-foreground">{item.value}</p>
                    <p className="text-sm text-muted-foreground">{item.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.helper}</p>
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
        </motion.div>

        <motion.div variants={fadeUp} custom={2} className="grid gap-4 lg:grid-cols-3">
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
                {urgentCoordinatorTasks} urgent tasks and {(followupDropoutSummary?.high ?? 0) + (followupDropoutSummary?.critical ?? 0)} higher-risk follow-up cases need coordination.
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
                {executiveSummary?.available_capacity ?? 0} open slots and {executiveSummary?.scheduled_consultations ?? 0} consultations already scheduled.
              </p>
            </CardContent>
          </Card>
        </motion.div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <section id="admin-bookings">
              <Card className="premium-section shadow-card">
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle className="font-display text-lg">Appointment Requests</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Patient requests, assigned doctor, and slot status in one place.
                    </p>
                  </div>
                  <Badge variant="outline">{bookingRequests.length} active</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  {bookingRequests.length === 0 && (
                    <p className="text-sm text-muted-foreground">No active appointment requests are waiting right now.</p>
                  )}
                  {bookingRequests.slice(0, 6).map((appointment: AppointmentRecord) => (
                    <div key={appointment.id} className="rounded-2xl border border-border/60 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-foreground">{appointment.patient_name || "Patient"}</p>
                          <p className="text-xs text-muted-foreground">
                            {appointment.requested_specialty ? `${formatLabel(appointment.requested_specialty)} requested` : "General booking"}
                            {appointment.assigned_doctor_name ? ` · ${appointment.assigned_doctor_name}` : " · Doctor not assigned yet"}
                          </p>
                        </div>
                        <Badge variant={appointment.assigned_doctor_name ? "outline" : "secondary"}>{formatLabel(appointment.status)}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-foreground">{appointment.reason || "No reason provided."}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>{appointment.appointment_date || "Date pending"}</span>
                        <span>·</span>
                        <span>{appointment.appointment_time || "Time pending"}</span>
                        <span>·</span>
                        <span>{appointment.appointment_location || appointment.slot_label || "Slot being finalized"}</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>

            <section id="admin-patients">
              <Card className="premium-section shadow-card">
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle className="font-display text-lg">Hospital Patient Records</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Patient issue, care history, assigned doctor, and next step without score-heavy noise.
                    </p>
                  </div>
                  <Badge variant="outline">{patientRecords.length} records</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  {patientRecords.length === 0 && (
                    <p className="text-sm text-muted-foreground">No patient records are available yet.</p>
                  )}
                  {patientRecords.slice(0, 8).map((patient) => (
                    <div key={patient.id || patient.email} className="rounded-2xl border border-border/60 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-foreground">{patient.name}</p>
                            <Badge variant={getRiskBadgeVariant(patient.risk_level)}>{patient.risk_level}</Badge>
                            <Badge variant="outline">{patient.status}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{patient.email || "No email on file"}</p>
                        </div>
                        <p className="text-xs text-muted-foreground">{formatDate(patient.updated_at)}</p>
                      </div>
                      <div className="mt-3 grid gap-3 lg:grid-cols-[1.2fr_0.8fr_1fr]">
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Current issue</p>
                          <p className="mt-2 text-sm text-foreground">
                            {patient.summary_headline || patient.clinical_summary || compactList(patient.symptoms)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Hospital use</p>
                          <p className="mt-2 text-sm text-foreground">
                            {patient.visit_history?.length || 0} visit{(patient.visit_history?.length || 0) === 1 ? "" : "s"} · {patient.appointments_requested || 0} booking request{patient.appointments_requested === 1 ? "" : "s"} · {patient.emergency_count || 0} emergencies
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Doctor and next step</p>
                          <p className="mt-2 text-sm text-foreground">
                            {patient.assigned_doctor_name || "Unassigned"} {patient.assigned_doctor_specialty ? `· ${formatLabel(patient.assigned_doctor_specialty)}` : ""}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {patient.recommended_action || patient.followup_priority || "Routine monitoring"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>
          </div>

          <div className="space-y-6">
            <section id="admin-attention-center">
              <Card className="premium-section shadow-card">
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle className="font-display text-lg">Attention Center</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Live escalations, emergency logs, and the cases that need attention first.
                    </p>
                  </div>
                  <Badge variant={stats?.openEmergencies ? "destructive" : "outline"}>
                    {stats?.openEmergencies ?? 0} open emergencies
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl bg-muted/40 p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Immediate reviews</p>
                      <p className="mt-2 text-2xl font-semibold text-foreground">{reviewQueueSummary?.immediate ?? 0}</p>
                    </div>
                    <div className="rounded-2xl bg-muted/40 p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Safety watch</p>
                      <p className="mt-2 text-2xl font-semibold text-foreground">
                        {(clinicalSafetySummary?.critical ?? 0) + (clinicalSafetySummary?.high ?? 0)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-muted/40 p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Early warning</p>
                      <p className="mt-2 text-2xl font-semibold text-foreground">
                        {(earlyWarningSummary?.critical ?? 0) + (earlyWarningSummary?.high ?? 0)}
                      </p>
                    </div>
                  </div>

                  {emergencies.length === 0 && (
                    <p className="text-sm text-muted-foreground">No emergency logs are active right now.</p>
                  )}
                  {emergencies.slice(0, 4).map((entry) => (
                    <div key={entry.id} className="rounded-2xl border border-border/60 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-foreground">{entry.patient_name}</p>
                            <Badge variant={entry.status === "open" ? "destructive" : "secondary"}>{entry.status}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {entry.assigned_doctor_name || "Doctor not assigned"} {entry.email ? `· ${entry.email}` : ""}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground">{formatDate(entry.created_at)}</p>
                      </div>
                      <p className="mt-2 text-sm text-foreground">{entry.message}</p>
                      <p className="mt-2 text-xs text-muted-foreground">Severity: {formatLabel(entry.severity)}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>

            <Card className="premium-section shadow-card">
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle className="font-display text-lg">Recent Outreach Activity</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Email, WhatsApp, and call actions logged by the admin care team.
                  </p>
                </div>
                <Badge variant="outline">{recentOutreachHistory.length} recent</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {recentOutreachHistory.length === 0 && (
                  <p className="text-sm text-muted-foreground">Outreach history will appear here after email, WhatsApp, or call actions are logged.</p>
                )}
                {recentOutreachHistory.map((entry, index) => (
                  <div key={`${entry.patient_id || entry.patient_email || entry.target}-${index}`} className="rounded-2xl border border-border/60 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{entry.patient_name || "Patient"}</p>
                        <p className="text-xs text-muted-foreground">
                          {entry.patient_email || "No email on file"} {entry.target ? `· ${entry.target}` : ""}
                        </p>
                      </div>
                      <Badge variant="outline">{formatLabel(entry.channel)}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-foreground">{formatLabel(entry.status)}</p>
                    {entry.message_preview && <p className="mt-1 text-sm text-muted-foreground">{entry.message_preview}</p>}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {entry.actor_name || "Care team"} · {entry.created_at ? formatDate(entry.created_at) : "No timestamp"}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <section id="admin-documents">
              <Card className="premium-section shadow-card">
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle className="font-display text-lg">Document Intake</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Uploaded prescriptions, lab reports, and discharge notes with extracted summaries.
                    </p>
                  </div>
                  <Badge variant="outline">{recentDocuments.length} documents</Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-4">
                    {[
                      { label: "Flagged", value: documentIntelligenceSummary?.flagged_documents ?? 0 },
                      { label: "Prescriptions", value: documentIntelligenceSummary?.prescriptions ?? 0 },
                      { label: "Lab reports", value: documentIntelligenceSummary?.lab_reports ?? 0 },
                      { label: "Discharge notes", value: documentIntelligenceSummary?.discharge_notes ?? 0 },
                    ].map((item) => (
                      <div key={item.label} className="rounded-2xl bg-muted/40 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{item.label}</p>
                        <p className="mt-2 text-2xl font-semibold text-foreground">{item.value}</p>
                      </div>
                    ))}
                  </div>

                  {recentDocuments.length === 0 && (
                    <p className="text-sm text-muted-foreground">Patient-uploaded documents will appear here for hospital review.</p>
                  )}
                  {recentDocuments.slice(0, 4).map((document: DocumentRecord) => (
                    <div key={document.id} className="rounded-2xl border border-border/60 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-foreground">{document.title}</p>
                            <Badge variant={document.review_priority === "Urgent" ? "destructive" : document.review_priority === "Priority" ? "secondary" : "outline"}>
                              {document.review_priority || "Routine"}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {document.patient_name || "Patient"} {document.assigned_doctor_name ? `· ${document.assigned_doctor_name}` : ""}
                          </p>
                        </div>
                        {document.storage_key && (
                          <Button size="sm" variant="outline" onClick={() => void handleDocumentDownload(document)}>
                            <Download className="h-3.5 w-3.5" />
                            Open
                          </Button>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-foreground">{document.summary || document.prescription_summary || "No extracted summary yet."}</p>
                      {(document.structured_findings?.length || document.clinical_highlights?.length) ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {(document.structured_findings || document.clinical_highlights || []).slice(0, 2).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>
          </div>
        </div>

        <motion.div variants={fadeUp} custom={3} id="admin-followup">
          <Accordion type="multiple" className="rounded-[1.75rem] border border-border/60 bg-card/80 px-5 shadow-card backdrop-blur">
            <AccordionItem value="operations">
              <AccordionTrigger className="text-sm font-medium text-foreground">Operations and safety</AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
                  <Card className="premium-section shadow-card">
                    <CardHeader>
                      <CardTitle className="font-display text-lg">Review timing</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-2">
                      {[
                        { label: "Immediate", value: reviewQueueSummary?.immediate ?? 0 },
                        { label: "Within 6 hours", value: reviewQueueSummary?.within_6_hours ?? 0 },
                        { label: "Within 24 hours", value: reviewQueueSummary?.within_24_hours ?? 0 },
                        { label: "Routine", value: reviewQueueSummary?.routine ?? 0 },
                      ].map((item) => (
                        <div key={item.label} className="rounded-2xl bg-muted/40 p-4">
                          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{item.label}</p>
                          <p className="mt-2 text-2xl font-semibold text-foreground">{item.value}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <Card className="premium-section shadow-card">
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="font-display text-lg">Safety watch</CardTitle>
                      <Badge variant={clinicalSafetyWatch.length > 0 ? "secondary" : "outline"}>{clinicalSafetyWatch.length} patients</Badge>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {clinicalSafetyWatch.length === 0 && (
                        <p className="text-sm text-muted-foreground">No hospital-wide safety conflicts are active right now.</p>
                      )}
                      {clinicalSafetyWatch.slice(0, 3).map((entry) => (
                        <div key={`admin-safety-${entry.id || entry.email}`} className="rounded-2xl border border-border/60 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-medium text-foreground">{entry.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {entry.assigned_doctor_name || "Unassigned"} {entry.email ? `· ${entry.email}` : ""}
                              </p>
                            </div>
                            <Badge variant={getRiskBadgeVariant(entry.clinical_alert_level)}>{entry.clinical_alert_level}</Badge>
                          </div>
                          <p className="mt-2 text-sm text-foreground">{entry.safety_recommendation}</p>
                        </div>
                      ))}
                      {earlyWarningWatchlist.slice(0, 2).map((entry) => (
                        <div key={`admin-ew-${entry.id || entry.email}`} className="rounded-2xl border border-border/60 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-medium text-foreground">{entry.name}</p>
                              <p className="text-xs text-muted-foreground">{entry.assigned_doctor_name || "Unassigned"}</p>
                            </div>
                            <Badge variant={getRiskBadgeVariant(entry.early_warning_priority)}>{entry.early_warning_priority}</Badge>
                          </div>
                          <p className="mt-2 text-sm text-foreground">{entry.early_warning_summary}</p>
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
              <AccordionTrigger className="text-sm font-medium text-foreground">Recovery and follow-up</AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
                  <Card className="premium-section shadow-card">
                    <CardHeader>
                      <CardTitle className="font-display text-lg">Follow-up pressure</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl bg-muted/40 p-4">
                          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Return-risk watch</p>
                          <p className="mt-2 text-2xl font-semibold text-foreground">
                            {(readmissionRiskSummary?.high ?? 0) + (readmissionRiskSummary?.critical ?? 0)}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-muted/40 p-4">
                          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Dropout-risk watch</p>
                          <p className="mt-2 text-2xl font-semibold text-foreground">
                            {(followupDropoutSummary?.high ?? 0) + (followupDropoutSummary?.critical ?? 0)}
                          </p>
                        </div>
                      </div>
                      {readmissionWatchlist.slice(0, 2).map((entry) => (
                        <div key={`admin-readmission-${entry.id || entry.email}`} className="rounded-2xl border border-border/60 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-medium text-foreground">{entry.name}</p>
                              <p className="text-xs text-muted-foreground">{entry.assigned_doctor_name || "Unassigned"}</p>
                            </div>
                            <Badge variant={getRiskBadgeVariant(entry.readmission_risk_label)}>{entry.readmission_risk_label}</Badge>
                          </div>
                          <p className="mt-2 text-sm text-foreground">{entry.readmission_risk_summary}</p>
                        </div>
                      ))}
                      {followupDropoutWatchlist.slice(0, 2).map((entry) => (
                        <div key={`admin-followup-${entry.id || entry.email}`} className="rounded-2xl border border-border/60 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-medium text-foreground">{entry.name}</p>
                              <p className="text-xs text-muted-foreground">{entry.assigned_doctor_name || "Unassigned"}</p>
                            </div>
                            <Badge variant={getRiskBadgeVariant(entry.followup_dropout_risk_label)}>{entry.followup_dropout_risk_label}</Badge>
                          </div>
                          <p className="mt-2 text-sm text-foreground">{entry.followup_dropout_risk_summary}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <Card className="premium-section shadow-card">
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="font-display text-lg">Care outreach queue</CardTitle>
                      <Badge variant={careCoordinatorQueue.length > 0 ? "secondary" : "outline"}>{careCoordinatorQueue.length} tasks</Badge>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {careCoordinatorQueue.length === 0 && (
                        <p className="text-sm text-muted-foreground">No coordinator actions are pending right now.</p>
                      )}
                      {careCoordinatorQueue.slice(0, 3).map((task) => (
                        <div key={`coord-${task.patient_id || task.patient_email}-${task.task_type}`} className="rounded-2xl border border-border/60 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium text-foreground">{task.patient_name}</p>
                                <Badge variant={getRiskBadgeVariant(task.priority)}>{task.priority}</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {task.assigned_doctor_name || "Unassigned"} {task.patient_email ? `· ${task.patient_email}` : ""}
                              </p>
                            </div>
                            <Badge variant="outline">{formatLabel(task.task_type)}</Badge>
                          </div>
                          <p className="mt-2 text-sm text-foreground">{task.summary}</p>
                          <p className="mt-2 text-xs text-muted-foreground">{task.suggested_action}</p>
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
                                      status: "resolved",
                                      note: careCoordinatorNotes[task.patient_id as string] ?? task.workflow?.note ?? "",
                                    })
                                  }
                                >
                                  Resolve
                                </Button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="emergencies">
              <AccordionTrigger className="text-sm font-medium text-foreground">Emergency logs</AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="grid gap-4 md:grid-cols-2">
                  {emergencies.length === 0 && (
                    <p className="text-sm text-muted-foreground">No emergency logs have been created yet.</p>
                  )}
                  {emergencies.map((entry) => (
                    <Card key={entry.id} className="premium-section shadow-card">
                      <CardContent className="p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-foreground">{entry.patient_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {entry.assigned_doctor_name || "Doctor not assigned"} {entry.email ? `· ${entry.email}` : ""}
                            </p>
                          </div>
                          <Badge variant={entry.status === "open" ? "destructive" : "secondary"}>{entry.status}</Badge>
                        </div>
                        <p className="mt-2 text-sm text-foreground">{entry.message}</p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Severity: {formatLabel(entry.severity)} · {formatDate(entry.created_at)}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </motion.div>
      </motion.div>
    </DashboardLayout>
  );
}
