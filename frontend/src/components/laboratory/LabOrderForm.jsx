import X from 'lucide-react/dist/esm/icons/x.js';
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import { useCallback, useMemo, useReducer } from "react";
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
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

const STEPS = [
  { id: 'select_tests', title: 'Select Tests' },
  { id: 'details', title: 'Details' },
  { id: 'review', title: 'Review' },
];

const TOTAL_STEPS = STEPS.length;

const PRIORITY_CONFIG = {
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

const INITIAL_FORM_DATA = {
  priority: "routine",
  clinical_notes: "",
  indication: "",
  selected_tests: [],
  selected_panels: [],
};

const INITIAL_FORM_STATE = {
  currentStep: 1,
  formData: INITIAL_FORM_DATA,
  searchQuery: "",
  activeCategory: "all",
  errors: {},
};

const labOrderFormReducer = (state, action) => {
  switch (action.type) {
    case "set_step":
      return {
        ...state,
        currentStep: Math.min(Math.max(action.step, 1), TOTAL_STEPS),
      };
    case "next_step":
      return {
        ...state,
        currentStep: Math.min(state.currentStep + 1, TOTAL_STEPS),
      };
    case "previous_step":
      return {
        ...state,
        currentStep: Math.max(state.currentStep - 1, 1),
      };
    case "set_field":
      return {
        ...state,
        formData: {
          ...state.formData,
          [action.field]: action.value,
        },
      };
    case "toggle_test":
      return {
        ...state,
        formData: {
          ...state.formData,
          selected_tests: state.formData.selected_tests.includes(action.testId)
            ? state.formData.selected_tests.filter((id) => id !== action.testId)
            : [...state.formData.selected_tests, action.testId],
        },
      };
    case "toggle_panel":
      return {
        ...state,
        formData: {
          ...state.formData,
          selected_panels: state.formData.selected_panels.includes(action.panelId)
            ? state.formData.selected_panels.filter((id) => id !== action.panelId)
            : [...state.formData.selected_panels, action.panelId],
        },
      };
    case "set_search_query":
      return {
        ...state,
        searchQuery: action.searchQuery,
      };
    case "set_active_category":
      return {
        ...state,
        activeCategory: action.activeCategory,
      };
    case "set_errors":
      return {
        ...state,
        errors: action.errors,
      };
    default:
      return state;
  }
};

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

  return searchTerms.every(term => searchableText.includes(term));
};

const getPatientDisplayName = (patient) => {
  if (patient?.local_data?.user_details) {
    return `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim();
  }

  if (patient?.local_data?.first_name) {
    return `${patient.local_data.first_name} ${patient.local_data.last_name || ''}`.trim();
  }

  return patient?.name || 'Patient';
};

function LabOrderHeader({ patientName, onClose }) {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-sky-100 dark:bg-sky-900/30">
          <TestTube2 className="size-5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
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
        <X className="size-4 mr-1.5" aria-hidden="true" />
        Close
      </Button>
    </header>
  );
}

function LabOrderProgress({ currentStep, onStepClick }) {
  return (
    <div className="bg-card border-b border-border px-6 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs text-muted-foreground">
          Step {currentStep} of {TOTAL_STEPS}
        </span>
      </div>
      <WorkflowSteps
        steps={STEPS}
        currentStep={currentStep}
        onStepClick={onStepClick}
      />
    </div>
  );
}

function LabOrderFooter({
  createOrder,
  currentStep,
  onBack,
  onClose,
  onNext,
  onSubmit,
  submitOrder,
}) {
  const isSubmitting = createOrder.isPending || submitOrder.isPending;
  return (
    <footer className="border-t border-border bg-card px-6 py-3">
      <WorkflowKeyboardHints totalSteps={TOTAL_STEPS} className="mb-3" />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {currentStep > 1 && (
            <Button variant="outline" size="sm" onClick={onBack} className="font-mono text-xs">
              <ChevronLeft className="size-3.5 mr-1" />
              Back
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} className="font-mono text-xs">
            Cancel
          </Button>
          {currentStep < TOTAL_STEPS ? (
            <Button size="sm" onClick={onNext} className="font-mono text-xs">
              Next
              <ChevronRight className="size-3.5 ml-1" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onSubmit}
              disabled={isSubmitting}
              className="bg-sky-600 hover:bg-sky-700 font-mono text-xs"
            >
              {isSubmitting ? (
                "Submitting..."
              ) : (
                <>
                  <Check className="size-3.5 mr-1.5" />
                  Submit Order
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </footer>
  );
}

function LabOrderTestSelectionStep({
  activeCategory,
  categories,
  errors,
  filteredPanels,
  filteredTests,
  formData,
  hasSearchQuery,
  panelsLoading,
  searchQuery,
  testsLoading,
  totalResults,
  onCategoryChange,
  onPanelToggle,
  onSearchQueryChange,
  onTestToggle,
}) {
  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-muted-foreground" aria-hidden="true" />
        <Label htmlFor="lab-test-search" className="sr-only">Search tests and panels</Label>
        <Input
          id="lab-test-search"
          placeholder="Search by name or abbreviation (TSH, CBC, LFTs...)"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          className="pl-10"
          autoFocus
        />
      </div>

      {errors.tests && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{errors.tests}</AlertDescription>
        </Alert>
      )}

      <LabOrderSelectionSummary formData={formData} />

      {hasSearchQuery ? (
        <LabOrderSearchResults
          filteredPanels={filteredPanels}
          filteredTests={filteredTests}
          formData={formData}
          panelsLoading={panelsLoading}
          searchQuery={searchQuery}
          testsLoading={testsLoading}
          totalResults={totalResults}
          onPanelToggle={onPanelToggle}
          onTestToggle={onTestToggle}
        />
      ) : (
        <LabOrderBrowseCatalog
          activeCategory={activeCategory}
          categories={categories}
          filteredPanels={filteredPanels}
          filteredTests={filteredTests}
          formData={formData}
          panelsLoading={panelsLoading}
          testsLoading={testsLoading}
          onCategoryChange={onCategoryChange}
          onPanelToggle={onPanelToggle}
          onTestToggle={onTestToggle}
        />
      )}
    </div>
  );
}

function LabOrderSelectionSummary({ formData }) {
  const hasSelectedItems = formData.selected_tests.length > 0 || formData.selected_panels.length > 0;
  if (!hasSelectedItems) return null;

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
      <Check className="size-4 text-emerald-600" />
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
  );
}

function LabOrderSearchResults({
  filteredPanels,
  filteredTests,
  formData,
  panelsLoading,
  searchQuery,
  testsLoading,
  totalResults,
  onPanelToggle,
  onTestToggle,
}) {
  return (
    <div className="space-y-4">
      <div aria-live="polite" aria-atomic="true" className="text-sm text-muted-foreground">
        Found {totalResults} result{totalResults !== 1 ? 's' : ''} for "{searchQuery}"
      </div>

      {testsLoading || panelsLoading ? (
        <div className="text-center py-8 text-muted-foreground">
          Searching…
        </div>
      ) : totalResults === 0 ? (
        <LabOrderNoSearchResults />
      ) : (
        <div className="space-y-3">
          {filteredPanels.length > 0 && (
            <LabOrderCatalogGroup
              icon={Package}
              title={`Panels (${filteredPanels.length})`}
            >
              {filteredPanels.map((panel) => (
                <LabOrderCatalogCard
                  key={panel.id}
                  item={panel}
                  itemType="panel"
                  selected={formData.selected_panels.includes(panel.id)}
                  showPanelBadge
                  onToggle={() => onPanelToggle(panel.id)}
                />
              ))}
            </LabOrderCatalogGroup>
          )}

          {filteredTests.length > 0 && (
            <LabOrderCatalogGroup
              icon={TestTube2}
              title={`Individual Tests (${filteredTests.length})`}
            >
              {filteredTests.slice(0, 20).map((test) => (
                <LabOrderCatalogCard
                  key={test.id}
                  item={test}
                  itemType="test"
                  selected={formData.selected_tests.includes(test.id)}
                  onToggle={() => onTestToggle(test.id)}
                />
              ))}
              {filteredTests.length > 20 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Showing first 20 of {filteredTests.length} tests. Refine your search for more specific results.
                </p>
              )}
            </LabOrderCatalogGroup>
          )}
        </div>
      )}
    </div>
  );
}

function LabOrderNoSearchResults() {
  return (
    <div className="text-center py-8 text-muted-foreground">
      <Search className="size-8 mx-auto mb-2 opacity-50" />
      <p>No tests or panels found</p>
      <p className="text-xs mt-1">Try different keywords or abbreviations (e.g., TSH, CBC, LFTs)</p>
    </div>
  );
}

function LabOrderBrowseCatalog({
  activeCategory,
  categories,
  filteredPanels,
  filteredTests,
  formData,
  panelsLoading,
  testsLoading,
  onCategoryChange,
  onPanelToggle,
  onTestToggle,
}) {
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant={activeCategory === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => onCategoryChange("all")}
        >
          All
        </Button>
        {categories.map((category) => (
          <Button
            key={category}
            variant={activeCategory === category ? "default" : "outline"}
            size="sm"
            onClick={() => onCategoryChange(category)}
            className="capitalize"
          >
            {category}
          </Button>
        ))}
      </div>

      <Tabs defaultValue="panels" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="panels">
            <Package className="size-4 mr-2" />
            Panels ({filteredPanels.length})
          </TabsTrigger>
          <TabsTrigger value="tests">
            <TestTube2 className="size-4 mr-2" />
            Tests ({filteredTests.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="panels" className="space-y-3 mt-4">
          {panelsLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading panels…
            </div>
          ) : filteredPanels.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No panels available
            </div>
          ) : (
            filteredPanels.map((panel) => (
              <LabOrderCatalogCard
                key={panel.id}
                item={panel}
                itemType="panel"
                selected={formData.selected_panels.includes(panel.id)}
                showDescription
                onToggle={() => onPanelToggle(panel.id)}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="tests" className="space-y-3 mt-4">
          {testsLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading tests…
            </div>
          ) : filteredTests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No tests available
            </div>
          ) : (
            filteredTests.map((test) => (
              <LabOrderCatalogCard
                key={test.id}
                item={test}
                itemType="test"
                selected={formData.selected_tests.includes(test.id)}
                showSpecimen
                onToggle={() => onTestToggle(test.id)}
              />
            ))
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

function LabOrderCatalogGroup({ children, icon: Icon, title }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-mono uppercase text-muted-foreground">
        <Icon className="size-3" />
        {title}
      </div>
      {children}
    </div>
  );
}

function LabOrderCatalogCard({
  item,
  itemType,
  selected,
  showDescription = false,
  showPanelBadge = false,
  showSpecimen = false,
  onToggle,
}) {
  const isPanel = itemType === "panel";
  const ariaLabel = isPanel
    ? `${item.name} panel, ${item.test_count || 0} tests, $${Number(item.price || 0).toFixed(2)}`
    : `${item.name}, ${item.category}, $${Number(item.price || 0).toFixed(2)}`;

  return (
    <label
      className={cn(
        "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm cursor-pointer transition-colors",
        selected
          ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20"
          : "hover:border-muted-foreground/50"
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        aria-label={ariaLabel}
        className="peer sr-only"
      />
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input shadow-xs transition-colors",
                selected && "border-primary bg-primary text-primary-foreground"
              )}
            >
              {selected && <Check className="size-3.5" />}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">{item.name}</CardTitle>
                {isPanel && showPanelBadge && (
                  <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                    Panel
                  </Badge>
                )}
                {!isPanel && (
                  <Badge variant="outline" className="text-xs capitalize">
                    {item.category}
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs font-mono mt-1">
                {isPanel ? (
                  <>{item.code} • {item.test_count || 0} tests</>
                ) : (
                  <>
                    {item.loinc_code && `LOINC: ${item.loinc_code}`}
                    {item.loinc_code && item.tat_hours && ' • '}
                    {item.tat_hours && `${item.tat_hours}h TAT`}
                  </>
                )}
              </CardDescription>
            </div>
          </div>
          <div className="text-sm font-semibold text-foreground">
            ${Number(item.price || 0).toFixed(2)}
          </div>
        </div>
      </CardHeader>
      {showDescription && item.description && (
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">
            {item.description}
          </p>
        </CardContent>
      )}
      {showSpecimen && item.specimen_type && (
        <CardContent className="pt-0">
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">Specimen:</span>{" "}
            {item.specimen_type}
          </div>
        </CardContent>
      )}
    </label>
  );
}

function LabOrderDetailsStep({
  errors,
  formData,
  selectedPanelsList,
  selectedTestsList,
  onFieldChange,
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="priority">Priority *</Label>
        <Select
          value={formData.priority}
          onValueChange={(value) => onFieldChange("priority", value)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[200]">
            {Object.entries(PRIORITY_CONFIG).map(([key, config]) => (
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

      <div className="space-y-2">
        <Label htmlFor="indication">Clinical Indication *</Label>
        <Textarea
          id="indication"
          placeholder="Why is this test being ordered? (e.g., 'Rule out anemia', 'Monitor diabetes', 'Chest pain workup')"
          value={formData.indication}
          onChange={(event) => onFieldChange("indication", event.target.value)}
          className={cn(
            "min-h-[80px]",
            errors.indication && "border-rose-500"
          )}
        />
        {errors.indication && (
          <p className="text-sm text-rose-600">{errors.indication}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="clinical_notes">Additional Clinical Notes</Label>
        <Textarea
          id="clinical_notes"
          placeholder="Any additional information for the lab (optional)"
          value={formData.clinical_notes}
          onChange={(event) => onFieldChange("clinical_notes", event.target.value)}
          className="min-h-[100px]"
        />
      </div>

      <SelectedLabItemsPreview
        selectedPanelsList={selectedPanelsList}
        selectedTestsList={selectedTestsList}
      />
    </div>
  );
}

function SelectedLabItemsPreview({ selectedPanelsList, selectedTestsList }) {
  return (
    <div className="bg-muted border border-border rounded-lg p-4">
      <h3 className="font-heading font-semibold text-foreground mb-3">
        Selected Items
      </h3>
      <div className="space-y-2">
        {selectedPanelsList.length > 0 && (
          <SelectedLabItemGroup
            icon={Package}
            title="Panels:"
            items={selectedPanelsList}
          />
        )}
        {selectedTestsList.length > 0 && (
          <SelectedLabItemGroup
            icon={TestTube2}
            title="Individual Tests:"
            items={selectedTestsList}
          />
        )}
      </div>
    </div>
  );
}

function SelectedLabItemGroup({ icon: Icon, items, title }) {
  return (
    <div>
      <p className="text-sm font-medium text-foreground mb-2">
        {title}
      </p>
      <div className="space-y-1">
        {items.map((item) => (
          <div
            key={item.id}
            className="text-sm text-muted-foreground flex items-center gap-2"
          >
            <Icon className="size-3" />
            {item.name}
          </div>
        ))}
      </div>
    </div>
  );
}

function LabOrderReviewStep({ formData, selectedPanelsList, selectedTestsList }) {
  return (
    <div className="space-y-6">
      <Alert>
        <AlertCircle className="size-4" />
        <AlertDescription>
          Please review the order details before submitting. The order will
          be immediately submitted to the laboratory.
        </AlertDescription>
      </Alert>

      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="font-heading font-semibold text-foreground mb-3">
          Order Priority
        </h3>
        <Badge className={PRIORITY_CONFIG[formData.priority].color}>
          {PRIORITY_CONFIG[formData.priority].label}
        </Badge>
      </div>

      <LabOrderReviewItems
        selectedPanelsList={selectedPanelsList}
        selectedTestsList={selectedTestsList}
      />
      <LabOrderClinicalDetailsReview formData={formData} />
    </div>
  );
}

function LabOrderReviewItems({ selectedPanelsList, selectedTestsList }) {
  const total = (
    selectedPanelsList.reduce((sum, panel) => sum + Number(panel.price || 0), 0) +
    selectedTestsList.reduce((sum, test) => sum + Number(test.price || 0), 0)
  );

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="font-heading font-semibold text-foreground mb-3">
        Tests & Panels
      </h3>
      <div className="space-y-4">
        {selectedPanelsList.length > 0 && (
          <ReviewLineItemGroup
            icon={Package}
            title="Panels:"
            items={selectedPanelsList}
          />
        )}
        {selectedTestsList.length > 0 && (
          <ReviewLineItemGroup
            icon={TestTube2}
            title="Individual Tests:"
            items={selectedTestsList}
          />
        )}
        <div className="pt-2 border-t border-border">
          <div className="flex items-center justify-between font-semibold text-foreground">
            <span>Total</span>
            <span>${total.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewLineItemGroup({ icon: Icon, items, title }) {
  return (
    <div>
      <p className="text-sm font-medium text-foreground mb-2">
        {title}
      </p>
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between text-sm"
          >
            <div className="flex items-center gap-2">
              <Icon className="size-4 text-muted-foreground" />
              <span className="text-foreground">{item.name}</span>
            </div>
            <span className="font-semibold text-foreground">
              ${Number(item.price || 0).toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LabOrderClinicalDetailsReview({ formData }) {
  return (
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
  );
}

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
  const formScopeKey = open
    ? `${patientId || 'unknown-patient'}:${encounterId || 'no-encounter'}`
    : 'closed';

  return (
    <LabOrderFormContent
      key={formScopeKey}
      open={open}
      onClose={onClose}
      patient={patient}
      patientId={patientId}
      encounterId={encounterId}
      onOrderCreated={onOrderCreated}
    />
  );
};

const LabOrderFormContent = ({
  open,
  onClose,
  patient,
  patientId,
  encounterId,
  onOrderCreated,
}) => {
  const [state, dispatch] = useReducer(labOrderFormReducer, INITIAL_FORM_STATE);
  const { currentStep, formData, searchQuery, activeCategory, errors } = state;

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

  // Normalize data - API returns array directly, not { results: [...] }
  const tests = useMemo(
    () => (Array.isArray(testsData) ? testsData : (testsData?.results || [])),
    [testsData]
  );
  const panels = useMemo(
    () => (Array.isArray(panelsData) ? panelsData : (panelsData?.results || [])),
    [panelsData]
  );

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
  const categories = useMemo(
    () => (
      tests.length > 0
        ? [...new Set(tests.flatMap((test) => (test.category ? [test.category] : [])))]
        : []
    ),
    [tests]
  );

  // Check if we have search results to show combined view
  const hasSearchQuery = searchQuery.trim().length > 0;
  const totalResults = filteredTests.length + filteredPanels.length;

  // Handle test selection
  const handleTestToggle = useCallback((testId) => {
    dispatch({ type: "toggle_test", testId });
  }, []);

  // Handle panel selection
  const handlePanelToggle = useCallback((panelId) => {
    dispatch({ type: "toggle_panel", panelId });
  }, []);

  // Validation
  const validateStep = useCallback((step) => {
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

    dispatch({ type: "set_errors", errors: newErrors });
    return Object.keys(newErrors).length === 0;
  }, [formData.indication, formData.selected_panels.length, formData.selected_tests.length]);

  // Handle next step
  const handleNext = useCallback(() => {
    if (validateStep(currentStep)) {
      dispatch({ type: "next_step" });
    }
  }, [currentStep, validateStep]);

  // Handle previous step
  const handleBack = useCallback(() => {
    dispatch({ type: "previous_step" });
  }, []);

  // Handle jump to specific step
  const goToStep = useCallback((stepNumber) => {
    if (stepNumber >= 1 && stepNumber <= TOTAL_STEPS && stepNumber !== currentStep) {
      dispatch({ type: "set_step", step: stepNumber });
    }
  }, [currentStep]);

  // Handle submit
  const handleSubmit = useCallback(async () => {
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
  }, [
    createOrder,
    encounterId,
    formData.clinical_notes,
    formData.indication,
    formData.priority,
    formData.selected_panels,
    formData.selected_tests,
    onClose,
    onOrderCreated,
    patientId,
    submitOrder,
    validateStep,
  ]);

  // Keyboard navigation for workflow
  useWorkflowKeyboard({
    enabled: open,
    currentStep,
    totalSteps: TOTAL_STEPS,
    onNextStep: handleNext,
    onPrevStep: handleBack,
    onGoToStep: goToStep,
    onComplete: currentStep === TOTAL_STEPS ? handleSubmit : undefined,
    onClose,
  });

  // Get selected items summary
  const { tests: selectedTestsList, panels: selectedPanelsList } = useMemo(() => {
    const selectedTests = tests.filter((test) =>
      formData.selected_tests.includes(test.id)
    );
    const selectedPanels = panels.filter((panel) =>
      formData.selected_panels.includes(panel.id)
    );

    return { tests: selectedTests, panels: selectedPanels };
  }, [formData.selected_panels, formData.selected_tests, panels, tests]);

  const patientName = getPatientDisplayName(patient);

  return (
    <dialog
      open={open}
      aria-labelledby="lab-order-title"
      className={cn(
        "fixed inset-y-0 left-auto right-0 z-[100] m-0 h-auto max-h-none w-full max-w-none p-0 lg:w-1/2 bg-background border-0 border-l border-border",
        "transform transition-transform duration-300 ease-in-out",
        "flex flex-col shadow-2xl",
        open ? "translate-x-0" : "translate-x-full"
      )}
    >
      <LabOrderHeader patientName={patientName} onClose={onClose} />
      <LabOrderProgress currentStep={currentStep} onStepClick={goToStep} />

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {currentStep === 1 && (
            <LabOrderTestSelectionStep
              activeCategory={activeCategory}
              categories={categories}
              errors={errors}
              filteredPanels={filteredPanels}
              filteredTests={filteredTests}
              formData={formData}
              hasSearchQuery={hasSearchQuery}
              panelsLoading={panelsLoading}
              searchQuery={searchQuery}
              testsLoading={testsLoading}
              totalResults={totalResults}
              onCategoryChange={(activeCategory) => dispatch({ type: "set_active_category", activeCategory })}
              onPanelToggle={handlePanelToggle}
              onSearchQueryChange={(searchQuery) => dispatch({ type: "set_search_query", searchQuery })}
              onTestToggle={handleTestToggle}
            />
          )}

          {currentStep === 2 && (
            <LabOrderDetailsStep
              errors={errors}
              formData={formData}
              selectedPanelsList={selectedPanelsList}
              selectedTestsList={selectedTestsList}
              onFieldChange={(field, value) => dispatch({ type: "set_field", field, value })}
            />
          )}

          {currentStep === 3 && (
            <LabOrderReviewStep
              formData={formData}
              selectedPanelsList={selectedPanelsList}
              selectedTestsList={selectedTestsList}
            />
          )}
        </div>

        <LabOrderFooter
          createOrder={createOrder}
          currentStep={currentStep}
          onBack={handleBack}
          onClose={onClose}
          onNext={handleNext}
          onSubmit={handleSubmit}
          submitOrder={submitOrder}
        />
    </dialog>
  );
};

export default LabOrderForm;
