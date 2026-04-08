import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Activity, AlertTriangle, Brain, Calendar, Clock3, HeartPulse, Languages, Mic, Send, Sparkles, Square, Stethoscope, Volume2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useMutation, useQuery } from "@tanstack/react-query";

import DashboardLayout from "@/components/DashboardLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ApiError, createVital, getChatHistory, getDocuments, getVitals, sendChatMessage, uploadDocument } from "@/lib/api";
import type { ChatMessage, DocumentRecord, VitalRecord } from "@/types/api";

const suggestions = [
  "I have a persistent headache and mild fever",
  "I want to book an appointment for tomorrow",
  "I am feeling shortness of breath and chest discomfort",
  "What precautions should I take for high blood pressure?",
];

const voiceLanguages = [
  { value: "en-IN", label: "English" },
  { value: "hi-IN", label: "Hindi" },
  { value: "ta-IN", label: "Tamil" },
  { value: "te-IN", label: "Telugu" },
  { value: "ml-IN", label: "Malayalam" },
  { value: "bn-IN", label: "Bengali" },
];

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
  const [voiceLanguage, setVoiceLanguage] = useState("en-IN");
  const [voiceError, setVoiceError] = useState("");
  const [isListening, setIsListening] = useState(false);
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

      return uploadDocument(token, {
        title: documentTitle.trim(),
        document_type: documentType,
        notes: documentNotes.trim(),
        file_name: selectedFile?.name,
        content_type: selectedFile?.type,
        file_size: selectedFile?.size,
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
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isSending]);

  const patientProfile = historyQuery.data?.patient || profile;
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
  const documents = documentsQuery.data?.documents || [];
  const vitals = vitalsQuery.data?.vitals || [];
  const latestVital = vitals[0];
  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant");

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
        setInput(transcript);
        toast({
          title: "Voice captured",
          description: "Review the text and send it when you're ready.",
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

  function speakLatestReply() {
    if (!latestAssistantMessage?.content || typeof window === "undefined" || !window.speechSynthesis) {
      setVoiceError("Speech playback is not available right now.");
      return;
    }

    setVoiceError("");
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      latestAssistantMessage.content.replace(/[#*_`>-]/g, " "),
    );
    utterance.lang = voiceLanguage;
    utterance.rate = 0.96;
    window.speechSynthesis.speak(utterance);
  }

  async function handleSend(rawText: string) {
    const text = rawText.trim();
    if (!text || !token || isSending) {
      return;
    }

    const outgoingMessage: ChatMessage = {
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };

    setMessages((current) => [...current, outgoingMessage]);
    setInput("");
    setChatError("");
    setIsSending(true);

    try {
      const response = await sendChatMessage(token, text);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: response.response,
          created_at: new Date().toISOString(),
        },
      ]);
      void historyQuery.refetch();
    } catch (error) {
      setChatError(error instanceof ApiError ? error.message : "Unable to reach the healthcare assistant right now.");
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: "I’m having trouble reaching the backend right now. Please try again in a moment.",
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">Hello, {user?.name}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Continue your AI care conversation, review prior messages, and monitor your latest care status in one place.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{patientProfile?.status || "Monitoring"}</Badge>
            <Badge variant={getRiskBadgeVariant(triageLabel)}>
              Triage: {triageLabel}
            </Badge>
          </div>
        </div>

        {historyQuery.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {historyQuery.error instanceof ApiError
                ? historyQuery.error.message
                : "Unable to load your conversation history right now."}
            </AlertDescription>
          </Alert>
        )}

        {chatError && (
          <Alert variant="destructive">
            <AlertDescription>{chatError}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Messages Saved", value: String(messageCount), icon: Brain },
            { label: "Triage Score", value: `${triageScore}/100`, icon: Stethoscope },
            { label: "Appointments Requested", value: String(patientProfile?.appointments_requested || 0), icon: Calendar },
            { label: "Emergency Flags", value: String(patientProfile?.emergency_count || 0), icon: AlertTriangle },
          ].map((item) => (
            <Card key={item.label} className="border-border/60 bg-card/90 shadow-card">
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
          <Card className="flex min-h-[680px] flex-col overflow-hidden border-border/60 bg-card/95 shadow-elevated">
            <CardHeader className="border-b bg-muted/30">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <CardTitle className="flex items-center gap-2 font-display text-lg">
                  <Brain className="h-5 w-5 text-primary" />
                  AI Health Assistant
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                    <Languages className="h-3.5 w-3.5" />
                    <select
                      value={voiceLanguage}
                      onChange={(event) => setVoiceLanguage(event.target.value)}
                      className="bg-transparent outline-none"
                    >
                      {voiceLanguages.map((language) => (
                        <option key={language.value} value={language.value}>
                          {language.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={isListening ? stopVoiceCapture : startVoiceCapture}>
                    {isListening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    {isListening ? "Stop" : "Voice input"}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={speakLatestReply} disabled={!latestAssistantMessage}>
                    <Volume2 className="h-4 w-4" />
                    Speak reply
                  </Button>
                </div>
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
                      Ask about symptoms, request an appointment, or describe an urgent situation so it can be logged quickly.
                    </p>
                    <div className="mt-6 grid w-full max-w-2xl gap-3 sm:grid-cols-2">
                      {suggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          onClick={() => handleSend(suggestion)}
                          className="rounded-2xl border border-border/60 bg-background p-4 text-left text-sm shadow-card transition-colors hover:bg-accent"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((message, index) => (
                  <div key={`${message.role}-${index}-${message.created_at || ""}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-3xl px-4 py-3 shadow-sm sm:max-w-[78%] ${
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      }`}
                    >
                      <div className="prose prose-sm max-w-none text-inherit prose-p:my-0 prose-strong:text-inherit prose-li:text-inherit prose-ul:my-2">
                        {message.role === "assistant" ? <ReactMarkdown>{message.content}</ReactMarkdown> : message.content}
                      </div>
                      <p
                        className={`mt-2 text-[11px] ${
                          message.role === "user" ? "text-primary-foreground/80" : "text-muted-foreground"
                        }`}
                      >
                        {getTimestampLabel(message.created_at)}
                      </p>
                    </div>
                  </div>
                ))}

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
                  className="flex gap-3"
                >
                  <Input
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Describe symptoms, ask for guidance, or request an appointment..."
                    disabled={isSending}
                  />
                  <Button type="submit" variant="hero" disabled={isSending || !input.trim()}>
                    <Send className="h-4 w-4" />
                    <span className="hidden sm:inline">Send</span>
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-border/60 bg-card/95 shadow-card">
              <CardHeader>
                <CardTitle className="font-display text-lg">Health Snapshot</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="rounded-2xl bg-muted/50 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Current status</p>
                  <p className="mt-2 text-lg font-semibold text-foreground">{patientProfile?.status || "Monitoring"}</p>
                </div>
                <div className="rounded-2xl bg-muted/50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Latest triage assessment</p>
                      <p className="mt-2 text-lg font-semibold text-foreground">{triageLabel}</p>
                    </div>
                    <Badge variant={getRiskBadgeVariant(triageLabel)}>{triageScore}/100</Badge>
                  </div>
                  <p className="mt-3 text-foreground">{triageReason}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{recommendedAction}</p>
                </div>
                <div className="rounded-2xl bg-muted/50 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Extracted symptom details</p>
                  <div className="mt-3 space-y-3">
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
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                      <div>
                        <p className="text-xs text-muted-foreground">Duration</p>
                        <p className="mt-1 text-sm text-foreground">{durationText}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Body parts</p>
                        <p className="mt-1 text-sm text-foreground">
                          {bodyParts.length > 0 ? bodyParts.join(", ") : "No body area detected yet."}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Medications mentioned</p>
                        <p className="mt-1 text-sm text-foreground">
                          {medications.length > 0 ? medications.join(", ") : "No medications detected yet."}
                        </p>
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
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl bg-muted/50 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Adaptive follow-up questions</p>
                  <div className="mt-3 space-y-2">
                    {followUpQuestions.length > 0 ? (
                      followUpQuestions.map((question) => (
                        <div key={question} className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm text-foreground">
                          {question}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Follow-up prompts will appear here when the assistant needs more context for triage.
                      </p>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl bg-muted/50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Care outlook prediction</p>
                    <Badge variant={getRiskBadgeVariant(predictionLabel)}>{predictionLabel}</Badge>
                  </div>
                  <p className="mt-3 text-sm text-foreground">{predictionReason}</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                    <div>
                      <p className="text-xs text-muted-foreground">Prediction score</p>
                      <p className="mt-1 text-sm text-foreground">{predictionScore}/100</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Recommended check-in</p>
                      <p className="mt-1 text-sm text-foreground">{predictedFollowupWindow}</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl bg-muted/50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Risk trend</p>
                    <Badge variant={worseningFlag ? "destructive" : riskTrajectory === "rising" ? "secondary" : "outline"}>
                      {worseningFlag ? "Worsening" : riskTrajectory}
                    </Badge>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                    <div>
                      <p className="text-xs text-muted-foreground">Repeat symptom count</p>
                      <p className="mt-1 text-sm text-foreground">{repeatSymptomCount}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Repeated symptoms</p>
                      <p className="mt-1 text-sm text-foreground">
                        {repeatedSymptoms.length > 0 ? repeatedSymptoms.join(", ") : "No repeated symptom pattern detected yet."}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                  <div className="rounded-2xl bg-muted/50 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Latest vitals</p>
                    <p className="mt-2 text-foreground">
                      {latestVital ? latestVital.summary || "Vitals submitted" : "No vitals submitted yet"}
                    </p>
                    {latestVital && (
                      <Badge variant={latestVital.severity === "critical" || latestVital.severity === "high" ? "destructive" : latestVital.severity === "medium" ? "secondary" : "outline"} className="mt-2">
                        {latestVital.severity || "normal"}
                      </Badge>
                    )}
                  </div>
                  <div className="rounded-2xl bg-muted/50 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Last interaction</p>
                    <p className="mt-2 text-foreground">
                      {patientProfile?.last_interaction_at ? getExactTimestamp(patientProfile.last_interaction_at) : "No activity yet"}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-muted/50 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Latest summary</p>
                    <p className="mt-2 line-clamp-4 text-foreground">
                      {patientProfile?.last_summary || "Your recent symptoms and requests will appear here after you chat."}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/95 shadow-card">
              <CardHeader>
                <CardTitle className="font-display text-lg">Conversation Timeline</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {messages.length === 0 && (
                  <p className="text-sm text-muted-foreground">Once you start chatting, your recent activity will appear here.</p>
                )}

                {messages.slice(-6).reverse().map((message, index) => (
                  <div key={`${message.role}-timeline-${index}-${message.created_at || ""}`} className="rounded-2xl border border-border/60 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <Badge variant={message.role === "assistant" ? "secondary" : "outline"}>
                        {message.role === "assistant" ? "Assistant" : "You"}
                      </Badge>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock3 className="h-3.5 w-3.5" />
                        {getExactTimestamp(message.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-foreground">{message.content}</p>
                  </div>
                ))}
                {messages.length > 0 && (
                  <div className="rounded-2xl border border-border/60 bg-accent/40 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <Badge variant={getRiskBadgeVariant(triageLabel)}>AI Triage</Badge>
                      <span className="text-xs text-muted-foreground">{triageScore}/100</span>
                    </div>
                    <p className="text-sm text-foreground">{triageReason}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{recommendedAction}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/95 shadow-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-display text-lg">
                  <HeartPulse className="h-5 w-5 text-primary" />
                  Vitals Tracker
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {vitalError && (
                  <Alert variant="destructive">
                    <AlertDescription>{vitalError}</AlertDescription>
                  </Alert>
                )}
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
                    />
                  ))}
                </div>
                <textarea
                  value={vitalForm.notes}
                  onChange={(event) => setVitalForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Optional notes like dizziness, fasting reading, or taken after medication."
                  disabled={vitalMutation.isPending}
                  className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <Button
                  variant="hero"
                  disabled={vitalMutation.isPending}
                  onClick={() => {
                    setVitalError("");
                    vitalMutation.mutate();
                  }}
                >
                  {vitalMutation.isPending ? "Saving..." : "Save Vitals"}
                </Button>
                <div className="space-y-3">
                  {vitals.length === 0 && (
                    <p className="text-sm text-muted-foreground">Recent vital readings will appear here after you submit them.</p>
                  )}
                  {vitals.slice(0, 4).map((vital: VitalRecord) => (
                    <div key={vital.id} className="rounded-2xl border border-border/60 p-4">
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
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/95 shadow-card">
              <CardHeader>
                <CardTitle className="font-display text-lg">Medical Documents</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {documentError && (
                  <Alert variant="destructive">
                    <AlertDescription>{documentError}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-3 rounded-2xl bg-muted/50 p-4">
                  <Input
                    value={documentTitle}
                    onChange={(event) => setDocumentTitle(event.target.value)}
                    placeholder="Document title, e.g. CBC Lab Report"
                    disabled={uploadMutation.isPending}
                  />
                  <select
                    value={documentType}
                    onChange={(event) => setDocumentType(event.target.value)}
                    disabled={uploadMutation.isPending}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
                    placeholder="Add context for your doctor, like key results or why this file matters."
                    disabled={uploadMutation.isPending}
                    className="min-h-[110px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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

                <div className="space-y-3">
                  {documents.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Uploaded medical documents will appear here for you and your care team.
                    </p>
                  )}
                  {documents.slice(0, 4).map((document: DocumentRecord) => (
                    <div key={document.id} className="rounded-2xl border border-border/60 p-4">
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-foreground">{document.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {document.file_name || "No file name"} · {formatFileSize(document.file_size)}
                          </p>
                        </div>
                        <Badge variant={document.review_priority === "Urgent" ? "destructive" : document.review_priority === "Priority" ? "secondary" : "outline"}>
                          {document.review_priority || "Routine"}
                        </Badge>
                      </div>
                      <p className="text-sm text-foreground">{document.summary || "No document summary available yet."}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(document.extracted_tags || []).map((tag) => (
                          <Badge key={tag} variant="outline">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
