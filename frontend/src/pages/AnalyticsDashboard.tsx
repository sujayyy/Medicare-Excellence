import { useMemo } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  endOfMonth,
  endOfWeek,
  format,
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
import { AlertTriangle, CalendarClock, ShieldAlert, TrendingUp, Users, Waves } from "lucide-react";

import DashboardLayout from "@/components/DashboardLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { ApiError, getAnalyticsOverview, getEmergencies, getPatients, getStats } from "@/lib/api";

const riskColors = {
  Low: "hsl(152 69% 41%)",
  Medium: "hsl(38 92% 50%)",
  High: "hsl(8 82% 56%)",
  Critical: "hsl(345 83% 47%)",
} as const;

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

function formatLabel(value?: string) {
  if (!value) {
    return "";
  }

  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
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
    return `${urgentCoordinatorTasks} urgent follow-up tasks are active while ${topCluster} is the strongest symptom trend building across the hospital.`;
  }

  if (urgentCoordinatorTasks > 0) {
    return `${urgentCoordinatorTasks} urgent follow-up tasks currently need hospital follow-through.`;
  }

  if (topCluster) {
    return `${topCluster} is the strongest cluster signal in the current monitoring window.`;
  }

  return `${highRiskPatients} higher-risk patient${highRiskPatients === 1 ? "" : "s"} are active in the current monitoring window.`;
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
  }, [overview?.risk_distribution, patients]);

  const highRiskPatients = useMemo(
    () => patients.filter((patient) => ["High", "Critical"].includes(patient.risk_level || patient.triage_label || "")).length,
    [patients],
  );

  const symptomDistribution = overview?.symptom_distribution || [];
  const priorityPatients = overview?.priority_patients || [];
  const demandForecast = overview?.demand_forecast;
  const anomalySignals = overview?.anomaly_signals || [];
  const outbreakClusters = overview?.outbreak_clusters || [];
  const reviewQueueSummary = overview?.review_queue_summary;
  const careCoordinatorSummary = overview?.care_coordinator_summary;
  const careCoordinatorQueue = overview?.care_coordinator_queue || [];
  const documentIntelligenceSummary = overview?.document_intelligence_summary;
  const executiveSummary = overview?.executive_summary;
  const specialtyDemand = overview?.specialty_demand || [];
  const urgentCoordinatorTasks = overview?.operational_flags?.care_coordinator_urgent_tasks ?? 0;
  const analyticsNarrative = getAnalyticsNarrative({
    urgentCoordinatorTasks,
    topCluster: outbreakClusters[0]?.cluster,
    highRiskPatients,
  });

  const statCards = [
    {
      label: "Patient Load",
      value: stats?.totalPatients ?? patients.length,
      helper: `${highRiskPatients} higher-risk profiles being watched`,
      icon: Users,
    },
    {
      label: "Open Emergencies",
      value: stats?.openEmergencies ?? emergencies.filter((entry) => entry.status === "open").length,
      helper: `${stats?.totalEmergencies ?? emergencies.length} total logs in hospital history`,
      icon: AlertTriangle,
    },
    {
      label: "Urgent Follow-ups",
      value: urgentCoordinatorTasks,
      helper: `${careCoordinatorQueue.length} total coordinator tasks in queue`,
      icon: CalendarClock,
    },
    {
      label: "Open Capacity",
      value: executiveSummary?.available_capacity ?? 0,
      helper: `${executiveSummary?.slot_utilization ?? 0}% slot utilization`,
      icon: TrendingUp,
    },
  ];

  const fadeUp = {
    hidden: { opacity: 0, y: 18 },
    visible: (index: number) => ({
      opacity: 1,
      y: 0,
      transition: { delay: index * 0.05, duration: 0.32, ease: "easeOut" as const },
    }),
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="dashboard-hero rounded-[2rem] px-6 py-6 sm:px-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground shadow-sm backdrop-blur-xl">
                <Waves className="h-3.5 w-3.5 text-primary" />
                Hospital Analytics
              </div>
              <h1 className="mt-4 font-display text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-[2.35rem]">
                Operations Analytics
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                A practical view of hospital load, emergency movement, specialty pressure, and follow-up demand.
              </p>
              <p className="mt-3 max-w-2xl rounded-2xl border border-border/60 bg-background/65 px-4 py-3 text-sm text-foreground shadow-sm backdrop-blur-xl">
                {analyticsNarrative}
              </p>
            </div>
            <Badge variant="secondary">{urgentCoordinatorTasks} urgent coordinator tasks</Badge>
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
              <Card className="metric-card metric-card-hover border-border/60 bg-card/95 shadow-card">
                <CardContent className="p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent">
                      <item.icon className="h-5 w-5 text-primary" />
                    </div>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="font-display text-2xl font-bold text-foreground">{item.value}</p>
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{item.helper}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card className="premium-section depth-card border-border/60 bg-card/95 shadow-card">
            <CardHeader>
              <CardTitle className="font-display text-lg">Monthly Patient And Emergency Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={monthlyActivity}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.22)" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="patients" fill="hsl(199 89% 48%)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="emergencies" fill="hsl(8 82% 56%)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="premium-section depth-card border-border/60 bg-card/95 shadow-card">
            <CardHeader>
              <CardTitle className="font-display text-lg">Weekly Care Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={weeklyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.22)" />
                  <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="activePatients" stroke="hsl(168 76% 42%)" strokeWidth={3} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="emergencyCases" stroke="hsl(8 82% 56%)" strokeWidth={3} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Card className="premium-section depth-card border-border/60 bg-card/95 shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Capacity And Staffing Outlook</CardTitle>
              <Badge variant="outline">{demandForecast?.forecast_window || "Next 7 days"}</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  { label: "Projected patients", value: demandForecast?.projected_patient_load ?? 0 },
                  { label: "Projected emergencies", value: demandForecast?.projected_emergency_load ?? 0 },
                  { label: "Staffing pressure", value: demandForecast?.staffing_pressure || "Stable" },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl bg-muted/40 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{item.label}</p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">{item.value}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border border-border/60 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="font-medium text-foreground">Specialty demand</p>
                  <Badge variant="outline">{specialtyDemand.length} specialties</Badge>
                </div>
                <div className="space-y-2">
                  {specialtyDemand.length === 0 && (
                      <p className="text-sm text-muted-foreground">Specialty pressure will appear here once appointment traffic builds up.</p>
                  )}
                  {specialtyDemand.slice(0, 6).map((entry) => (
                    <div key={entry.specialty} className="flex items-center justify-between rounded-xl bg-muted/30 px-3 py-2">
                      <span className="text-sm text-foreground">{formatLabel(entry.specialty)}</span>
                      <Badge variant="outline">{entry.count}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="premium-section depth-card border-border/60 bg-card/95 shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Care Coordination Load</CardTitle>
              <Badge variant={careCoordinatorQueue.length > 0 ? "secondary" : "outline"}>{careCoordinatorQueue.length} tasks</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-4">
                {[
                  { label: "Immediate", value: reviewQueueSummary?.immediate ?? 0 },
                  { label: "Critical", value: careCoordinatorSummary?.critical ?? 0 },
                  { label: "High", value: careCoordinatorSummary?.high ?? 0 },
                  { label: "Medium", value: careCoordinatorSummary?.medium ?? 0 },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl bg-muted/40 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{item.label}</p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">{item.value}</p>
                  </div>
                ))}
              </div>
              {careCoordinatorQueue.length === 0 && (
                <p className="text-sm text-muted-foreground">No follow-up tasks are being prioritized right now.</p>
              )}
              {careCoordinatorQueue.slice(0, 4).map((task) => (
                <div key={`${task.patient_id || task.patient_email}-${task.task_type}`} className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="font-medium text-foreground">{task.patient_name}</p>
                    <Badge variant={task.priority === "Critical" || task.priority === "High" ? "destructive" : task.priority === "Medium" ? "secondary" : "outline"}>
                      {task.priority}
                    </Badge>
                  </div>
                  <p className="text-sm text-foreground">{task.summary}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatLabel(task.task_type)} · {task.outreach_window}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="premium-section depth-card border-border/60 bg-card/95 shadow-card">
            <CardHeader>
              <CardTitle className="font-display text-lg">Patient Risk Mix</CardTitle>
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

          <Card className="premium-section depth-card border-border/60 bg-card/95 shadow-card">
            <CardHeader>
              <CardTitle className="font-display text-lg">Symptom Hotspots</CardTitle>
            </CardHeader>
            <CardContent>
              {symptomDistribution.length === 0 ? (
                <p className="text-sm text-muted-foreground">Symptom hotspots will appear here once patient chats accumulate structured extraction data.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={symptomDistribution}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.22)" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} angle={-18} textAnchor="end" height={56} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="hsl(199 89% 48%)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <Card className="premium-section depth-card border-border/60 bg-card/95 shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Patients Needing Attention</CardTitle>
              <Badge variant="secondary">
                {overview?.operational_flags?.high_risk_patients ?? highRiskPatients} high risk
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              {priorityPatients.length === 0 && (
                <p className="text-sm text-muted-foreground">Priority patient signals will appear here as clinical activity builds up.</p>
              )}
              {priorityPatients.map((patient) => (
                <div key={patient.id || patient.email} className="rounded-2xl border border-border/60 p-4">
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
                  <p className="mt-2 text-xs text-muted-foreground">
                    {patient.escalation_note || patient.predicted_followup_window || "Needs follow-up review."}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="premium-section depth-card border-border/60 bg-card/95 shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display text-lg">Outbreak And Anomaly Watch</CardTitle>
              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-4">
              {anomalySignals.length === 0 && outbreakClusters.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No unusual symptom spikes or emergency surges are visible right now.
                </p>
              )}
              {anomalySignals.slice(0, 3).map((signal) => (
                <div key={signal.signal} className="rounded-2xl border border-border/60 p-4">
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
              {outbreakClusters.slice(0, 2).map((cluster) => (
                <div key={cluster.cluster} className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{cluster.cluster}</p>
                      <p className="text-xs text-muted-foreground">
                        {cluster.top_symptoms.length > 0 ? `Top symptoms: ${cluster.top_symptoms.join(", ")}` : "Cluster activity detected"}
                      </p>
                    </div>
                    <Badge variant={cluster.severity === "high" ? "destructive" : "secondary"}>{cluster.severity}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{cluster.summary}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="premium-section depth-card border-border/60 bg-card/95 shadow-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-display text-lg">Clinical Document Intake</CardTitle>
            <Badge variant="outline">{documentIntelligenceSummary?.total_documents ?? 0} documents</Badge>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
