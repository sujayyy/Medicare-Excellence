import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, Clock, FileText, MapPin, Phone, Sparkles, UserRound } from "lucide-react";

import DashboardLayout from "@/components/DashboardLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import { ApiError, createAppointment, getAppointments, getDoctors, getDoctorSlots } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";


function formatDateTime(date?: string, time?: string) {
  if (!date && !time) {
    return "Not scheduled";
  }
  return [date, time].filter(Boolean).join(" · ");
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

function formatSpecialtyLabel(value?: string | null) {
  if (!value) {
    return "";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function inferSuggestedSpecialty(input: {
  assignedDoctorSpecialty?: string;
  symptoms?: string[];
  triageReason?: string;
  summaryHeadline?: string;
  clinicalSummary?: string;
}) {
  if (input.assignedDoctorSpecialty) {
    return input.assignedDoctorSpecialty;
  }

  const text = [
    ...(input.symptoms || []),
    input.triageReason || "",
    input.summaryHeadline || "",
    input.clinicalSummary || "",
  ]
    .join(" ")
    .toLowerCase();

  const specialtyMatchers: Array<{ specialty: string; keywords: string[] }> = [
    { specialty: "dermatology", keywords: ["skin", "rash", "itch", "itching", "eczema", "acne", "allergy", "psoriasis"] },
    { specialty: "cardiology", keywords: ["chest pain", "heart", "palpitation", "blood pressure", "hypertension"] },
    { specialty: "pulmonology", keywords: ["cough", "asthma", "breath", "breathing", "wheezing", "lungs"] },
    { specialty: "neurology", keywords: ["headache", "migraine", "seizure", "dizziness", "numbness", "stroke"] },
    { specialty: "orthopedics", keywords: ["back pain", "joint", "knee", "bone", "fracture", "shoulder", "leg pain"] },
    { specialty: "ophthalmology", keywords: ["eye", "vision", "blurry", "red eye", "sight"] },
    { specialty: "ent", keywords: ["ear", "nose", "throat", "sinus", "tonsil", "hearing"] },
    { specialty: "gastroenterology", keywords: ["stomach", "abdomen", "vomiting", "nausea", "diarrhea", "constipation"] },
    { specialty: "gynecology", keywords: ["period", "menstrual", "pelvic", "pregnancy", "uterus"] },
    { specialty: "psychiatry", keywords: ["anxiety", "depression", "panic", "sleep", "stress"] },
    { specialty: "urology", keywords: ["urine", "bladder", "kidney", "burning urination"] },
    { specialty: "pediatrics", keywords: ["child", "baby", "infant", "pediatric"] },
  ];

  const match = specialtyMatchers.find((entry) => entry.keywords.some((keyword) => text.includes(keyword)));
  return match?.specialty || "";
}


export default function AppointmentBooking() {
  const { token, user, profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [bookingError, setBookingError] = useState("");

  const suggestedSpecialty = useMemo(
    () =>
      inferSuggestedSpecialty({
        assignedDoctorSpecialty: profile?.assigned_doctor_specialty,
        symptoms: profile?.symptoms,
        triageReason: profile?.triage_reason,
        summaryHeadline: profile?.summary_headline,
        clinicalSummary: profile?.clinical_summary,
      }),
    [profile?.assigned_doctor_specialty, profile?.clinical_summary, profile?.summary_headline, profile?.symptoms, profile?.triage_reason],
  );

  const recommendedDoctorsQuery = useQuery({
    queryKey: ["doctor-directory", suggestedSpecialty || "all"],
    queryFn: () => getDoctors(token || "", suggestedSpecialty || undefined),
    enabled: Boolean(token),
  });

  const allDoctorsQuery = useQuery({
    queryKey: ["doctor-directory", "fallback-all"],
    queryFn: () => getDoctors(token || ""),
    enabled: Boolean(token && suggestedSpecialty),
  });

  const appointmentsQuery = useQuery({
    queryKey: ["patient-appointments"],
    queryFn: () => getAppointments(token || ""),
    enabled: Boolean(token),
  });

  const matchedDoctors = recommendedDoctorsQuery.data?.doctors || [];
  const fallbackDoctors = allDoctorsQuery.data?.doctors || [];
  const isShowingFallbackDoctors = Boolean(suggestedSpecialty && matchedDoctors.length === 0 && fallbackDoctors.length > 0);
  const doctorDirectory = suggestedSpecialty ? (matchedDoctors.length > 0 ? matchedDoctors : fallbackDoctors) : matchedDoctors;

  useEffect(() => {
    if (selectedDoctorId && !doctorDirectory.some((doctor) => doctor.id === selectedDoctorId)) {
      setSelectedDoctorId("");
      setSelectedSlotId("");
    }
  }, [doctorDirectory, selectedDoctorId]);

  const selectedDoctor = useMemo(
    () => doctorDirectory.find((doctor) => doctor.id === selectedDoctorId),
    [doctorDirectory, selectedDoctorId],
  );

  const doctorSlotsQuery = useQuery({
    queryKey: ["doctor-slots", selectedDoctorId],
    queryFn: () => getDoctorSlots(token || "", selectedDoctorId),
    enabled: Boolean(token && selectedDoctorId),
  });

  const availableSlots = doctorSlotsQuery.data?.slots || [];
  const selectedSlot = useMemo(
    () => availableSlots.find((slot) => slot.id === selectedSlotId),
    [availableSlots, selectedSlotId],
  );

  const createMutation = useMutation({
    mutationFn: () =>
      createAppointment(token || "", {
        doctor_id: selectedDoctorId,
        slot_id: selectedSlotId,
        reason,
        notes,
      }),
    onSuccess: async () => {
      setBookingError("");
      setSelectedSlotId("");
      setReason("");
      setNotes("");
      await appointmentsQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["doctor-appointments"] });
      void queryClient.invalidateQueries({ queryKey: ["hospital-admin-appointments"] });
      toast({
        title: "Appointment request sent",
        description: "The selected doctor and hospital team can now review it.",
      });
    },
    onError: (error) => {
      setBookingError(error instanceof ApiError ? error.message : "Unable to create the appointment right now.");
    },
  });

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Book a Real Doctor Appointment</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a doctor account from this hospital, pick a slot, and send the request directly into the doctor queue.
          </p>
        </div>

        {(recommendedDoctorsQuery.error || allDoctorsQuery.error || appointmentsQuery.error) && (
          <Alert variant="destructive">
            <AlertDescription>
              {(recommendedDoctorsQuery.error || allDoctorsQuery.error || appointmentsQuery.error) instanceof ApiError
                ? ((recommendedDoctorsQuery.error || allDoctorsQuery.error || appointmentsQuery.error) as ApiError).message
                : "Unable to load appointment data right now."}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <Card className="border-border/60 bg-card/95 shadow-elevated">
            <CardHeader>
              <CardTitle className="font-display text-lg">Select Doctor And Slot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-2xl border border-border/60 bg-muted/35 p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-xl bg-accent p-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Suggested doctor match</p>
                    {suggestedSpecialty ? (
                      <>
                        <p className="text-sm font-medium text-foreground">
                          Recommended specialty: {formatSpecialtyLabel(suggestedSpecialty)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          We’re using the patient’s current concern to surface the most relevant hospital doctors first.
                        </p>
                        {matchedDoctors.length === 0 && !recommendedDoctorsQuery.isLoading && (
                          <p className="text-sm text-muted-foreground">
                            No {formatSpecialtyLabel(suggestedSpecialty).toLowerCase()} doctors are available in this hospital right now. Showing the rest of the hospital doctor list instead.
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-foreground">No specialty recommendation yet</p>
                        <p className="text-sm text-muted-foreground">
                          You can still choose from all available doctors and book a live slot normally.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {bookingError && (
                <Alert variant="destructive">
                  <AlertDescription>{bookingError}</AlertDescription>
                </Alert>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                {doctorDirectory.map((doctor) => {
                  const isSelected = doctor.id === selectedDoctorId;
                  return (
                    <button
                      key={doctor.id}
                      type="button"
                      onClick={() => {
                        setSelectedDoctorId(doctor.id);
                        setSelectedSlotId("");
                      }}
                      className={`rounded-2xl border p-4 text-left transition-all ${
                        isSelected ? "border-primary bg-accent shadow-card" : "border-border/60 bg-background hover:border-primary/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-display text-base font-semibold text-foreground">{doctor.name}</p>
                          <p className="mt-1 text-sm text-primary">{doctor.specialty_label || doctor.specialty}</p>
                        </div>
                        {doctor.doctor_code && <Badge variant="outline">{doctor.doctor_code}</Badge>}
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">{doctor.email}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant="outline">{doctor.open_slot_count || 0} open slots</Badge>
                        {suggestedSpecialty &&
                          !isShowingFallbackDoctors &&
                          suggestedSpecialty === (doctor.specialty || "").toLowerCase() && (
                            <Badge variant="secondary">Recommended match</Badge>
                          )}
                        {doctor.next_open_slot && (
                          <Badge variant="secondary">
                            Next: {doctor.next_open_slot.date} · {doctor.next_open_slot.time}
                          </Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {doctorDirectory.length === 0 && !recommendedDoctorsQuery.isLoading && !allDoctorsQuery.isLoading && (
                <div className="rounded-2xl border border-dashed border-border/70 p-5 text-sm text-muted-foreground">
                  {suggestedSpecialty
                    ? `No ${formatSpecialtyLabel(suggestedSpecialty).toLowerCase()} doctors are available in this hospital yet. Ask the admin to add a doctor in that specialty.`
                    : "No doctor accounts are available yet. Ask the hospital admin to create doctor logins first."}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Reason for visit</label>
                  <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Headache, fever, follow-up..." />
                </div>
                <div className="rounded-2xl border border-border/60 bg-muted/40 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Chosen slot</p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {selectedSlot ? `${selectedSlot.date} · ${selectedSlot.time}` : "Select an open slot below"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedSlot?.location || selectedSlot?.label || "Doctor-managed slot availability keeps this calendar realistic."}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Choose an open slot</label>
                {selectedDoctorId && availableSlots.length === 0 && !doctorSlotsQuery.isLoading && (
                  <div className="rounded-2xl border border-dashed border-border/70 p-5 text-sm text-muted-foreground">
                    This doctor does not have any live bookable slots right now. Ask the doctor to publish a future opening and refresh this page.
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {availableSlots.map((slot) => {
                    return (
                      <button
                        key={slot.id}
                        type="button"
                        onClick={() => setSelectedSlotId(slot.id)}
                        className={`rounded-2xl border px-4 py-3 text-left text-sm transition-colors ${
                          selectedSlotId === slot.id
                            ? "border-primary bg-accent text-primary"
                            : "border-border/60 bg-background hover:border-primary/50"
                        }`}
                      >
                        <p className="font-medium">{slot.date} · {slot.time}</p>
                        <p className="mt-1 text-xs opacity-80">{slot.label || "Consultation slot"}</p>
                        <p className="mt-1 text-xs opacity-80">{slot.location || "Location shared after booking"}</p>
                        <p className="mt-2 text-[11px] uppercase tracking-[0.16em] opacity-70">
                          {slot.available_count ?? 0} open {slot.available_count === 1 ? "seat" : "seats"}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Notes for doctor</label>
                <Textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Share short context like symptoms, duration, or what you want reviewed."
                  rows={4}
                />
              </div>

              <Button
                variant="hero"
                size="lg"
                className="w-full"
                disabled={!selectedDoctorId || !selectedSlot || reason.trim().length < 3 || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                Confirm Appointment
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-border/60 bg-card/95 shadow-card">
              <CardHeader>
                <CardTitle className="font-display text-lg">Patient Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center gap-3">
                  <UserRound className="h-4 w-4 text-primary" />
                  <span>{user?.name || profile?.name || "Patient"}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-primary" />
                  <span>{profile?.phone || "No phone added yet"}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-primary" />
                  <span>{profile?.age ? `${profile.age} years` : "Age not added yet"}</span>
                </div>
                <div className="flex items-center gap-3">
                  <MapPin className="h-4 w-4 text-primary" />
                  <span>{selectedSlot?.location || "Location appears after you choose a slot"}</span>
                </div>
                <div className="rounded-2xl bg-muted/50 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Selected doctor</p>
                  <p className="mt-2 text-sm text-foreground">
                    {selectedDoctor
                      ? `${selectedDoctor.name} · ${selectedDoctor.specialty_label || formatSpecialtyLabel(selectedDoctor.specialty)}`
                      : "No doctor selected yet"}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/95 shadow-card">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="font-display text-lg">My Appointment Requests</CardTitle>
                <Badge variant="outline">{appointmentsQuery.data?.appointments.length || 0} requests</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {(appointmentsQuery.data?.appointments || []).length === 0 && (
                  <p className="text-sm text-muted-foreground">Your real appointment requests will appear here once they are submitted.</p>
                )}

                {(appointmentsQuery.data?.appointments || []).map((appointment) => (
                  <div key={appointment.id} className="rounded-2xl border border-border/60 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{appointment.assigned_doctor_name || "Doctor pending"}</p>
                        <p className="text-sm text-muted-foreground">
                          {appointment.assigned_doctor_specialty?.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase()) || "Specialty pending"}
                          {appointment.assigned_doctor_code ? ` · ${appointment.assigned_doctor_code}` : ""}
                        </p>
                      </div>
                      <Badge variant={getStatusVariant(appointment.status)}>{appointment.status}</Badge>
                    </div>
                    <div className="mt-3 space-y-1 text-sm text-foreground">
                      <p className="flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /> {formatDateTime(appointment.appointment_date, appointment.appointment_time)}</p>
                      {appointment.appointment_location && (
                        <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /> {appointment.appointment_location}</p>
                      )}
                      <p className="flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> {appointment.reason || "No reason recorded"}</p>
                      {appointment.patient_notes && <p className="text-muted-foreground">{appointment.patient_notes}</p>}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
