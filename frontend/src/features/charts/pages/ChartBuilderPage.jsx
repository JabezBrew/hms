/**
 * ChartBuilderPage - Page for creating and editing chart templates
 *
 * Routes:
 * - /charts/builder - Create new template
 * - /charts/builder/:id - Edit existing template
 */

import { useParams, useNavigate } from "react-router-dom";
import { ChartTemplateBuilder } from "@/components/charts";
import { PageShell } from "@/shared/components/page/PageShell";

const ChartBuilderPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const handleClose = () => {
    navigate("/charts/templates");
  };

  const handleSaved = () => {
    navigate("/charts/templates");
  };

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
