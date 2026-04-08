import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, MapPin, Star, Calendar, Clock, User, Filter } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

const doctors = [
  { name: "Dr. Sarah Johnson", specialty: "Cardiologist", city: "New York", rating: 4.9, reviews: 230, available: true, nextSlot: "Today 3:00 PM", experience: "15 years" },
  { name: "Dr. Michael Lee", specialty: "Neurologist", city: "Los Angeles", rating: 4.8, reviews: 185, available: true, nextSlot: "Tomorrow 10:00 AM", experience: "12 years" },
  { name: "Dr. Emily Chen", specialty: "Dermatologist", city: "Chicago", rating: 4.7, reviews: 142, available: false, nextSlot: "Mar 14, 2:00 PM", experience: "8 years" },
  { name: "Dr. James Wilson", specialty: "Orthopedic Surgeon", city: "Houston", rating: 4.9, reviews: 310, available: true, nextSlot: "Today 5:00 PM", experience: "20 years" },
  { name: "Dr. Priya Patel", specialty: "Pediatrician", city: "New York", rating: 4.8, reviews: 198, available: true, nextSlot: "Tomorrow 9:00 AM", experience: "10 years" },
  { name: "Dr. Robert Kim", specialty: "Psychiatrist", city: "San Francisco", rating: 4.6, reviews: 95, available: true, nextSlot: "Mar 13, 11:00 AM", experience: "7 years" },
];

export default function DoctorSearch() {
  const [search, setSearch] = useState("");
  const [specialtyFilter, setSpecialtyFilter] = useState("");

  const filtered = doctors.filter((d) => {
    const matchesSearch = d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.specialty.toLowerCase().includes(search.toLowerCase()) ||
      d.city.toLowerCase().includes(search.toLowerCase());
    const matchesSpecialty = !specialtyFilter || d.specialty === specialtyFilter;
    return matchesSearch && matchesSpecialty;
  });

  const specialties = [...new Set(doctors.map(d => d.specialty))];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Find a Doctor</h1>
          <p className="text-muted-foreground font-body text-sm">Search by name, specialty, or city.</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search doctors, specialties, cities..." className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant={specialtyFilter === "" ? "default" : "outline"} size="sm" onClick={() => setSpecialtyFilter("")}>All</Button>
            {specialties.map(s => (
              <Button key={s} variant={specialtyFilter === s ? "default" : "outline"} size="sm" onClick={() => setSpecialtyFilter(s)}>{s}</Button>
            ))}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {filtered.map((d) => (
            <Card key={d.name} className="shadow-card hover:shadow-elevated transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 rounded-xl bg-gradient-hero flex items-center justify-center flex-shrink-0">
                    <User className="w-7 h-7 text-primary-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display font-semibold text-foreground">{d.name}</h3>
                    <p className="text-sm text-primary font-medium">{d.specialty}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground font-body">
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{d.city}</span>
                      <span className="flex items-center gap-1"><Star className="w-3 h-3 text-warning" />{d.rating} ({d.reviews})</span>
                      <span>{d.experience}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground font-body">
                        <Clock className="w-3 h-3" /> Next: {d.nextSlot}
                      </span>
                      {d.available && <span className="w-2 h-2 rounded-full bg-success animate-pulse-soft" />}
                    </div>
                    <Button variant="hero" size="sm" className="mt-3" asChild>
                      <Link to="/appointments">Book Appointment</Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
