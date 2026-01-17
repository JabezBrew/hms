import X from 'lucide-react/dist/esm/icons/x.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { usePatient } from "@/hooks/usePatientQueries";
import { usePatientInsurance, usePatientInvoices } from "@/hooks/useBillingQueries";
import { useAppointments } from "@/hooks/useAppointmentQueries";

import format from "date-fns/format";

const formatDate = (value) => {
  if (!value) return "-";
  try {
    return format(new Date(value), "MMM d, yyyy");
  } catch {
    return "-";
  }
};

const formatDateTime = (value) => {
  if (!value) return "-";
  try {
    return format(new Date(value), "MMM d, yyyy h:mm a");
  } catch {
    return "-";
  }
};

const formatCurrency = (amount) => {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    minimumFractionDigits: 2,
  }).format(amount || 0);
};

const getAppointmentPatientId = (appointment) => {
  const participant = appointment?.participant?.find((p) =>
    p.actor?.reference?.startsWith("Patient/")
  );
  return participant?.actor?.reference?.split("/")[1] || null;
};

export default function PatientContextPanel({
  open,
  onClose,
  mode,
  patientId,
  fhirPatientId,
  patientName,
  patientMrn,
  patientContext,
}) {
  const showBilling = mode === "billing";
  const showReception = mode === "reception";
  const showPharmacy = mode === "pharmacy";
  const [clinicalOpen, setClinicalOpen] = useState(false);

  const { data: patientDetails } = usePatient(patientId, { enabled: open && !!patientId });
  const { data: insuranceData, isLoading: insuranceLoading } = usePatientInsurance(
    patientId,
    {},
    { enabled: open && showBilling && !!patientId }
  );
  const { data: invoicesData, isLoading: invoicesLoading } = usePatientInvoices(
    patientId,
    {},
    { enabled: open && showBilling && !!patientId }
  );

  const { data: appointmentsData, isLoading: appointmentsLoading } = useAppointments(
    fhirPatientId ? { patient_id: fhirPatientId } : {},
    { enabled: open && showReception && !!fhirPatientId }
  );

  const demographics = useMemo(() => {
    if (showPharmacy) {
      return {
        name: patientContext?.name || patientName,
        mrn: patientContext?.mrn || patientMrn,
        ward: patientContext?.ward,
      };
    }

    if (showReception && patientContext) {
      return {
        name: patientContext.name || patientName,
        mrn: patientContext.mrn || patientMrn,
        dob: patientContext.dob,
        gender: patientContext.gender_display || patientContext.gender,
      };
    }

    const local = patientDetails?.local_data || patientDetails;
    return {
      name: local?.user_details
        ? `${local.user_details.first_name || ""} ${local.user_details.last_name || ""}`.trim()
        : patientName,
      mrn: local?.medical_record_number || patientMrn,
      dob: local?.user_details?.date_of_birth || local?.date_of_birth,
      gender: local?.user_details?.gender || local?.gender,
    };
  }, [patientDetails, patientContext, patientName, patientMrn, showPharmacy, showReception]);

  const insurances = insuranceData?.results || insuranceData || [];
  const invoices = invoicesData?.results || invoicesData || [];

  const billingSummary = useMemo(() => {
    if (!invoices.length) {
      return { outstanding: 0, pendingCount: 0, recent: [] };
    }
    const outstanding = invoices.reduce((acc, inv) => acc + (inv.balance_due || 0), 0);
    const pendingCount = invoices.filter((inv) =>
      ["pending", "partially_paid", "overdue"].includes(inv.status)
    ).length;
    const recent = [...invoices].slice(0, 3);
    return { outstanding, pendingCount, recent };
  }, [invoices]);

  const appointments = useMemo(() => {
    if (!appointmentsData) return [];
    if (appointmentsData.entry) {
      return appointmentsData.entry
        .filter((entry) => entry.resource?.resourceType === "Appointment")
        .map((entry) => entry.resource);
    }
    if (Array.isArray(appointmentsData)) return appointmentsData;
    if (appointmentsData.results) return appointmentsData.results;
    return [];
  }, [appointmentsData]);

  const appointmentSummary = useMemo(() => {
    const now = new Date();
    const upcomingStatuses = ["proposed", "pending", "booked", "arrived"];
    const historyStatuses = ["fulfilled", "cancelled", "noshow"];

    const upcoming = appointments
      .filter((appt) => upcomingStatuses.includes(appt.status))
      .sort((a, b) => new Date(a.start || 0) - new Date(b.start || 0))
      .slice(0, 3);

    const history = appointments
      .filter((appt) => historyStatuses.includes(appt.status) || new Date(appt.start || 0) < now)
      .sort((a, b) => new Date(b.start || 0) - new Date(a.start || 0))
      .slice(0, 3);

    return { upcoming, history };
  }, [appointments]);

  const headerName = demographics?.name || patientName || "Patient";
  const headerMrn = demographics?.mrn || patientMrn;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) onClose();
    }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto p-0">
        <DialogHeader className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <User className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="font-display text-xl text-foreground">
                Patient Context
              </DialogTitle>
              <DialogDescription className="font-mono text-xs text-muted-foreground">
                {headerName}
                {headerMrn ? ` · ${headerMrn}` : ""}
              </DialogDescription>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="font-mono text-xs">
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>
        <div className="px-6 py-6 space-y-6">
        <section className="rounded-xl border border-border/70 bg-card/70 p-4">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Demographics
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">MRN</p>
              <p className="text-foreground font-mono">{headerMrn || "-"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Name</p>
              <p className="text-foreground">{headerName}</p>
            </div>
            {demographics?.dob !== undefined && (
              <div>
                <p className="text-muted-foreground text-xs">DOB</p>
                <p className="text-foreground">{formatDate(demographics.dob)}</p>
              </div>
            )}
            {demographics?.gender !== undefined && (
              <div>
                <p className="text-muted-foreground text-xs">Gender</p>
                <p className="text-foreground">{demographics.gender || "-"}</p>
              </div>
            )}
            {demographics?.ward && (
              <div className="col-span-2">
                <Badge variant="outline" className="font-mono text-[10px]">
                  {demographics.ward}
                </Badge>
              </div>
            )}
          </div>
        </section>

        {showPharmacy && (
          <>
            <section className="rounded-xl border border-border/70 bg-card/70 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-600" />
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Allergies
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(patientContext?.allergies || []).length > 0 ? (
                  patientContext.allergies.map((allergy, index) => (
                    <span
                      key={`${allergy}-${index}`}
                      className="badge-chronicle-rose text-[10px]"
                    >
                      {allergy}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">No allergies recorded</span>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-border/70 bg-card/70 p-4">
              <Collapsible open={clinicalOpen} onOpenChange={setClinicalOpen}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-muted-foreground" />
                    <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      Clinical Context
                    </p>
                  </div>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="font-mono text-xs">
                      <ChevronDown className={cn("h-3 w-3 mr-1 transition-transform", clinicalOpen && "rotate-180")} />
                      {clinicalOpen ? "Hide" : "Expand"}
                    </Button>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent className="mt-4 space-y-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Problems</p>
                    {(patientContext?.problems || []).length > 0 ? (
                      <ul className="space-y-1 text-sm">
                        {patientContext.problems.map((problem, index) => (
                          <li key={`${problem}-${index}`} className="text-foreground">
                            {problem}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-muted-foreground">No active problems</span>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Other Active Medications</p>
                    {(patientContext?.medications || []).length > 0 ? (
                      <ul className="space-y-1 text-sm">
                        {patientContext.medications.map((med, index) => (
                          <li key={`${med}-${index}`} className="text-foreground">
                            {med}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-muted-foreground">No additional medications</span>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </section>
          </>
        )}

        {showBilling && (
          <>
            <section className="rounded-xl border border-border/70 bg-card/70 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-emerald-600" />
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Insurance
                </p>
              </div>
              {insuranceLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : insurances.length === 0 ? (
                <p className="text-xs text-muted-foreground">No insurance on file</p>
              ) : (
                <div className="space-y-2 text-sm">
                  {insurances.slice(0, 3).map((insurance) => (
                    <div key={insurance.id} className="flex items-center justify-between">
                      <span className="text-foreground">
                        {insurance.plan_name || "Insurance Plan"}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {insurance.coverage_percentage || 0}%
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-border/70 bg-card/70 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Billing Summary
                </p>
              </div>
              {invoicesLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : invoices.length === 0 ? (
                <p className="text-xs text-muted-foreground">No invoices found</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Outstanding</span>
                    <span className="font-mono text-foreground">
                      {formatCurrency(billingSummary.outstanding)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{billingSummary.pendingCount} pending</span>
                  </div>
                  <div className="divide-y divide-border/60">
                    {billingSummary.recent.map((invoice) => (
                      <div key={invoice.id} className="flex items-center justify-between py-2 text-xs">
                        <span className="font-mono text-primary">
                          {invoice.invoice_number}
                        </span>
                        <span className="text-muted-foreground">
                          {formatCurrency(
                            invoice.balance_due > 0 ? invoice.balance_due : invoice.total_amount
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {showReception && (
          <>
            <section className="rounded-xl border border-border/70 bg-card/70 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" />
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Upcoming / Active
                </p>
              </div>
              {appointmentsLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : appointmentSummary.upcoming.length === 0 ? (
                <p className="text-xs text-muted-foreground">No upcoming appointments</p>
              ) : (
                <div className="space-y-2 text-sm">
                  {appointmentSummary.upcoming.map((appointment) => (
                    <div key={appointment.id} className="flex items-center justify-between">
                      <span className="text-foreground">
                        {appointment.appointmentType?.coding?.[0]?.display || "Appointment"}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {formatDateTime(appointment.start)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-border/70 bg-card/70 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Appointment History
                </p>
              </div>
              {appointmentsLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : appointmentSummary.history.length === 0 ? (
                <p className="text-xs text-muted-foreground">No appointment history</p>
              ) : (
                <div className="space-y-2 text-sm">
                  {appointmentSummary.history.map((appointment) => (
                    <div key={appointment.id} className="flex items-center justify-between">
                      <span className="text-foreground">
                        {appointment.appointmentType?.coding?.[0]?.display || "Appointment"}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {formatDateTime(appointment.start)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { getAppointmentPatientId };
