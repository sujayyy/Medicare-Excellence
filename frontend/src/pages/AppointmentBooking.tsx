import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, User, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

const doctors = [
  { id: 1, name: "Dr. Sarah Johnson", specialty: "Cardiologist" },
  { id: 2, name: "Dr. Michael Lee", specialty: "Neurologist" },
  { id: 3, name: "Dr. Emily Chen", specialty: "Dermatologist" },
  { id: 4, name: "Dr. James Wilson", specialty: "Orthopedic Surgeon" },
];

const timeSlots = ["9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM", "2:00 PM", "2:30 PM", "3:00 PM", "3:30 PM", "4:00 PM", "4:30 PM"];
const bookedSlots = ["10:00 AM", "2:30 PM"];

const days = Array.from({ length: 7 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() + i);
  return { date: d.getDate(), day: d.toLocaleDateString("en", { weekday: "short" }), month: d.toLocaleDateString("en", { month: "short" }), full: d.toISOString().split("T")[0] };
});

export default function AppointmentBooking() {
  const [step, setStep] = useState(0);
  const [selectedDoctor, setSelectedDoctor] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState(days[0].full);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const handleBook = () => {
    setStep(3);
  };

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Book an Appointment</h1>
          <p className="text-muted-foreground font-body text-sm">Follow the steps to schedule your visit.</p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2">
          {["Doctor", "Date", "Time", "Done"].map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold font-display ${
                i <= step ? "bg-gradient-hero text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}>
                {i < step ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <span className="text-xs font-body text-muted-foreground hidden sm:block">{label}</span>
              {i < 3 && <div className={`flex-1 h-0.5 ${i < step ? "bg-primary" : "bg-border"}`} />}
            </div>
          ))}
        </div>

        {step === 0 && (
          <Card className="shadow-card">
            <CardHeader><CardTitle className="text-base font-display">Select a Doctor</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {doctors.map((d) => (
                <button key={d.id} onClick={() => { setSelectedDoctor(d.id); setStep(1); }}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                    selectedDoctor === d.id ? "border-primary bg-accent" : "border-border hover:border-primary/50"
                  }`}>
                  <div className="w-10 h-10 rounded-full bg-gradient-hero flex items-center justify-center">
                    <User className="w-5 h-5 text-primary-foreground" />
                  </div>
                  <div>
                    <p className="font-display font-medium text-sm text-foreground">{d.name}</p>
                    <p className="text-xs text-muted-foreground font-body">{d.specialty}</p>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        {step === 1 && (
          <Card className="shadow-card">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base font-display">Select a Date</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setStep(0)}><ChevronLeft className="w-4 h-4" /> Back</Button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-2">
                {days.map((d) => (
                  <button key={d.full} onClick={() => { setSelectedDate(d.full); setStep(2); }}
                    className={`p-3 rounded-xl text-center transition-all ${
                      selectedDate === d.full ? "bg-gradient-hero text-primary-foreground" : "bg-muted hover:bg-accent"
                    }`}>
                    <span className="text-xs font-body block">{d.day}</span>
                    <span className="text-lg font-display font-bold block">{d.date}</span>
                    <span className="text-[10px] font-body block">{d.month}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card className="shadow-card">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base font-display">Select a Time Slot</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setStep(1)}><ChevronLeft className="w-4 h-4" /> Back</Button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {timeSlots.map((t) => {
                  const booked = bookedSlots.includes(t);
                  return (
                    <button key={t} disabled={booked} onClick={() => setSelectedTime(t)}
                      className={`p-3 rounded-lg text-sm font-body transition-all ${
                        booked ? "bg-muted/50 text-muted-foreground/50 cursor-not-allowed line-through" :
                        selectedTime === t ? "bg-gradient-hero text-primary-foreground" : "bg-muted hover:bg-accent"
                      }`}>
                      <Clock className="w-3.5 h-3.5 inline mr-1.5" />{t}
                    </button>
                  );
                })}
              </div>
              {selectedTime && (
                <Button variant="hero" size="lg" className="w-full mt-4" onClick={handleBook}>
                  Confirm Appointment
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {step === 3 && (
          <Card className="shadow-card">
            <CardContent className="p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-success" />
              </div>
              <h2 className="text-xl font-display font-bold text-foreground mb-2">Appointment Booked!</h2>
              <p className="text-muted-foreground font-body text-sm mb-1">
                {doctors.find(d => d.id === selectedDoctor)?.name} · {doctors.find(d => d.id === selectedDoctor)?.specialty}
              </p>
              <p className="text-muted-foreground font-body text-sm mb-4">{selectedDate} at {selectedTime}</p>
              <div className="flex gap-3 justify-center">
                <Button variant="outline" onClick={() => { setStep(0); setSelectedDoctor(null); setSelectedTime(null); }}>Book Another</Button>
                <Button variant="hero" onClick={() => window.location.href = "/patient"}>Go to Dashboard</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
