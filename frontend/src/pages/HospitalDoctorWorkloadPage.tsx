import { useMemo } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronDown, ClipboardList, Clock3, Stethoscope, Users } from "lucide-react";

import DashboardLayout from "@/components/DashboardLayout";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { ApiError, getAnalyticsOverview, getAppointments } from "@/lib/api";
import type { AppointmentRecord } from "@/types/api";

function formatLabel(value?: string) {
  if (!value) {
    return "";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatStatusLabel(value?: string) {
  return formatLabel(value || "pending");
}

function getStatusVariant(status?: string) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "completed") {
    return "secondary" as const;
  }
  if (normalized === "in_consultation") {
    return "destructive" as const;
  }
  return "outline" as const;
}

function formatTimelinePoint(timestamp?: string | null) {
  if (!timestamp) {
    return "";
  }

  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return "";
  }

  return format(value, "dd MMM · hh:mm a");
}

function formatSlotMoment(date?: string, time?: string) {
  if (!date && !time) {
    return "Timeline pending";
  }
  return [date, time].filter(Boolean).join(" · ");
}

export default function HospitalDoctorWorkloadPage() {
  const { token } = useAuth();

  const overviewQuery = useQuery({
    queryKey: ["hospital-admin-analytics-overview", "doctor-workload-page"],
    queryFn: () => getAnalyticsOverview(token || ""),
    enabled: Boolean(token),
  });

  const appointmentsQuery = useQuery({
    queryKey: ["hospital-admin-appointments", "doctor-workload-page"],
    queryFn: () => getAppointments(token || ""),
    enabled: Boolean(token),
  });

  const error = overviewQuery.error || appointmentsQuery.error;
  const overview = overviewQuery.data;
  const doctorWorkload = overview?.doctor_workload || [];
  const appointments = appointmentsQuery.data?.appointments || [];

  const appointmentsByDoctor = useMemo(() => {
    return appointments.reduce<Record<string, AppointmentRecord[]>>((accumulator, appointment) => {
      if (!appointment.assigned_doctor_id) {
        return accumulator;
      }
      accumulator[appointment.assigned_doctor_id] = [...(accumulator[appointment.assigned_doctor_id] || []), appointment].sort((left, right) => {
        const leftTime = new Date(left.updated_at || left.completed_at || left.consultation_started_at || left.created_at || 0).getTime();
        const rightTime = new Date(right.updated_at || right.completed_at || right.consultation_started_at || right.created_at || 0).getTime();
        return rightTime - leftTime;
      });
      return accumulator;
    }, {});
  }, [appointments]);

  const summary = useMemo(
    () => ({
      totalDoctors: overview?.executive_summary?.total_doctors ?? doctorWorkload.length,
      totalCases: doctorWorkload.reduce((sum, doctor) => sum + doctor.booked_appointments, 0),
      totalCompleted: doctorWorkload.reduce((sum, doctor) => sum + doctor.completed_today, 0),
      totalInConsultation: doctorWorkload.reduce((sum, doctor) => sum + doctor.in_consultation, 0),
      totalSlots: doctorWorkload.reduce((sum, doctor) => sum + doctor.upcoming_slots, 0),
    }),
    [doctorWorkload, overview?.executive_summary?.total_doctors],
  );

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
      <motion.div initial="hidden" animate="visible" className="space-y-6">
        <motion.div variants={fadeUp} custom={0} className="dashboard-hero rounded-[2rem] px-6 py-6 sm:px-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground shadow-sm backdrop-blur-xl">
                <Stethoscope className="h-3.5 w-3.5 text-primary" />
                Doctor Workload
              </div>
              <h1 className="mt-4 font-display text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-[2.35rem]">
                Doctor Workload
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                A compact view of each doctor’s case load, current activity, open capacity, and recent patient timeline.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{summary.totalDoctors} doctors</Badge>
              <Badge variant="outline">{summary.totalCases} total cases</Badge>
            </div>
          </div>
        </motion.div>

        {error && (
          <Alert variant="destructive" className="cinematic-alert">
            <AlertDescription>
              {error instanceof ApiError ? error.message : "Unable to load doctor workload right now."}
            </AlertDescription>
          </Alert>
        )}

        <motion.div variants={fadeUp} custom={1}>
          <Card className="border-border/60 bg-card/95 shadow-card">
            <CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
              {[
                { label: "Doctors", value: summary.totalDoctors, icon: Users },
                { label: "Cases overall", value: summary.totalCases, icon: ClipboardList },
                { label: "Completed today", value: summary.totalCompleted, icon: CalendarClock },
                { label: "In consultation", value: summary.totalInConsultation, icon: Clock3 },
                { label: "Open slots", value: summary.totalSlots, icon: Stethoscope },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-3">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <item.icon className="h-4 w-4 text-primary" />
                    <span className="text-xs uppercase tracking-[0.18em]">{item.label}</span>
                  </div>
                  <p className="mt-2 font-display text-2xl font-semibold text-foreground">{item.value}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </motion.div>

        <Card className="premium-section shadow-card">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="font-display text-lg">Doctor roster</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Each row stays compact, and the patient timeline opens only when you need the details.
              </p>
            </div>
            <Badge variant="outline">{doctorWorkload.length} clinicians</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {doctorWorkload.length === 0 && (
              <p className="text-sm text-muted-foreground">Doctor workload will appear here once appointments and live slots are active.</p>
            )}

            {doctorWorkload.length > 0 && (
              <>
                <div className="hidden rounded-2xl border border-border/60 bg-muted/25 px-5 py-3 text-xs uppercase tracking-[0.16em] text-muted-foreground lg:grid lg:grid-cols-[minmax(220px,2.3fr)_minmax(160px,1.3fr)_88px_88px_110px_minmax(140px,1.1fr)_44px] lg:items-center lg:gap-5">
                  <span>Doctor</span>
                  <span>Specialty</span>
                  <span className="flex justify-center text-center">Overall</span>
                  <span className="flex justify-center text-center">Today</span>
                  <span className="flex justify-center text-center">Open slots</span>
                  <span>Queue</span>
                  <span />
                </div>

                <Accordion type="multiple" className="space-y-3">
                  {doctorWorkload.map((entry) => {
                    const doctorAppointments = appointmentsByDoctor[entry.doctor_id] || [];

                    return (
                      <AccordionItem
                        key={entry.doctor_id}
                        value={entry.doctor_id}
                        className="overflow-hidden rounded-2xl border border-border/60 bg-card/90 px-4 shadow-card"
                      >
                        <AccordionTrigger className="py-4 hover:no-underline [&>svg]:hidden">
                          <div className="grid w-full gap-3 text-left lg:grid-cols-[minmax(220px,2.3fr)_minmax(160px,1.3fr)_88px_88px_110px_minmax(140px,1.1fr)_44px] lg:items-center lg:gap-5">
                            <div>
                              <p className="font-medium text-foreground">{entry.doctor_name}</p>
                              <p className="text-xs text-muted-foreground">{entry.doctor_code || "Doctor code pending"}</p>
                            </div>
                            <div className="text-sm text-foreground">{formatLabel(entry.specialty) || "General Medicine"}</div>
                            <div className="flex justify-center text-center text-sm font-medium tabular-nums text-foreground">{entry.booked_appointments}</div>
                            <div className="flex justify-center text-center text-sm font-medium tabular-nums text-foreground">{entry.completed_today}</div>
                            <div className="flex justify-center text-center text-sm font-medium tabular-nums text-foreground">{entry.upcoming_slots}</div>
                            <div className="flex items-center justify-start gap-2 lg:flex-wrap">
                              <Badge variant={entry.open_requests > 0 ? "secondary" : "outline"}>{entry.open_requests} pending</Badge>
                              <span className="text-xs text-muted-foreground">{doctorAppointments.length} tracked</span>
                            </div>
                            <div className="flex justify-center">
                              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]/accordion:rotate-180" />
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="pb-4">
                          <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium text-foreground">Recent patient activity</p>
                                <p className="text-sm text-muted-foreground">
                                  Consulted patients, recorded reason, and timeline for this doctor.
                                </p>
                              </div>
                              <Badge variant="outline">{doctorAppointments.length} appointments</Badge>
                            </div>

                            {doctorAppointments.length === 0 ? (
                              <p className="text-sm text-muted-foreground">No patient consultations are recorded for this doctor yet.</p>
                            ) : (
                              <div className="overflow-hidden rounded-xl border border-border/60">
                                <div className="overflow-x-auto">
                                  <table className="min-w-full text-sm">
                                    <thead className="bg-muted/40 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
                                      <tr>
                                        <th className="px-4 py-3 font-medium">Patient</th>
                                        <th className="px-4 py-3 font-medium">Reason / problem</th>
                                        <th className="px-4 py-3 font-medium">Status</th>
                                        <th className="px-4 py-3 font-medium">Timeline</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {doctorAppointments.slice(0, 8).map((appointment) => (
                                        <tr key={appointment.id} className="border-t border-border/50 align-top">
                                          <td className="px-4 py-3">
                                            <p className="font-medium text-foreground">{appointment.patient_name || "Patient"}</p>
                                            <p className="text-xs text-muted-foreground">{appointment.patient_email || "Email not available"}</p>
                                          </td>
                                          <td className="px-4 py-3">
                                            <p className="text-foreground">{appointment.reason || appointment.patient_notes || "Reason not recorded"}</p>
                                            {appointment.patient_notes && appointment.patient_notes !== appointment.reason && (
                                              <p className="mt-1 text-xs text-muted-foreground">{appointment.patient_notes}</p>
                                            )}
                                          </td>
                                          <td className="px-4 py-3">
                                            <Badge variant={getStatusVariant(appointment.status)}>{formatStatusLabel(appointment.status)}</Badge>
                                          </td>
                                          <td className="px-4 py-3">
                                            <p className="text-foreground">{formatSlotMoment(appointment.appointment_date, appointment.appointment_time)}</p>
                                            <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                                              {formatTimelinePoint(appointment.created_at) && <p>Requested: {formatTimelinePoint(appointment.created_at)}</p>}
                                              {formatTimelinePoint(appointment.consultation_started_at) && (
                                                <p>Started: {formatTimelinePoint(appointment.consultation_started_at)}</p>
                                              )}
                                              {formatTimelinePoint(appointment.completed_at) && <p>Completed: {formatTimelinePoint(appointment.completed_at)}</p>}
                                            </div>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </DashboardLayout>
  );
}
