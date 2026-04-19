import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Search, Stethoscope, UserRound } from "lucide-react";

import DashboardLayout from "@/components/DashboardLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { ApiError, getDoctors } from "@/lib/api";


export default function DoctorSearch() {
  const { token } = useAuth();
  const [search, setSearch] = useState("");
  const [specialtyFilter, setSpecialtyFilter] = useState("");

  const doctorsQuery = useQuery({
    queryKey: ["doctor-directory-search"],
    queryFn: () => getDoctors(token || ""),
    enabled: Boolean(token),
  });

  const doctors = doctorsQuery.data?.doctors || [];
  const specialties = useMemo(
    () => [...new Set(doctors.map((doctor) => doctor.specialty_label || doctor.specialty).filter(Boolean))] as string[],
    [doctors],
  );

  const filteredDoctors = useMemo(() => {
    return doctors.filter((doctor) => {
      const searchable = [doctor.name, doctor.email, doctor.specialty_label, doctor.doctor_code].join(" ").toLowerCase();
      const matchesSearch = searchable.includes(search.toLowerCase());
      const matchesSpecialty = !specialtyFilter || (doctor.specialty_label || doctor.specialty) === specialtyFilter;
      return matchesSearch && matchesSpecialty;
    });
  }, [doctors, search, specialtyFilter]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Find Doctors In This Hospital</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse the real doctor accounts currently available in your hospital workspace.
          </p>
        </div>

        {doctorsQuery.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {doctorsQuery.error instanceof ApiError ? doctorsQuery.error.message : "Unable to load doctors right now."}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-10"
              placeholder="Search doctors, specialty, email, or doctor ID..."
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant={specialtyFilter ? "outline" : "default"} size="sm" onClick={() => setSpecialtyFilter("")}>
              All
            </Button>
            {specialties.map((specialty) => (
              <Button
                key={specialty}
                variant={specialtyFilter === specialty ? "default" : "outline"}
                size="sm"
                onClick={() => setSpecialtyFilter(specialty)}
              >
                {specialty}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {filteredDoctors.map((doctor) => (
            <Card key={doctor.id} className="border-border/60 bg-card/95 shadow-card">
              <CardContent className="flex items-start gap-4 p-5">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-hero">
                  <UserRound className="h-7 w-7 text-primary-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-lg font-semibold text-foreground">{doctor.name}</h3>
                    {doctor.doctor_code && <Badge variant="outline">{doctor.doctor_code}</Badge>}
                  </div>
                  <p className="mt-1 flex items-center gap-2 text-sm text-primary">
                    <Stethoscope className="h-4 w-4" />
                    {doctor.specialty_label || doctor.specialty}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">{doctor.email}</p>
                  <Button variant="hero" size="sm" className="mt-4" asChild>
                    <Link to="/appointments">Book with this doctor</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {!doctorsQuery.isLoading && filteredDoctors.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
            No doctors matched that search. Add doctor accounts from signup to populate this directory.
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
