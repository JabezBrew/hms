import X from 'lucide-react/dist/esm/icons/x.js';
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import { useState, useCallback, useEffect, useMemo } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  WorkflowSteps,
  WorkflowKeyboardHints,
  useWorkflowKeyboard,
} from "@/components/ui/workflow-steps";
import {
  useLabTests,
  useLabPanels,
  useCreateLabOrder,
  useSubmitLabOrder,
} from "@/features/laboratory/hooks";
import { emitOnboardingEvent } from "@/features/onboarding";
import { toast } from "sonner";

/**
 * LabOrderForm - Multi-step wizard for creating lab orders
 *
 * Features:
 * - Test and panel selection with categories
 * - Priority levels (routine, urgent, stat)
 * - Clinical notes and indication
 * - Patient and encounter linking
 * - Immediate submission workflow
 * - Chronicle design system styling
 */
const LabOrderForm = ({ open, onClose, patient, encounter, onOrderCreated }) => {
  // Get patient and encounter IDs
  const patientId = patient?.local_data?.id || patient?.id;
  const encounterId = encounter?.local_data?.id || encounter?.id;

  // Workflow steps configuration
  const steps = [
    { id: 'select_tests', title: 'Select Tests' },
    { id: 'details', title: 'Details' },
    { id: 'review', title: 'Review' },
  ];
  const totalSteps = steps.length;

  // Step state
  const [currentStep, setCurrentStep] = useState(1);

  // Form state
  const [formData, setFormData] = useState({
    priority: "routine",
    clinical_notes: "",
    indication: "",
    selected_tests: [],
    selected_panels: [],
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [errors, setErrors] = useState({});

  // TODO: Switch to backend search when catalog grows beyond ~500 items
  // Currently using frontend fuzzy search for instant results with small catalog
  // To switch: pass { search: debouncedSearch } to useLabTests/useLabPanels hooks
  // and remove the client-side fuzzyMatch filtering below

  // Load all tests and panels when form opens (small catalog, ~200 items)
  // Uses lazy loading - only fetches when slide-over is open
  const { data: testsData, isLoading: testsLoading } = useLabTests({
    enabled: open,
    page_size: 500,
  });
  const { data: panelsData, isLoading: panelsLoading } = useLabPanels({
    enabled: open,
    page_size: 500,
  });
  const createOrder = useCreateLabOrder();
  const submitOrder = useSubmitLabOrder();

  // Reset form when panel closes
  useEffect(() => {
    if (!open) {
      setFormData({
        priority: "routine",
        clinical_notes: "",
        indication: "",
        selected_tests: [],
        selected_panels: [],
      });
      setCurrentStep(1);
      setErrors({});
      setSearchQuery("");
      setActiveCategory("all");
    }
  }, [open]);

  // Normalize data - API returns array directly, not { results: [...] }
  const tests = Array.isArray(testsData) ? testsData : (testsData?.results || []);
  const panels = Array.isArray(panelsData) ? panelsData : (panelsData?.results || []);

  // Fuzzy search function - matches if all search terms appear in searchable text
  // Handles abbreviations naturally (TSH matches "Thyroid Stimulating Hormone" if TSH is in code/short_name)
  const fuzzyMatch = (item, query) => {
    if (!query.trim()) return true;

    const searchTerms = query.toLowerCase().trim().split(/\s+/);
    const searchableText = [
      item.name,
      item.code,
      item.short_name,
      item.loinc_code,
      item.description,
      item.category,
      item.specimen_type,
    ].filter(Boolean).join(' ').toLowerCase();

    // All terms must match somewhere in the searchable text
    return searchTerms.every(term => searchableText.includes(term));
  };

  // Filter tests by search query, category, and active status
  const filteredTests = useMemo(() => {
    return tests.filter((test) => {
      const isActive = test.is_active !== false;
      const matchesSearch = fuzzyMatch(test, searchQuery);
      const matchesCategory = activeCategory === "all" || test.category === activeCategory;
      return isActive && matchesSearch && matchesCategory;
    });
  }, [tests, searchQuery, activeCategory]);

  // Filter panels by search query and active status
  const filteredPanels = useMemo(() => {
    return panels.filter((panel) => {
      const isActive = panel.is_active !== false;
      const matchesSearch = fuzzyMatch(panel, searchQuery);
      return isActive && matchesSearch;
    });
  }, [panels, searchQuery]);

  // Get test categories for the category filter buttons
  const categories = tests.length > 0
    ? [...new Set(tests.map((test) => test.category).filter(Boolean))]
    : [];

  // Check if we have search results to show combined view
  const hasSearchQuery = searchQuery.trim().length > 0;
  const totalResults = filteredTests.length + filteredPanels.length;

  // Handle test selection
  const handleTestToggle = (testId) => {
    setFormData((prev) => ({
      ...prev,
      selected_tests: prev.selected_tests.includes(testId)
        ? prev.selected_tests.filter((id) => id !== testId)
        : [...prev.selected_tests, testId],
    }));
  };

  // Handle panel selection
  const handlePanelToggle = (panelId) => {
    setFormData((prev) => ({
      ...prev,
      selected_panels: prev.selected_panels.includes(panelId)
        ? prev.selected_panels.filter((id) => id !== panelId)
        : [...prev.selected_panels, panelId],
    }));
  };

  // Validation
  const validateStep = (step) => {
    const newErrors = {};

    if (step === 1) {
      if (
        formData.selected_tests.length === 0 &&
        formData.selected_panels.length === 0
      ) {
        newErrors.tests = "Please select at least one test or panel";
      }
    }

    if (step === 2) {
      if (!formData.indication || formData.indication.trim() === "") {
        newErrors.indication = "Indication is required";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle next step
  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => Math.min(prev + 1, 3));
    }
  };

  // Handle previous step
  const handleBack = useCallback(() => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  }, []);

  // Handle jump to specific step
  const goToStep = useCallback((stepNumber) => {
    if (stepNumber >= 1 && stepNumber <= totalSteps && stepNumber !== currentStep) {
      setCurrentStep(stepNumber);
    }
  }, [currentStep, totalSteps]);

  // Handle submit
  const handleSubmit = async () => {
    // Validate all steps before submitting
    if (!validateStep(1) || !validateStep(2)) return;

    try {
      // Create order (ordering_provider auto-set by backend from current user)
      // Combine indication and clinical_notes into clinical_notes field
      const combinedNotes = [
        formData.indication && `Indication: ${formData.indication}`,
        formData.clinical_notes
      ].filter(Boolean).join('\n\n');

      const orderData = {
        patient: patientId,
        encounter: encounterId || null,
        priority: formData.priority,
        clinical_notes: combinedNotes,
        test_ids: formData.selected_tests,
        panel_ids: formData.selected_panels,
      };

      const createdOrder = await createOrder.mutateAsync(orderData);

      // Submit order immediately
      await submitOrder.mutateAsync(createdOrder.id);

      emitOnboardingEvent('labs.order_created', {
        success: true,
        order_id: createdOrder.id,
        patient_id: patientId || null,
      });

      toast.success("Lab order created and submitted", {
        description: `Order #${createdOrder.order_number} has been submitted`,
      });

      if (onOrderCreated) {
        onOrderCreated(createdOrder);
      }

      onClose();
    } catch (error) {
      console.error("Error creating lab order:", error);
      toast.error("Failed to create lab order", {
        description: error.message || "Please try again",
      });
    }
  };

  // Keyboard navigation for workflow
  useWorkflowKeyboard({
    enabled: open,
    currentStep,
    totalSteps,
    onNextStep: handleNext,
    onPrevStep: handleBack,
    onGoToStep: goToStep,
    onComplete: currentStep === totalSteps ? handleSubmit : undefined,
    onClose,
  });

  // Get selected items summary
  const getSelectedSummary = () => {
    const selectedTests = tests.filter((test) =>
      formData.selected_tests.includes(test.id)
    );
    const selectedPanels = panels.filter((panel) =>
      formData.selected_panels.includes(panel.id)
    );

    return { tests: selectedTests, panels: selectedPanels };
  };

  const { tests: selectedTestsList, panels: selectedPanelsList } =
    getSelectedSummary();

  // Priority config
  const priorityConfig = {
    routine: {
      label: "Routine",
      color: "bg-muted text-muted-foreground",
      description: "Standard turnaround time",
    },
    urgent: {
      label: "Urgent",
      color: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
      description: "Expedited processing",
    },
    stat: {
      label: "STAT",
      color: "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400",
      description: "Immediate processing required",
    },
  };

  // Get patient display name
  const patientName = patient?.local_data?.user_details
    ? `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim()
    : patient?.local_data?.first_name
    ? `${patient.local_data.first_name} ${patient.local_data.last_name || ''}`.trim()
    : patient?.name || 'Patient';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lab-order-title"
      className={cn(
        "fixed inset-y-0 right-0 z-[100] w-full lg:w-1/2 bg-background border-l border-border",
        "transform transition-transform duration-300 ease-in-out",
        "flex flex-col shadow-2xl",
        open ? "translate-x-0" : "translate-x-full"
      )}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-sky-100 dark:bg-sky-900/30">
            <TestTube2 className="h-5 w-5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
          </div>
          <div>
            <h2 id="lab-order-title" className="font-display text-xl text-foreground">
              Order Labs
            </h2>
            <p className="font-mono text-xs text-muted-foreground mt-0.5">
              {patientName}
            </p>
          </div>
        </div>

        <Button
          variant="destructive"
          size="sm"
          onClick={onClose}
          className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
        >
          <X className="h-4 w-4 mr-1.5" aria-hidden="true" />
          Close
        </Button>
      </header>

      {/* Progress Indicator */}
      <div className="bg-card border-b border-border px-6 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-xs text-muted-foreground">
            Step {currentStep} of {totalSteps}
          </span>
        </div>
        <WorkflowSteps
          steps={steps}
          currentStep={currentStep}
          onStepClick={goToStep}
        />
      </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {/* Step 1: Test Selection */}
          {currentStep === 1 && (
            <div className="space-y-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Label htmlFor="lab-test-search" className="sr-only">Search tests and panels</Label>
                <Input
                  id="lab-test-search"
                  placeholder="Search by name or abbreviation (TSH, CBC, LFTs...)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                  autoFocus
                />
              </div>

              {errors.tests && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{errors.tests}</AlertDescription>
                </Alert>
              )}

              {/* Selection summary */}
              {(formData.selected_tests.length > 0 || formData.selected_panels.length > 0) && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                  <Check className="h-4 w-4 text-emerald-600" />
                  <span>
                    {formData.selected_panels.length > 0 && (
                      <span className="font-medium">{formData.selected_panels.length} panel{formData.selected_panels.length !== 1 ? 's' : ''}</span>
                    )}
                    {formData.selected_panels.length > 0 && formData.selected_tests.length > 0 && ' and '}
                    {formData.selected_tests.length > 0 && (
                      <span className="font-medium">{formData.selected_tests.length} test{formData.selected_tests.length !== 1 ? 's' : ''}</span>
                    )}
                    {' '}selected
                  </span>
                </div>
              )}

              {/* Combined Search Results or Tabbed Browse */}
              {hasSearchQuery ? (
                // Combined search results view
                <div className="space-y-4">
                  <div aria-live="polite" aria-atomic="true" className="text-sm text-muted-foreground">
                    Found {totalResults} result{totalResults !== 1 ? 's' : ''} for "{searchQuery}"
                  </div>

                  {testsLoading || panelsLoading ? (
                    <div className="text-center py-8 text-muted-foreground">
                      Searching...
                    </div>
                  ) : totalResults === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No tests or panels found</p>
                      <p className="text-xs mt-1">Try different keywords or abbreviations (e.g., TSH, CBC, LFTs)</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Panels first */}
                      {filteredPanels.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs font-mono uppercase text-muted-foreground">
                            <Package className="h-3 w-3" />
                            Panels ({filteredPanels.length})
                          </div>
                          {filteredPanels.map((panel) => (
                            <Card
                              key={panel.id}
                              tabIndex={0}
                              role="checkbox"
                              aria-checked={formData.selected_panels.includes(panel.id)}
                              aria-label={`${panel.name} panel, ${panel.test_count || 0} tests, $${Number(panel.price || 0).toFixed(2)}`}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlePanelToggle(panel.id); } }}
                              className={cn(
                                "cursor-pointer transition-colors",
                                formData.selected_panels.includes(panel.id)
                                  ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20"
                                  : "hover:border-muted-foreground/50"
                              )}
                              onClick={() => handlePanelToggle(panel.id)}
                            >
                              <CardHeader className="py-3">
                                <div className="flex items-start justify-between">
                                  <div className="flex items-start gap-3">
                                    <Checkbox
                                      checked={formData.selected_panels.includes(panel.id)}
                                      onCheckedChange={() => handlePanelToggle(panel.id)}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <CardTitle className="text-base">{panel.name}</CardTitle>
                                        <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                                          Panel
                                        </Badge>
                                      </div>
                                      <CardDescription className="text-xs font-mono mt-1">
                                        {panel.code} • {panel.test_count || 0} tests
                                      </CardDescription>
                                    </div>
                                  </div>
                                  <div className="text-sm font-semibold text-foreground">
                                    ${Number(panel.price || 0).toFixed(2)}
                                  </div>
                                </div>
                              </CardHeader>
                            </Card>
                          ))}
                        </div>
                      )}

                      {/* Tests */}
                      {filteredTests.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs font-mono uppercase text-muted-foreground">
                            <TestTube2 className="h-3 w-3" />
                            Individual Tests ({filteredTests.length})
                          </div>
                          {filteredTests.slice(0, 20).map((test) => (
                            <Card
                              key={test.id}
                              tabIndex={0}
                              role="checkbox"
                              aria-checked={formData.selected_tests.includes(test.id)}
                              aria-label={`${test.name}, ${test.category}, $${Number(test.price || 0).toFixed(2)}`}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleTestToggle(test.id); } }}
                              className={cn(
                                "cursor-pointer transition-colors",
                                formData.selected_tests.includes(test.id)
                                  ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20"
                                  : "hover:border-muted-foreground/50"
                              )}
                              onClick={() => handleTestToggle(test.id)}
                            >
                              <CardHeader className="py-3">
                                <div className="flex items-start justify-between">
                                  <div className="flex items-start gap-3">
                                    <Checkbox
                                      checked={formData.selected_tests.includes(test.id)}
                                      onCheckedChange={() => handleTestToggle(test.id)}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <CardTitle className="text-base">{test.name}</CardTitle>
                                        <Badge variant="outline" className="text-xs capitalize">
                                          {test.category}
                                        </Badge>
                                      </div>
                                      <CardDescription className="text-xs font-mono mt-1">
                                        {test.loinc_code && `LOINC: ${test.loinc_code}`}
                                        {test.loinc_code && test.tat_hours && ' • '}
                                        {test.tat_hours && `${test.tat_hours}h TAT`}
                                      </CardDescription>
                                    </div>
                                  </div>
                                  <div className="text-sm font-semibold text-foreground">
                                    ${Number(test.price || 0).toFixed(2)}
                                  </div>
                                </div>
                              </CardHeader>
                            </Card>
                          ))}
                          {filteredTests.length > 20 && (
                            <p className="text-xs text-muted-foreground text-center py-2">
                              Showing first 20 of {filteredTests.length} tests. Refine your search for more specific results.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                // Tabbed browse view (no search)
                <>
                  {/* Category Filter */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant={activeCategory === "all" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setActiveCategory("all")}
                    >
                      All
                    </Button>
                    {categories.map((category) => (
                      <Button
                        key={category}
                        variant={activeCategory === category ? "default" : "outline"}
                        size="sm"
                        onClick={() => setActiveCategory(category)}
                        className="capitalize"
                      >
                        {category}
                      </Button>
                    ))}
                  </div>

                  {/* Tabs */}
                  <Tabs defaultValue="panels" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="panels">
                        <Package className="h-4 w-4 mr-2" />
                        Panels ({filteredPanels.length})
                      </TabsTrigger>
                      <TabsTrigger value="tests">
                        <TestTube2 className="h-4 w-4 mr-2" />
                        Tests ({filteredTests.length})
                      </TabsTrigger>
                    </TabsList>

                    {/* Panels Tab */}
                    <TabsContent value="panels" className="space-y-3 mt-4">
                      {panelsLoading ? (
                        <div className="text-center py-8 text-muted-foreground">
                          Loading panels...
                        </div>
                      ) : filteredPanels.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          No panels available
                        </div>
                      ) : (
                        filteredPanels.map((panel) => (
                          <Card
                            key={panel.id}
                            tabIndex={0}
                            role="checkbox"
                            aria-checked={formData.selected_panels.includes(panel.id)}
                            aria-label={`${panel.name} panel, ${panel.test_count || 0} tests, $${Number(panel.price || 0).toFixed(2)}`}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlePanelToggle(panel.id); } }}
                            className={cn(
                              "cursor-pointer transition-colors",
                              formData.selected_panels.includes(panel.id)
                                ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20"
                                : "hover:border-muted-foreground/50"
                            )}
                            onClick={() => handlePanelToggle(panel.id)}
                          >
                            <CardHeader className="pb-3">
                              <div className="flex items-start justify-between">
                                <div className="flex items-start gap-3">
                                  <Checkbox
                                    checked={formData.selected_panels.includes(panel.id)}
                                    onCheckedChange={() => handlePanelToggle(panel.id)}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <div>
                                    <CardTitle className="text-base">
                                      {panel.name}
                                    </CardTitle>
                                    <CardDescription className="text-xs font-mono mt-1">
                                      {panel.code} • {panel.test_count || 0} tests
                                    </CardDescription>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-sm font-semibold text-foreground">
                                    ${Number(panel.price || 0).toFixed(2)}
                                  </div>
                                </div>
                              </div>
                            </CardHeader>
                            {panel.description && (
                              <CardContent className="pt-0">
                                <p className="text-sm text-muted-foreground">
                                  {panel.description}
                                </p>
                              </CardContent>
                            )}
                          </Card>
                        ))
                      )}
                    </TabsContent>

                    {/* Individual Tests Tab */}
                    <TabsContent value="tests" className="space-y-3 mt-4">
                      {testsLoading ? (
                        <div className="text-center py-8 text-muted-foreground">
                          Loading tests...
                        </div>
                      ) : filteredTests.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          No tests available
                        </div>
                      ) : (
                        filteredTests.map((test) => (
                          <Card
                            key={test.id}
                            tabIndex={0}
                            role="checkbox"
                            aria-checked={formData.selected_tests.includes(test.id)}
                            aria-label={`${test.name}, ${test.category}, $${Number(test.price || 0).toFixed(2)}`}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleTestToggle(test.id); } }}
                            className={cn(
                              "cursor-pointer transition-colors",
                              formData.selected_tests.includes(test.id)
                                ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20"
                                : "hover:border-muted-foreground/50"
                            )}
                            onClick={() => handleTestToggle(test.id)}
                          >
                            <CardHeader className="pb-3">
                              <div className="flex items-start justify-between">
                                <div className="flex items-start gap-3">
                                  <Checkbox
                                    checked={formData.selected_tests.includes(test.id)}
                                    onCheckedChange={() => handleTestToggle(test.id)}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <CardTitle className="text-base">
                                        {test.name}
                                      </CardTitle>
                                      <Badge
                                        variant="outline"
                                        className="text-xs capitalize"
                                      >
                                        {test.category}
                                      </Badge>
                                    </div>
                                    <CardDescription className="text-xs font-mono mt-1">
                                      {test.loinc_code && `LOINC: ${test.loinc_code}`}
                                      {test.loinc_code && test.tat_hours && ' • '}
                                      {test.tat_hours && `${test.tat_hours}h TAT`}
                                    </CardDescription>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-sm font-semibold text-foreground">
                                    ${Number(test.price || 0).toFixed(2)}
                                  </div>
                                </div>
                              </div>
                            </CardHeader>
                            {test.specimen_type && (
                              <CardContent className="pt-0">
                                <div className="text-xs text-muted-foreground">
                                  <span className="font-medium">Specimen:</span>{" "}
                                  {test.specimen_type}
                                </div>
                              </CardContent>
                            )}
                          </Card>
                        ))
                      )}
                    </TabsContent>
                  </Tabs>
                </>
              )}
            </div>
          )}

          {/* Step 2: Clinical Details */}
          {currentStep === 2 && (
            <div className="space-y-6">
              {/* Priority */}
              <div className="space-y-2">
                <Label htmlFor="priority">Priority *</Label>
                <Select
                  value={formData.priority}
                  onValueChange={(value) =>
                    setFormData((prev) => ({ ...prev, priority: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[200]">
                    {Object.entries(priorityConfig).map(([key, config]) => (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-2">
                          <Badge className={config.color}>{config.label}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {config.description}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Indication */}
              <div className="space-y-2">
                <Label htmlFor="indication">Clinical Indication *</Label>
                <Textarea
                  id="indication"
                  placeholder="Why is this test being ordered? (e.g., 'Rule out anemia', 'Monitor diabetes', 'Chest pain workup')"
                  value={formData.indication}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      indication: e.target.value,
                    }))
                  }
                  className={cn(
                    "min-h-[80px]",
                    errors.indication && "border-rose-500"
                  )}
                />
                {errors.indication && (
                  <p className="text-sm text-rose-600">{errors.indication}</p>
                )}
              </div>

              {/* Clinical Notes */}
              <div className="space-y-2">
                <Label htmlFor="clinical_notes">Additional Clinical Notes</Label>
                <Textarea
                  id="clinical_notes"
                  placeholder="Any additional information for the lab (optional)"
                  value={formData.clinical_notes}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      clinical_notes: e.target.value,
                    }))
                  }
                  className="min-h-[100px]"
                />
              </div>

              {/* Selected Items Preview */}
              <div className="bg-muted border border-border rounded-lg p-4">
                <h3 className="font-heading font-semibold text-foreground mb-3">
                  Selected Items
                </h3>
                <div className="space-y-2">
                  {selectedPanelsList.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-foreground mb-2">
                        Panels:
                      </p>
                      <div className="space-y-1">
                        {selectedPanelsList.map((panel) => (
                          <div
                            key={panel.id}
                            className="text-sm text-muted-foreground flex items-center gap-2"
                          >
                            <Package className="h-3 w-3" />
                            {panel.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedTestsList.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-foreground mb-2">
                        Individual Tests:
                      </p>
                      <div className="space-y-1">
                        {selectedTestsList.map((test) => (
                          <div
                            key={test.id}
                            className="text-sm text-muted-foreground flex items-center gap-2"
                          >
                            <TestTube2 className="h-3 w-3" />
                            {test.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Review */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Please review the order details before submitting. The order will
                  be immediately submitted to the laboratory.
                </AlertDescription>
              </Alert>

              {/* Priority */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="font-heading font-semibold text-foreground mb-3">
                  Order Priority
                </h3>
                <Badge className={priorityConfig[formData.priority].color}>
                  {priorityConfig[formData.priority].label}
                </Badge>
              </div>

              {/* Tests and Panels */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="font-heading font-semibold text-foreground mb-3">
                  Tests & Panels
                </h3>
                <div className="space-y-4">
                  {selectedPanelsList.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-foreground mb-2">
                        Panels:
                      </p>
                      <div className="space-y-2">
                        {selectedPanelsList.map((panel) => (
                          <div
                            key={panel.id}
                            className="flex items-center justify-between text-sm"
                          >
                            <div className="flex items-center gap-2">
                              <Package className="h-4 w-4 text-muted-foreground" />
                              <span className="text-foreground">{panel.name}</span>
                            </div>
                            <span className="font-semibold text-foreground">
                              ${Number(panel.price || 0).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedTestsList.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-foreground mb-2">
                        Individual Tests:
                      </p>
                      <div className="space-y-2">
                        {selectedTestsList.map((test) => (
                          <div
                            key={test.id}
                            className="flex items-center justify-between text-sm"
                          >
                            <div className="flex items-center gap-2">
                              <TestTube2 className="h-4 w-4 text-muted-foreground" />
                              <span className="text-foreground">{test.name}</span>
                            </div>
                            <span className="font-semibold text-foreground">
                              ${Number(test.price || 0).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="pt-2 border-t border-border">
                    <div className="flex items-center justify-between font-semibold text-foreground">
                      <span>Total</span>
                      <span>
                        $
                        {(
                          selectedPanelsList.reduce(
                            (sum, panel) => sum + Number(panel.price || 0),
                            0
                          ) +
                          selectedTestsList.reduce(
                            (sum, test) => sum + Number(test.price || 0),
                            0
                          )
                        ).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Clinical Details */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="font-heading font-semibold text-foreground mb-3">
                  Clinical Details
                </h3>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Indication:
                    </p>
                    <p className="text-sm text-foreground mt-1">
                      {formData.indication}
                    </p>
                  </div>
                  {formData.clinical_notes && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        Additional Notes:
                      </p>
                      <p className="text-sm text-foreground mt-1">
                        {formData.clinical_notes}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="border-t border-border bg-card px-6 py-3">
          {/* Keyboard shortcuts hint */}
          <WorkflowKeyboardHints totalSteps={totalSteps} className="mb-3" />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {currentStep > 1 && (
                <Button variant="outline" size="sm" onClick={handleBack} className="font-mono text-xs">
                  <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                  Back
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} className="font-mono text-xs">
                Cancel
              </Button>
              {currentStep < totalSteps ? (
                <Button size="sm" onClick={handleNext} className="font-mono text-xs">
                  Next
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={createOrder.isPending || submitOrder.isPending}
                  className="bg-sky-600 hover:bg-sky-700 font-mono text-xs"
                >
                  {createOrder.isPending || submitOrder.isPending ? (
                    "Submitting..."
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5 mr-1.5" />
                      Submit Order
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </footer>
      </div>
  );
};

export default LabOrderForm;
