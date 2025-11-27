import { useState, useCallback, useEffect } from "react";
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
import { X, TestTube2, Package, AlertCircle, Check, Search, Clock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  useLabTests,
  useLabPanels,
  useCreateLabOrder,
  useSubmitLabOrder,
} from "@/hooks/useLabQueries";
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

  // API queries
  const { data: testsData, isLoading: testsLoading } = useLabTests();
  const { data: panelsData, isLoading: panelsLoading } = useLabPanels();
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

  // Get test categories
  const categories = testsData?.results
    ? [...new Set(testsData.results.map((test) => test.category))]
    : [];

  // Filter tests by search and category
  const filteredTests =
    testsData?.results?.filter((test) => {
      const matchesSearch =
        searchQuery === "" ||
        test.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        test.code.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory =
        activeCategory === "all" || test.category === activeCategory;
      return matchesSearch && matchesCategory;
    }) || [];

  // Filter panels by search
  const filteredPanels =
    panelsData?.results?.filter(
      (panel) =>
        searchQuery === "" ||
        panel.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        panel.code.toLowerCase().includes(searchQuery.toLowerCase())
    ) || [];

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
  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  // Handle submit
  const handleSubmit = async () => {
    if (!validateStep(2)) return;

    try {
      // Create order
      const orderData = {
        patient: patientId,
        encounter: encounterId || null,
        priority: formData.priority,
        clinical_notes: formData.clinical_notes,
        indication: formData.indication,
        tests: formData.selected_tests,
        panels: formData.selected_panels,
      };

      const createdOrder = await createOrder.mutateAsync(orderData);

      // Submit order immediately
      await submitOrder.mutateAsync(createdOrder.id);

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

  // Get selected items summary
  const getSelectedSummary = () => {
    const selectedTests =
      testsData?.results?.filter((test) =>
        formData.selected_tests.includes(test.id)
      ) || [];
    const selectedPanels =
      panelsData?.results?.filter((panel) =>
        formData.selected_panels.includes(panel.id)
      ) || [];

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
            <TestTube2 className="h-5 w-5 text-sky-600 dark:text-sky-400" />
          </div>
          <div>
            <h2 className="font-display text-xl text-foreground">
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
          <X className="h-4 w-4 mr-1.5" />
          Close
        </Button>
      </header>

      {/* Progress Indicator */}
      <div className="bg-card border-b border-border px-6 py-3">
        <div className="flex items-center justify-between text-sm">
          <div
            className={cn(
              "flex items-center gap-2",
              currentStep >= 1 ? "text-sky-600" : "text-muted-foreground"
            )}
          >
            <div
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold font-mono",
                currentStep >= 1
                  ? "bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400"
                  : "bg-muted text-muted-foreground"
              )}
            >
              1
            </div>
            <span className="font-medium text-xs">Select Tests</span>
          </div>
          <div className="flex-1 h-px bg-border mx-4" />
          <div
            className={cn(
              "flex items-center gap-2",
              currentStep >= 2 ? "text-sky-600" : "text-muted-foreground"
            )}
          >
            <div
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold font-mono",
                currentStep >= 2
                  ? "bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400"
                  : "bg-muted text-muted-foreground"
              )}
            >
              2
            </div>
            <span className="font-medium text-xs">Details</span>
          </div>
          <div className="flex-1 h-px bg-border mx-4" />
          <div
            className={cn(
              "flex items-center gap-2",
              currentStep >= 3 ? "text-sky-600" : "text-muted-foreground"
            )}
          >
            <div
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold font-mono",
                currentStep >= 3
                  ? "bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400"
                  : "bg-muted text-muted-foreground"
              )}
            >
              3
            </div>
            <span className="font-medium text-xs">Review</span>
          </div>
        </div>
      </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {/* Step 1: Test Selection */}
          {currentStep === 1 && (
            <div className="space-y-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search tests or panels..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

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

              {errors.tests && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{errors.tests}</AlertDescription>
                </Alert>
              )}

              {/* Tabs */}
              <Tabs defaultValue="panels" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="panels">
                    <Package className="h-4 w-4 mr-2" />
                    Panels ({formData.selected_panels.length})
                  </TabsTrigger>
                  <TabsTrigger value="tests">
                    <TestTube2 className="h-4 w-4 mr-2" />
                    Individual Tests ({formData.selected_tests.length})
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
                      No panels found
                    </div>
                  ) : (
                    filteredPanels.map((panel) => (
                      <Card
                        key={panel.id}
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
                                checked={formData.selected_panels.includes(
                                  panel.id
                                )}
                                onCheckedChange={() => handlePanelToggle(panel.id)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <div>
                                <CardTitle className="text-base">
                                  {panel.name}
                                </CardTitle>
                                <CardDescription className="text-xs font-mono mt-1">
                                  {panel.code}
                                </CardDescription>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-semibold text-foreground">
                                ${panel.price?.toFixed(2)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {panel.tests_count} tests
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
                      No tests found
                    </div>
                  ) : (
                    filteredTests.map((test) => (
                      <Card
                        key={test.id}
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
                                  {test.code}
                                  {test.loinc_code && ` • LOINC: ${test.loinc_code}`}
                                </CardDescription>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-semibold text-foreground">
                                ${test.price?.toFixed(2)}
                              </div>
                              {test.tat_hours && (
                                <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                                  <Clock className="h-3 w-3" />
                                  {test.tat_hours}h TAT
                                </div>
                              )}
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
                              ${panel.price?.toFixed(2)}
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
                              ${test.price?.toFixed(2)}
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
                            (sum, panel) => sum + (panel.price || 0),
                            0
                          ) +
                          selectedTestsList.reduce(
                            (sum, test) => sum + (test.price || 0),
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
        <footer className="border-t border-border bg-card px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {currentStep > 1 && (
              <Button variant="outline" onClick={handleBack} className="font-mono text-xs">
                Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} className="font-mono text-xs">
              Cancel
            </Button>
            {currentStep < 3 ? (
              <Button onClick={handleNext} className="font-mono text-xs">Next</Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={createOrder.isPending || submitOrder.isPending}
                className="bg-sky-600 hover:bg-sky-700 font-mono text-xs"
              >
                {createOrder.isPending || submitOrder.isPending ? (
                  "Submitting..."
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Submit Order
                  </>
                )}
              </Button>
            )}
          </div>
        </footer>
      </div>
  );
};

export default LabOrderForm;
