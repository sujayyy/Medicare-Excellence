import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BellRing, CalendarClock, ClipboardList, Copy, Download, FileText, HeartPulse, MapPin, Plus, ShieldAlert, Sparkles, Stethoscope, Users } from "lucide-react";

import DashboardLayout from "@/components/DashboardLayout";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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
  getAnalyticsOverview,
  getAppointments,
  getDoctorSlots,
  getDocuments,
  getEmergencies,
  getPatients,
  getStats,
  getVitals,
  updateAppointment,
  updateDoctorSlots,
  sendCareOutreach,
  updateCareCoordination,
  uploadDocument,
} from "@/lib/api";
import { useLiveAlertNotifications } from "@/hooks/useLiveAlertNotifications";
import { useToast } from "@/hooks/use-toast";
import type { AppointmentRecord, DocumentRecord, DoctorSlot, PatientRecord, VitalRecord } from "@/types/api";

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
    .slice(0, 4);
}

function getDoctorOperationalBrief({
  immediateReviews,
  openAlerts,
  urgentCoordinatorTasks,
  appointments,
}: {
  immediateReviews: number;
  openAlerts: number;
  urgentCoordinatorTasks: number;
  appointments: number;
}) {
  if (immediateReviews > 0 || openAlerts > 0) {
    return `Immediate attention is needed for ${immediateReviews} review case${immediateReviews === 1 ? "" : "s"} and ${openAlerts} live alert${openAlerts === 1 ? "" : "s"}.`;
  }

  if (urgentCoordinatorTasks > 0) {
    return `${urgentCoordinatorTasks} outreach task${urgentCoordinatorTasks === 1 ? "" : "s"} should be closed next to keep follow-up care moving.`;
  }

  if (appointments > 0) {
    return `${appointments} appointment${appointments === 1 ? "" : "s"} are currently in your queue and ready for preparation or completion.`;
  }

  return "No urgent operational blockers are active right now. This is a good time to review summaries, documents, and upcoming follow-ups.";
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

function openPrintableWindow(title: string, sections: Array<{ label: string; value?: string }>) {
  const printable = window.open("", "_blank", "noopener,noreferrer,width=980,height=780");
  if (!printable) {
    return false;
  }

  const sectionMarkup = sections
    .filter((section) => section.value && section.value.trim().length > 0)
    .map(
      (section) => `
        <section style="margin-bottom:18px;">
          <h3 style="margin:0 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:0.12em;color:#64748b;">${section.label}</h3>
          <div style="font-size:14px;line-height:1.6;color:#0f172a;white-space:pre-wrap;">${section.value}</div>
        </section>
      `,
    )
    .join("");

  printable.document.write(`
    <html>
      <head>
        <title>${title}</title>
      </head>
      <body style="font-family:Inter,Arial,sans-serif;padding:32px;color:#0f172a;">
        <h1 style="margin:0 0 24px;font-size:28px;">${title}</h1>
        ${sectionMarkup || "<p>No structured content is available yet.</p>"}
      </body>
    </html>
  `);
  printable.document.close();
  printable.focus();
  printable.print();
  return true;
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
  safety_workflow_note?: string;
};

export default function DoctorDashboard() {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [appointmentDrafts, setAppointmentDrafts] = useState<Record<string, AppointmentWorkflowDraft>>({});
  const [appointmentFiles, setAppointmentFiles] = useState<Record<string, File | null>>({});
  const [careCoordinatorNotes, setCareCoordinatorNotes] = useState<Record<string, string>>({});
  const [selectedWorkspaceAppointmentId, setSelectedWorkspaceAppointmentId] = useState("");
  const [slotDraft, setSlotDraft] = useState({
    date: format(new Date(), "yyyy-MM-dd"),
    time: "09:00 AM",
    label: "General consultation",
    location: "Outpatient Room 1",
    capacity: "1",
  });

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

  const overviewQuery = useQuery({
    queryKey: ["doctor-analytics-overview"],
    queryFn: () => getAnalyticsOverview(token || ""),
    enabled: Boolean(token),
  });

  const doctorSlotsQuery = useQuery({
    queryKey: ["doctor-slot-schedule", user?.id],
    queryFn: () => getDoctorSlots(token || "", user?.id || ""),
    enabled: Boolean(token && user?.id),
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
      await Promise.all([
        appointmentsQuery.refetch(),
        overviewQuery.refetch(),
        patientsQuery.refetch(),
      ]);
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

  const updateDoctorSlotsMutation = useMutation({
    mutationFn: (slots: DoctorSlot[]) =>
      updateDoctorSlots(token || "", {
        doctor_id: user?.id,
        slots: slots.map((slot) => ({
          id: slot.id,
          date: slot.date,
          time: slot.time,
          label: slot.label,
          location: slot.location,
          capacity: slot.capacity,
          status: slot.status,
        })),
      }),
    onSuccess: async () => {
      await Promise.all([doctorSlotsQuery.refetch(), appointmentsQuery.refetch(), overviewQuery.refetch()]);
      toast({
        title: "Clinic slots updated",
        description: "Your live booking schedule is now available to patients and the hospital team.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Unable to update slots",
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
        description: "The patient outreach workflow was updated successfully.",
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
  const recentVisitEntries = getRecentVisitEntries(patients);
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
  const doctorSlots = doctorSlotsQuery.data?.slots || [];
  const selectedWorkspaceAppointment =
    appointments.find((appointment) => appointment.id === selectedWorkspaceAppointmentId) || appointments[0] || null;
  const selectedWorkspacePatient = selectedWorkspaceAppointment
    ? patients.find((patient) => patient.user_id === selectedWorkspaceAppointment.patient_user_id || patient.email === selectedWorkspaceAppointment.patient_email)
    : null;
  const previousVisitHistory = [...(selectedWorkspacePatient?.visit_history || [])]
    .filter((visit) => visit.appointment_id !== selectedWorkspaceAppointment?.id)
    .sort((left, right) => (right.completed_at || "").localeCompare(left.completed_at || ""))
    .slice(0, 4);
  const linkedWorkspaceVitals = selectedWorkspaceAppointment
    ? vitals.filter((entry) => entry.appointment_id === selectedWorkspaceAppointment.id)
    : [];
  const linkedWorkspaceDocuments = selectedWorkspaceAppointment
    ? documents.filter((entry) => entry.appointment_id === selectedWorkspaceAppointment.id)
    : [];
  const urgentCoordinatorTasks = careCoordinatorQueue.filter((task) => ["Critical", "High"].includes(task.priority)).length;
  const doctorOperationalBrief = getDoctorOperationalBrief({
    immediateReviews: reviewQueueSummary?.immediate ?? 0,
    openAlerts: alerts.filter((entry) => entry.status === "open").length,
    urgentCoordinatorTasks,
    appointments: appointments.length,
  });
  const fadeUp = {
    hidden: { opacity: 0, y: 18 },
    visible: (index: number) => ({
      opacity: 1,
      y: 0,
      transition: { delay: index * 0.06, duration: 0.35, ease: "easeOut" as const },
    }),
  };

  const addDoctorSlot = () => {
    if (!slotDraft.date || !slotDraft.time) {
      toast({
        variant: "destructive",
        title: "Missing slot details",
        description: "Add a date and time before publishing a slot.",
      });
      return;
    }

    const nextSlots: DoctorSlot[] = [
      ...doctorSlots,
      {
        id: `${slotDraft.date}-${slotDraft.time}-${slotDraft.location}`.replace(/\s+/g, "-").toLowerCase(),
        date: slotDraft.date,
        time: slotDraft.time,
        label: slotDraft.label,
        location: slotDraft.location,
        capacity: Math.max(1, Number(slotDraft.capacity || 1)),
        status: "open",
      },
    ];
    updateDoctorSlotsMutation.mutate(nextSlots);
    setSlotDraft((current) => ({ ...current, label: "General consultation", location: current.location || "Outpatient Room 1", capacity: "1" }));
  };

  const removeDoctorSlot = (slotId: string) => {
    updateDoctorSlotsMutation.mutate(doctorSlots.filter((slot) => slot.id !== slotId));
  };

  const exportWorkspaceDocument = (mode: "soap" | "summary") => {
    if (!selectedWorkspaceAppointment) {
      return;
    }
    const copilot = selectedWorkspaceAppointment.doctor_copilot;
    if (mode === "soap") {
      openPrintableWindow(`SOAP Note · ${selectedWorkspaceAppointment.patient_name || "Patient"}`, [
        { label: "Patient", value: `${selectedWorkspaceAppointment.patient_name || "Patient"}\n${selectedWorkspaceAppointment.patient_email || ""}`.trim() },
        { label: "Visit reason", value: selectedWorkspaceAppointment.reason || "" },
        { label: "SOAP Note", value: copilot?.soap_note?.formatted || selectedWorkspaceAppointment.consultation_notes || "" },
        { label: "Follow-up plan", value: selectedWorkspaceAppointment.follow_up_plan || copilot?.suggested_follow_up_plan?.join("\n") || "" },
      ]);
      return;
    }

    openPrintableWindow(`Consultation Summary · ${selectedWorkspaceAppointment.patient_name || "Patient"}`, [
      { label: "Patient", value: `${selectedWorkspaceAppointment.patient_name || "Patient"}\n${selectedWorkspaceAppointment.patient_email || ""}`.trim() },
      { label: "Scheduled slot", value: `${selectedWorkspaceAppointment.appointment_date || ""} ${selectedWorkspaceAppointment.appointment_time || ""}\n${selectedWorkspaceAppointment.appointment_location || ""}`.trim() },
      { label: "Diagnosis summary", value: selectedWorkspaceAppointment.diagnosis_summary || copilot?.suggested_diagnosis_buckets?.join("\n") || "" },
      { label: "Medication / prescription", value: selectedWorkspaceAppointment.prescription_summary || copilot?.medication_safety_reminders?.join("\n") || "" },
      { label: "Follow-up plan", value: selectedWorkspaceAppointment.follow_up_plan || copilot?.suggested_follow_up_plan?.join("\n") || "" },
    ]);
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

  const applyCopilotToDraft = (appointment: AppointmentRecord) => {
    const copilot = appointment.doctor_copilot;
    if (!copilot) {
      toast({
        variant: "destructive",
        title: "Copilot not ready",
        description: "This appointment does not have a generated copilot note yet.",
      });
      return;
    }

    setAppointmentDrafts((current) => ({
      ...current,
      [appointment.id]: {
        ...current[appointment.id],
        consultation_notes: current[appointment.id]?.consultation_notes || copilot.soap_note.formatted,
        diagnosis_summary:
          current[appointment.id]?.diagnosis_summary ||
          copilot.suggested_diagnosis_buckets.join("; "),
        vitals_summary: current[appointment.id]?.vitals_summary || copilot.soap_note.objective,
        prescription_summary:
          current[appointment.id]?.prescription_summary ||
          copilot.medication_safety_reminders.join(" "),
        follow_up_plan:
          current[appointment.id]?.follow_up_plan ||
          copilot.suggested_follow_up_plan.join(" "),
      },
    }));

    toast({
      title: "Doctor Copilot applied",
      description: "SOAP note, diagnosis buckets, follow-up plan, and safety reminders were copied into the draft.",
    });
  };

  const copyCopilotSoap = async (appointment: AppointmentRecord) => {
    const copilot = appointment.doctor_copilot;
    if (!copilot?.soap_note?.formatted) {
      toast({
        variant: "destructive",
        title: "No SOAP note available",
        description: "Generate or refresh the copilot snapshot first.",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(copilot.soap_note.formatted);
      toast({
        title: "SOAP note copied",
        description: "The generated note is ready to paste into the clinical record.",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Unable to copy note",
        description: "Clipboard access was blocked in this browser.",
      });
    }
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

  const updateSafetyWorkflow = (appointment: AppointmentRecord, workflowStatus: string) => {
    const draft = appointmentDrafts[appointment.id] || {};
    updateAppointmentMutation.mutate({
      appointmentId: appointment.id,
      payload: {
        safety_workflow_status: workflowStatus,
        safety_workflow_note: String(draft.safety_workflow_note || appointment.safety_workflow_note || ""),
      },
    });
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
                Doctor Care Queue
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                A focused view of assigned patients, appointments, and urgent follow-up for Dr. {user?.name}.
              </p>
              <p className="mt-3 max-w-2xl rounded-2xl border border-white/80 bg-white/65 px-4 py-3 text-sm text-foreground shadow-sm">
                {doctorOperationalBrief}
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

        <motion.div variants={fadeUp} custom={2} className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="premium-section shadow-card">
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Needs attention now</p>
                    <p className="mt-2 font-display text-3xl font-semibold text-foreground">
                      {(reviewQueueSummary?.immediate ?? 0) + (alerts.filter((entry) => entry.status === "open").length)}
                    </p>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent">
                    <AlertTriangle className="h-5 w-5 text-primary" />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {reviewQueueSummary?.immediate ?? 0} patient review{(reviewQueueSummary?.immediate ?? 0) === 1 ? "" : "s"} and {alerts.filter((entry) => entry.status === "open").length} live alert{alerts.filter((entry) => entry.status === "open").length === 1 ? "" : "s"} are currently waiting.
                </p>
              </CardContent>
            </Card>

            <Card className="premium-section shadow-card">
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Visit queue</p>
                    <p className="mt-2 font-display text-3xl font-semibold text-foreground">{appointments.length}</p>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent">
                    <ClipboardList className="h-5 w-5 text-primary" />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {stats?.appointmentRequests ?? 0} booking request{(stats?.appointmentRequests ?? 0) === 1 ? "" : "s"} and {prioritySchedulingPatients.length} patient{prioritySchedulingPatients.length === 1 ? "" : "s"} need scheduling attention.
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
                  {urgentCoordinatorTasks} urgent outreach task{urgentCoordinatorTasks === 1 ? "" : "s"} and {followupDropoutWatchlist.length} follow-up risk case{followupDropoutWatchlist.length === 1 ? "" : "s"} need a response path.
                </p>
              </CardContent>
            </Card>
          </div>

          <Accordion type="multiple" className="rounded-[1.75rem] border border-white/70 bg-card/80 px-5 shadow-card backdrop-blur">
            <AccordionItem value="clinical">
              <AccordionTrigger className="text-sm font-medium text-foreground">Clinical review details</AccordionTrigger>
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
                    <Stethoscope className="h-4 w-4 text-primary" />
                    <p className="font-display text-2xl font-bold text-foreground">{item.value}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="premium-section shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Trend Signals</CardTitle>
              <Badge variant={outbreakClusters.length > 0 ? "secondary" : "outline"}>{outbreakClusters.length} signals</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {outbreakClusters.length === 0 && (
                <p className="text-sm text-muted-foreground">No unusual assigned-patient symptom cluster is above baseline right now.</p>
              )}
              {outbreakClusters.slice(0, 3).map((cluster) => (
                <div key={cluster.cluster} className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{cluster.cluster}</p>
                      <p className="text-xs text-muted-foreground">
                        {cluster.top_symptoms?.length ? cluster.top_symptoms.join(", ") : "Cluster activity detected"}
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
                      <ShieldAlert className="h-4 w-4 text-primary" />
                      <p className="font-display text-2xl font-bold text-foreground">{item.value}</p>
                    </div>
                  </div>
                ))}
              </div>
              {clinicalSafetyWatch.length === 0 && (
                <p className="text-sm text-muted-foreground">No high-priority clinical safety conflicts are active in your assigned queue.</p>
              )}
              {clinicalSafetyWatch.slice(0, 2).map((entry) => (
                <div key={`safety-${entry.id || entry.email}`} className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{entry.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.assigned_doctor_name || "Assigned doctor"} {entry.email ? `· ${entry.email}` : ""}
                      </p>
                    </div>
                    <Badge variant={getSafetyBadgeVariant(entry.clinical_alert_level)}>{entry.clinical_alert_level}</Badge>
                  </div>
                  <p className="text-sm text-foreground">{entry.safety_recommendation}</p>
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
                <p className="text-sm text-muted-foreground">No assigned patient currently has an elevated early-warning score.</p>
              )}
              {earlyWarningWatchlist.slice(0, 2).map((entry) => (
                <div key={`doctor-ew-${entry.id || entry.email}`} className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{entry.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.assigned_doctor_name || "Assigned patient"} {entry.email ? `· ${entry.email}` : ""}
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
              <AccordionTrigger className="text-sm font-medium text-foreground">Follow-up and outreach details</AccordionTrigger>
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
                      <AlertTriangle className="h-4 w-4 text-primary" />
                      <p className="font-display text-2xl font-bold text-foreground">{item.value}</p>
                    </div>
                  </div>
                ))}
              </div>
              {readmissionWatchlist.length === 0 && (
                <p className="text-sm text-muted-foreground">No assigned patient currently has elevated relapse or return-risk.</p>
              )}
              {readmissionWatchlist.slice(0, 2).map((entry) => (
                <div key={`doctor-readmission-${entry.id || entry.email}`} className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{entry.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.assigned_doctor_name || "Assigned patient"} {entry.email ? `· ${entry.email}` : ""}
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
                <p className="text-sm text-muted-foreground">No assigned patient currently shows elevated follow-up dropout risk.</p>
              )}
              {followupDropoutWatchlist.slice(0, 2).map((entry) => (
                <div key={`doctor-followup-${entry.id || entry.email}`} className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{entry.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.assigned_doctor_name || "Assigned patient"} {entry.email ? `· ${entry.email}` : ""}
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
              <CardTitle className="font-display text-lg">Outreach Queue</CardTitle>
              <Badge variant={careCoordinatorQueue.length > 0 ? "secondary" : "outline"}>{careCoordinatorQueue.length} tasks</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Use this queue to close the loop on patients who need outreach, rebooking, or a manual response from the care team.
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
                <p className="text-sm text-muted-foreground">No outreach tasks are waiting right now. New follow-up, return-risk, or safety cases will appear here automatically.</p>
              )}
              {careCoordinatorQueue.slice(0, 3).map((task) => (
                <div key={`coord-${task.patient_id || task.patient_email}-${task.task_type}`} className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{task.patient_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {task.assigned_doctor_name || "Assigned patient"} {task.patient_email ? `· ${task.patient_email}` : ""}
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
                        placeholder="Add outreach note, patient response, or escalation reason."
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
                            <Badge variant="outline">{formatLabel(task.workflow.status)}</Badge>
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

        <motion.div variants={fadeUp} custom={3} className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="premium-section shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="font-display text-lg">Clinic Slot Manager</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Publish real appointment openings so patients book into actual consultation capacity.</p>
              </div>
              <Badge variant="outline">{doctorSlots.length} live slots</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Input type="date" value={slotDraft.date} onChange={(event) => setSlotDraft((current) => ({ ...current, date: event.target.value }))} />
                <select
                  className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                  value={slotDraft.time}
                  onChange={(event) => setSlotDraft((current) => ({ ...current, time: event.target.value }))}
                >
                  {["09:00 AM", "09:30 AM", "10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM", "02:00 PM", "02:30 PM", "03:00 PM", "03:30 PM", "04:00 PM", "04:30 PM"].map((slotTime) => (
                    <option key={slotTime} value={slotTime}>
                      {slotTime}
                    </option>
                  ))}
                </select>
                <Input value={slotDraft.label} onChange={(event) => setSlotDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Consultation type" />
                <Input value={slotDraft.location} onChange={(event) => setSlotDraft((current) => ({ ...current, location: event.target.value }))} placeholder="Room / clinic location" />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-muted/30 px-4 py-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Capacity per slot</p>
                  <Input className="mt-2 w-24" value={slotDraft.capacity} onChange={(event) => setSlotDraft((current) => ({ ...current, capacity: event.target.value }))} />
                </div>
                <Button variant="outline" onClick={addDoctorSlot} disabled={updateDoctorSlotsMutation.isPending}>
                  <Plus className="mr-2 h-4 w-4" />
                  Publish slot
                </Button>
              </div>
              <div className="space-y-3">
                {doctorSlots.length === 0 && (
                  <p className="text-sm text-muted-foreground">No live slots yet. Publish your next clinic openings here and patients will see them on the booking page.</p>
                )}
                {doctorSlots.slice(0, 8).map((slot) => (
                  <div key={slot.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 px-4 py-3">
                    <div>
                      <p className="font-medium text-foreground">{slot.date} · {slot.time}</p>
                      <p className="text-sm text-muted-foreground">{slot.label || "Consultation slot"} {slot.location ? `· ${slot.location}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={slot.is_available ? "secondary" : "outline"}>
                        {(slot.booked_count ?? 0)}/{slot.capacity ?? 1} booked
                      </Badge>
                      <Button size="sm" variant="outline" onClick={() => removeDoctorSlot(slot.id)} disabled={updateDoctorSlotsMutation.isPending}>
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="premium-section shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="font-display text-lg">Consultation Workspace</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Open one booking at a time with clinical context, recent history, and export-ready note actions.</p>
              </div>
              <Badge variant="outline">{selectedWorkspaceAppointment ? selectedWorkspaceAppointment.status : "No selection"}</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedWorkspaceAppointment && (
                <p className="text-sm text-muted-foreground">Select an appointment from the queue below to open the focused consultation workspace.</p>
              )}
              {selectedWorkspaceAppointment && (
                <>
                  <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Current visit</p>
                      <p className="mt-2 font-display text-xl font-semibold text-foreground">{selectedWorkspaceAppointment.patient_name || "Patient"}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{selectedWorkspaceAppointment.patient_email || "No email on file"}</p>
                      <div className="mt-3 space-y-2 text-sm text-foreground">
                        <p><span className="font-medium">Slot:</span> {selectedWorkspaceAppointment.appointment_date} · {selectedWorkspaceAppointment.appointment_time}</p>
                        <p><span className="font-medium">Reason:</span> {selectedWorkspaceAppointment.reason || "Not provided"}</p>
                        {selectedWorkspaceAppointment.appointment_location && <p><span className="font-medium">Location:</span> {selectedWorkspaceAppointment.appointment_location}</p>}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">What changed since last visit</p>
                      <div className="mt-3 space-y-2 text-sm text-foreground">
                        {(selectedWorkspaceAppointment.doctor_copilot?.changes_since_last_visit || []).length > 0 ? (
                          (selectedWorkspaceAppointment.doctor_copilot?.changes_since_last_visit || []).slice(0, 4).map((change) => <p key={change}>{change}</p>)
                        ) : (
                          <p className="text-muted-foreground">No previous-visit comparison is available for this patient yet.</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => exportWorkspaceDocument("soap")}>
                      <Download className="mr-2 h-4 w-4" />
                      Export SOAP
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => exportWorkspaceDocument("summary")}>
                      <FileText className="mr-2 h-4 w-4" />
                      Export summary
                    </Button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-border/60 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Recent visit timeline</p>
                      <div className="mt-3 space-y-3">
                        {previousVisitHistory.length === 0 && <p className="text-sm text-muted-foreground">No previous visit history is attached yet.</p>}
                        {previousVisitHistory.map((visit) => (
                          <div key={visit.appointment_id} className="rounded-xl bg-muted/30 p-3">
                            <p className="font-medium text-foreground">{visit.appointment_date || "Visit"} {visit.appointment_time ? `· ${visit.appointment_time}` : ""}</p>
                            <p className="mt-1 text-sm text-muted-foreground">{visit.diagnosis_summary || visit.consultation_notes || visit.visit_reason || "No summary recorded."}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border/60 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Linked exam records</p>
                      <div className="mt-3 space-y-3">
                        <div className="rounded-xl bg-muted/30 p-3">
                          <p className="font-medium text-foreground">{linkedWorkspaceVitals.length} vital capture{linkedWorkspaceVitals.length === 1 ? "" : "s"}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {linkedWorkspaceVitals[0]?.summary || linkedWorkspaceVitals[0]?.notes || "No vitals linked yet for this visit."}
                          </p>
                        </div>
                        <div className="rounded-xl bg-muted/30 p-3">
                          <p className="font-medium text-foreground">{linkedWorkspaceDocuments.length} clinician document{linkedWorkspaceDocuments.length === 1 ? "" : "s"}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {linkedWorkspaceDocuments[0]?.summary || linkedWorkspaceDocuments[0]?.title || "No consultation document linked yet."}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={fadeUp} custom={4}>
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
              const copilot = appointment.doctor_copilot;
              return (
                <div key={appointment.id} className="rounded-2xl border border-border/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{appointment.patient_name || "Patient"}</p>
                      <p className="text-sm text-muted-foreground">
                        {appointment.patient_email || "No email"} {appointment.patient_phone ? `· ${appointment.patient_phone}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => setSelectedWorkspaceAppointmentId(appointment.id)}>
                        Open workspace
                      </Button>
                      <Badge variant={getAppointmentRiskBadgeVariant((appointment.status || "").toLowerCase() === "completed" ? "Low" : "Medium")}>
                        {appointment.status}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl bg-muted/40 p-3 text-sm">
                      <p><span className="font-medium text-foreground">Slot:</span> {appointment.appointment_date || "Date pending"} · {appointment.appointment_time || "Time pending"}</p>
                      {appointment.appointment_location && <p className="mt-1"><span className="font-medium text-foreground">Location:</span> {appointment.appointment_location}</p>}
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
                        <Button
                          size="sm"
                          variant="hero"
                          onClick={() =>
                            updateAppointmentMutation.mutate({
                              appointmentId: appointment.id,
                              payload: {
                                status: "completed",
                                ...draft,
                                safety_workflow_status: appointment.safety_workflow_status,
                                safety_workflow_note: String(draft.safety_workflow_note || appointment.safety_workflow_note || ""),
                              },
                            })
                          }
                        >
                          Complete
                        </Button>
                      </div>
                      {copilot && (
                        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-primary">
                                <Sparkles className="h-3.5 w-3.5" />
                                Doctor Copilot
                              </div>
                              <p className="mt-2 font-medium text-foreground">{copilot.care_focus}</p>
                              <p className="mt-1 text-sm text-muted-foreground">{copilot.latest_patient_context}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" variant="outline" onClick={() => applyCopilotToDraft(appointment)}>
                                <ClipboardList className="h-3.5 w-3.5" />
                                Apply to draft
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => void copyCopilotSoap(appointment)}>
                                <Copy className="h-3.5 w-3.5" />
                                Copy SOAP
                              </Button>
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3 xl:grid-cols-2">
                            <div className="rounded-xl bg-background/80 p-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">What changed since last visit</p>
                              <div className="mt-2 space-y-2 text-sm text-foreground">
                                {(copilot.changes_since_last_visit || []).map((item) => (
                                  <p key={`${appointment.id}-${item}`}>{item}</p>
                                ))}
                              </div>
                            </div>
                            <div className="rounded-xl bg-background/80 p-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Suggested diagnosis buckets</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {(copilot.suggested_diagnosis_buckets || []).map((item) => (
                                  <Badge key={`${appointment.id}-dx-${item}`} variant="secondary">
                                    {item}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 rounded-xl bg-background/80 p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Auto SOAP note</p>
                            <p className="mt-2 whitespace-pre-line text-sm text-foreground">{copilot.soap_note.formatted}</p>
                          </div>

                          {copilot.evidence_panel && (
                            <div className="mt-3 rounded-xl bg-background/80 p-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Copilot evidence</p>
                              <div className="mt-2 space-y-2 text-sm text-foreground">
                                <p>{copilot.evidence_panel.triage_signal}</p>
                                <p>{copilot.evidence_panel.specialty_signal}</p>
                                <p>{copilot.evidence_panel.longitudinal_signal}</p>
                              </div>
                              <p className="mt-2 text-xs text-muted-foreground">
                                Specialty confidence: {Math.round((copilot.evidence_panel.specialty_confidence || 0) * 100)}%
                              </p>
                            </div>
                          )}

                          <div className="mt-3 grid gap-3 xl:grid-cols-2">
                            <div className="rounded-xl bg-background/80 p-3">
                              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                <Stethoscope className="h-3.5 w-3.5" />
                                Follow-up plan
                              </div>
                              <div className="mt-2 space-y-2 text-sm text-foreground">
                                {(copilot.suggested_follow_up_plan || []).map((item) => (
                                  <p key={`${appointment.id}-plan-${item}`}>{item}</p>
                                ))}
                              </div>
                            </div>
                            <div className="rounded-xl bg-background/80 p-3">
                              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                <ShieldAlert className="h-3.5 w-3.5" />
                                Medication safety reminders
                              </div>
                              <div className="mt-2 space-y-2 text-sm text-foreground">
                                {(copilot.medication_safety_reminders || []).map((item) => (
                                  <p key={`${appointment.id}-med-${item}`}>{item}</p>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 rounded-xl bg-background/80 p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                <ShieldAlert className="h-3.5 w-3.5" />
                                Clinical safety engine
                              </div>
                              <Badge variant={getSafetyBadgeVariant(copilot.clinical_safety?.clinical_alert_level)}>
                                {copilot.clinical_safety?.clinical_alert_level || "Low"}
                              </Badge>
                            </div>
                            <p className="text-sm text-foreground">
                              {copilot.clinical_safety?.safety_recommendation || "No major safety conflict was auto-detected."}
                            </p>
                            <div className="mt-2 space-y-2 text-sm text-foreground">
                              {(copilot.clinical_safety?.safety_flags || []).slice(0, 3).map((item) => (
                                <p key={`${appointment.id}-safety-${item}`}>{item}</p>
                              ))}
                            </div>
                            {((copilot.clinical_safety?.medication_interaction_flags?.length || 0) > 0 ||
                              (copilot.clinical_safety?.medication_contraindications?.length || 0) > 0) && (
                              <div className="mt-3 rounded-xl border border-border/60 bg-muted/30 p-3">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                    Medication interaction engine
                                  </p>
                                  <Badge variant={getRiskBadgeVariant(copilot.clinical_safety?.medication_risk_level)}>
                                    {copilot.clinical_safety?.medication_risk_level || "Low"}
                                  </Badge>
                                </div>
                                <p className="text-sm text-foreground">
                                  {copilot.clinical_safety?.medication_risk_summary || "No major interaction was auto-detected."}
                                </p>
                                <div className="mt-2 space-y-2 text-sm text-foreground">
                                  {(copilot.clinical_safety?.medication_interaction_flags || []).slice(0, 2).map((item) => (
                                    <p key={`${appointment.id}-interaction-${item}`}>{item}</p>
                                  ))}
                                  {(copilot.clinical_safety?.medication_contraindications || []).slice(0, 2).map((item) => (
                                    <p key={`${appointment.id}-contra-${item}`}>{item}</p>
                                  ))}
                                </div>
                                {(copilot.clinical_safety?.medication_monitoring_actions?.length || 0) > 0 && (
                                  <p className="mt-2 text-xs text-muted-foreground">
                                    Monitoring: {(copilot.clinical_safety?.medication_monitoring_actions || []).slice(0, 2).join(" ")}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>

                          {copilot.early_warning && (
                            <div className="mt-3 rounded-xl bg-background/80 p-3">
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                  <HeartPulse className="h-3.5 w-3.5" />
                                  Early warning engine
                                </div>
                                <Badge variant={getRiskBadgeVariant(copilot.early_warning.early_warning_priority)}>
                                  {copilot.early_warning.early_warning_priority} · {copilot.early_warning.early_warning_score}/12
                                </Badge>
                              </div>
                              <p className="text-sm text-foreground">{copilot.early_warning.early_warning_summary}</p>
                              <p className="mt-2 text-sm text-muted-foreground">
                                {copilot.early_warning.early_warning_response}
                              </p>
                              <div className="mt-2 space-y-2 text-sm text-foreground">
                                {(copilot.early_warning.early_warning_components || []).slice(0, 3).map((item) => (
                                  <p key={`${appointment.id}-ews-${item}`}>{item}</p>
                                ))}
                              </div>
                              <p className="mt-2 text-xs text-muted-foreground">
                                Monitoring window: {copilot.early_warning.early_warning_monitoring_window}
                              </p>
                            </div>
                          )}

                          {copilot.readmission_risk && (
                            <div className="mt-3 rounded-xl bg-background/80 p-3">
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  Relapse and return-risk
                                </div>
                                <Badge variant={getRiskBadgeVariant(copilot.readmission_risk.readmission_risk_label)}>
                                  {copilot.readmission_risk.readmission_risk_label} · {copilot.readmission_risk.readmission_risk_score}/100
                                </Badge>
                              </div>
                              <p className="text-sm text-foreground">{copilot.readmission_risk.readmission_risk_summary}</p>
                              <div className="mt-2 space-y-2 text-sm text-foreground">
                                {(copilot.readmission_risk.readmission_risk_factors || []).slice(0, 3).map((item) => (
                                  <p key={`${appointment.id}-readmission-${item}`}>{item}</p>
                                ))}
                              </div>
                              <p className="mt-2 text-xs text-muted-foreground">
                                Suggested review window: {copilot.readmission_risk.relapse_risk_window}
                              </p>
                            </div>
                          )}

                          {copilot.followup_dropout_risk && (
                            <div className="mt-3 rounded-xl bg-background/80 p-3">
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                  <CalendarClock className="h-3.5 w-3.5" />
                                  Follow-up dropout risk
                                </div>
                                <Badge variant={getRiskBadgeVariant(copilot.followup_dropout_risk.followup_dropout_risk_label)}>
                                  {copilot.followup_dropout_risk.followup_dropout_risk_label} · {copilot.followup_dropout_risk.followup_dropout_risk_score}/100
                                </Badge>
                              </div>
                              <p className="text-sm text-foreground">{copilot.followup_dropout_risk.followup_dropout_risk_summary}</p>
                              <div className="mt-2 space-y-2 text-sm text-foreground">
                                {(copilot.followup_dropout_risk.followup_dropout_risk_factors || []).slice(0, 3).map((item) => (
                                  <p key={`${appointment.id}-dropout-${item}`}>{item}</p>
                                ))}
                              </div>
                              <p className="mt-2 text-xs text-muted-foreground">
                                Suggested outreach: {copilot.followup_dropout_risk.followup_outreach_window}
                              </p>
                            </div>
                          )}

                          <div className="mt-3 rounded-xl bg-background/80 p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                <ClipboardList className="h-3.5 w-3.5" />
                                Closed-loop safety workflow
                              </div>
                              <Badge variant={getWorkflowBadgeVariant(appointment.safety_workflow_status)}>
                                {formatLabel(appointment.safety_workflow_status || "open")}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Track whether this safety signal has been acknowledged, escalated, or resolved before final closure.
                            </p>
                            <Textarea
                              className="mt-3"
                              value={String(draft.safety_workflow_note || appointment.safety_workflow_note || "")}
                              onChange={(event) => setAppointmentDraft(appointment.id, "safety_workflow_note", event.target.value)}
                              placeholder="Add the clinical action taken, escalation decision, or resolution note."
                              rows={2}
                            />
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button size="sm" variant="outline" onClick={() => updateSafetyWorkflow(appointment, "acknowledged")}>
                                Acknowledge
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => updateSafetyWorkflow(appointment, "monitoring")}>
                                Monitor
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => updateSafetyWorkflow(appointment, "escalated")}>
                                Escalate
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => updateSafetyWorkflow(appointment, "resolved")}>
                                Resolve
                              </Button>
                            </div>
                            {(appointment.safety_workflow_history || []).length > 0 && (
                              <div className="mt-3 space-y-2">
                                {(appointment.safety_workflow_history || []).slice(0, 3).map((entry, index) => (
                                  <div key={`${appointment.id}-workflow-${index}`} className="rounded-lg border border-border/60 px-3 py-2">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <Badge variant={getWorkflowBadgeVariant(entry.status)}>{formatLabel(entry.status)}</Badge>
                                      <span className="text-[11px] text-muted-foreground">{formatDate(entry.created_at)}</span>
                                    </div>
                                    <p className="mt-2 text-sm text-foreground">{entry.note || "No note added."}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {entry.actor_name || "Clinician"} {entry.actor_role ? `· ${formatLabel(entry.actor_role)}` : ""}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {copilot.source_summary && (
                            <p className="mt-3 text-xs text-muted-foreground">
                              Built from {copilot.source_summary.chat_messages_used || 0} chat messages, {copilot.source_summary.vitals_used || 0} vitals,
                              {" "}{copilot.source_summary.documents_used || 0} documents, and {copilot.source_summary.prior_visits_used || 0} prior visits.
                            </p>
                          )}
                        </div>
                      )}
                      <Textarea
                        value={String(draft.consultation_notes || appointment.consultation_notes || "")}
                        onChange={(event) => setAppointmentDraft(appointment.id, "consultation_notes", event.target.value)}
                        placeholder="Consultation notes / SOAP note"
                        rows={3}
                      />
                      <Textarea
                        value={String(draft.diagnosis_summary || appointment.diagnosis_summary || "")}
                        onChange={(event) => setAppointmentDraft(appointment.id, "diagnosis_summary", event.target.value)}
                        placeholder="Diagnosis buckets / findings"
                        rows={2}
                      />
                      <Textarea
                        value={String(draft.vitals_summary || appointment.vitals_summary || "")}
                        onChange={(event) => setAppointmentDraft(appointment.id, "vitals_summary", event.target.value)}
                        placeholder="Vitals / objective findings / scan notes"
                        rows={2}
                      />
                      <Textarea
                        value={String(draft.prescription_summary || appointment.prescription_summary || "")}
                        onChange={(event) => setAppointmentDraft(appointment.id, "prescription_summary", event.target.value)}
                        placeholder="Prescription / medication safety / discharge medicines"
                        rows={2}
                      />
                      <Textarea
                        value={String(draft.follow_up_plan || appointment.follow_up_plan || "")}
                        onChange={(event) => setAppointmentDraft(appointment.id, "follow_up_plan", event.target.value)}
                        placeholder="Follow-up plan / return precautions / next review"
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
                            Safety: {patient.clinical_alert_level || "Low"} · {patient.safety_recommendation || "Routine safety review"}
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
                <Badge variant={predictionWatchlist.length > 0 ? "secondary" : "outline"}>{predictionWatchlist.length} patients</Badge>
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
                          {patient.email || "No email on file"} {patient.triage_label ? `· Triage ${patient.triage_label}` : ""}
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
                    {(document.abnormal_findings?.length || 0) > 0 && (
                      <div className="mt-3 rounded-xl bg-destructive/5 p-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-destructive">Abnormal findings</p>
                        <p className="mt-2 text-sm text-foreground">{document.abnormal_findings?.slice(0, 2).join(" ")}</p>
                      </div>
                    )}
                    {document.document_type === "lab_report" && (
                      <div className="mt-3 rounded-xl bg-background/80 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Lab alert</p>
                          <Badge variant={getRiskBadgeVariant(document.lab_alert_level === "critical" ? "Critical" : document.lab_alert_level === "high" ? "High" : document.lab_alert_level === "medium" ? "Medium" : "Low")}>
                            {document.lab_alert_level || "low"}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm text-foreground">
                          {document.abnormal_value_count ? `${document.abnormal_value_count} abnormal value(s) detected.` : "No high-confidence lab abnormality count was extracted."}
                        </p>
                        {(document.structured_findings?.length || 0) > 0 && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Structured values: {document.structured_findings?.slice(0, 3).join(" · ")}
                          </p>
                        )}
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
                        {(document.discharge_key_diagnoses?.length || 0) > 0 && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Diagnoses: {document.discharge_key_diagnoses?.slice(0, 2).join(" ")}
                          </p>
                        )}
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
