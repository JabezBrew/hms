/**
 * ChartBuilderPage - Page for creating and editing chart templates
 *
 * Routes:
 * - /charts/builder - Create new template
 * - /charts/builder/:id - Edit existing template
 */

import { useParams, useNavigate } from "react-router-dom";
import { ChartTemplateBuilder } from "@/components/charts";
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/shared/components/page/PageShell";
import { PageHeader } from "@/shared/components/page/PageHeader";
import { isRustV2ApiMode } from "@/lib/api/v2/runtime";

const ChartBuilderPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const chartBuilderAvailable = !isRustV2ApiMode();

  const handleClose = () => {
    navigate("/charts/templates");
  };

  const handleSaved = () => {
    navigate("/charts/templates");
  };

  if (!chartBuilderAvailable) {
    return (
      <PageShell>
        <PageHeader
          title={(
            <span className="flex items-center gap-3">
              <span className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-900/30">
                <ClipboardList className="size-6 text-amber-600 dark:text-amber-400" />
              </span>
              Chart Builder
            </span>
          )}
          description="Build clinical monitoring templates"
          descriptionClassName="font-mono text-xs text-muted-foreground"
          actions={(
            <Button
              variant="outline"
              className="font-mono text-xs"
              onClick={() => navigate("/charts/templates")}
            >
              Back to Templates
            </Button>
          )}
          contentClassName="max-w-7xl mx-auto w-full"
        />

        <div className="max-w-7xl mx-auto px-6 py-8">
          <Alert>
            <ClipboardList className="size-4" />
            <AlertDescription>
              Chart builder is not available in Rust V2 mode yet because no generated /api/v2 chart-builder contract exists.
            </AlertDescription>
          </Alert>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <ChartTemplateBuilder
        templateId={id}
        onClose={handleClose}
        onSaved={handleSaved}
      />
    </PageShell>
  );
};

export default ChartBuilderPage;
