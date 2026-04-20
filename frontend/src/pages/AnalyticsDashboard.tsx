import { useMemo } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  endOfMonth,
  endOfWeek,
  format,
  formatDistanceToNowStrict,
  isWithinInterval,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, CalendarClock, MessagesSquare, ShieldAlert, TrendingUp, Users, Waves } from "lucide-react";

import DashboardLayout from "@/components/DashboardLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { ApiError, getAnalyticsOverview, getEmergencies, getPatients, getStats } from "@/lib/api";

const riskColors = {
  Low: "hsl(152 69% 41%)",
  Medium: "hsl(38 92% 50%)",
  High: "hsl(0 72% 51%)",
  Critical: "hsl(345 83% 47%)",
} as const;

const outbreakColors = ["hsl(199 89% 48%)", "hsl(168 76% 42%)", "hsl(345 83% 47%)"] as const;

function safeDate(value?: string) {
  if (!value) {
    return null;
  }

  try {
    return parseISO(value);
  } catch {
    return null;
  }
}

function getAnalyticsNarrative({
  urgentCoordinatorTasks,
  topCluster,
  highRiskPatients,
}: {
  urgentCoordinatorTasks: number;
  topCluster?: string;
  highRiskPatients: number;
}) {
  if (urgentCoordinatorTasks > 0 && topCluster) {
    return `${urgentCoordinatorTasks} urgent coordination task${urgentCoordinatorTasks === 1 ? "" : "s"} are active while ${topCluster} remains the strongest symptom signal.`;
  }

  if (urgentCoordinatorTasks > 0) {
    return `${urgentCoordinatorTasks} urgent coordination task${urgentCoordinatorTasks === 1 ? "" : "s"} currently need hospital follow-through.`;
  }

  if (topCluster) {
    return `${topCluster} is the strongest current cluster signal across the monitored patient population.`;
  }

  return `${highRiskPatients} high-risk patient${highRiskPatients === 1 ? "" : "s"} are active in the current monitoring window.`;
}

export default function AnalyticsDashboard() {
  const { token } = useAuth();

  const statsQuery = useQuery({
    queryKey: ["analytics-stats"],
    queryFn: () => getStats(token || ""),
    enabled: Boolean(token),
  });

  const patientsQuery = useQuery({
    queryKey: ["analytics-patients"],
    queryFn: () => getPatients(token || ""),
    enabled: Boolean(token),
  });

  const emergenciesQuery = useQuery({
    queryKey: ["analytics-emergencies"],
    queryFn: () => getEmergencies(token || ""),
    enabled: Boolean(token),
  });

  const overviewQuery = useQuery({
    queryKey: ["analytics-overview"],
    queryFn: () => getAnalyticsOverview(token || ""),
    enabled: Boolean(token),
  });

  const error = statsQuery.error || patientsQuery.error || emergenciesQuery.error || overviewQuery.error;
  const stats = statsQuery.data;
  const patients = patientsQuery.data?.patients || [];
  const emergencies = emergenciesQuery.data?.emergencies || [];
  const overview = overviewQuery.data;

  const monthlyActivity = useMemo(() => {
    return Array.from({ length: 6 }, (_, index) => {
      const monthStart = startOfMonth(subMonths(new Date(), 5 - index));
      const monthEnd = endOfMonth(monthStart);

      return {
        month: format(monthStart, "MMM"),
        patients: patients.filter((patient) => {
          const createdAt = safeDate(patient.created_at || patient.updated_at);
          return createdAt && isWithinInterval(createdAt, { start: monthStart, end: monthEnd });
        }).length,
        emergencies: emergencies.filter((entry) => {
          const createdAt = safeDate(entry.created_at);
          return createdAt && isWithinInterval(createdAt, { start: monthStart, end: monthEnd });
        }).length,
      };
    });
  }, [patients, emergencies]);

  const weeklyTrend = useMemo(() => {
    return Array.from({ length: 4 }, (_, index) => {
      const weekStart = startOfWeek(subWeeks(new Date(), 3 - index), { weekStartsOn: 1 });
      const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

      return {
        week: format(weekStart, "'Wk' d MMM"),
        activePatients: patients.filter((patient) => {
          const updatedAt = safeDate(patient.updated_at || patient.created_at);
          return updatedAt && isWithinInterval(updatedAt, { start: weekStart, end: weekEnd });
        }).length,
        emergencyCases: emergencies.filter((entry) => {
          const createdAt = safeDate(entry.created_at);
          return createdAt && isWithinInterval(createdAt, { start: weekStart, end: weekEnd });
        }).length,
      };
    });
  }, [patients, emergencies]);

  const riskDistribution = useMemo(() => {
    if (overview?.risk_distribution?.length) {
      return overview.risk_distribution.map((entry) => ({
        name: entry.name,
        value: entry.count,
        color: riskColors[entry.name as keyof typeof riskColors] || "hsl(215 14% 46%)",
      }));
    }

    const counts = patients.reduce<Record<string, number>>((accumulator, patient) => {
      const risk = patient.risk_level || "Low";
      accumulator[risk] = (accumulator[risk] || 0) + 1;
      return accumulator;
    }, {});

    return Object.entries(counts).map(([name, value]) => ({
      name,
      value,
      color: riskColors[name as keyof typeof riskColors] || "hsl(215 14% 46%)",
    }));
  }, [patients]);

  const deteriorationDistribution = useMemo(() => {
    if (overview?.deterioration_distribution?.length) {
      return overview.deterioration_distribution.map((entry) => ({
        name: entry.name,
        value: entry.count,
        color: riskColors[entry.name as keyof typeof riskColors] || "hsl(215 14% 46%)",
      }));
    }

    const counts = patients.reduce<Record<string, number>>((accumulator, patient) => {
      const risk = patient.deterioration_prediction_label || "Low";
      accumulator[risk] = (accumulator[risk] || 0) + 1;
      return accumulator;
    }, {});

    return Object.entries(counts).map(([name, value]) => ({
      name,
      value,
      color: riskColors[name as keyof typeof riskColors] || "hsl(215 14% 46%)",
    }));
  }, [overview?.deterioration_distribution, patients]);

  const highRiskPatients = useMemo(
    () => patients.filter((patient) => ["High", "Critical"].includes(patient.risk_level || patient.triage_label || "")).length,
    [patients],
  );

  const symptomDistribution = overview?.symptom_distribution || [];
  const redFlagDistribution = overview?.red_flag_distribution || [];
  const careFunnel = overview?.care_funnel || [];
  const priorityPatients = overview?.priority_patients || [];
  const demandForecast = overview?.demand_forecast;
  const anomalySignals = overview?.anomaly_signals || [];
  const outbreakClusters = overview?.outbreak_clusters || [];
  const outbreakTimeline = overview?.outbreak_timeline || [];
  const predictionWatchlist = overview?.prediction_watchlist || [];
  const reviewQueueSummary = overview?.review_queue_summary;
  const careCoordinatorSummary = overview?.care_coordinator_summary;
  const careCoordinatorQueue = overview?.care_coordinator_queue || [];
  const modelMetrics = overview?.model_metrics;
  const documentIntelligenceSummary = overview?.document_intelligence_summary;
  const urgentCoordinatorTasks = overview?.operational_flags?.care_coordinator_urgent_tasks ?? 0;
  const analyticsNarrative = getAnalyticsNarrative({
    urgentCoordinatorTasks,
    topCluster: outbreakClusters[0]?.cluster,
    highRiskPatients,
  });

  const outbreakTrendSeries = useMemo(() => {
    const topClusters = outbreakClusters.slice(0, 3).map((entry) => entry.cluster);
    return {
      topClusters,
      data: outbreakTimeline.map((point) => {
        const row: Record<string, string | number> = { day: point.day };
        topClusters.forEach((cluster) => {
          row[cluster] = typeof point[cluster] === "number" ? Number(point[cluster]) : 0;
        });
        return row;
      }),
    };
  }, [outbreakClusters, outbreakTimeline]);

  const statCards = [
    {
      label: "Total Patients",
      value: stats?.totalPatients ?? patients.length,
      icon: Users,
      helper: `${patients.filter((patient) => patient.status === "Active").length} active profiles`,
    },
    {
      label: "Open Emergencies",
      value: stats?.openEmergencies ?? emergencies.filter((entry) => entry.status === "open").length,
      icon: AlertTriangle,
      helper: `${stats?.totalEmergencies ?? emergencies.length} total logged`,
    },
    {
      label: "Active Chats",
      value: stats?.activeChats ?? 0,
      icon: MessagesSquare,
      helper: "Patient histories saved in MongoDB",
    },
    {
      label: "Appointment Requests",
      value: stats?.appointmentRequests ?? 0,
      icon: CalendarClock,
      helper: `${patients.filter((patient) => (patient.appointments_requested || 0) > 0).length} patients requesting care`,
    },
  ];

  const fadeUp = {
    hidden: { opacity: 0, y: 18 },
    visible: (index: number) => ({
      opacity: 1,
      y: 0,
      transition: { delay: index * 0.06, duration: 0.35, ease: "easeOut" as const },
    }),
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="dashboard-hero rounded-[2rem] px-6 py-6 sm:px-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground shadow-sm">
                <Waves className="h-3.5 w-3.5 text-primary" />
                Forecast And Intelligence
              </div>
              <h1 className="mt-4 font-display text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-[2.35rem]">
                Analytics Dashboard
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                Live care activity, patient trends, emergency patterns, and operational forecasting for the hospital admin workspace.
              </p>
              <p className="mt-3 max-w-2xl rounded-2xl border border-white/80 bg-white/65 px-4 py-3 text-sm text-foreground shadow-sm">
                {analyticsNarrative}
              </p>
            </div>
            <Badge variant="secondary">
              {urgentCoordinatorTasks} urgent coordinator tasks
            </Badge>
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="cinematic-alert">
            <AlertDescription>
              {error instanceof ApiError ? error.message : "Unable to load analytics right now."}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {statCards.map((item, index) => (
            <motion.div key={item.label} initial="hidden" animate="visible" variants={fadeUp} custom={index}>
            <Card className="metric-card metric-card-hover border-white/70 bg-card/95 shadow-card">
              <CardContent className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent">
                    <item.icon className="h-5 w-5 text-primary" />
                  </div>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="font-display text-2xl font-bold text-foreground">{item.value}</p>
                <p className="text-sm text-muted-foreground">{item.label}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {item.label === "Open Emergencies"
                    ? `${overview?.operational_flags?.predicted_high_risk_patients ?? 0} patients predicted to worsen`
                    : item.helper}
                </p>
              </CardContent>
            </Card>
            </motion.div>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card className="premium-section depth-card border-white/70 bg-card/95 shadow-elevated">
            <CardHeader>
              <CardTitle className="font-display text-lg">Monthly Patient And Emergency Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={monthlyActivity}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 20% 90%)" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="patients" fill="hsl(199 89% 48%)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="emergencies" fill="hsl(0 72% 51%)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="premium-section depth-card border-white/70 bg-card/95 shadow-card">
            <CardHeader>
              <CardTitle className="font-display text-lg">Risk Distribution</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={riskDistribution.length > 0 ? riskDistribution : [{ name: "No data", value: 1, color: "hsl(214 20% 90%)" }]}
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={105}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {(riskDistribution.length > 0 ? riskDistribution : [{ name: "No data", value: 1, color: "hsl(214 20% 90%)" }]).map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Card className="premium-section depth-card border-white/70 bg-card/95 shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Care Coordinator Queue</CardTitle>
              <Badge variant={careCoordinatorQueue.length > 0 ? "secondary" : "outline"}>{careCoordinatorQueue.length} tasks</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This is the operational handoff list for the care team, showing which predicted risks have been converted into action-ready follow-up work.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  { label: "Critical", value: careCoordinatorSummary?.critical ?? 0 },
                  { label: "High", value: careCoordinatorSummary?.high ?? 0 },
                  { label: "Medium", value: careCoordinatorSummary?.medium ?? 0 },
                  { label: "Low", value: careCoordinatorSummary?.low ?? 0 },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl bg-white/60 p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                    <p className="mt-2 font-display text-2xl font-bold text-foreground">{item.value}</p>
                  </div>
                ))}
              </div>
              {careCoordinatorQueue.length === 0 && (
                <p className="text-sm text-muted-foreground">No active coordinator tasks are being prioritized right now. This usually means current follow-up risk is stable across the monitored population.</p>
              )}
              {careCoordinatorQueue.slice(0, 4).map((task) => (
                <div key={`${task.patient_id || task.patient_email}-${task.task_type}`} className="rounded-2xl border border-white/70 bg-white/55 p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="font-medium text-foreground">{task.patient_name}</p>
                    <Badge variant={task.priority === "Critical" || task.priority === "High" ? "destructive" : task.priority === "Medium" ? "secondary" : "outline"}>
                      {task.priority}
                    </Badge>
                  </div>
                  <p className="text-sm text-foreground">{task.summary}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {task.task_type.replace(/_/g, " ")} · {task.outreach_window} · score {task.score}/100
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="premium-section depth-card border-white/70 bg-card/95 shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">AI Model Evaluation</CardTitle>
              <Badge variant="outline">{modelMetrics?.dataset_size ?? 0} benchmark cases</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  { label: "Triage Accuracy", value: modelMetrics ? `${Math.round((modelMetrics.triage_accuracy || 0) * 100)}%` : "N/A" },
                  { label: "Triage Macro F1", value: modelMetrics ? `${Math.round((modelMetrics.triage_macro_f1 || 0) * 100)}%` : "N/A" },
                  { label: "Specialty Accuracy", value: modelMetrics ? `${Math.round((modelMetrics.specialty_accuracy || 0) * 100)}%` : "N/A" },
                  { label: "Baseline Triage", value: modelMetrics ? `${Math.round((modelMetrics.triage_baseline_accuracy || 0) * 100)}%` : "N/A" },
                  { label: "Baseline Specialty", value: modelMetrics ? `${Math.round((modelMetrics.specialty_baseline_accuracy || 0) * 100)}%` : "N/A" },
                  { label: "Embedding Backend", value: modelMetrics?.transformer_enabled ? "Transformer" : "Fallback" },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl bg-white/60 p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                    <p className="mt-2 font-display text-2xl font-bold text-foreground">{item.value}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/55 p-4">
                <p className="text-sm text-foreground">
                  {modelMetrics?.triage_model_version || "transformer-semantic-triage-v3"} uses a semantic embedding layer for triage and specialty routing.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Backend: {modelMetrics?.embedding_backend || "hashing-vectorizer-medical-v1"} · {modelMetrics?.specialty_model_version || "transformer-semantic-specialty-v3"}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Artifact: {modelMetrics?.artifact_saved ? "saved" : "not saved"}{modelMetrics?.artifact_path ? ` · ${modelMetrics.artifact_path}` : ""}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="premium-section depth-card border-white/70 bg-card/95 shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Demand Forecast</CardTitle>
              <Badge variant="outline">{demandForecast?.forecast_window || "Next 7 days"}</Badge>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              {[
                {
                  label: "Projected Patients",
                  value: demandForecast?.projected_patient_load ?? 0,
                },
                {
                  label: "Projected Emergencies",
                  value: demandForecast?.projected_emergency_load ?? 0,
                },
                {
                  label: "Staffing Pressure",
                  value: demandForecast?.staffing_pressure || "Stable",
                },
              ].map((item) => (
                  <div key={item.label} className="rounded-2xl bg-white/60 p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                    <div className="mt-2 flex items-center gap-3">
                      <Waves className="h-4 w-4 text-primary" />
                    <p className="font-display text-2xl font-bold text-foreground">{item.value}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="premium-section depth-card border-white/70 bg-card/95 shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Anomaly Watch</CardTitle>
              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-3">
              {anomalySignals.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No unusual symptom spikes or emergency surges are visible right now.
                </p>
              )}
              {anomalySignals.map((signal) => (
                <div key={signal.signal} className="rounded-2xl border border-white/70 bg-white/55 p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="font-medium capitalize text-foreground">{signal.signal}</p>
                    <Badge variant={signal.severity === "high" ? "destructive" : "secondary"}>{signal.severity}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{signal.summary}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Recent: {signal.recent_count} · Baseline: {signal.baseline_count}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <Card className="premium-section depth-card border-white/70 bg-card/95 shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Clinical Document Intelligence</CardTitle>
              <Badge variant="outline">{documentIntelligenceSummary?.total_documents ?? 0} documents</Badge>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {[
                { label: "Flagged", value: documentIntelligenceSummary?.flagged_documents ?? 0 },
                { label: "Prescriptions", value: documentIntelligenceSummary?.prescriptions ?? 0 },
                { label: "Lab Reports", value: documentIntelligenceSummary?.lab_reports ?? 0 },
                { label: "Discharge Notes", value: documentIntelligenceSummary?.discharge_notes ?? 0 },
                { label: "Transformer OCR", value: modelMetrics?.transformer_enabled ? "On" : "Fallback" },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl bg-white/60 p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                  <p className="mt-2 font-display text-2xl font-bold text-foreground">{item.value}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="premium-section depth-card border-white/70 bg-card/95 shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Model Sample Predictions</CardTitle>
              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-3">
              {(modelMetrics?.sample_predictions || []).map((sample, index) => (
                <div key={`${sample.text}-${index}`} className="rounded-2xl border border-white/70 bg-white/55 p-4">
                  <p className="text-sm font-medium text-foreground">{sample.text}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Triage: expected {sample.expected_triage}, predicted {sample.predicted_triage} · confidence {Math.round((sample.triage_confidence || 0) * 100)}%
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Specialty: expected {sample.expected_specialty}, predicted {sample.predicted_specialty}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <Card className="premium-section depth-card border-white/70 bg-card/95 shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Outbreak Trend Monitor</CardTitle>
              <Badge variant="outline">Last 7 days</Badge>
            </CardHeader>
            <CardContent>
              {outbreakTrendSeries.topClusters.length === 0 || outbreakTrendSeries.data.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Cluster trendlines will appear once enough symptom activity is recorded for anomaly comparison.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={outbreakTrendSeries.data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 20% 90%)" />
                    <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    {outbreakTrendSeries.topClusters.map((cluster, index) => (
                      <Line
                        key={cluster}
                        type="monotone"
                        dataKey={cluster}
                        stroke={outbreakColors[index % outbreakColors.length]}
                        strokeWidth={3}
                        dot={{ r: 3 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="premium-section depth-card border-white/70 bg-card/95 shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Outbreak Cluster Watch</CardTitle>
              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-3">
              {outbreakClusters.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No cluster is currently rising far enough above baseline to trigger an outbreak watch signal.
                </p>
              )}
              {outbreakClusters.map((cluster) => (
                <div key={cluster.cluster} className="rounded-2xl border border-white/70 bg-white/55 p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{cluster.cluster}</p>
                      <p className="text-xs text-muted-foreground">
                        Top symptoms: {cluster.top_symptoms.length > 0 ? cluster.top_symptoms.join(", ") : "general clinical complaints"}
                      </p>
                    </div>
                    <Badge variant={cluster.severity === "high" ? "destructive" : "secondary"}>{cluster.severity}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{cluster.summary}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Recent: {cluster.recent_count} · Baseline/day: {cluster.baseline_daily_avg} · Anomaly score: {cluster.anomaly_score}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <Card className="premium-section depth-card border-white/70 bg-card/95 shadow-card">
            <CardHeader>
              <CardTitle className="font-display text-lg">Symptom Hotspots</CardTitle>
            </CardHeader>
            <CardContent>
              {symptomDistribution.length === 0 ? (
                <p className="text-sm text-muted-foreground">Symptoms will appear here once patient chats accumulate structured extraction data.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={symptomDistribution}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 20% 90%)" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} angle={-18} textAnchor="end" height={56} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="hsl(199 89% 48%)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="premium-section depth-card border-white/70 bg-card/95 shadow-card">
            <CardHeader>
              <CardTitle className="font-display text-lg">Care Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              {careFunnel.length === 0 ? (
                <p className="text-sm text-muted-foreground">Care funnel metrics will populate once activity is recorded.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={careFunnel}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 20% 90%)" />
                    <XAxis dataKey="stage" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="value" fill="hsl(168 76% 42%)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <Card className="premium-section depth-card border-white/70 bg-card/95 shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Patients Needing Attention</CardTitle>
              <Badge variant="secondary">
                {overview?.operational_flags?.high_risk_patients ?? highRiskPatients} high risk
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              {priorityPatients.length === 0 && (
                <p className="text-sm text-muted-foreground">Priority patient signals will appear here as triage and summaries are generated.</p>
              )}
              {priorityPatients.map((patient) => (
                <div key={patient.id || patient.email} className="rounded-2xl border border-white/70 bg-white/55 p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{patient.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {patient.email || "No email on file"} {patient.assigned_doctor_name ? `· ${patient.assigned_doctor_name}` : ""}
                      </p>
                    </div>
                    <Badge variant={patient.risk_level === "Critical" || patient.risk_level === "High" ? "destructive" : patient.risk_level === "Medium" ? "secondary" : "outline"}>
                      {patient.risk_level}
                    </Badge>
                  </div>
                  <p className="text-sm font-medium text-foreground">{patient.summary_headline}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{patient.clinical_summary}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{patient.escalation_note}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Prediction: {patient.deterioration_prediction_label || "Low"} ({patient.deterioration_prediction_score ?? 0}/100) · {patient.predicted_followup_window || "Routine 72-hour review"}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="depth-card border-white/70 bg-card/95 shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Red-Flag Signals</CardTitle>
              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-3">
              {redFlagDistribution.length === 0 && (
                <p className="text-sm text-muted-foreground">Red-flag symptom extraction will appear here when urgent phrases are detected.</p>
              )}
              {redFlagDistribution.map((entry) => (
                <div key={entry.name} className="rounded-2xl bg-white/60 p-4 shadow-sm">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="font-medium text-foreground capitalize">{entry.name}</p>
                    <Badge variant="destructive">{entry.count}</Badge>
                  </div>
                  <div className="h-2 rounded-full bg-background">
                    <div
                      className="h-2 rounded-full bg-destructive"
                      style={{ width: `${Math.max(12, Math.min(100, entry.count * 16))}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
          <Card className="premium-section depth-card border-white/70 bg-card/95 shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Prediction Review Queue</CardTitle>
              <Badge variant="outline">Near-term follow-up</Badge>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {[
                { label: "Immediate", value: reviewQueueSummary?.immediate ?? 0 },
                { label: "Within 6 Hours", value: reviewQueueSummary?.within_6_hours ?? 0 },
                { label: "Within 24 Hours", value: reviewQueueSummary?.within_24_hours ?? 0 },
                { label: "Routine", value: reviewQueueSummary?.routine ?? 0 },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl bg-white/60 p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                  <p className="mt-2 font-display text-2xl font-bold text-foreground">{item.value}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="premium-section depth-card border-white/70 bg-card/95 shadow-card">
            <CardHeader>
              <CardTitle className="font-display text-lg">Deterioration Prediction Distribution</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={deteriorationDistribution.length > 0 ? deteriorationDistribution : [{ name: "No data", value: 1, color: "hsl(214 20% 90%)" }]}
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={105}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {(deteriorationDistribution.length > 0 ? deteriorationDistribution : [{ name: "No data", value: 1, color: "hsl(214 20% 90%)" }]).map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <Card className="premium-section depth-card border-white/70 bg-card/95 shadow-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-display text-lg">Triage Confusion Matrix</CardTitle>
            <Badge variant="outline">Benchmark view</Badge>
          </CardHeader>
          <CardContent>
            {!(modelMetrics?.triage_confusion_matrix?.length) ? (
              <p className="text-sm text-muted-foreground">Confusion matrix data will appear here once benchmark evaluation is available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border/60">
                      <th className="px-3 py-2 font-medium text-muted-foreground">Actual \ Predicted</th>
                      {["Low", "Medium", "High", "Critical"].map((label) => (
                        <th key={label} className="px-3 py-2 font-medium text-muted-foreground">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {modelMetrics.triage_confusion_matrix.map((row) => (
                      <tr key={String(row.label)} className="border-b border-border/40">
                        <td className="px-3 py-2 font-medium text-foreground">{String(row.label)}</td>
                        {["Low", "Medium", "High", "Critical"].map((label) => (
                          <td key={`${row.label}-${label}`} className="px-3 py-2 text-foreground">{Number(row[label] || 0)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="premium-section depth-card border-white/70 bg-card/95 shadow-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-display text-lg">Predicted Worsening Watchlist</CardTitle>
            <Badge variant="secondary">{predictionWatchlist.length} patients</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {predictionWatchlist.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Prediction watchlist entries will appear here once the AI deterioration model has enough patient activity to score.
              </p>
            )}
            {predictionWatchlist.map((patient) => {
              const nextCheck = safeDate(patient.prediction_next_check_at);
              return (
                <div key={patient.id || patient.email || patient.name} className="rounded-2xl border border-white/70 bg-white/55 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground">{patient.name}</p>
                        <Badge
                          variant={
                            patient.deterioration_prediction_label === "Critical" || patient.deterioration_prediction_label === "High"
                              ? "destructive"
                              : patient.deterioration_prediction_label === "Medium"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {patient.deterioration_prediction_label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {patient.email || "No email on file"}
                        {patient.assigned_doctor_name ? ` · ${patient.assigned_doctor_name}` : ""}
                        {patient.triage_label ? ` · Triage ${patient.triage_label}` : ""}
                      </p>
                    </div>
                    <div className="text-left md:text-right">
                      <p className="font-display text-xl font-bold text-foreground">{patient.deterioration_prediction_score}/100</p>
                      <p className="text-xs text-muted-foreground">{patient.predicted_followup_window}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm font-medium text-foreground">{patient.summary_headline || "AI deterioration watchlist entry."}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{patient.deterioration_prediction_reason}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {patient.worsening_flag ? "Worsening trend detected" : `Trajectory: ${patient.risk_trajectory || "stable"}`}
                    {nextCheck ? ` · Next review ${formatDistanceToNowStrict(nextCheck, { addSuffix: true })}` : ""}
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="premium-section depth-card border-white/70 bg-card/95 shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-lg">Weekly Care Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={weeklyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 20% 90%)" />
                <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="activePatients" stroke="hsl(168 76% 42%)" strokeWidth={3} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="emergencyCases" stroke="hsl(0 72% 51%)" strokeWidth={3} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
