import { useState, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";

import format from "date-fns/format";
import addDays from "date-fns/addDays";
import subDays from "date-fns/subDays";
import startOfDay from "date-fns/startOfDay";
import { toast } from "sonner";
import { isRustV2ApiMode } from "@/lib/api/v2/runtime";
import { useFluidBalanceDay } from '@/features/nursing/hooks/useFluidBalanceDay';
import {
  useFluidBalance,
  useFluidBalanceSummary,
  useTodayFluidBalance,
  useCreateFluidBalance,
  useDeleteFluidBalance
} from "@/features/nursing/hooks";
import {
  FluidBalanceHeader,
  FluidBalanceTabs,
  FluidEntryTab,
  FluidHistoryTab,
} from './AddFluidBalanceSlideOverSections';

const INITIAL_FORM_DATA = {
  type: 'intake',
  category: '',
  subcategory: '',
  amount: '',
  colour: '',
  notes: ''
};

const CATEGORY_OPTIONS_BY_TYPE = {
  intake: [
    { label: 'Oral', value: 'oral' },
    { label: 'IV Fluids', value: 'iv' },
    { label: 'Enteral Feed', value: 'enteral' },
    { label: 'Blood Products', value: 'blood' }
  ],
  output: [
    { label: 'Urine', value: 'urine' },
    { label: 'Vomit', value: 'vomit' },
    { label: 'Stool', value: 'stool' },
    { label: 'Drain', value: 'drain' },
    { label: 'N.G. Suction', value: 'ng_suction' },
    { label: 'Other', value: 'other' }
  ],
};

const SUBCATEGORY_OPTIONS_BY_CATEGORY = {
  oral: [
    { label: 'Water', value: 'Water' },
    { label: 'Juice', value: 'Juice' },
    { label: 'Tea/Coffee', value: 'Tea/Coffee' },
    { label: 'Milk', value: 'Milk' },
    { label: 'Other', value: 'Other' }
  ],
  iv: [
    { label: 'Normal Saline', value: 'Normal Saline' },
    { label: 'Lactated Ringers', value: 'Lactated Ringers' },
    { label: 'D5W', value: 'D5W' },
    { label: 'Other', value: 'Other' }
  ],
  enteral: [
    { label: 'NG Tube', value: 'NG Tube' },
    { label: 'PEG Tube', value: 'PEG Tube' },
    { label: 'Other', value: 'Other' }
  ],
  blood: [
    { label: 'Packed RBCs', value: 'Packed RBCs' },
    { label: 'Platelets', value: 'Platelets' },
    { label: 'Plasma', value: 'Plasma' },
    { label: 'Other', value: 'Other' }
  ],
  drain: [
    { label: 'Chest Tube', value: 'Chest Tube' },
    { label: 'JP Drain', value: 'JP Drain' },
    { label: 'Penrose', value: 'Penrose' },
    { label: 'Other', value: 'Other' }
  ],
  urine: [
    { label: 'Voided', value: 'Voided' },
    { label: 'Foley', value: 'Foley' }
  ],
  ng_suction: [
    { label: 'Aspirate', value: 'Aspirate' },
    { label: 'Drainage', value: 'Drainage' },
    { label: 'Other', value: 'Other' }
  ]
};

const getCategoryOptions = (entryType) => CATEGORY_OPTIONS_BY_TYPE[entryType] || CATEGORY_OPTIONS_BY_TYPE.output;

const getSubcategoryOptions = (category) => SUBCATEGORY_OPTIONS_BY_CATEGORY[category] || [];

/**
 * AddFluidBalanceSlideOver - Chronicle-styled split-screen panel for fluid balance
 *
 * Two-tab design:
 * - Record Entry: Quick fluid intake/output entry (today only)
 * - History: Browse historical data with date navigation
 */
const AddFluidBalanceSlideOver = ({
  open,
  onClose,
  patient,
  admission,
  onFluidRecorded,
  allowEntry = true,
}) => {
  // Get patient ID
  const patientId = patient?.local_data?.id || patient?.id;
  const admissionId = admission?.id || 'no-admission';
  const formScopeKey = open
    ? `${patientId || 'unknown-patient'}:${admissionId}:${allowEntry ? 'entry' : 'history-only'}`
    : 'closed';

  return (
    <AddFluidBalanceSlideOverContent
      key={formScopeKey}
      open={open}
      onClose={onClose}
      patient={patient}
      patientId={patientId}
      admission={admission}
      onFluidRecorded={onFluidRecorded}
      allowEntry={allowEntry}
    />
  );
};

function AddFluidBalanceSlideOverContent({
  open,
  onClose,
  patient,
  patientId,
  admission,
  onFluidRecorded,
  allowEntry,
}) {
  const rustV2Mode = isRustV2ApiMode();
  const admissionScope = rustV2Mode && admission?.id ? { admission_case_id: admission.id } : {};
  const todayDateString = useFluidBalanceDay({ utc: rustV2Mode, enabled: open });
  // Active tab state
  const [activeTabValue, setActiveTab] = useState(allowEntry ? 'entry' : 'history'); // 'entry' | 'history'
  const activeTab = allowEntry ? activeTabValue : 'history';

  // History date navigation state
  const [historyDate, setHistoryDate] = useState(() => new Date(`${todayDateString}T12:00:00`));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const fluidBalanceDeletionAvailable = !rustV2Mode;

  // Form state (includes colour for outputs)
  const [formData, setFormData] = useState(INITIAL_FORM_DATA);
  const [writeUnconfirmed, setWriteUnconfirmed] = useState(false);
  const submitInFlight = useRef(false);
  const maxHistoryDate = useMemo(() => startOfDay(new Date(`${todayDateString}T12:00:00`)), [todayDateString]);

  // Format history date for API (YYYY-MM-DD)
  const historyDateString = format(historyDate, 'yyyy-MM-dd');

  // API hooks - only fetch when slide-over is open
  // Today's data for entry tab
  const todaySummaryQuery = useTodayFluidBalance(patientId, { enabled: open, date: todayDateString, ...admissionScope });
  const { data: todaySummary } = todaySummaryQuery;
  const todayQuery = useFluidBalance(patientId, { date: todayDateString, descending: true, ...admissionScope }, { enabled: open });
  const { data: todayRecords = [], isLoading: todayLoading } = todayQuery;

  // Historical data for history tab
  const historyQuery = useFluidBalance(patientId, { date: historyDateString, ...admissionScope }, { enabled: open });
  const { data: historyRecords = [], isLoading: historyLoading } = historyQuery;
  const historySummaryQuery = useFluidBalanceSummary(patientId, historyDateString, { enabled: open, ...admissionScope });
  const { data: historySummary } = historySummaryQuery;

  const createMutation = useCreateFluidBalance();
  const deleteMutation = useDeleteFluidBalance();

  // Date navigation handlers for history tab
  const goToPreviousDay = () => setHistoryDate(prev => subDays(prev, 1));
  const goToNextDay = () => {
    const tomorrow = addDays(historyDate, 1);
    if (startOfDay(tomorrow) <= maxHistoryDate) {
      setHistoryDate(tomorrow);
    }
  };
  const goToToday = () => setHistoryDate(new Date(`${todayDateString}T12:00:00`));
  const isHistoryToday = historyDateString === todayDateString;

  // Get patient display name
  const patientName = patient?.local_data?.user_details
    ? `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim()
    : patient?.name || 'Patient';

  // Handle type change (reset category/subcategory/colour)
  const handleTypeChange = (value) => {
    setFormData(prev => ({
      ...prev,
      type: value,
      category: '',
      subcategory: '',
      colour: ''
    }));
  };

  // Handle form submit
  const handleSubmit = async () => {
    if (submitInFlight.current || writeUnconfirmed) return;
    const amount = Number(formData.amount);
    if (!Number.isInteger(amount) || amount <= 0 || amount > 2147483647) {
      toast.error('Please enter a whole amount in millilitres greater than 0');
      return;
    }

    if (!rustV2Mode && !formData.category) {
      toast.error('Please select a category');
      return;
    }

    submitInFlight.current = true;
    try {
      await createMutation.mutateAsync({
        patient: patientId,
        admission: admission?.id || null,
        entry_type: formData.type,
        category: formData.category,
        subcategory: formData.subcategory || null,
        volume_ml: amount,
        colour: formData.type === 'output' ? (formData.colour || null) : null,
        notes: formData.notes || null,
      });

      toast.success(`${formData.type === 'intake' ? 'Intake' : 'Output'} recorded: ${amount}ml`);

      // Reset form but keep panel open for more entries
      setFormData({
        type: formData.type,
        category: '',
        subcategory: '',
        amount: '',
        colour: '',
        notes: ''
      });

      // A consumer refresh failure cannot turn a confirmed save into a retry.
      try { await onFluidRecorded?.(); } catch { /* Entries remain saved. */ }
    } catch (error) {
      if (error?.name === 'FluidBalanceWriteUnconfirmedError') {
        setWriteUnconfirmed(true);
        void todayQuery.refetch();
        void todaySummaryQuery.refetch();
        toast.error('The fluid entry may have been saved. Review the refreshed entries before recording it again.');
      } else {
        toast.error('Failed to record fluid balance');
      }
    } finally {
      submitInFlight.current = false;
    }
  };

  // Handle delete entry
  const handleDelete = async (entryId) => {
    if (!fluidBalanceDeletionAvailable) {
      toast.error('Saved fluid entries cannot be removed. Corrections are not available yet.');
      return;
    }

    try {
      await deleteMutation.mutateAsync(entryId);
      toast.success('Entry deleted');
    } catch {
      toast.error('Failed to delete entry');
    }
  };

  // Handle close
  const handleClose = () => {
    onClose();
  };

  // Get today's balance data
  const todayIntake = todaySummary?.total_intake || 0;
  const todayOutput = todaySummary?.total_output || 0;
  const todayBalance = todaySummary?.balance || (todayIntake - todayOutput);

  // Get history date's balance data
  const historyIntake = historySummary?.total_intake || 0;
  const historyOutput = historySummary?.total_output || 0;
  const historyBalance = historySummary?.balance || (historyIntake - historyOutput);

  // Get records for display
  const todayRecordsList = useMemo(() => {
    const records = Array.isArray(todayRecords) ? todayRecords : todayRecords?.results || [];
    return records.slice(0, 10);
  }, [todayRecords]);

  const historyRecordsList = useMemo(() => {
    return Array.isArray(historyRecords) ? historyRecords : historyRecords?.results || [];
  }, [historyRecords]);

  const categoryOptions = getCategoryOptions(formData.type);
  const subcategoryOptions = getSubcategoryOptions(formData.category);
  const todayBalanceSummary = {
    intake: todayIntake,
    output: todayOutput,
    balance: todayBalance,
  };
  const historyBalanceSummary = {
    intake: historyIntake,
    output: historyOutput,
    balance: historyBalance,
  };

  const handleCategoryChange = (value) => {
    setFormData(prev => ({ ...prev, category: value, subcategory: '' }));
  };

  const handleSubcategoryChange = (value) => {
    setFormData(prev => ({ ...prev, subcategory: value }));
  };

  const handleFieldChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleHistoryDateSelect = (date) => {
    if (date) {
      setHistoryDate(date);
      setCalendarOpen(false);
    }
  };

  return (
    <div
      role="region"
      aria-label="Fluid balance"
      className={cn(
        "fixed inset-y-0 right-0 z-[100] w-full lg:w-1/2 bg-background border-l border-border",
        "transform transition-transform duration-300 ease-in-out",
        "flex flex-col shadow-2xl",
        open ? "translate-x-0" : "translate-x-full"
      )}
    >
      <FluidBalanceHeader patientName={patientName} scopeLabel={rustV2Mode && admission?.id ? 'Current admission' : undefined} onClose={handleClose} />
      <FluidBalanceTabs
        allowEntry={allowEntry}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      {activeTab === 'entry' ? (
        <FluidEntryTab
          formData={formData}
          categoryOptions={categoryOptions}
          subcategoryOptions={subcategoryOptions}
          summary={todayBalanceSummary}
          records={todayRecordsList}
          loading={todayLoading || todaySummaryQuery.isLoading}
          error={todayQuery.error || todaySummaryQuery.error}
          onRetry={() => { void todayQuery.refetch(); void todaySummaryQuery.refetch(); }}
          rustV2Mode={rustV2Mode}
          deletionAvailable={fluidBalanceDeletionAvailable}
          deletePending={deleteMutation.isPending}
          createPending={createMutation.isPending}
          writeUnconfirmed={writeUnconfirmed}
          onTypeChange={handleTypeChange}
          onCategoryChange={handleCategoryChange}
          onSubcategoryChange={handleSubcategoryChange}
          onFieldChange={handleFieldChange}
          onDelete={handleDelete}
          onCancel={handleClose}
          onSubmit={handleSubmit}
        />
      ) : (
        <FluidHistoryTab
          historyDate={historyDate}
          calendarOpen={calendarOpen}
          isHistoryToday={isHistoryToday}
          maxHistoryDate={maxHistoryDate}
          summary={historyBalanceSummary}
          records={historyRecordsList}
          loading={historyLoading || historySummaryQuery.isLoading}
          error={historyQuery.error || historySummaryQuery.error}
          onRetry={() => { void historyQuery.refetch(); void historySummaryQuery.refetch(); }}
          rustV2Mode={rustV2Mode}
          deletionAvailable={fluidBalanceDeletionAvailable}
          deletePending={deleteMutation.isPending}
          onCalendarOpenChange={setCalendarOpen}
          onDateSelect={handleHistoryDateSelect}
          onPreviousDay={goToPreviousDay}
          onNextDay={goToNextDay}
          onToday={goToToday}
          onDelete={handleDelete}
          onClose={handleClose}
        />
      )}
    </div>
  );
}

export default AddFluidBalanceSlideOver;
export { AddFluidBalanceSlideOver };
