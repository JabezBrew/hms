/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
/**
 * AddChartSlideOver - Chronicle-styled slide-over for assigning charts to patients
 *
 * Allows practitioners to select a chart template and configure
 * monitoring settings for a patient.
 */

import X from 'lucide-react/dist/esm/icons/x.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Info from 'lucide-react/dist/esm/icons/info.js';
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";

import { toast } from "sonner";
import { ChartTemplateCard } from "./ChartTemplateCard";
import {
  useChartTemplates,
  useChartCategories,
  useChartIntervals,
  useCreateChartAssignment,
} from "@/features/charts/hooks";

const AddChartSlideOver = ({
  open,
  onClose,
  patient,
  encounter,
  admission,
  allHistory = false,
  onChartAssigned,
}) => {
  const patientId = patient?.local_data?.id || patient?.id || 'unknown-patient';
  const encounterId = encounter?.id || 'no-encounter';
  const admissionId = admission?.id || 'no-admission';
  const contentKey = `${patientId}:${encounterId}:${admissionId}:${allHistory ? 'all' : 'scoped'}`;

  return (
    <div
      className={cn(
        "fixed inset-y-0 right-0 z-[100] w-full lg:w-1/2 bg-background border-l border-border",
        "transform transition-transform duration-300 ease-in-out",
        "flex flex-col shadow-2xl",
        open ? "translate-x-0" : "translate-x-full"
      )}
    >
      {open ? (
        <AddChartSlideOverContent
          key={contentKey}
          onClose={onClose}
          patient={patient}
          encounter={encounter}
          admission={admission}
          allHistory={allHistory}
          onChartAssigned={onChartAssigned}
        />
      ) : null}
    </div>
  );
};

function AddChartSlideOverContent({
  onClose,
  patient,
  encounter,
  admission,
  allHistory = false,
  onChartAssigned,
}) {
  // Fetch templates and options (lazy - only when slide-over is open)
  const { data: templatesData, isLoading: templatesLoading } = useChartTemplates({ is_active: true, enabled: true });
  const { data: categories = [] } = useChartCategories({ enabled: true });
  const { data: intervals = [] } = useChartIntervals({ enabled: true });
  const createMutation = useCreateChartAssignment();

  // Form state
  const [step, setStep] = useState(1); // 1: Select template, 2: Configure
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [formData, setFormData] = useState({
    monitoring_interval: '',
    reason: '',
    instructions: '',
  });

  // Get patient info
  const patientId = patient?.local_data?.id || patient?.id;
  const patientName = patient?.local_data?.user_details
    ? `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim()
    : patient?.name || 'Patient';
  const encounterId = encounter?.id || null;
  const admissionId = admission?.id || null;
  const scopeContextLabel = allHistory
    ? 'All history'
    : encounterId
      ? 'Selected visit'
      : admissionId
        ? 'Selected admission'
        : 'Patient record';

  // Filter templates
  const templates = templatesData?.results || templatesData || [];
  const filteredTemplates = templates.filter((t) => {
    const matchesSearch = !searchQuery ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = !categoryFilter || t.category === categoryFilter;
    const isScopeCompatible = (
      t.scope_type === 'patient'
      || (t.scope_type === 'encounter' && !!encounterId)
      || (t.scope_type === 'admission' && !!admissionId)
    );
    return matchesSearch && matchesCategory && isScopeCompatible;
  });

  // Handle template selection
  const handleSelectTemplate = (template) => {
    setSelectedTemplate(template);
    setFormData((prev) => ({
      ...prev,
      monitoring_interval: template.default_interval,
    }));
    setStep(2);
  };

  // Go back to template selection
  const handleBack = () => {
    setStep(1);
    setSelectedTemplate(null);
  };

  // Handle form submit
  const handleSubmit = async () => {
    if (!selectedTemplate || !patientId) {
      toast.error('Please select a chart template');
      return;
    }

    try {
      await createMutation.mutateAsync({
        template_id: selectedTemplate.id,
        patient: patientId,
        admission: selectedTemplate.scope_type === 'admission' ? admissionId : null,
        encounter: selectedTemplate.scope_type === 'encounter' ? encounterId : null,
        monitoring_interval: formData.monitoring_interval || undefined,
        reason: formData.reason || undefined,
        instructions: formData.instructions || undefined,
      });

      toast.success(`${selectedTemplate.name} assigned to patient`);
      onChartAssigned?.();
      onClose();
    } catch (err) {
      console.error('Failed to assign chart:', err);
    }
  };

  return (
    <>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
            <ClipboardList className="size-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h2 className="font-display text-xl text-foreground">
              {step === 1 ? 'Assign Chart' : selectedTemplate?.name}
            </h2>
            <p className="font-mono text-xs text-muted-foreground mt-0.5">
              {patientName} • {scopeContextLabel}
            </p>
          </div>
        </div>

        <Button
          variant="destructive"
          size="sm"
          onClick={onClose}
          className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
        >
          <X className="size-4 mr-1.5" />
          Close
        </Button>
      </header>

      {/* Step indicator */}
      <div className="px-6 py-3 bg-muted/30 border-b border-border">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => step > 1 && setStep(1)}
            className={cn(
              "flex items-center gap-1.5 font-mono text-xs",
              step === 1 ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span className={cn(
              "size-5 rounded-full flex items-center justify-center text-[10px]",
              step >= 1 ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground"
            )}>
              1
            </span>
            Select Chart
          </button>
          <div className="h-px w-8 bg-border" />
          <button
            type="button"
            onClick={() => selectedTemplate && setStep(2)}
            disabled={!selectedTemplate}
            className={cn(
              "flex items-center gap-1.5 font-mono text-xs",
              step === 2 ? "text-foreground" : "text-muted-foreground",
              !selectedTemplate && "opacity-50 cursor-not-allowed"
            )}
          >
            <span className={cn(
              "size-5 rounded-full flex items-center justify-center text-[10px]",
              step >= 2 ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground"
            )}>
              2
            </span>
            Configure
          </button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 p-6">
        {step === 1 ? (
          /* Step 1: Select Template */
          <div className="space-y-4">
            {/* Search and Filter */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder="Search charts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 font-mono"
                />
              </div>
              <Select value={categoryFilter || "all"} onValueChange={(v) => setCategoryFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-full sm:w-[180px] font-mono">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  <SelectItem value="all" className="font-mono">All categories</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value} className="font-mono">
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="font-mono text-[10px] text-muted-foreground">
              Showing templates compatible with {scopeContextLabel.toLowerCase()}.
            </p>

            {/* Template list */}
            {templatesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <ClipboardList className="size-12 mx-auto mb-3 opacity-50" />
                <p>No chart templates found</p>
                {searchQuery && (
                  <p className="text-xs mt-1">Try adjusting your search</p>
                )}
              </div>
            ) : (
              <div className="grid gap-3">
                {filteredTemplates.map((template, index) => (
                  <ChartTemplateCard
                    key={template.id}
                    template={template}
                    index={index}
                    onSelect={handleSelectTemplate}
                    showActions={false}
                    selected={selectedTemplate?.id === template.id}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Step 2: Configure */
          <div className="space-y-6">
            {/* Selected template info */}
            <div className="p-4 rounded-xl border border-border bg-muted/30">
              <div className="flex items-center gap-3 mb-2">
                <ClipboardList className="size-5 text-amber-600" />
                <div>
                  <p className="font-display text-base">{selectedTemplate?.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {selectedTemplate?.category_display} • {selectedTemplate?.scope_type_display} • {selectedTemplate?.field_count} fields
                  </p>
                </div>
              </div>
              {selectedTemplate?.description && (
                <p className="text-sm text-muted-foreground mt-2">
                  {selectedTemplate.description}
                </p>
              )}
            </div>

            {/* Monitoring Interval */}
            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Monitoring Interval
              </Label>
              <Select
                value={formData.monitoring_interval}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, monitoring_interval: value }))}
              >
                <SelectTrigger className="font-mono">
                  <SelectValue placeholder="Use template default" />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {intervals.map((interval) => (
                    <SelectItem key={interval.value} value={interval.value} className="font-mono">
                      {interval.label}
                      {interval.value === selectedTemplate?.default_interval && ' (default)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="flex items-start gap-1 text-[10px] text-muted-foreground">
                <Info className="size-3 mt-0.5" />
                How often observations should be recorded
              </p>
            </div>

            {/* Reason */}
            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Reason for Monitoring
              </Label>
              <Input
                value={formData.reason}
                onChange={(e) => setFormData((prev) => ({ ...prev, reason: e.target.value }))}
                placeholder="e.g., Post-operative monitoring"
                className="font-mono"
              />
            </div>

            {/* Instructions */}
            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Special Instructions
              </Label>
              <Textarea
                value={formData.instructions}
                onChange={(e) => setFormData((prev) => ({ ...prev, instructions: e.target.value }))}
                placeholder="Any specific instructions for recording observations..."
                className="font-mono text-sm resize-none"
                rows={3}
              />
            </div>
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <footer className="px-6 py-4 border-t border-border bg-card">
        <div className="flex items-center justify-between">
          {step === 2 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleBack}
              className="font-mono text-xs"
            >
              Back
            </Button>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="font-mono text-xs"
            >
              Cancel
            </Button>
            {step === 2 && (
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={createMutation.isPending || !selectedTemplate}
                className="font-mono text-xs bg-amber-600 hover:bg-amber-700"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                    Assigning…
                  </>
                ) : (
                  <>
                    <Check className="size-3.5 mr-1.5" />
                    Assign Chart
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </footer>
    </>
  );
}

export { AddChartSlideOver };
