
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import { Card, CardContent } from "@/components/ui/card";
import { FacilitySwitcher } from "@/components/layout/FacilitySwitcher";
import { cn } from "@/lib/utils";

const FacilityRequiredPanel = ({ className }) => {
  return (
    <div className={cn("p-6", className)}>
      <Card className="border border-amber-200/70 bg-amber-50/60">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-xs font-mono uppercase tracking-widest">
                  Facility Context Required
                </span>
              </div>
              <h2 className="font-display text-2xl text-foreground">
                Select a facility to continue
              </h2>
              <p className="text-sm text-muted-foreground max-w-xl">
                Dashboard data loads only after a facility context is set. Choose the
                facility you are working in before proceeding.
              </p>
            </div>
            <FacilitySwitcher />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" />
            <span>
              First-time admin? Create the facility code in Admin or seed it,
              then select it here.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default FacilityRequiredPanel;
