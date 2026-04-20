import { useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { Activity, AlertTriangle, ArrowUp, Brain, Calendar, Clock3, Download, FileText, HeartPulse, Languages, Mic, Paperclip, Plus, Sparkles, Square, Stethoscope, Volume2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useMutation, useQuery } from "@tanstack/react-query";

import DashboardLayout from "@/components/DashboardLayout";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ApiError, createVital, downloadDocumentFile, getChatHistory, getDocuments, getVitals, sendChatMessage, uploadDocument } from "@/lib/api";
import type { ChatMessage, DocumentRecord, PatientTimelineEvent, VisitHistoryEntry, VitalRecord } from "@/types/api";

const suggestions = [
  "I have a mild fever and headache since yesterday",
  "I want to book a doctor appointment for tomorrow",
  "I feel shortness of breath and chest discomfort",
  "Help me understand this prescription",
];

const voiceLanguages = [
  { value: "en-IN", label: "English", nativeLabel: "English", assistantLabel: "English (India)" },
  { value: "hi-IN", label: "Hindi", nativeLabel: "हिन्दी", assistantLabel: "Hindi (India)" },
  { value: "kn-IN", label: "Kannada", nativeLabel: "ಕನ್ನಡ", assistantLabel: "Kannada (India)" },
  { value: "ta-IN", label: "Tamil", nativeLabel: "தமிழ்", assistantLabel: "Tamil (India)" },
  { value: "te-IN", label: "Telugu", nativeLabel: "తెలుగు", assistantLabel: "Telugu (India)" },
  { value: "ml-IN", label: "Malayalam", nativeLabel: "മലയാളം", assistantLabel: "Malayalam (India)" },
  { value: "bn-IN", label: "Bengali", nativeLabel: "বাংলা", assistantLabel: "Bengali (India)" },
];

const VOICE_LANGUAGE_STORAGE_KEY = "medicare-excellence.voice-language";
const AUTO_SPEAK_STORAGE_KEY = "medicare-excellence.auto-speak";
const SUPPORT_DRAFT_STORAGE_KEY = "medicare-excellence.support-draft";

const SUPPORT_TEMPLATE_BY_LANGUAGE: Record<string, string> = {
  "en-IN": "Hello, I need help with symptoms, prescription understanding, or appointment support.",
  "hi-IN": "Hello, I need healthcare help in Hindi for symptoms, prescription understanding, or appointment support.",
  "kn-IN": "Hello, I need healthcare help in Kannada for symptoms, prescription understanding, or appointment support.",
  "ta-IN": "Hello, I need healthcare help in Tamil for symptoms, prescription understanding, or appointment support.",
  "te-IN": "Hello, I need healthcare help in Telugu for symptoms, prescription understanding, or appointment support.",
  "ml-IN": "Hello, I need healthcare help in Malayalam for symptoms, prescription understanding, or appointment support.",
  "bn-IN": "Hello, I need healthcare help in Bengali for symptoms, prescription understanding, or appointment support.",
};

function getLanguageOption(value: string) {
  return voiceLanguages.find((language) => language.value === value) || voiceLanguages[0];
}

function getLanguageLabel(value: string) {
  return getLanguageOption(value).label;
}

function getLanguageAssistantPreference(value: string) {
  const language = getLanguageOption(value);
  return `${language.assistantLabel} (${language.nativeLabel})`;
}

function getTimestampLabel(value?: string) {
  if (!value) {
    return "Just now";
  }

  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

function getExactTimestamp(value?: string) {
  if (!value) {
    return "N/A";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatLabel(value?: string) {
  if (!value) {
    return "Not shared";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDateOnly(value?: string) {
  if (!value) {
    return "Not shared";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(`${value}T00:00:00`));
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

function displayList(values?: string[]) {
  return values && values.length > 0 ? values : [];
}

function getMessageIdentity(message: ChatMessage) {
  return `${message.role}::${message.content}::${message.created_at || ""}`;
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const merged = [...current];
  const known = new Set(current.map(getMessageIdentity));

  for (const message of incoming) {
    const identity = getMessageIdentity(message);
    if (!known.has(identity)) {
      merged.push(message);
      known.add(identity);
    }
  }

  return merged;
}

function formatFileSize(size?: number) {
  if (!size) {
    return "No file size";
  }
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${size} B`;
}

function inferDocumentType(file: File | null) {
  if (!file) {
    return "lab_report";
  }

  const lowered = file.name.toLowerCase();
  if (lowered.includes("prescription") || lowered.includes("rx") || lowered.includes("medicine")) {
    return "prescription";
  }
  if (lowered.includes("discharge")) {
    return "discharge_note";
  }
  if (lowered.includes("insurance")) {
    return "insurance";
  }
  if (lowered.includes("lab") || lowered.includes("blood") || lowered.includes("report")) {
    return "lab_report";
  }
  return "other";
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read the selected file."));
    reader.readAsDataURL(file);
  });
}

function buildDocumentAssistantReply(document: DocumentRecord) {
  if (document.document_type === "prescription" && (document.medication_schedule?.length || 0) > 0) {
    const medications = (document.medication_schedule || [])
      .map((entry) => `- ${entry.drug_name}: ${entry.dosage} · ${entry.timing}${entry.duration ? ` · ${entry.duration}` : ""}`)
      .join("\n");
    const modeNote =
      document.ocr_status === "ai_handwriting_interpreted"
        ? "I reviewed the uploaded handwritten prescription image and extracted this medicine plan:"
        : "I reviewed the uploaded prescription and extracted this medicine plan:";
    const interpretationNote = document.ai_interpretation_notes ? `\n\nNote: ${document.ai_interpretation_notes}` : "";
    return `${modeNote}\n\n${medications}${interpretationNote}\n\nPlease confirm the drug name, dosage, and timing with your doctor or pharmacist before following it.`;
  }

  if (document.document_type === "prescription") {
    return document.prescription_summary || "Prescription uploaded successfully. Add typed prescription notes for more accurate medicine extraction.";
  }

  return document.summary || "Your medical document has been uploaded and shared with the care team.";
}

function getMessageSpeakId(message: ChatMessage, index: number) {
  return `${message.role}-${index}-${message.created_at || ""}`;
}

function getAssistantMessageMeta(content: string) {
  if (content.includes("**Appointment booking**")) {
    const stepMatch = content.match(/Step\s+(\d+)\s+of\s+(\d+)/i);
    return {
      variant: "appointment" as const,
      title: "Appointment Assistant",
      detail: stepMatch ? `Step ${stepMatch[1]} of ${stepMatch[2]}` : "Booking in progress",
    };
  }

  if (content.includes("**Appointment request submitted**")) {
    return {
      variant: "appointment-success" as const,
      title: "Appointment Confirmed",
      detail: "Request shared with the care team",
    };
  }

  if (content.includes("**Urgent next step**")) {
    return {
      variant: "emergency" as const,
      title: "Urgent Guidance",
      detail: "Needs faster attention",
    };
  }

  if (content.includes("**What I understood**")) {
    const isHighRisk =
      content.includes("Current AI triage: High") ||
      content.includes("Current AI triage: Critical");

    return {
      variant: isHighRisk ? ("triage-high" as const) : ("triage-routine" as const),
      title: isHighRisk ? "Priority Triage" : "Care Guidance",
      detail: isHighRisk ? "Higher-risk symptoms detected" : "Structured symptom support",
    };
  }

  return null;
}

function getTimelineIcon(type: PatientTimelineEvent["type"]) {
  if (type === "appointment") {
    return Calendar;
  }
  if (type === "vital") {
    return HeartPulse;
  }
  if (type === "document") {
    return FileText;
  }
  if (type === "visit") {
    return Stethoscope;
  }
  return Brain;
}

function getPatientNextStepSummary({
  triageLabel,
  earlyWarningPriority,
  careCoordinatorStatus,
  followupDueAt,
}: {
  triageLabel?: string;
  earlyWarningPriority?: string;
  careCoordinatorStatus?: string;
  followupDueAt?: string;
}) {
  const normalizedCoordinator = (careCoordinatorStatus || "").toLowerCase();

  if (triageLabel === "Critical" || earlyWarningPriority === "Critical") {
    return {
      title: "Urgent follow-up needed",
      body: "Your latest care signals suggest this concern needs faster review. Please contact your care team or seek urgent help if symptoms are getting worse.",
    };
  }

  if (triageLabel === "High" || earlyWarningPriority === "High") {
    return {
      title: "Priority review recommended",
      body: "Your symptoms should be reviewed soon. Keep your phone nearby in case the hospital team reaches out and avoid delaying the next appointment.",
    };
  }

  if (normalizedCoordinator === "contacted" || normalizedCoordinator === "rescheduled") {
    return {
      title: "Care team follow-up is in progress",
      body: "Your reminder workflow is active. Please check your messages and confirm the next available slot if a reschedule has been offered.",
    };
  }

  if (followupDueAt) {
    return {
      title: "Upcoming review to keep on track",
      body: "Your next follow-up window is already set. Use the reminder center below to stay aligned with the care plan and respond if the team contacts you.",
    };
  }

  return {
    title: "Routine monitoring is active",
    body: "Keep sharing symptoms, vitals, and documents as needed. The assistant and care team will use them to keep your timeline and follow-up plan current.",
  };
}

function selectPreferredVoice(voices: SpeechSynthesisVoice[], requestedLanguage: string) {
  if (voices.length === 0) {
    return null;
  }

  const normalizedLanguage = requestedLanguage.toLowerCase();
  const primaryLanguage = normalizedLanguage.split("-")[0];
  const femaleHints = [
    "female",
    "woman",
    "samantha",
    "karen",
    "moira",
    "tessa",
    "veena",
    "raveena",
    "zira",
    "aria",
    "jenny",
    "serena",
    "fiona",
    "sona",
    "swara",
    "priya",
    "neerja",
    "heera",
    "google uk english female",
  ];

  const scored = voices
    .map((voice) => {
      const name = voice.name.toLowerCase();
      const lang = voice.lang.toLowerCase();
      let score = 0;

      if (lang === normalizedLanguage) {
        score += 5;
      } else if (lang.startsWith(primaryLanguage)) {
        score += 3;
      }

      if (femaleHints.some((hint) => name.includes(hint))) {
        score += 4;
      }

      if (voice.default) {
        score += 1;
      }

      return { voice, score };
    })
    .sort((left, right) => right.score - left.score);

  return scored[0]?.score ? scored[0].voice : voices.find((voice) => voice.lang.toLowerCase().startsWith(primaryLanguage)) || voices[0];
}

export default function PatientDashboard() {
  const { token, user, profile } = useAuth();
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentType, setDocumentType] = useState("lab_report");
  const [documentNotes, setDocumentNotes] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentError, setDocumentError] = useState("");
  const [voiceLanguage, setVoiceLanguage] = useState(() => {
    if (typeof window === "undefined") {
      return "en-IN";
    }
    return window.localStorage.getItem(VOICE_LANGUAGE_STORAGE_KEY) || "en-IN";
  });
  const [voiceError, setVoiceError] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [autoSpeakReplies, setAutoSpeakReplies] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem(AUTO_SPEAK_STORAGE_KEY) === "true";
  });
  const [speechRecognitionSupported, setSpeechRecognitionSupported] = useState(false);
  const [speechPlaybackSupported, setSpeechPlaybackSupported] = useState(false);
  const [vitalForm, setVitalForm] = useState({
    pulse: "",
    spo2: "",
    temperature: "",
    systolic_bp: "",
    diastolic_bp: "",
    glucose: "",
    notes: "",
  });
  const [vitalError, setVitalError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const historyHydratedRef = useRef(false);
  const lastAutoSpokenMessageRef = useRef("");

  const historyQuery = useQuery({
    queryKey: ["chat-history", user?.id],
    queryFn: () => getChatHistory(token || ""),
    enabled: Boolean(token),
  });

  const documentsQuery = useQuery({
    queryKey: ["patient-documents", user?.id],
    queryFn: () => getDocuments(token || ""),
    enabled: Boolean(token),
  });

  const vitalsQuery = useQuery({
    queryKey: ["patient-vitals", user?.id],
    queryFn: () => getVitals(token || ""),
    enabled: Boolean(token),
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!token) {
        throw new ApiError("Please log in again to upload documents.", 401);
      }
      if (!documentTitle.trim()) {
        throw new ApiError("Document title is required.", 400);
      }

      let contentText = "";
      if (selectedFile && selectedFile.type.startsWith("text/")) {
        contentText = (await selectedFile.text()).slice(0, 4000);
      }
      const fileDataUrl = selectedFile ? await readFileAsDataUrl(selectedFile) : "";

      return uploadDocument(token, {
        title: documentTitle.trim(),
        document_type: documentType,
        notes: documentNotes.trim(),
        file_name: selectedFile?.name,
        content_type: selectedFile?.type,
        file_size: selectedFile?.size,
        file_data_url: fileDataUrl,
        content_text: contentText,
      });
    },
    onSuccess: async () => {
      setDocumentTitle("");
      setDocumentType("lab_report");
      setDocumentNotes("");
      setSelectedFile(null);
      setDocumentError("");
      await documentsQuery.refetch();
      toast({
        title: "Document uploaded",
        description: "Your document is now available to the care team.",
      });
    },
    onError: (error) => {
      setDocumentError(error instanceof ApiError ? error.message : "Unable to upload the document right now.");
    },
  });

  const vitalMutation = useMutation({
    mutationFn: async () => {
      if (!token) {
        throw new ApiError("Please log in again to submit vitals.", 401);
      }

      return createVital(token, {
        pulse: Number(vitalForm.pulse),
        spo2: Number(vitalForm.spo2),
        temperature: Number(vitalForm.temperature),
        systolic_bp: Number(vitalForm.systolic_bp),
        diastolic_bp: Number(vitalForm.diastolic_bp),
        glucose: Number(vitalForm.glucose),
        notes: vitalForm.notes.trim(),
      });
    },
    onSuccess: async () => {
      setVitalForm({
        pulse: "",
        spo2: "",
        temperature: "",
        systolic_bp: "",
        diastolic_bp: "",
        glucose: "",
        notes: "",
      });
      setVitalError("");
      await vitalsQuery.refetch();
      toast({
        title: "Vitals saved",
        description: "Your latest readings are now available to the care team.",
      });
    },
    onError: (error) => {
      setVitalError(error instanceof ApiError ? error.message : "Unable to save vitals right now.");
    },
  });

  useEffect(() => {
    if (historyQuery.data?.messages) {
      setMessages((current) => {
        if (current.length === 0) {
          return historyQuery.data?.messages || [];
        }

        const merged = mergeMessages(current, historyQuery.data.messages);
        return merged.length >= current.length ? merged : current;
      });
    }
  }, [historyQuery.data]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSpeechRecognitionSupported(Boolean(SpeechRecognitionCtor));
    setSpeechPlaybackSupported(Boolean(window.speechSynthesis));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(VOICE_LANGUAGE_STORAGE_KEY, voiceLanguage);
  }, [voiceLanguage]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(AUTO_SPEAK_STORAGE_KEY, autoSpeakReplies ? "true" : "false");
  }, [autoSpeakReplies]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const baseText = input.trim()
      ? `Hello, I need healthcare assistance in ${getLanguageOption(voiceLanguage).label}. Current concern: ${input.trim()}`
      : SUPPORT_TEMPLATE_BY_LANGUAGE[voiceLanguage] || SUPPORT_TEMPLATE_BY_LANGUAGE["en-IN"];
    const attachmentHint = selectedFile ? ` I also want help with the uploaded ${documentType.replace(/_/g, " ")}.` : "";
    window.localStorage.setItem(SUPPORT_DRAFT_STORAGE_KEY, `${baseText}${attachmentHint}`.trim());
  }, [input, selectedFile, documentType, voiceLanguage]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isSending]);

  useEffect(() => {
    const textarea = composerTextareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    const nextHeight = Math.min(textarea.scrollHeight, 168);
    textarea.style.height = `${Math.max(nextHeight, 28)}px`;
  }, [input]);

  const patientProfile = historyQuery.data?.patient || profile;
  const digitalTwin = historyQuery.data?.digital_twin;
  const messageCount = messages.length;
  const conversationCount = Math.ceil(messageCount / 2);
  const triageScore = patientProfile?.triage_score ?? historyQuery.data?.chat?.latest_triage?.triage_score ?? 20;
  const triageLabel = patientProfile?.triage_label || patientProfile?.risk_level || historyQuery.data?.chat?.latest_triage?.triage_label || "Low";
  const triageReason =
    patientProfile?.triage_reason ||
    historyQuery.data?.chat?.latest_triage?.triage_reason ||
    "No urgent symptom keywords were detected in the latest message.";
  const recommendedAction =
    patientProfile?.recommended_action ||
    historyQuery.data?.chat?.latest_triage?.recommended_action ||
    "Continue monitoring symptoms and use the assistant if anything changes.";
  const symptoms = displayList(patientProfile?.symptoms || historyQuery.data?.chat?.latest_entities?.symptoms);
  const bodyParts = displayList(patientProfile?.body_parts || historyQuery.data?.chat?.latest_entities?.body_parts);
  const medications = displayList(
    patientProfile?.medications_mentioned || historyQuery.data?.chat?.latest_entities?.medications_mentioned,
  );
  const redFlags = displayList(patientProfile?.red_flags || historyQuery.data?.chat?.latest_entities?.red_flags);
  const durationText =
    patientProfile?.duration_text || historyQuery.data?.chat?.latest_entities?.duration_text || "Not detected yet";
  const followUpQuestions = displayList(patientProfile?.follow_up_questions);
  const repeatedSymptoms = displayList(patientProfile?.repeated_symptoms);
  const riskTrajectory = patientProfile?.risk_trajectory || "stable";
  const worseningFlag = Boolean(patientProfile?.worsening_flag);
  const repeatSymptomCount = patientProfile?.repeat_symptom_count || 0;
  const predictionScore = patientProfile?.deterioration_prediction_score ?? 18;
  const predictionLabel = patientProfile?.deterioration_prediction_label || "Low";
  const predictionReason =
    patientProfile?.deterioration_prediction_reason ||
    "No strong near-term deterioration signal is visible from the current record.";
  const predictedFollowupWindow = patientProfile?.predicted_followup_window || "Routine 72-hour review";
  const earlyWarningScore = patientProfile?.early_warning_score ?? 0;
  const earlyWarningPriority = patientProfile?.early_warning_priority || "Low";
  const earlyWarningSummary =
    patientProfile?.early_warning_summary || "No strong early-warning trigger is active from the current record.";
  const earlyWarningResponse =
    patientProfile?.early_warning_response || "Routine monitoring is appropriate unless symptoms worsen.";
  const earlyWarningWindow =
    patientProfile?.early_warning_monitoring_window || "Routine observation";
  const earlyWarningComponents = displayList(patientProfile?.early_warning_components);
  const readmissionRiskScore = patientProfile?.readmission_risk_score ?? 12;
  const readmissionRiskLabel = patientProfile?.readmission_risk_label || "Low";
  const readmissionRiskSummary =
    patientProfile?.readmission_risk_summary || "No strong relapse or return-risk pattern is active from the current record.";
  const readmissionRiskFactors = displayList(patientProfile?.readmission_risk_factors);
  const relapseRiskWindow = patientProfile?.relapse_risk_window || "Routine 14-day follow-up";
  const followupDropoutRiskScore = patientProfile?.followup_dropout_risk_score ?? 14;
  const followupDropoutRiskLabel = patientProfile?.followup_dropout_risk_label || "Low";
  const followupDropoutRiskSummary =
    patientProfile?.followup_dropout_risk_summary || "No strong follow-up dropout pattern is active from the current record.";
  const followupDropoutRiskFactors = displayList(patientProfile?.followup_dropout_risk_factors);
  const followupOutreachWindow = patientProfile?.followup_outreach_window || "Routine reminder within 7 days";
  const careCoordinatorStatus = patientProfile?.care_coordinator_status || "open";
  const careCoordinatorNote = patientProfile?.care_coordinator_note || "";
  const careCoordinatorUpdatedAt = patientProfile?.care_coordinator_updated_at;
  const careCoordinatorUpdatedBy = patientProfile?.care_coordinator_updated_by || "Care team";
  const careCoordinatorHistory = patientProfile?.care_coordinator_history || [];
  const careOutreachHistory = patientProfile?.care_outreach_history || [];
  const patientNextStep = getPatientNextStepSummary({
    triageLabel,
    earlyWarningPriority,
    careCoordinatorStatus,
    followupDueAt: patientProfile?.followup_due_at,
  });
  const medicationRiskLevel = patientProfile?.medication_risk_level || "Low";
  const medicationRiskSummary =
    patientProfile?.medication_risk_summary || "No active medication list is available yet for interaction analysis.";
  const medicationInteractionFlags = displayList(patientProfile?.medication_interaction_flags);
  const medicationContraindications = displayList(patientProfile?.medication_contraindications);
  const medicationMonitoringActions = displayList(patientProfile?.medication_monitoring_actions);
  const interactingMedications = displayList(patientProfile?.interacting_medications);
  const documents = documentsQuery.data?.documents || [];
  const vitals = vitalsQuery.data?.vitals || [];
  const latestVital = vitals[0];
  const visitHistory = patientProfile?.visit_history || [];
  const careGaps = displayList(digitalTwin?.care_gaps);
  const timelineEvents = digitalTwin?.timeline_events || [];
  const whatsAppHref = useMemo(() => {
    const baseText = input.trim()
      ? `Hello, I need healthcare assistance in ${getLanguageOption(voiceLanguage).label}. Current concern: ${input.trim()}`
      : SUPPORT_TEMPLATE_BY_LANGUAGE[voiceLanguage] || SUPPORT_TEMPLATE_BY_LANGUAGE["en-IN"];
    const attachmentHint = selectedFile ? ` I also want help with the uploaded ${documentType.replace(/_/g, " ")}.` : "";
    const number = (import.meta.env.VITE_WHATSAPP_NUMBER || "919999999999").replace(/\D/g, "");
    return `https://wa.me/${number}?text=${encodeURIComponent(`${baseText}${attachmentHint}`.trim())}`;
  }, [documentType, input, selectedFile, voiceLanguage]);
  const fadeUp = {
    hidden: { opacity: 0, y: 18 },
    visible: (index: number) => ({
      opacity: 1,
      y: 0,
      transition: { delay: index * 0.06, duration: 0.35, ease: "easeOut" as const },
    }),
  };
  function startVoiceCapture() {
    const SpeechRecognitionCtor =
      typeof window !== "undefined"
        ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
        : null;

    if (!SpeechRecognitionCtor) {
      setVoiceError("Voice dictation is not supported in this browser.");
      return;
    }

    setVoiceError("");
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = voiceLanguage;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setIsListening(true);
    recognition.onerror = () => {
      setIsListening(false);
      setVoiceError("Voice capture failed. Please try again.");
    };
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event?.results?.[0]?.[0]?.transcript || "";
      if (transcript) {
        setInput((current) => (current.trim() ? `${current.trim()} ${transcript}` : transcript));
        toast({
          title: "Voice captured",
          description: `Captured in ${getLanguageLabel(voiceLanguage)}. Review the text and send it when you're ready.`,
        });
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopVoiceCapture() {
    recognitionRef.current?.stop?.();
    setIsListening(false);
  }

  useEffect(() => {
    document.title = "Medicare Excellence | Patient Portal";
  }, []);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    if (historyQuery.isLoading || messages.length === 0) {
      return;
    }

    if (!historyHydratedRef.current) {
      historyHydratedRef.current = true;
      return;
    }

    if (!autoSpeakReplies || !speechPlaybackSupported) {
      return;
    }

    const latestAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant");
    if (!latestAssistantMessage) {
      return;
    }

    const identity = getMessageIdentity(latestAssistantMessage);
    if (lastAutoSpokenMessageRef.current === identity) {
      return;
    }

    lastAutoSpokenMessageRef.current = identity;
    speakMessage(latestAssistantMessage.content, `assistant-auto-${latestAssistantMessage.created_at || identity}`);
  }, [messages, autoSpeakReplies, historyQuery.isLoading, speechPlaybackSupported]);

  function speakMessage(content: string, messageId: string) {
    if (!content || typeof window === "undefined" || !window.speechSynthesis) {
      setVoiceError("Speech playback is not available right now.");
      return;
    }

    setVoiceError("");
    const synth = window.speechSynthesis;

    if (speakingMessageId === messageId && synth.speaking) {
      synth.cancel();
      setSpeakingMessageId(null);
      return;
    }

    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(
      content.replace(/[#*_`>-]/g, " ").replace(/\s+/g, " ").trim(),
    );
    utterance.lang = voiceLanguage;
    utterance.rate = 0.92;
    utterance.pitch = 1.08;

    const voices = synth.getVoices?.() || [];
    const preferredVoice = selectPreferredVoice(voices, voiceLanguage);
    if (preferredVoice) {
      utterance.voice = preferredVoice;
      utterance.lang = preferredVoice.lang;
    }

    utterance.onend = () => setSpeakingMessageId(null);
    utterance.onerror = () => {
      setSpeakingMessageId(null);
      setVoiceError("Voice playback ran into a problem. Please try again.");
    };

    setSpeakingMessageId(messageId);
    synth.speak(utterance);
  }

  function handleAttachmentPick(file: File | null) {
    setSelectedFile(file);
    if (!file) {
      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = "";
      }
      return;
    }

    setDocumentTitle((current) => current || file.name.replace(/\.[^.]+$/, ""));
    setDocumentType(inferDocumentType(file));
    setDocumentError("");
    toast({
      title: "Attachment added",
      description: "You can send this file with your next message or upload it from Medical Documents.",
    });
  }

  async function uploadComposerAttachment(messageText: string) {
    if (!token || !selectedFile) {
      return null;
    }

    let contentText = "";
    if (selectedFile.type.startsWith("text/")) {
      contentText = (await selectedFile.text()).slice(0, 4000);
    }
    const fileDataUrl = await readFileAsDataUrl(selectedFile);

    const uploaded = await uploadDocument(token, {
      title: documentTitle.trim() || selectedFile.name.replace(/\.[^.]+$/, ""),
      document_type: documentType,
      notes: (documentNotes || messageText).trim(),
      file_name: selectedFile.name,
      content_type: selectedFile.type,
      file_size: selectedFile.size,
      file_data_url: fileDataUrl,
      content_text: contentText,
    });

    await documentsQuery.refetch();
    return uploaded.document;
  }

  async function handleSend(rawText: string) {
    const text = rawText.trim();
    if ((!text && !selectedFile) || !token || isSending) {
      return;
    }

    const nowIso = new Date().toISOString();
    const outgoingMessages: ChatMessage[] = [];
    if (text) {
      outgoingMessages.push({
        role: "user",
        content: text,
        created_at: nowIso,
      });
    }

    if (selectedFile) {
      outgoingMessages.push({
        role: "user",
        content: `Uploaded ${documentType.replace(/_/g, " ")}: ${documentTitle.trim() || selectedFile.name}`,
        created_at: nowIso,
      });
    }

    setMessages((current) => [...current, ...outgoingMessages]);
    setInput("");
    setChatError("");
    setIsSending(true);

    try {
      let attachmentReply: string | null = null;
      if (selectedFile) {
        const uploadedDocument = await uploadComposerAttachment(text);
        attachmentReply = uploadedDocument ? buildDocumentAssistantReply(uploadedDocument) : null;
        setSelectedFile(null);
        setDocumentTitle("");
        setDocumentType("lab_report");
        setDocumentNotes("");
      }

      if (attachmentReply) {
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: attachmentReply,
            created_at: new Date().toISOString(),
          },
        ]);
      }

      if (text) {
        const response = await sendChatMessage(token, text, getLanguageAssistantPreference(voiceLanguage));
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: response.response,
            created_at: new Date().toISOString(),
          },
        ]);
        void historyQuery.refetch();
      } else if (attachmentReply) {
        toast({
          title: "Document analyzed",
          description: "The uploaded file has been added to your record.",
        });
      }
    } catch (error) {
      setChatError(error instanceof ApiError ? error.message : "Unable to reach the healthcare assistant right now.");
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: "I’m having trouble processing that request right now. Please try again in a moment.",
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsSending(false);
      requestAnimationFrame(() => composerTextareaRef.current?.focus());
    }
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend(input);
    }
  }

  async function handleDocumentDownload(document: DocumentRecord) {
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
  }

  return (
    <DashboardLayout>
      <motion.div initial="hidden" animate="visible" className="space-y-6">
        <motion.div variants={fadeUp} custom={0} className="dashboard-hero rounded-[2rem] px-6 py-6 sm:px-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground shadow-sm">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Patient Care Workspace
              </div>
              <h1 className="mt-4 font-display text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-[2.35rem]">
                Patient Care Hub
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                Hello, {user?.name}. Continue your care conversation, review what needs attention next, and keep your records in one calm workspace.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {["Multilingual support", "Saved medical history", "Connected follow-up reminders"].map((item) => (
                  <span key={item} className="rounded-full border border-white/75 bg-white/65 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{patientProfile?.status || "Monitoring"}</Badge>
              <Badge variant={getRiskBadgeVariant(triageLabel)}>
                Triage: {triageLabel}
              </Badge>
            </div>
          </div>
        </motion.div>

        {historyQuery.error && (
          <Alert variant="destructive" className="cinematic-alert">
            <AlertDescription>
              {historyQuery.error instanceof ApiError
                ? historyQuery.error.message
                : "Unable to load your conversation history right now."}
            </AlertDescription>
          </Alert>
        )}

        {chatError && (
          <Alert variant="destructive" className="cinematic-alert">
            <AlertDescription>{chatError}</AlertDescription>
          </Alert>
        )}

        <motion.div variants={fadeUp} custom={1} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Messages saved", value: String(messageCount), icon: Brain },
            { label: "Current triage", value: `${triageScore}/100`, icon: Stethoscope },
            { label: "Appointments", value: String(patientProfile?.appointments_requested || 0), icon: Calendar },
            { label: "Urgency score", value: `${earlyWarningScore}/12`, icon: AlertTriangle },
          ].map((item) => (
            <Card key={item.label} className="metric-card metric-card-hover border-white/70 bg-card/90 shadow-card">
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

        <motion.div variants={fadeUp} custom={2} className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="premium-section flex min-h-[680px] flex-col overflow-hidden shadow-elevated">
            <CardHeader className="border-b bg-muted/30">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <CardTitle className="flex items-center gap-2 font-display text-lg">
                  <Brain className="h-5 w-5 text-primary" />
                  Care Assistant
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                    <Languages className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Language</span>
                    <select
                      value={voiceLanguage}
                      onChange={(event) => setVoiceLanguage(event.target.value)}
                      className="bg-transparent outline-none"
                    >
                      {voiceLanguages.map((language) => (
                        <option key={language.value} value={language.value}>
                          {language.label} · {language.nativeLabel}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAutoSpeakReplies((current) => !current)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs transition-colors ${
                      autoSpeakReplies
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-border/60 bg-background/80 text-muted-foreground"
                    }`}
                  >
                    <Volume2 className="h-3.5 w-3.5" />
                    {autoSpeakReplies ? "Auto speak on" : "Auto speak off"}
                  </button>
                  <a
                    href={whatsAppHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 transition-colors hover:bg-emerald-100"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    Open WhatsApp
                  </a>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border border-border/60 bg-background/80 px-3 py-1.5">
                  Voice input: {speechRecognitionSupported ? "Ready" : "Not supported"}
                </span>
                <span className="rounded-full border border-border/60 bg-background/80 px-3 py-1.5">
                  Voice replies: {speechPlaybackSupported ? "Ready" : "Not supported"}
                </span>
                <span className="rounded-full border border-border/60 bg-background/80 px-3 py-1.5">
                  Active language: {getLanguageOption(voiceLanguage).nativeLabel}
                </span>
              </div>
              {voiceError && <p className="text-sm text-destructive">{voiceError}</p>}
            </CardHeader>
            <CardContent className="flex flex-1 flex-col p-0">
              <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
                {historyQuery.isLoading && messages.length === 0 && (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Loading your saved conversation...
                  </div>
                )}

                {!historyQuery.isLoading && messages.length === 0 && (
                  <div className="flex h-full flex-col items-center justify-center px-4 py-12 text-center">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-hero">
                      <Sparkles className="h-8 w-8 text-primary-foreground" />
                    </div>
                    <h3 className="font-display text-xl font-semibold text-foreground">How can I help today?</h3>
                    <p className="mt-2 max-w-md text-sm text-muted-foreground">
                      Ask about symptoms, request an appointment, speak in your language, or upload a prescription for guidance.
                    </p>
                    <div className="mt-6 grid w-full max-w-2xl gap-3 sm:grid-cols-2">
                      {suggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          onClick={() => handleSend(suggestion)}
                          className="rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white to-sky-50/60 p-4 text-left text-sm shadow-[0_10px_28px_rgba(15,23,42,0.05)] transition-all hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-[0_16px_34px_rgba(59,167,230,0.12)]"
                        >
                          <span className="block font-medium text-foreground">{suggestion}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((message, index) => {
                  const messageSpeakId = getMessageSpeakId(message, index);
                  const isAssistant = message.role === "assistant";
                  const assistantMeta = isAssistant ? getAssistantMessageMeta(message.content) : null;

                  return (
                  <div key={messageSpeakId} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-3xl px-4 py-3 shadow-sm sm:max-w-[78%] ${
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "border border-slate-200/90 bg-white text-foreground shadow-[0_8px_24px_rgba(15,23,42,0.06)]"
                      }`}
                    >
                      {assistantMeta && (
                        <div
                          className={`mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                            assistantMeta.variant === "appointment"
                              ? "bg-sky-50 text-sky-700 ring-1 ring-sky-200"
                            : assistantMeta.variant === "appointment-success"
                                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                              : assistantMeta.variant === "triage-routine"
                                ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                              : assistantMeta.variant === "triage-high"
                                ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
                                : "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                          }`}
                        >
                          {assistantMeta.variant === "emergency" ? (
                            <AlertTriangle className="h-3.5 w-3.5" />
                          ) : assistantMeta.variant === "triage-routine" || assistantMeta.variant === "triage-high" ? (
                            <Stethoscope className="h-3.5 w-3.5" />
                          ) : (
                            <Calendar className="h-3.5 w-3.5" />
                          )}
                          <span>{assistantMeta.title}</span>
                          <span className="text-slate-400">•</span>
                          <span>{assistantMeta.detail}</span>
                        </div>
                      )}
                      <div
                        className={
                          message.role === "assistant"
                            ? "assistant-markdown"
                            : "prose prose-sm max-w-none text-inherit prose-p:my-0 prose-strong:text-inherit prose-li:text-inherit prose-ul:my-2"
                        }
                      >
                        {message.role === "assistant" ? <ReactMarkdown>{message.content}</ReactMarkdown> : message.content}
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <p
                          className={`text-[11px] ${
                            message.role === "user" ? "text-primary-foreground/80" : "text-muted-foreground"
                          }`}
                        >
                          {getTimestampLabel(message.created_at)}
                        </p>
                        {isAssistant && (
                          <button
                            type="button"
                            onClick={() => speakMessage(message.content, messageSpeakId)}
                            className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/80 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                            aria-label={speakingMessageId === messageSpeakId ? "Stop voice reply" : "Play voice reply"}
                          >
                            <Volume2 className="h-3.5 w-3.5" />
                            {speakingMessageId === messageSpeakId ? "Stop" : "Listen"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )})}

                {isSending && (
                  <div className="flex justify-start">
                    <div className="rounded-3xl bg-muted px-4 py-3 text-sm text-muted-foreground">
                      Thinking through your request...
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t bg-card p-4 sm:p-5">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSend(input);
                  }}
                  className="space-y-3"
                >
                  {selectedFile && (
                    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-muted/40 px-3 py-3">
                      <div className="inline-flex items-center gap-2 rounded-full bg-background px-3 py-1.5 text-xs text-foreground">
                        <Paperclip className="h-3.5 w-3.5 text-primary" />
                        {selectedFile.name}
                      </div>
                      <select
                        value={documentType}
                        onChange={(event) => setDocumentType(event.target.value)}
                        className="rounded-full border border-border/60 bg-background px-3 py-1.5 text-xs text-muted-foreground outline-none"
                      >
                        <option value="prescription">Prescription</option>
                        <option value="lab_report">Lab Report</option>
                        <option value="discharge_note">Discharge Note</option>
                        <option value="insurance">Insurance</option>
                        <option value="other">Other</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => handleAttachmentPick(null)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background text-muted-foreground transition-colors hover:text-foreground"
                        aria-label="Remove attachment"
                      >
                        <X className="h-4 w-4" />
                      </button>
                      <p className="basis-full text-xs text-muted-foreground">
                        Handwritten prescription photos and scans are supported. You can continue the same concern in WhatsApp too.
                      </p>
                    </div>
                  )}

                  <div className="rounded-[18px] border border-slate-200 bg-white px-2.5 py-1.5 shadow-[0_6px_16px_rgba(15,23,42,0.045)]">
                    <div className="flex items-end gap-1">
                      <div className="flex items-center gap-1.5 pb-0.5">
                        <button
                          type="button"
                          onClick={() => attachmentInputRef.current?.click()}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition-colors hover:bg-slate-200"
                          aria-label="Attach media"
                        >
                          <Plus className="h-4.5 w-4.5" />
                        </button>
                      </div>

                      <div className="flex-1">
                        <Textarea
                          ref={composerTextareaRef}
                          value={input}
                          onChange={(event) => setInput(event.target.value)}
                          onKeyDown={handleComposerKeyDown}
                          placeholder={`Describe your health concern in ${getLanguageLabel(voiceLanguage)}...`}
                          disabled={isSending}
                          rows={1}
                          className="min-h-0 resize-none overflow-y-auto border-0 bg-transparent px-1.5 py-1 text-base leading-6 text-slate-900 placeholder:text-[15px] placeholder:text-slate-400 focus-visible:ring-0 focus-visible:ring-offset-0"
                        />
                        <input
                          ref={attachmentInputRef}
                          type="file"
                          accept="image/*,.pdf,text/*"
                          hidden
                          onChange={(event) => handleAttachmentPick(event.target.files?.[0] || null)}
                        />
                      </div>

                      <div className="flex items-center gap-1 pb-0.5">
                        <button
                          type="button"
                          onClick={isListening ? stopVoiceCapture : startVoiceCapture}
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                            isListening ? "bg-red-500 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                          aria-label={isListening ? "Stop voice input" : "Start voice input"}
                        >
                          {isListening ? <Square className="h-3 w-3" /> : <Mic className="h-4 w-4" />}
                        </button>
                        <button
                          type="submit"
                          disabled={isSending || (!input.trim() && !selectedFile)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                          aria-label="Send"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-1 text-[11px] text-muted-foreground">
                      <span>Press Enter to send. Use Shift + Enter for a new line.</span>
                      <span>Prescription photos and medical reports are supported.</span>
                    </div>
                  </div>
                </form>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-border/60 bg-card/95 shadow-card">
              <CardHeader>
                <CardTitle className="font-display text-lg">Today's Care Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="rounded-3xl border border-sky-200/70 bg-gradient-to-br from-sky-50 via-white to-emerald-50/70 p-5 shadow-[0_16px_34px_rgba(59,167,230,0.08)]">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Next best step</p>
                  <p className="mt-2 text-base font-semibold text-foreground">{patientNextStep.title}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{patientNextStep.body}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-gradient-to-br from-white to-sky-50/70 p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Current care</p>
                    <div className="mt-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-semibold text-foreground">{patientProfile?.status || "Monitoring"}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{recommendedAction}</p>
                      </div>
                      <Badge variant={getRiskBadgeVariant(triageLabel)}>{triageLabel}</Badge>
                    </div>
                  </div>
                  <div className="rounded-2xl bg-gradient-to-br from-white to-emerald-50/70 p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Next review</p>
                    <p className="mt-3 text-lg font-semibold text-foreground">{predictedFollowupWindow}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {patientProfile?.followup_due_at ? getExactTimestamp(patientProfile.followup_due_at) : "The care team will set this after review."}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-muted/50 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Reminder status</p>
                    <div className="mt-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-semibold text-foreground">{formatLabel(careCoordinatorStatus) || "On track"}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{followupOutreachWindow}</p>
                      </div>
                      <Badge variant={getRiskBadgeVariant(followupDropoutRiskLabel)}>{followupDropoutRiskLabel}</Badge>
                    </div>
                  </div>
                  <div className="rounded-2xl bg-muted/50 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Latest readings</p>
                    <p className="mt-3 text-sm font-medium text-foreground">{latestVital ? latestVital.summary || "Vitals saved" : "No vitals shared yet"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Last activity: {patientProfile?.last_interaction_at ? getExactTimestamp(patientProfile.last_interaction_at) : "No activity yet"}
                    </p>
                  </div>
                </div>

                <Accordion type="multiple" className="rounded-3xl border border-border/60 bg-gradient-to-br from-white to-slate-50/80 px-4 shadow-[0_12px_26px_rgba(15,23,42,0.04)]">
                  <AccordionItem value="symptoms">
                    <AccordionTrigger className="text-sm font-medium text-foreground">Symptoms and care insights</AccordionTrigger>
                    <AccordionContent className="space-y-4 pb-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Symptoms</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {symptoms.length > 0 ? (
                            symptoms.map((symptom) => (
                              <Badge key={symptom} variant="outline">
                                {symptom}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-sm text-foreground">No structured symptoms detected yet.</span>
                          )}
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border border-border/60 bg-background px-3 py-3">
                          <p className="text-xs text-muted-foreground">Duration and body area</p>
                          <p className="mt-1 text-sm text-foreground">{durationText}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{bodyParts.length > 0 ? bodyParts.join(", ") : "No body area detected yet."}</p>
                        </div>
                        <div className="rounded-xl border border-border/60 bg-background px-3 py-3">
                          <p className="text-xs text-muted-foreground">Medicines mentioned</p>
                          <p className="mt-1 text-sm text-foreground">{medications.length > 0 ? medications.join(", ") : "No medicines mentioned yet."}</p>
                        </div>
                        <div className="rounded-xl border border-border/60 bg-background px-3 py-3">
                          <p className="text-xs text-muted-foreground">Care outlook</p>
                          <p className="mt-1 text-sm text-foreground">{predictionReason}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{predictionLabel} · {predictionScore}/100</p>
                        </div>
                        <div className="rounded-xl border border-border/60 bg-background px-3 py-3">
                          <p className="text-xs text-muted-foreground">Urgency score</p>
                          <p className="mt-1 text-sm text-foreground">{earlyWarningSummary}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{earlyWarningPriority} · {earlyWarningWindow}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Red flags</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {redFlags.length > 0 ? (
                            redFlags.map((flag) => (
                              <Badge key={flag} variant="destructive">
                                {flag}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-sm text-foreground">No red flags detected.</span>
                          )}
                        </div>
                      </div>
                      {followUpQuestions.length > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground">Helpful follow-up questions</p>
                          <div className="mt-2 space-y-2">
                            {followUpQuestions.slice(0, 3).map((question) => (
                              <div key={question} className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm text-foreground">
                                {question}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="followup">
                    <AccordionTrigger className="text-sm font-medium text-foreground">Follow-up and reminders</AccordionTrigger>
                    <AccordionContent className="space-y-4 pb-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border border-border/60 bg-background px-3 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-muted-foreground">Return risk</p>
                            <Badge variant={getRiskBadgeVariant(readmissionRiskLabel)}>{readmissionRiskLabel}</Badge>
                          </div>
                          <p className="mt-1 text-sm text-foreground">{readmissionRiskSummary}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{relapseRiskWindow}</p>
                        </div>
                        <div className="rounded-xl border border-border/60 bg-background px-3 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-muted-foreground">Follow-up reliability</p>
                            <Badge variant={getRiskBadgeVariant(followupDropoutRiskLabel)}>{followupDropoutRiskLabel}</Badge>
                          </div>
                          <p className="mt-1 text-sm text-foreground">{followupDropoutRiskSummary}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{followupOutreachWindow}</p>
                        </div>
                      </div>
                      <div className="rounded-xl border border-border/60 bg-background px-3 py-3">
                        <p className="text-xs text-muted-foreground">Care-team reminder note</p>
                        <p className="mt-1 text-sm text-foreground">
                          {careCoordinatorNote ||
                            (careCoordinatorStatus === "resolved"
                              ? "Your latest follow-up reminder has already been completed."
                              : `The care team may contact you within ${followupOutreachWindow.toLowerCase()} to keep your care plan on track.`)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Updated by {careCoordinatorUpdatedBy} {careCoordinatorUpdatedAt ? `· ${getExactTimestamp(careCoordinatorUpdatedAt)}` : ""}
                        </p>
                      </div>
                      <div className="space-y-2">
                        {(careOutreachHistory.length > 0 ? careOutreachHistory.slice(0, 2) : []).map((entry, index) => (
                          <div key={`${entry.channel}-${entry.created_at || index}`} className="rounded-xl border border-border/60 bg-background px-3 py-2">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium text-foreground">{formatLabel(entry.channel)} reminder</p>
                                <p className="text-xs text-muted-foreground">
                                  {formatLabel(entry.status)} {entry.created_at ? `· ${getExactTimestamp(entry.created_at)}` : ""}
                                </p>
                              </div>
                              {entry.preview_url ? (
                                <a
                                  href={entry.preview_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                                >
                                  Open
                                </a>
                              ) : null}
                            </div>
                          </div>
                        ))}
                        {careOutreachHistory.length === 0 && (
                          <p className="text-sm text-muted-foreground">
                            Reminder emails, WhatsApp handoffs, or care-team calls will appear here when they are sent.
                          </p>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="history">
                    <AccordionTrigger className="text-sm font-medium text-foreground">Profile and care history</AccordionTrigger>
                    <AccordionContent className="space-y-4 pb-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border border-border/60 bg-background px-3 py-3">
                          <p className="text-xs text-muted-foreground">Patient profile</p>
                          <p className="mt-1 text-sm text-foreground">
                            {patientProfile?.dob ? `${formatDateOnly(patientProfile.dob)} · ` : ""}
                            {patientProfile?.age ?? "Age not shared"} · {formatLabel(patientProfile?.gender) || "Gender not shared"}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">{patientProfile?.phone || "Phone not shared"}</p>
                        </div>
                        <div className="rounded-xl border border-border/60 bg-background px-3 py-3">
                          <p className="text-xs text-muted-foreground">Medicine safety</p>
                          <p className="mt-1 text-sm text-foreground">{medicationRiskSummary}</p>
                          {interactingMedications.length > 0 && (
                            <p className="mt-1 text-xs text-muted-foreground">{interactingMedications.slice(0, 4).join(", ")}</p>
                          )}
                        </div>
                      </div>
                      <div className="rounded-xl border border-border/60 bg-background px-3 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-muted-foreground">Care history</p>
                          <Badge variant="outline">{timelineEvents.length} events</Badge>
                        </div>
                        <p className="mt-1 text-sm text-foreground">
                          {digitalTwin?.journey_summary || "Your saved chats, visits, vitals, and documents help the care team continue from the right context."}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Badge variant="secondary">Messages {digitalTwin?.counts?.messages ?? 0}</Badge>
                          <Badge variant="secondary">Visits {digitalTwin?.counts?.visits ?? 0}</Badge>
                          <Badge variant="secondary">Vitals {digitalTwin?.counts?.vitals ?? 0}</Badge>
                          <Badge variant="secondary">Documents {digitalTwin?.counts?.documents ?? 0}</Badge>
                        </div>
                        {careGaps.length > 0 && (
                          <p className="mt-2 text-xs text-muted-foreground">Care gaps: {careGaps.slice(0, 3).join(" · ")}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        {visitHistory.length > 0 ? (
                          visitHistory.slice(0, 3).map((visit: VisitHistoryEntry) => (
                            <div key={visit.appointment_id} className="rounded-xl border border-border/60 bg-background px-3 py-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium text-foreground">
                                    {visit.visit_reason || visit.diagnosis_summary || "Consultation review"}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {visit.doctor_name || "Doctor"} {visit.doctor_specialty ? `· ${formatLabel(visit.doctor_specialty)}` : ""}
                                  </p>
                                </div>
                                <span className="text-[11px] text-muted-foreground">{getExactTimestamp(visit.completed_at)}</span>
                              </div>
                              <p className="mt-2 text-xs text-muted-foreground">
                                {visit.follow_up_plan || visit.prescription_summary || visit.vitals_summary || visit.consultation_notes || "Visit details saved for future care context."}
                              </p>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Completed doctor visits will appear here and help the care team remember your history.
                          </p>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/95 shadow-card">
              <CardHeader>
                <CardTitle className="font-display text-lg">Health Records</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Keep daily readings, reports, and prescriptions together in one lighter, easier-to-scan area.
                </p>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="vitals" className="space-y-4">
                  <TabsList className="grid h-auto w-full grid-cols-2 rounded-2xl bg-muted/40 p-1">
                    <TabsTrigger value="vitals" className="rounded-xl py-2">Vitals</TabsTrigger>
                    <TabsTrigger value="documents" className="rounded-xl py-2">Documents</TabsTrigger>
                  </TabsList>

                  <TabsContent value="vitals" className="space-y-4">
                    {vitalError && (
                      <Alert variant="destructive">
                        <AlertDescription>{vitalError}</AlertDescription>
                      </Alert>
                    )}
                    <div className="rounded-3xl border border-border/60 bg-gradient-to-br from-white to-sky-50/60 p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                      <div className="mb-4 flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent">
                          <HeartPulse className="h-4.5 w-4.5 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">Daily Vitals</p>
                          <p className="text-xs text-muted-foreground">Add the latest readings you want the care team to see.</p>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {[
                          { key: "pulse", label: "Pulse", placeholder: "72" },
                          { key: "spo2", label: "SpO2", placeholder: "98" },
                          { key: "temperature", label: "Temperature", placeholder: "98.6" },
                          { key: "systolic_bp", label: "Systolic BP", placeholder: "120" },
                          { key: "diastolic_bp", label: "Diastolic BP", placeholder: "80" },
                          { key: "glucose", label: "Glucose", placeholder: "110" },
                        ].map((field) => (
                          <Input
                            key={field.key}
                            value={vitalForm[field.key as keyof typeof vitalForm] as string}
                            onChange={(event) =>
                              setVitalForm((current) => ({ ...current, [field.key]: event.target.value }))
                            }
                            placeholder={`${field.label} (${field.placeholder})`}
                            disabled={vitalMutation.isPending}
                            className="border-white/70 bg-white/90"
                          />
                        ))}
                      </div>
                      <textarea
                        value={vitalForm.notes}
                        onChange={(event) => setVitalForm((current) => ({ ...current, notes: event.target.value }))}
                        placeholder="Optional notes like dizziness, fasting reading, or taken after medication."
                        disabled={vitalMutation.isPending}
                        className="mt-3 min-h-[100px] w-full rounded-md border border-white/70 bg-white/90 px-3 py-2 text-sm"
                      />
                      <Button
                        variant="hero"
                        className="mt-3"
                        disabled={vitalMutation.isPending}
                        onClick={() => {
                          setVitalError("");
                          vitalMutation.mutate();
                        }}
                      >
                        {vitalMutation.isPending ? "Saving..." : "Save Vitals"}
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {vitals.length === 0 && (
                        <p className="text-sm text-muted-foreground">Recent vital readings will appear here after you submit them.</p>
                      )}
                      {vitals.slice(0, 4).map((vital: VitalRecord) => (
                        <div key={vital.id} className="rounded-2xl border border-border/60 bg-background/90 p-4 shadow-sm">
                          <div className="mb-2 flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium text-foreground">
                                Pulse {vital.pulse} · SpO2 {vital.spo2}% · Temp {vital.temperature}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                BP {vital.systolic_bp}/{vital.diastolic_bp} · Glucose {vital.glucose}
                              </p>
                            </div>
                            <Badge variant={vital.severity === "critical" || vital.severity === "high" ? "destructive" : vital.severity === "medium" ? "secondary" : "outline"}>
                              {vital.severity || "normal"}
                            </Badge>
                          </div>
                          <p className="text-sm text-foreground">{vital.summary || "No summary available."}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(vital.anomaly_flags || []).map((flag) => (
                              <Badge key={flag} variant="outline">
                                {flag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="documents" className="space-y-4">
                    {documentError && (
                      <Alert variant="destructive">
                        <AlertDescription>{documentError}</AlertDescription>
                      </Alert>
                    )}
                    <div className="rounded-3xl border border-border/60 bg-gradient-to-br from-white to-emerald-50/50 p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                      <div className="mb-4 flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent">
                          <FileText className="h-4.5 w-4.5 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">Reports and Prescriptions</p>
                          <p className="text-xs text-muted-foreground">Upload prescriptions, lab reports, or discharge notes and keep them linked to your care history.</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <Input
                          value={documentTitle}
                          onChange={(event) => setDocumentTitle(event.target.value)}
                          placeholder="Document title, e.g. CBC Lab Report"
                          disabled={uploadMutation.isPending}
                          className="border-white/70 bg-white/90"
                        />
                        <select
                          value={documentType}
                          onChange={(event) => setDocumentType(event.target.value)}
                          disabled={uploadMutation.isPending}
                          className="flex h-10 w-full rounded-md border border-white/70 bg-white/90 px-3 py-2 text-sm"
                        >
                          <option value="lab_report">Lab Report</option>
                          <option value="prescription">Prescription</option>
                          <option value="discharge_note">Discharge Note</option>
                          <option value="insurance">Insurance</option>
                          <option value="other">Other</option>
                        </select>
                        <textarea
                          value={documentNotes}
                          onChange={(event) => setDocumentNotes(event.target.value)}
                          placeholder="Add context or paste prescription text here for medicine extraction."
                          disabled={uploadMutation.isPending}
                          className="min-h-[110px] w-full rounded-md border border-white/70 bg-white/90 px-3 py-2 text-sm"
                        />
                        <input
                          type="file"
                          disabled={uploadMutation.isPending}
                          onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                          className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-medium"
                        />
                        <Button
                          variant="hero"
                          disabled={uploadMutation.isPending || !documentTitle.trim()}
                          onClick={() => {
                            setDocumentError("");
                            uploadMutation.mutate();
                          }}
                        >
                          {uploadMutation.isPending ? "Uploading..." : "Upload Document"}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {documents.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          Uploaded medical documents will appear here for you and your care team.
                        </p>
                      )}
                      {documents.slice(0, 4).map((document: DocumentRecord) => (
                        <div key={document.id} className="rounded-2xl border border-border/60 bg-background/90 p-4 shadow-sm">
                          <div className="mb-2 flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium text-foreground">{document.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {document.file_name || "No file name"} · {formatFileSize(document.file_size)}
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
                          <p className="text-sm text-foreground">{document.summary || "No document summary available yet."}</p>
                          {document.document_type === "lab_report" && (
                            <div className="mt-3 rounded-2xl border border-border/60 bg-background/80 px-3 py-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Lab intelligence</p>
                                <Badge variant={getRiskBadgeVariant(document.lab_alert_level === "critical" ? "Critical" : document.lab_alert_level === "high" ? "High" : document.lab_alert_level === "medium" ? "Medium" : "Low")}>
                                  {document.lab_alert_level || "low"}
                                </Badge>
                              </div>
                              <p className="mt-2 text-sm text-foreground">
                                {document.abnormal_value_count ? `${document.abnormal_value_count} abnormal value(s) detected.` : "No abnormal lab value was strongly flagged automatically."}
                              </p>
                              {(document.abnormal_findings?.length || 0) > 0 && (
                                <div className="mt-2 space-y-2">
                                  {document.abnormal_findings?.slice(0, 3).map((item) => (
                                    <div key={`${document.id}-lab-${item}`} className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-sm text-foreground">
                                      {item}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {document.document_type === "discharge_note" && (
                            <div className="mt-3 rounded-2xl border border-border/60 bg-background/80 px-3 py-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Discharge risk summary</p>
                                <Badge variant={getRiskBadgeVariant(document.discharge_risk_level === "high" ? "High" : document.discharge_risk_level === "medium" ? "Medium" : "Low")}>
                                  {document.discharge_risk_level || "low"}
                                </Badge>
                              </div>
                              <p className="mt-2 text-sm text-foreground">
                                {document.discharge_risk_summary || "No high-risk discharge wording was auto-detected."}
                              </p>
                              {(document.discharge_red_flags?.length || 0) > 0 && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {document.discharge_red_flags?.slice(0, 3).map((item) => (
                                    <Badge key={`${document.id}-flag-${item}`} variant="secondary">
                                      {item}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {document.document_type === "prescription" && (document.medication_schedule?.length || 0) > 0 && (
                            <div className="mt-3 space-y-2 rounded-2xl bg-accent/40 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Medication schedule</p>
                                <p className="text-xs text-muted-foreground">
                                  Confidence: {Math.round((document.extraction_confidence || 0) * 100)}%
                                </p>
                              </div>
                              {(document.medication_schedule || []).map((entry) => (
                                <div key={`${document.id}-${entry.drug_name}`} className="rounded-xl border border-border/60 bg-background px-3 py-2">
                                  <p className="text-sm font-medium text-foreground">{entry.drug_name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    Dosage: {entry.dosage} · Timing: {entry.timing}{entry.duration ? ` · Duration: ${entry.duration}` : ""}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                          {document.document_type === "prescription" && (
                            <div className="mt-3 rounded-2xl border border-border/60 bg-background/80 px-3 py-3">
                              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Extraction details</p>
                              <p className="mt-1 text-sm text-foreground">
                                Source: {document.ocr_source ? document.ocr_source.replace(/_/g, " ") : "manual text"} · Status:{" "}
                                {document.ocr_status ? document.ocr_status.replace(/_/g, " ") : "not available"}
                              </p>
                              {document.ai_interpretation_notes && (
                                <p className="mt-2 text-sm text-foreground">
                                  AI interpretation note: {document.ai_interpretation_notes}
                                </p>
                              )}
                              {document.ocr_text_excerpt && (
                                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                  Text preview: {document.ocr_text_excerpt}
                                </p>
                              )}
                              {document.extraction_model && (
                                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                  Model: {document.extraction_model.replace(/-/g, " ")}
                                </p>
                              )}
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(document.extracted_tags || []).map((tag) => (
                              <Badge key={tag} variant="outline">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                          {((document.follow_up_recommendations?.length || 0) > 0 || (document.discharge_key_diagnoses?.length || 0) > 0 || (document.discharge_procedures?.length || 0) > 0) && (
                            <div className="mt-3 rounded-2xl bg-muted/40 p-3">
                              {(document.discharge_key_diagnoses?.length || 0) > 0 && (
                                <p className="text-sm text-foreground">
                                  Diagnosis: {document.discharge_key_diagnoses?.slice(0, 2).join(" ")}
                                </p>
                              )}
                              {(document.discharge_procedures?.length || 0) > 0 && (
                                <p className="mt-2 text-sm text-foreground">
                                  Procedure: {document.discharge_procedures?.slice(0, 2).join(" ")}
                                </p>
                              )}
                              {(document.follow_up_recommendations?.length || 0) > 0 && (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  Follow-up: {document.follow_up_recommendations?.slice(0, 2).join(" ")}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </motion.div>

        <motion.div variants={fadeUp} custom={3}>
          <Card className="border-border/60 bg-card/95 shadow-card">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 font-display text-lg">
                  <Activity className="h-5 w-5 text-primary" />
                  Care Journey Timeline
                </CardTitle>
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                  Your saved chats, visits, vitals, and documents stay linked here so every future review starts with the right context.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{digitalTwin?.care_phase || "Monitoring"}</Badge>
                <Badge variant="outline">{timelineEvents.length} saved events</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-3xl border border-border/60 bg-gradient-to-br from-white to-sky-50/50 p-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)]">
                <p className="text-sm text-foreground">
                  {digitalTwin?.journey_summary || "As you continue using the assistant, your longitudinal care timeline will grow here automatically."}
                </p>
              </div>

              {timelineEvents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                  Timeline events will appear here once you chat, upload a document, record vitals, or complete a doctor visit.
                </div>
              ) : (
                <div className="space-y-3">
                  {timelineEvents.slice(0, 12).map((event) => {
                    const TimelineIcon = getTimelineIcon(event.type);

                    return (
                      <div key={`${event.type}-${event.timestamp}-${event.title}`} className="rounded-3xl border border-border/60 bg-gradient-to-br from-white to-slate-50/70 p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent">
                              <TimelineIcon className="h-4.5 w-4.5 text-primary" />
                            </div>
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-foreground">{event.title}</p>
                                <Badge variant={getRiskBadgeVariant(event.severity)}>{formatLabel(event.severity)}</Badge>
                              </div>
                              <p className="mt-1 text-sm leading-6 text-muted-foreground">{event.detail}</p>
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {getExactTimestamp(event.timestamp)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    </DashboardLayout>
  );
}
