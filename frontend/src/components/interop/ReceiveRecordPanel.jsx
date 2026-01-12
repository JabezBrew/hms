import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Building2, Download, Hash, KeyRound, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useRetrieveRecordExport } from "@/hooks/useInteropQueries";

const ReceiveRecordPanel = ({ open, onClose, patient }) => {
  const { facilityCode } = useAuth();
  const [sourceFacilityCode, setSourceFacilityCode] = useState("");
  const [exportId, setExportId] = useState("");
  const [consentToken, setConsentToken] = useState("");
  const [exportJob, setExportJob] = useState(null);
  const [bundle, setBundle] = useState(null);
  const [checksum, setChecksum] = useState(null);

  const retrieveMutation = useRetrieveRecordExport();

  const patientName = useMemo(() => {
    if (!patient) return "Patient";
    const details = patient?.local_data?.user_details || patient?.user_details;
    if (details) {
      return `${details.first_name || ""} ${details.last_name || ""}`.trim() || "Patient";
    }
    return patient?.name || patient?.full_name || "Patient";
  }, [patient]);

  useEffect(() => {
    if (!open) {
      setSourceFacilityCode("");
      setExportId("");
      setConsentToken("");
      setExportJob(null);
      setBundle(null);
      setChecksum(null);
    }
  }, [open]);

  const bundleSummary = useMemo(() => {
    if (!bundle) return null;
    const entries = Array.isArray(bundle.entry) ? bundle.entry.length : 0;
    return {
      type: bundle.type || "collection",
      entries,
      timestamp: bundle.timestamp ? new Date(bundle.timestamp).toLocaleString() : null,
    };
  }, [bundle]);

  const handleRetrieve = async () => {
    const normalizedExportId = exportId.trim();
    const normalizedToken = consentToken.trim();
    const normalizedSource = sourceFacilityCode.trim().toUpperCase() || facilityCode || "";

    if (!normalizedExportId) {
      toast.error("Export job ID required");
      return;
    }
    if (!normalizedToken) {
      toast.error("Consent token required");
      return;
    }
    if (!normalizedSource) {
      toast.error("Source facility required");
      return;
    }

    try {
      const response = await retrieveMutation.mutateAsync({
        exportId: normalizedExportId,
        consentToken: normalizedToken,
        sourceFacilityCode: normalizedSource,
        requestingFacilityCode: facilityCode || undefined,
      });

      if (response?.bundle) {
        setBundle(response.bundle);
        setChecksum(response.checksum || null);
        setExportJob(null);
        toast.success("Record bundle retrieved");
      } else {
        setExportJob(response);
        setBundle(null);
        setChecksum(null);
        toast.success("Export status updated", {
          description: response?.status ? `Status: ${response.status}` : undefined,
        });
      }
    } catch (error) {
      toast.error("Retrieval failed", {
        description: error.message || "Please check the export ID and token.",
      });
    }
  };

  return (
    <div
      className={cn(
        "fixed inset-y-0 right-0 z-[100] w-full lg:w-1/2 bg-background border-l border-border",
        "transform transition-transform duration-300 ease-in-out",
        "flex flex-col shadow-2xl",
        open ? "translate-x-0" : "translate-x-full"
      )}
    >
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-sky-100 text-sky-700">
            <Download className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-xl text-foreground">Receive Shared Record</h2>
            <p className="font-mono text-xs text-muted-foreground mt-0.5">
              {patientName}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {!facilityCode && (
          <Card className="border border-rose-200 bg-rose-50">
            <CardContent className="p-4 text-sm text-rose-700">
              Facility context is required before retrieving a shared record.
            </CardContent>
          </Card>
        )}

        <Card className="border border-border">
          <CardContent className="p-4 space-y-4">
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase text-muted-foreground">
                Source Facility Code
              </Label>
              <div className="relative">
                <Building2 className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  value={sourceFacilityCode}
                  onChange={(event) => setSourceFacilityCode(event.target.value.toUpperCase())}
                  placeholder="SOURCE-CODE"
                  className="pl-9 font-mono"
                />
              </div>
              {facilityCode && (
                <p className="text-xs text-muted-foreground">
                  Receiving facility: {facilityCode}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase text-muted-foreground">
                Export Job ID
              </Label>
              <div className="relative">
                <Hash className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  value={exportId}
                  onChange={(event) => setExportId(event.target.value)}
                  placeholder="Export job UUID"
                  className="pl-9 font-mono"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase text-muted-foreground">
                Consent Token
              </Label>
              <div className="relative">
                <KeyRound className="h-4 w-4 text-muted-foreground absolute left-3 top-3" />
                <Textarea
                  value={consentToken}
                  onChange={(event) => setConsentToken(event.target.value)}
                  placeholder="Paste consent token from the source facility"
                  className="pl-9 font-mono min-h-[120px]"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="font-heading text-sm text-muted-foreground">Export status</p>
                <p className="font-display text-lg text-foreground">
                  {bundle ? "Bundle Ready" : exportJob?.status ? "Pending Delivery" : "Awaiting retrieval"}
                </p>
              </div>
              {exportJob?.status && (
                <Badge variant="secondary" className="font-mono text-xs">
                  {exportJob.status}
                </Badge>
              )}
            </div>

            {bundleSummary ? (
              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span className="font-mono">Bundle type</span>
                  <span className="font-mono text-foreground">{bundleSummary.type}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono">Entries</span>
                  <span className="font-mono text-foreground">{bundleSummary.entries}</span>
                </div>
                {bundleSummary.timestamp && (
                  <div className="flex items-center justify-between">
                    <span className="font-mono">Timestamp</span>
                    <span className="font-mono text-foreground">{bundleSummary.timestamp}</span>
                  </div>
                )}
                {checksum && (
                  <div className="flex items-center justify-between">
                    <span className="font-mono">Checksum</span>
                    <span className="font-mono text-foreground">{checksum}</span>
                  </div>
                )}
              </div>
            ) : exportJob ? (
              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span className="font-mono">Job ID</span>
                  <span className="font-mono text-foreground">{exportJob.id}</span>
                </div>
                {exportJob.expires_at && (
                  <div className="flex items-center justify-between">
                    <span className="font-mono">Expires</span>
                    <span className="font-mono text-foreground">
                      {new Date(exportJob.expires_at).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Enter the export job ID and consent token to retrieve the bundle.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <footer className="border-t border-border p-4 flex items-center justify-between">
        <Button variant="ghost" onClick={onClose} className="font-mono text-xs">
          Close
        </Button>
        <Button
          onClick={handleRetrieve}
          className="font-mono text-xs"
          disabled={retrieveMutation.isPending}
        >
          {retrieveMutation.isPending ? "Retrieving..." : "Retrieve Record"}
        </Button>
      </footer>
    </div>
  );
};

export default ReceiveRecordPanel;
