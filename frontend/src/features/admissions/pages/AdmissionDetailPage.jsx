/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import Clipboard from 'lucide-react/dist/esm/icons/clipboard.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import DollarSign from 'lucide-react/dist/esm/icons/dollar-sign.js';
import { useCallback, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import format from 'date-fns/format';
import { admissionsApi } from '@/features/admissions/api';
import { dischargeApi } from '@/features/discharge/api';
import { DischargeCasePanel } from '@/features/discharge/components/DischargeCasePanel';
import { useAuth } from '@/lib/auth';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { useUrlEnumParam } from '@/shared/hooks/useUrlEnumParam';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

const ADMISSION_DETAIL_TABS = ['notes', 'vitals', 'billing'];

const DISCHARGE_CASE_ROLES = new Set([
  'admin',
  'doctor',
  'nurse',
  'head_nurse',
  'nurse_practitioner',
  'inpatient_doctor',
  'practitioner',
  'physician',
  'billing',
]);

const getNested = (obj, path) => path.reduce((acc, key) => acc?.[key], obj);

const getNameFromUser = (user) => {
  if (!user) return null;
  const fullName = user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return fullName || null;
};

function formatAdmissionDate(dateString) {
  if (!dateString) return 'N/A';
  return format(new Date(dateString), 'PPP');
}

function AdmissionStatusBadge({ status }) {
  switch (status) {
    case 'admitted':
      return <Badge className="bg-green-100 text-green-800">Admitted</Badge>;
    case 'pending_discharge':
      return <Badge className="bg-amber-100 text-amber-900">Pending Discharge</Badge>;
    case 'discharged':
      return <Badge className="bg-blue-100 text-blue-800">Discharged</Badge>;
    case 'transferred':
      return <Badge className="bg-yellow-100 text-yellow-800">Transferred</Badge>;
    case 'deceased':
      return <Badge className="bg-red-100 text-red-800">Deceased</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function AdmissionHeaderActions({
  admission,
  backLabel,
  backToWardPath,
  medicalDischargeAvailable,
  onNavigate,
  onRequestDischarge,
  patientId,
  requestingDischarge,
  rustV2Mode,
}) {
  const canDischarge = ['admitted', 'pending_discharge'].includes(admission.status);

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onNavigate(backToWardPath)}
      >
        <ChevronLeft className="size-4 mr-2" />
        {backLabel}
      </Button>
      {admission.admission_case_id && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onNavigate(`/admissions/cases/${admission.admission_case_id}`)}
        >
          Admission Case
        </Button>
      )}
      {medicalDischargeAvailable && canDischarge && (
        <Button
          size="sm"
          disabled={!patientId}
          onClick={() => onNavigate(
            `/patients/${patientId}?action=discharge&admission=${admission.id}&source=admission-detail`
          )}
        >
          {admission.status === 'pending_discharge' ? 'Review Medical Discharge' : 'Medical Discharge'}
        </Button>
      )}
      {rustV2Mode && canDischarge && (
        <Button
          size="sm"
          disabled={!admission.id || requestingDischarge}
          onClick={onRequestDischarge}
        >
          {requestingDischarge ? 'Requesting...' : 'Request Discharge'}
        </Button>
      )}
    </div>
  );
}

function AdmissionActionError({ message }) {
  if (!message) return null;

  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
      {message}
    </div>
  );
}

function buildDischargeWorkflowPath({ dischargeCase, patientId, wardId }) {
  const dischargeCaseId = dischargeCase?.id || null;
  const resolvedPatientId = patientId
    || dischargeCase?.patient
    || dischargeCase?.patient_id
    || null;
  const basePath = wardId ? `/wards/${wardId}/board` : '/ward-board';

  if (!resolvedPatientId) {
    const params = new URLSearchParams({ view: 'discharge' });
    if (dischargeCaseId) params.set('case', dischargeCaseId);
    return `${basePath}?${params.toString()}`;
  }

  const params = new URLSearchParams({ view: 'discharge' });
  params.set('patient', resolvedPatientId);
  if (dischargeCaseId) params.set('case', dischargeCaseId);

  return `${basePath}?${params.toString()}`;
}

function AdmissionSummaryField({ label, value, className = '' }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
      <p className={className}>{value}</p>
    </div>
  );
}

function AdmissionSummaryCard({
  admission,
  admissionTypeLabel,
  admittingDoctorName,
  bedLocationLabel,
  dailyRateLabel,
  lengthOfStayLabel,
  totalCostLabel,
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-2xl">Admission Summary</CardTitle>
            <CardDescription>
              Key dates, ward assignment, and billing overview.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AdmissionSummaryField label="Admission Date" value={formatAdmissionDate(admission.admission_date)} />
          <AdmissionSummaryField label="Expected Discharge" value={formatAdmissionDate(admission.expected_discharge_date)} />
          <AdmissionSummaryField label="Actual Discharge" value={formatAdmissionDate(admission.actual_discharge_date)} />
          <AdmissionSummaryField label="Admission Type" value={admissionTypeLabel} className="capitalize" />
          <AdmissionSummaryField label="Ward & Bed" value={bedLocationLabel} />
          <AdmissionSummaryField label="Daily Rate" value={dailyRateLabel} />
          <AdmissionSummaryField label="Length of Stay" value={lengthOfStayLabel} />
          <AdmissionSummaryField label="Total Cost" value={totalCostLabel} />
          <AdmissionSummaryField label="Admitting Doctor" value={admittingDoctorName} />
        </div>
      </CardContent>
    </Card>
  );
}

function AdmissionClinicalTabs({
  admission,
  dailyRateLabel,
  lengthOfStayLabel,
  totalCostLabel,
}) {
  const [activeTab, setActiveTab] = useUrlEnumParam({
    param: 'tab',
    values: ADMISSION_DETAIL_TABS,
    defaultValue: 'notes',
  });

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList>
        <TabsTrigger value="notes">
          <Clipboard className="size-4 mr-2" />
          Notes
        </TabsTrigger>
        <TabsTrigger value="vitals">
          <FileText className="size-4 mr-2" />
          Vital Signs
        </TabsTrigger>
        <TabsTrigger value="billing">
          <DollarSign className="size-4 mr-2" />
          Billing
        </TabsTrigger>
      </TabsList>

      <TabsContent value="notes" className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Admission Notes</CardTitle>
          </CardHeader>
          <CardContent>
            {admission.admission_notes ? (
              <div className="whitespace-pre-wrap">{admission.admission_notes}</div>
            ) : (
              <p className="text-muted-foreground">No admission notes available.</p>
            )}
          </CardContent>
        </Card>

        {admission.discharge_notes && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Discharge Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="whitespace-pre-wrap">{admission.discharge_notes}</div>
            </CardContent>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="vitals" className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Vital Signs</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">No vital signs recorded for this admission.</p>

            <div className="mt-4">
              <Button variant="outline">
                <FileText className="size-4 mr-2" />
                Record Vital Signs
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="billing" className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Billing Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AdmissionSummaryField label="Daily Rate" value={dailyRateLabel} className="text-lg font-medium" />
                <AdmissionSummaryField label="Length of Stay" value={lengthOfStayLabel} className="text-lg font-medium" />
                <AdmissionSummaryField label="Total Room Cost" value={totalCostLabel} className="text-lg font-medium" />
                <AdmissionSummaryField
                  label="Billing Status"
                  value={admission.is_billed ? 'Billed' : 'Not Billed'}
                  className="text-lg font-medium"
                />
              </div>

              <div className="pt-4 border-t">
                <h3 className="text-sm font-medium mb-2">Actions</h3>
                <div className="flex gap-2">
                  <Button variant="outline">
                    <DollarSign className="size-4 mr-2" />
                    Generate Invoice
                  </Button>
                  <Button variant="outline">
                    <FileText className="size-4 mr-2" />
                    View Invoices
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

export default function AdmissionDetailPage() {
  const { admissionId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [admission, setAdmission] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [requestingDischarge, setRequestingDischarge] = useState(false);

  const loadAdmission = useCallback(async () => {
    if (!admissionId) return;

    try {
      setLoading(true);
      setError(null);
      const data = await admissionsApi.getAdmission(admissionId);
      setAdmission(data);
    } catch {
      setError('Failed to load admission details. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [admissionId]);

  // Fetch admission details
  useEffect(() => {
    loadAdmission();
  }, [loadAdmission]);

  const patientId = (typeof admission?.patient === 'object' && admission?.patient?.id)
    || admission?.patient_details?.id
    || admission?.patient
    || null;

  const patientName = admission?.patient_name
    || getNameFromUser(admission?.patient_details?.user_details)
    || getNameFromUser(admission?.patient?.user_details)
    || getNameFromUser(admission?.patient?.user)
    || admission?.patient?.full_name
    || null;

  const bedDetails = admission?.bed_details;
  const wardDetails = bedDetails?.ward_details;

  const wardId = wardDetails?.id
    || getNested(admission, ['bed', 'ward', 'id'])
    || null;

  const wardName = wardDetails?.name
    || getNested(admission, ['bed', 'ward', 'name'])
    || null;

  const bedNumber = bedDetails?.bed_number
    || getNested(admission, ['bed', 'bed_number'])
    || null;

  const bedLocationLabel = wardName && bedNumber
    ? `${wardName} - Bed ${bedNumber}`
    : wardName || (bedNumber ? `Bed ${bedNumber}` : 'Not assigned');

  const doctorUser = admission?.admitting_doctor_details?.staff_details?.user_details
    || admission?.admitting_doctor?.staff?.user_details
    || admission?.admitting_doctor?.user
    || null;
  const admittingDoctorName = getNameFromUser(doctorUser) || admission?.admitting_doctor_name || 'Not assigned';

  const admissionTypeLabel = admission?.admission_type
    ? admission.admission_type.replace('_', ' ')
    : 'Not specified';

  const dailyRateLabel = admission?.daily_rate != null ? `$${admission.daily_rate}/night` : 'N/A';
  const totalCostLabel = admission?.total_cost != null ? `$${admission.total_cost}` : 'N/A';
  const lengthOfStayLabel = admission?.length_of_stay != null ? `${admission.length_of_stay} days` : 'N/A';

  const userRole = user?.user_type || user?.role;
  const canViewDischargeCase = DISCHARGE_CASE_ROLES.has(userRole);
  const rustV2Mode = isRustV2ApiMode();
  const medicalDischargeAvailable = !rustV2Mode;
  const backToWardPath = wardId ? `/wards/${wardId}` : '/wards';
  const backLabel = wardId ? 'Back to Ward' : 'Back to Wards';
  const pageMeta = usePageMeta({
    title: patientName
      ? `${patientName} Admission | Hospital Management System`
      : 'Admission | Hospital Management System',
    breadcrumbs: [
      { label: 'Wards', path: '/wards' },
      ...(wardId && wardName ? [{ label: wardName, path: `/wards/${wardId}` }] : []),
      { label: 'Admission', path: `/admissions/${admissionId}` },
    ],
  });

  if (loading) {
    return (
      <PageState variant="loading">
        {pageMeta}
      </PageState>
    );
  }

  if (error) {
    return (
      <>
        {pageMeta}
        <PageState
          variant="error"
          title="Unable to load admission"
          description={error}
          action={() => loadAdmission()}
        />
      </>
    );
  }

  if (!admission) {
    return (
      <>
        {pageMeta}
        <PageState
          variant="empty"
          title="Admission not found"
          description="The requested admission could not be found."
          action={
            <Button variant="outline" onClick={() => navigate('/wards')}>
              Back to Wards
            </Button>
          }
        />
      </>
    );
  }

  async function handleRequestDischarge() {
    if (!admission?.id) {
      return;
    }
    try {
      setRequestingDischarge(true);
      setActionError(null);
      const dischargeCase = await dischargeApi.requestCase(admission.id);
      navigate(buildDischargeWorkflowPath({ dischargeCase, patientId, wardId }));
    } catch {
      setActionError('Unable to request discharge. Please try again.');
    } finally {
      setRequestingDischarge(false);
    }
  }

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title={patientName || 'Admission'}
        description={patientId ? `Patient ID: ${patientId}` : undefined}
        actions={(
          <AdmissionHeaderActions
            admission={admission}
            backLabel={backLabel}
            backToWardPath={backToWardPath}
            medicalDischargeAvailable={medicalDischargeAvailable}
            onNavigate={navigate}
            onRequestDischarge={handleRequestDischarge}
            patientId={patientId}
            requestingDischarge={requestingDischarge}
            rustV2Mode={rustV2Mode}
          />
        )}
      >
        <div className="mt-2">
          <AdmissionStatusBadge status={admission.status} />
        </div>
      </PageHeader>

      <main className="p-6 space-y-6">
        <AdmissionActionError message={actionError} />

        <AdmissionSummaryCard
          admission={admission}
          admissionTypeLabel={admissionTypeLabel}
          admittingDoctorName={admittingDoctorName}
          bedLocationLabel={bedLocationLabel}
          dailyRateLabel={dailyRateLabel}
          lengthOfStayLabel={lengthOfStayLabel}
          totalCostLabel={totalCostLabel}
        />

        {canViewDischargeCase && (
          <DischargeCasePanel
            admissionId={admission.id}
            title="Discharge Clearance"
          />
        )}

        <AdmissionClinicalTabs
          admission={admission}
          dailyRateLabel={dailyRateLabel}
          lengthOfStayLabel={lengthOfStayLabel}
          totalCostLabel={totalCostLabel}
        />
      </main>
    </PageShell>
  );
}
