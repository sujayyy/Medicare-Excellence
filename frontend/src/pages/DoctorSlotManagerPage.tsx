import { useState } from "react";
import { format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, Plus, Stethoscope } from "lucide-react";

import DashboardLayout from "@/components/DashboardLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { ApiError, getDoctorSlots, updateDoctorSlots } from "@/lib/api";
import type { DoctorSlot } from "@/types/api";
import { useToast } from "@/hooks/use-toast";

export default function DoctorSlotManagerPage() {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [slotDraft, setSlotDraft] = useState({
    date: format(new Date(), "yyyy-MM-dd"),
    time: "09:00 AM",
    label: "General consultation",
    location: "Outpatient Room 1",
    capacity: "1",
  });

  const doctorSlotsQuery = useQuery({
    queryKey: ["doctor-slot-schedule", user?.id, "page"],
    queryFn: () => getDoctorSlots(token || "", user?.id || ""),
    enabled: Boolean(token && user?.id),
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
      await Promise.all([
        doctorSlotsQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["doctor-appointments"] }),
        queryClient.invalidateQueries({ queryKey: ["doctor-analytics-overview"] }),
      ]);
      toast({
        title: "Clinic slots updated",
        description: "Patients can now see your latest available consultation slots.",
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

  const doctorSlots = doctorSlotsQuery.data?.slots || [];
  const error = doctorSlotsQuery.error;
  const openSlots = doctorSlots.filter((slot) => slot.is_available !== false);
  const bookedToday = doctorSlots.filter(
    (slot) => slot.date === format(new Date(), "yyyy-MM-dd") && (slot.booked_count ?? 0) > 0,
  ).length;
  const nextOpenSlot = openSlots[0];

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
    setSlotDraft((current) => ({
      ...current,
      label: "General consultation",
      location: current.location || "Outpatient Room 1",
      capacity: "1",
    }));
  };

  const removeDoctorSlot = (slotId: string) => {
    updateDoctorSlotsMutation.mutate(doctorSlots.filter((slot) => slot.id !== slotId));
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="dashboard-hero rounded-[2rem] px-6 py-6 sm:px-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground shadow-sm backdrop-blur-xl">
                <Calendar className="h-3.5 w-3.5 text-primary" />
                Clinic Slot Manager
              </div>
              <h1 className="mt-4 font-display text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-[2.35rem]">
                Clinic Slot Manager
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                Publish your free consultation windows here so patients book into the real slots you want to expose.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{doctorSlots.length} live slots</Badge>
            </div>
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="cinematic-alert">
            <AlertDescription>
              {error instanceof ApiError ? error.message : "Unable to load clinic slots right now."}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="metric-card border-border/60 bg-card/95 shadow-card">
            <CardContent className="space-y-2 p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Visible Slots</p>
              <p className="font-display text-3xl font-semibold text-foreground">{openSlots.length}</p>
              <p className="text-sm text-muted-foreground">These are the openings patients can currently see.</p>
            </CardContent>
          </Card>
          <Card className="metric-card border-border/60 bg-card/95 shadow-card">
            <CardContent className="space-y-2 p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Booked Today</p>
              <p className="font-display text-3xl font-semibold text-foreground">{bookedToday}</p>
              <p className="text-sm text-muted-foreground">Today’s booked visits from your published clinic schedule.</p>
            </CardContent>
          </Card>
          <Card className="metric-card border-border/60 bg-card/95 shadow-card">
            <CardContent className="space-y-2 p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Next Open Slot</p>
              <p className="font-display text-xl font-semibold text-foreground">
                {nextOpenSlot ? `${nextOpenSlot.date} · ${nextOpenSlot.time}` : "No slot published"}
              </p>
              <p className="text-sm text-muted-foreground">
                {nextOpenSlot ? `${nextOpenSlot.label || "Consultation"}${nextOpenSlot.location ? ` · ${nextOpenSlot.location}` : ""}` : "Publish one slot to open your next booking window."}
              </p>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="premium-section shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="font-display text-lg">Publish appointment openings</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Keep this list tight and current so patients only see real consultation availability.
                </p>
              </div>
              <Badge variant="outline">{doctorSlots.filter((slot) => slot.is_available !== false).length} visible</Badge>
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
              <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-border/60 bg-muted/30 px-4 py-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Capacity per slot</p>
                  <Input className="mt-2 w-24" value={slotDraft.capacity} onChange={(event) => setSlotDraft((current) => ({ ...current, capacity: event.target.value }))} />
                </div>
                <Button variant="outline" onClick={addDoctorSlot} disabled={updateDoctorSlotsMutation.isPending}>
                  <Plus className="mr-2 h-4 w-4" />
                  Publish slot
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="premium-section shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="font-display text-lg">Live published slots</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Remove anything that is no longer truly available.</p>
              </div>
              <Badge variant="outline">{doctorSlots.length} total</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {doctorSlots.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No live slots yet. Publish your next clinic openings here and patients will see them on the booking page.
                </p>
              )}
              {doctorSlots.slice(0, 12).map((slot) => (
                <div key={slot.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 px-4 py-3">
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">
                      {slot.date} · {slot.time}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {slot.label || "Consultation slot"} {slot.location ? `· ${slot.location}` : ""}
                    </p>
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
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
