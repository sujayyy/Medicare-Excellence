import { useQuery } from "@tanstack/react-query";
import { ClipboardList, CalendarClock, Users } from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";

import DashboardLayout from "@/components/DashboardLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { ApiError, getPatients } from "@/lib/api";
import type { PatientRecord } from "@/types/api";

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

function compactList(values?: string[]) {
  return values && values.length > 0 ? values.join(", ") : "Not extracted yet";
}

export default function DoctorAssignedPatientsPage() {
  const { token } = useAuth();
  const navigate = useNavigate();

  const patientsQuery = useQuery({
    queryKey: ["doctor-patients", "page"],
    queryFn: () => getPatients(token || ""),
    enabled: Boolean(token),
  });

  const patients = patientsQuery.data?.patients || [];
  const error = patientsQuery.error;
  const highPriorityPatients = patients.filter((patient) => ["Critical", "High"].includes(patient.risk_level || "")).length;
  const recentlyUpdatedPatients = patients
    .slice()
    .sort((left, right) => (right.updated_at || "").localeCompare(left.updated_at || ""))
    .slice(0, 3);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="dashboard-hero rounded-[2rem] px-6 py-6 sm:px-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground shadow-sm backdrop-blur-xl">
                <Users className="h-3.5 w-3.5 text-primary" />
                Assigned Patients
              </div>
              <h1 className="mt-4 font-display text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-[2.35rem]">
                Assigned Patients
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                A clean doctor-side list of current patients, their concern, current status, and what needs to happen next.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{patients.length} patients</Badge>
              <Badge variant="outline">{highPriorityPatients} high priority</Badge>
            </div>
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="cinematic-alert">
            <AlertDescription>
              {error instanceof ApiError ? error.message : "Unable to load assigned patients right now."}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="metric-card border-border/60 bg-card/95 shadow-card">
            <CardContent className="space-y-2 p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Assigned Now</p>
              <p className="font-display text-3xl font-semibold text-foreground">{patients.length}</p>
              <p className="text-sm text-muted-foreground">Patients currently visible in your active queue.</p>
            </CardContent>
          </Card>
          <Card className="metric-card border-border/60 bg-card/95 shadow-card">
            <CardContent className="space-y-2 p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">High Priority</p>
              <p className="font-display text-3xl font-semibold text-foreground">{highPriorityPatients}</p>
              <p className="text-sm text-muted-foreground">Cases that may need faster review or follow-up.</p>
            </CardContent>
          </Card>
          <Card className="metric-card border-border/60 bg-card/95 shadow-card">
            <CardContent className="space-y-2 p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Latest Update</p>
              <p className="font-display text-xl font-semibold text-foreground">
                {recentlyUpdatedPatients[0]?.name || "No patient activity yet"}
              </p>
              <p className="text-sm text-muted-foreground">
                {recentlyUpdatedPatients[0]
                  ? `${formatDate(recentlyUpdatedPatients[0].updated_at)} · ${formatLabel(recentlyUpdatedPatients[0].status) || "Pending"}`
                  : "Once patients are assigned, their latest updates will surface here."}
              </p>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="premium-section shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="font-display text-lg">Patient roster</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Keep this view focused on concern, status, and next action instead of exposing noisy backend scores.
                </p>
              </div>
              <Badge variant="outline">{patients.length} total</Badge>
            </CardHeader>
            <CardContent>
              {patients.length === 0 && (
                <div className="mb-5 rounded-2xl border border-dashed border-border/60 bg-muted/20 p-5">
                  <p className="font-medium text-foreground">No assigned patients yet.</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Patients will appear here after they book your published slots or when a case is routed to your desk.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => navigate("/doctor/slots")}>
                      Open slot manager
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => navigate("/doctor")}>
                      Back to dashboard
                    </Button>
                  </div>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead>Concern</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Next step</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {patients.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        No patients are assigned yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {patients.map((patient: PatientRecord) => (
                    <TableRow key={patient.id || patient.email}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-foreground">{patient.name}</p>
                          <p className="text-xs text-muted-foreground">{patient.email || "No email on file"}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm text-foreground">{patient.summary_headline || compactList(patient.symptoms)}</p>
                          <p className="text-xs text-muted-foreground">
                            {patient.duration_text || "No duration"} {patient.body_parts && patient.body_parts.length > 0 ? `· ${patient.body_parts.join(", ")}` : ""}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant="outline">{formatLabel(patient.status) || "Pending"}</Badge>
                          <p className="text-xs text-muted-foreground">{patient.risk_level || "Stable"}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm text-foreground">{patient.recommended_action || patient.followup_priority || "Routine follow-up"}</p>
                          <p className="text-xs text-muted-foreground">{patient.triage_reason || "Review in progress"}</p>
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(patient.updated_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="premium-section shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="font-display text-lg">Recent care notes</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  A simple operational summary of the latest patient context without duplicating the entire dashboard.
                </p>
              </div>
              <Badge variant="outline">
                <ClipboardList className="mr-1 h-3.5 w-3.5" />
                Latest updates
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {patients.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border/60 bg-muted/20 p-5">
                  <div className="flex items-center gap-2 text-foreground">
                    <CalendarClock className="h-4 w-4 text-primary" />
                    <p className="font-medium">No recent care notes yet</p>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Recent consultation summaries, follow-up notes, and latest updates will appear here once patient cases start moving through your queue.
                  </p>
                </div>
              )}
              {patients.slice(0, 5).map((patient) => (
                <div key={`note-${patient.id || patient.email}`} className="rounded-2xl border border-border/60 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-foreground">{patient.name}</p>
                    <span className="text-xs text-muted-foreground">{formatDate(patient.updated_at)}</span>
                  </div>
                  <p className="mt-2 text-sm text-foreground">
                    {patient.clinical_summary || patient.last_summary || patient.summary_headline || "No new care note is recorded yet."}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
