import X from 'lucide-react/dist/esm/icons/x.js';
import Droplets from 'lucide-react/dist/esm/icons/droplets.js';
import ArrowDownCircle from 'lucide-react/dist/esm/icons/circle-arrow-down.js';
import ArrowUpCircle from 'lucide-react/dist/esm/icons/circle-arrow-up.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import CalendarIcon from 'lucide-react/dist/esm/icons/calendar.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import History from 'lucide-react/dist/esm/icons/history.js';
import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { WorkspaceShell } from '@/components/chronicle/WorkspaceShell';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import format from "date-fns/format";
import addDays from "date-fns/addDays";
import subDays from "date-fns/subDays";
import isToday from "date-fns/isToday";
import startOfDay from "date-fns/startOfDay";
import { toast } from "sonner";
import {
  useFluidBalance,
  useFluidBalanceSummary,
  useTodayFluidBalance,
  useCreateFluidBalance,
  useDeleteFluidBalance
} from "@/features/nursing/hooks";

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

  // Active tab state
  const [activeTab, setActiveTab] = useState(allowEntry ? 'entry' : 'history'); // 'entry' | 'history'

  // History date navigation state
  const [historyDate, setHistoryDate] = useState(new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Form state (includes colour for outputs)
  const [formData, setFormData] = useState({
    type: 'intake',
    category: '',
    subcategory: '',
    amount: '',
    colour: '',
    notes: ''
  });

  // Format history date for API (YYYY-MM-DD)
  const historyDateString = format(historyDate, 'yyyy-MM-dd');
  const todayDateString = format(new Date(), 'yyyy-MM-dd');

  // API hooks - only fetch when slide-over is open
  // Today's data for entry tab
  const { data: todaySummary } = useTodayFluidBalance(patientId, { enabled: open });
  const { data: todayRecords = [], isLoading: todayLoading } = useFluidBalance(patientId, { date: todayDateString }, { enabled: open });

  // Historical data for history tab
  const { data: historyRecords = [], isLoading: historyLoading } = useFluidBalance(patientId, { date: historyDateString }, { enabled: open });
  const { data: historySummary } = useFluidBalanceSummary(patientId, historyDateString, { enabled: open });

  const createMutation = useCreateFluidBalance();
  const deleteMutation = useDeleteFluidBalance();

  // Date navigation handlers for history tab
  const goToPreviousDay = () => setHistoryDate(prev => subDays(prev, 1));
  const goToNextDay = () => {
    const tomorrow = addDays(historyDate, 1);
    if (startOfDay(tomorrow) <= startOfDay(new Date())) {
      setHistoryDate(tomorrow);
    }
  };
  const goToToday = () => setHistoryDate(new Date());
  const isHistoryToday = isToday(historyDate);

  // Reset form and state when panel closes
  useEffect(() => {
    if (!open) {
      setFormData({
        type: 'intake',
        category: '',
        subcategory: '',
        amount: '',
        colour: '',
        notes: ''
      });
      setActiveTab(allowEntry ? 'entry' : 'history');
      setHistoryDate(new Date());
    }
  }, [allowEntry, open]);

  useEffect(() => {
    if (!allowEntry && activeTab === 'entry') {
      setActiveTab('history');
    }
  }, [activeTab, allowEntry]);

  // Get patient display name
  const patientName = patient?.local_data?.user_details
    ? `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim()
    : patient?.name || 'Patient';

  // Category options based on entry type
  const getCategoryOptions = () => {
    if (formData.type === 'intake') {
      return [
        { label: 'Oral', value: 'oral' },
        { label: 'IV Fluids', value: 'iv' },
        { label: 'Enteral Feed', value: 'enteral' },
        { label: 'Blood Products', value: 'blood' }
      ];
    } else {
      return [
        { label: 'Urine', value: 'urine' },
        { label: 'Vomit', value: 'vomit' },
        { label: 'Stool', value: 'stool' },
        { label: 'Drain', value: 'drain' },
        { label: 'N.G. Suction', value: 'ng_suction' },
        { label: 'Other', value: 'other' }
      ];
    }
  };

  // Subcategory options based on selected category
  const getSubcategoryOptions = () => {
    if (!formData.category) return [];

    const subcategoryMap = {
      'oral': [
        { label: 'Water', value: 'Water' },
        { label: 'Juice', value: 'Juice' },
        { label: 'Tea/Coffee', value: 'Tea/Coffee' },
        { label: 'Milk', value: 'Milk' },
        { label: 'Other', value: 'Other' }
      ],
      'iv': [
        { label: 'Normal Saline', value: 'Normal Saline' },
        { label: 'Lactated Ringers', value: 'Lactated Ringers' },
        { label: 'D5W', value: 'D5W' },
        { label: 'Other', value: 'Other' }
      ],
      'enteral': [
        { label: 'NG Tube', value: 'NG Tube' },
        { label: 'PEG Tube', value: 'PEG Tube' },
        { label: 'Other', value: 'Other' }
      ],
      'blood': [
        { label: 'Packed RBCs', value: 'Packed RBCs' },
        { label: 'Platelets', value: 'Platelets' },
        { label: 'Plasma', value: 'Plasma' },
        { label: 'Other', value: 'Other' }
      ],
      'drain': [
        { label: 'Chest Tube', value: 'Chest Tube' },
        { label: 'JP Drain', value: 'JP Drain' },
        { label: 'Penrose', value: 'Penrose' },
        { label: 'Other', value: 'Other' }
      ],
      'urine': [
        { label: 'Voided', value: 'Voided' },
        { label: 'Foley', value: 'Foley' }
      ],
      'ng_suction': [
        { label: 'Aspirate', value: 'Aspirate' },
        { label: 'Drainage', value: 'Drainage' },
        { label: 'Other', value: 'Other' }
      ]
    };

    return subcategoryMap[formData.category] || [];
  };

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
    const amount = parseInt(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Please enter a valid amount greater than 0');
      return;
    }

    if (!formData.category) {
      toast.error('Please select a category');
      return;
    }

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

      onFluidRecorded?.();
    } catch (err) {
      console.error('Failed to record fluid balance:', err);
      toast.error('Failed to record fluid balance');
    }
  };

  // Handle delete entry
  const handleDelete = async (entryId) => {
    try {
      await deleteMutation.mutateAsync(entryId);
      toast.success('Entry deleted');
    } catch (err) {
      console.error('Failed to delete entry:', err);
      toast.error('Failed to delete entry');
    }
  };

  // Handle close
  const handleClose = () => {
    setFormData({
      type: 'intake',
      category: '',
      subcategory: '',
      amount: '',
      colour: '',
      notes: ''
    });
    setActiveTab(allowEntry ? 'entry' : 'history');
    setHistoryDate(new Date());
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

  // Get category display label
  const getCategoryLabel = (category) => {
    const labels = {
      oral: 'Oral',
      iv: 'IV',
      enteral: 'Enteral',
      blood: 'Blood',
      urine: 'Urine',
      vomit: 'Vomit',
      stool: 'Stool',
      drain: 'Drain',
      ng_suction: 'N.G. Suction',
      other: 'Other'
    };
    return labels[category] || category;
  };

  // Render a fluid entry row
  const renderEntryRow = (record, allowDelete = true) => (
    <div
      key={record.id}
      className={cn(
        "flex items-center justify-between p-3 rounded-lg border",
        record.entry_type === 'intake'
          ? "bg-sky-50/50 border-sky-200 dark:bg-sky-900/10 dark:border-sky-800"
          : "bg-amber-50/50 border-amber-200 dark:bg-amber-900/10 dark:border-amber-800"
      )}
    >
      <div className="flex items-center gap-3">
        {record.entry_type === 'intake' ? (
          <ArrowDownCircle className="h-4 w-4 text-sky-500 flex-shrink-0" />
        ) : (
          <ArrowUpCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
        )}
        <div>
          <div className="font-mono text-sm">
            <span className={record.entry_type === 'intake' ? 'text-sky-700 dark:text-sky-400' : 'text-amber-700 dark:text-amber-400'}>
              {record.volume_ml}ml
            </span>
            <span className="text-muted-foreground ml-2">
              {getCategoryLabel(record.category)}
              {record.subcategory && ` - ${record.subcategory}`}
            </span>
            {record.entry_type === 'output' && record.colour && (
              <span className="text-muted-foreground ml-2 italic">
                ({record.colour})
              </span>
            )}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {format(new Date(record.recorded_at), 'h:mm a')}
            {record.notes && <span className="ml-2">• {record.notes}</span>}
          </div>
        </div>
      </div>
      {allowDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0"
          onClick={() => handleDelete(record.id)}
          disabled={deleteMutation.isPending}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );

  // Render balance summary bar
  const renderBalanceSummary = (intake, output, balance, label) => (
    <div className="flex items-center justify-between px-4 py-3 bg-muted/30 rounded-lg">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <ArrowDownCircle className="h-3.5 w-3.5 text-sky-500" />
          <span className="font-mono text-sm text-sky-600">{intake}ml</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ArrowUpCircle className="h-3.5 w-3.5 text-amber-500" />
          <span className="font-mono text-sm text-amber-600">{output}ml</span>
        </div>
        <div className={cn(
          "font-mono text-sm font-medium px-2 py-0.5 rounded",
          balance > 0 && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
          balance < 0 && "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
          balance === 0 && "bg-muted text-muted-foreground"
        )}>
          {balance > 0 ? '+' : ''}{balance}ml
        </div>
      </div>
    </div>
  );

  return (
    <WorkspaceShell open={open}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-sky-100 dark:bg-sky-900/30">
            <Droplets className="h-5 w-5 text-sky-600 dark:text-sky-400" />
          </div>
          <div>
            <h2 className="font-display text-xl text-foreground">
              Fluid Balance
            </h2>
            <p className="font-mono text-xs text-muted-foreground mt-0.5">
              {patientName}
            </p>
          </div>
        </div>

        <Button
          variant="destructive"
          size="sm"
          onClick={handleClose}
          className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
        >
          <X className="h-4 w-4 mr-1.5" />
          Close
        </Button>
      </header>

      {/* Tab Navigation */}
      <div className="flex border-b border-border bg-card">
        {allowEntry && (
          <button
            onClick={() => setActiveTab('entry')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-4 py-3 font-mono text-sm transition-colors",
              "border-b-2",
              activeTab === 'entry'
                ? "border-sky-500 text-sky-600 bg-sky-50/50 dark:bg-sky-900/10"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            <Plus className="h-4 w-4" />
            Record Entry
          </button>
        )}
        <button
          onClick={() => setActiveTab('history')}
          className={cn(
            "flex items-center justify-center gap-2 px-4 py-3 font-mono text-sm transition-colors",
            "border-b-2",
            allowEntry ? "flex-1" : "w-full",
            activeTab === 'history'
              ? "border-amber-500 text-amber-600 bg-amber-50/50 dark:bg-amber-900/10"
              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
          )}
        >
          <History className="h-4 w-4" />
          History
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'entry' ? (
        /* ===================== ENTRY TAB ===================== */
        <>
          <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
            {/* Today's Summary */}
            {renderBalanceSummary(todayIntake, todayOutput, todayBalance, "Today's Balance")}

            {/* Entry Form */}
            <div className="mt-6 space-y-5">
              {/* Type Selection - Visual Toggle */}
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Entry Type
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleTypeChange('intake')}
                    className={cn(
                      "flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-all",
                      "font-mono text-sm",
                      formData.type === 'intake'
                        ? "border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-400"
                        : "border-border hover:border-sky-300 text-muted-foreground"
                    )}
                  >
                    <ArrowDownCircle className="h-4 w-4" />
                    Intake (IN)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTypeChange('output')}
                    className={cn(
                      "flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-all",
                      "font-mono text-sm",
                      formData.type === 'output'
                        ? "border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
                        : "border-border hover:border-amber-300 text-muted-foreground"
                    )}
                  >
                    <ArrowUpCircle className="h-4 w-4" />
                    Output (OUT)
                  </button>
                </div>
              </div>

              {/* Category & Subcategory */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Category *
                  </Label>
                  <Select
                    value={formData.category}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, category: value, subcategory: '' }))}
                  >
                    <SelectTrigger className="font-mono">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent className="z-[200]">
                      {getCategoryOptions().map(option => (
                        <SelectItem key={option.value} value={option.value} className="font-mono">
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Subcategory
                  </Label>
                  <Select
                    value={formData.subcategory}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, subcategory: value }))}
                    disabled={!formData.category || getSubcategoryOptions().length === 0}
                  >
                    <SelectTrigger className="font-mono">
                      <SelectValue placeholder="Optional..." />
                    </SelectTrigger>
                    <SelectContent className="z-[200]">
                      {getSubcategoryOptions().map(option => (
                        <SelectItem key={option.value} value={option.value} className="font-mono">
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Amount */}
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Amount *
                </Label>
                <div className="relative">
                  <Input
                    type="number"
                    placeholder="Enter amount"
                    value={formData.amount}
                    onChange={(e) => setFormData(prev => ({ ...prev, amount: e.target.value }))}
                    className="font-mono pr-12 text-lg"
                    min="1"
                    max="10000"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono">
                    ml
                  </span>
                </div>
                {/* Quick amount buttons */}
                <div className="flex flex-wrap gap-2 mt-2">
                  {[50, 100, 150, 200, 250, 500].map(amt => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, amount: amt.toString() }))}
                      className={cn(
                        "px-3 py-1.5 rounded font-mono text-xs transition-colors",
                        formData.amount === amt.toString()
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted hover:bg-muted/80 text-muted-foreground"
                      )}
                    >
                      {amt}ml
                    </button>
                  ))}
                </div>
              </div>

              {/* Colour - Only for output entries */}
              {formData.type === 'output' && (
                <div className="space-y-2">
                  <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Colour
                  </Label>
                  <Input
                    type="text"
                    placeholder="e.g., clear, dark amber, cloudy, bloody..."
                    value={formData.colour}
                    onChange={(e) => setFormData(prev => ({ ...prev, colour: e.target.value }))}
                    className="font-mono text-sm"
                  />
                </div>
              )}

              {/* Notes */}
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Notes
                </Label>
                <Textarea
                  placeholder="Any additional observations..."
                  value={formData.notes}
                  onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  className="font-mono text-sm resize-none"
                  rows={2}
                />
              </div>
            </div>

            {/* Today's Recent Entries */}
            {todayRecordsList.length > 0 && (
              <>
                <div className="my-6 border-t border-border" />
                <div>
                  <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">
                    Today's Entries
                  </h3>
                  {todayLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {todayRecordsList.map(record => renderEntryRow(record, true))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Entry Tab Footer */}
          <footer className="px-6 py-4 border-t border-border bg-card">
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleClose}
                className="font-mono text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={createMutation.isPending || !formData.category || !formData.amount}
                className={cn(
                  "font-mono text-xs",
                  formData.type === 'intake'
                    ? "bg-sky-600 hover:bg-sky-700"
                    : "bg-amber-600 hover:bg-amber-700"
                )}
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Recording...
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5 mr-1.5" />
                    Record {formData.type === 'intake' ? 'Intake' : 'Output'}
                  </>
                )}
              </Button>
            </div>
          </footer>
        </>
      ) : (
        /* ===================== HISTORY TAB ===================== */
        <>
          {/* Date Navigation */}
          <div className="px-6 py-3 bg-muted/50 border-b border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={goToPreviousDay}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="min-w-[180px] justify-start text-left font-mono text-sm"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(historyDate, 'EEE, MMM d, yyyy')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 z-[200]" align="start">
                    <Calendar
                      mode="single"
                      selected={historyDate}
                      onSelect={(date) => {
                        if (date) {
                          setHistoryDate(date);
                          setCalendarOpen(false);
                        }
                      }}
                      disabled={(date) => startOfDay(date) > startOfDay(new Date())}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={goToNextDay}
                  disabled={isHistoryToday}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>

                {!isHistoryToday && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={goToToday}
                    className="font-mono text-xs ml-2"
                  >
                    Today
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
            {/* Selected Date Summary */}
            {renderBalanceSummary(
              historyIntake,
              historyOutput,
              historyBalance,
              isHistoryToday ? "Today's Balance" : `${format(historyDate, 'MMM d')} Balance`
            )}

            {/* Entries List */}
            <div className="mt-6">
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">
                {isHistoryToday ? "Today's Entries" : `Entries for ${format(historyDate, 'MMMM d, yyyy')}`}
              </h3>

              {historyLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : historyRecordsList.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Droplets className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="font-mono text-sm">No entries recorded for this date</p>
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-2 pr-4">
                    {historyRecordsList.map(record => renderEntryRow(record, isHistoryToday))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>

          {/* History Tab Footer */}
          <footer className="px-6 py-4 border-t border-border bg-card">
            <div className="flex items-center justify-between">
              <p className="font-mono text-xs text-muted-foreground">
                {historyRecordsList.length} {historyRecordsList.length === 1 ? 'entry' : 'entries'}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClose}
                className="font-mono text-xs"
              >
                Close
              </Button>
            </div>
          </footer>
        </>
      )}
    </WorkspaceShell>
  );
};

export default AddFluidBalanceSlideOver;
export { AddFluidBalanceSlideOver };
