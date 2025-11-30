import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StatCard } from "@/components/dashboard";
import {
  Search,
  TestTube2,
  CheckCircle2,
  Clock,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  X,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { useLabResults, useVerifyLabResult } from "@/hooks/useLabQueries";
import { toast } from "sonner";

/**
 * LabResultsPage - Lab results overview for clinicians and lab staff
 *
 * Features:
 * - Results table with abnormal value highlighting
 * - Filter by verification status, flag type
 * - Tabs for "All Results" and "Critical / Needs Review"
 * - Quick verify action for authorized users
 */
export default function LabResultsPage() {
  const { user } = useAuth();
  const userRole = user?.role || "";

  // Can verify results
  const canVerify = ["admin", "lab_technician", "doctor", "physician"].includes(userRole);

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [verificationFilter, setVerificationFilter] = useState("all");
  const [flagFilter, setFlagFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("all");

  // Verify dialog state
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [selectedResult, setSelectedResult] = useState(null);
  const [verificationNotes, setVerificationNotes] = useState("");

  // Build query filters
  const queryFilters = useMemo(() => {
    const filters = {};

    if (verificationFilter !== "all") {
      filters.is_verified = verificationFilter === "verified";
    }

    if (flagFilter !== "all") {
      filters.flag = flagFilter;
    }

    if (activeTab === "critical") {
      filters.critical_only = true;
    }

    return filters;
  }, [verificationFilter, flagFilter, activeTab]);

  // Fetch results
  const {
    data: resultsData,
    isLoading,
    refetch,
  } = useLabResults(queryFilters);

  // Verify mutation
  const verifyMutation = useVerifyLabResult();

  // Process results data
  const results = useMemo(() => {
    const data = resultsData?.results || resultsData || [];
    return Array.isArray(data) ? data : [];
  }, [resultsData]);

  // Client-side search filtering
  const filteredResults = useMemo(() => {
    if (!searchQuery.trim()) return results;

    const query = searchQuery.toLowerCase();
    return results.filter((result) => {
      return (
        result.test_name?.toLowerCase().includes(query) ||
        result.order_number?.toLowerCase().includes(query) ||
        result.patient_name?.toLowerCase().includes(query)
      );
    });
  }, [results, searchQuery]);

  // Calculate stats
  const stats = useMemo(() => {
    const total = results.length;
    const verified = results.filter((r) => r.is_verified).length;
    const pending = total - verified;
    const critical = results.filter((r) =>
      ["critical_low", "critical_high"].includes(r.flag)
    ).length;

    return { total, verified, pending, critical };
  }, [results]);

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return "-";
    try {
      return format(new Date(dateString), "MMM d, yyyy h:mm a");
    } catch {
      return "-";
    }
  };

  // Get flag styling
  const getFlagConfig = (flag) => {
    const configs = {
      normal: { label: "Normal", className: "text-emerald-600", icon: null },
      low: { label: "Low", className: "text-amber-600", icon: TrendingDown },
      high: { label: "High", className: "text-amber-600", icon: TrendingUp },
      critical_low: { label: "Critical Low", className: "text-rose-600 font-semibold", icon: AlertTriangle },
      critical_high: { label: "Critical High", className: "text-rose-600 font-semibold", icon: AlertTriangle },
      abnormal: { label: "Abnormal", className: "text-amber-600", icon: AlertTriangle },
    };
    return configs[flag] || configs.normal;
  };

  // Handle verify click
  const handleVerifyClick = (result) => {
    setSelectedResult(result);
    setVerificationNotes("");
    setVerifyDialogOpen(true);
  };

  // Handle verify submit
  const handleVerifySubmit = async () => {
    if (!selectedResult) return;

    try {
      await verifyMutation.mutateAsync({
        id: selectedResult.id,
        verificationNotes: verificationNotes.trim() || undefined,
      });

      toast.success("Result verified successfully");
      setVerifyDialogOpen(false);
      setSelectedResult(null);
      setVerificationNotes("");
    } catch (err) {
      console.error("Failed to verify result:", err);
      toast.error(err.message || "Failed to verify result");
    }
  };

  // Handle clear filters
  const handleClearFilters = () => {
    setSearchQuery("");
    setVerificationFilter("all");
    setFlagFilter("all");
  };

  const hasActiveFilters =
    searchQuery || verificationFilter !== "all" || flagFilter !== "all";

  // Filter options
  const verificationOptions = [
    { value: "all", label: "All Results" },
    { value: "verified", label: "Verified" },
    { value: "pending", label: "Pending Verification" },
  ];

  const flagOptions = [
    { value: "all", label: "All Flags" },
    { value: "normal", label: "Normal" },
    { value: "low", label: "Low" },
    { value: "high", label: "High" },
    { value: "critical_low", label: "Critical Low" },
    { value: "critical_high", label: "Critical High" },
    { value: "abnormal", label: "Abnormal" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Page Header */}
      <header className="bg-card border-b border-border px-4 sm:px-6 py-4 sm:py-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4 sm:mb-6">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl text-foreground tracking-tight mb-1">
              Lab Results
            </h1>
            <p className="text-sm text-muted-foreground">
              {stats.total} results
              {stats.critical > 0 && (
                <span className="text-rose-600 ml-2">
                  ({stats.critical} critical)
                </span>
              )}
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            title="Total Results"
            value={stats.total}
            icon={TestTube2}
            color="sky"
          />
          <StatCard
            title="Verified"
            value={stats.verified}
            icon={CheckCircle2}
            color="emerald"
          />
          <StatCard
            title="Pending"
            value={stats.pending}
            icon={Clock}
            color="amber"
          />
          <StatCard
            title="Critical"
            value={stats.critical}
            icon={AlertTriangle}
            color="rose"
          />
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-card/50 border-b border-border px-4 sm:px-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-transparent border-none h-auto p-0 gap-0">
            <TabsTrigger
              value="all"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-sky-500 data-[state=active]:bg-transparent px-4 py-3"
            >
              All Results
            </TabsTrigger>
            <TabsTrigger
              value="critical"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-rose-500 data-[state=active]:bg-transparent px-4 py-3"
            >
              <AlertTriangle className="h-4 w-4 mr-2" />
              Critical / Needs Review
              {stats.critical > 0 && (
                <Badge variant="destructive" className="ml-2 h-5 px-1.5">
                  {stats.critical}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Filter Bar */}
      <div className="bg-card/50 border-b border-border px-4 sm:px-6 py-3">
        <div className="flex flex-col gap-3">
          {/* Search row */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by test name, order number, or patient..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 font-mono text-sm"
            />
          </div>

          {/* Filters row */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Verification filter */}
            <Select value={verificationFilter} onValueChange={setVerificationFilter}>
              <SelectTrigger className="w-[160px] sm:w-[180px] text-sm">
                <SelectValue placeholder="Verification" />
              </SelectTrigger>
              <SelectContent>
                {verificationOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Flag filter */}
            <Select value={flagFilter} onValueChange={setFlagFilter}>
              <SelectTrigger className="w-[140px] sm:w-[160px] text-sm">
                <SelectValue placeholder="Flag" />
              </SelectTrigger>
              <SelectContent>
                {flagOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Clear filters */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="text-muted-foreground ml-auto"
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="p-4 sm:p-6">
        {isLoading ? (
          // Loading skeleton
          <div className="bg-card rounded-lg border border-border">
            <div className="p-4 space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-28 ml-auto" />
                </div>
              ))}
            </div>
          </div>
        ) : filteredResults.length === 0 ? (
          // Empty state
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <TestTube2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-display text-lg text-foreground mb-2">
              No results found
            </h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              {searchQuery || verificationFilter !== "all" || flagFilter !== "all"
                ? "Try adjusting your filters to see more results."
                : activeTab === "critical"
                ? "No critical results require attention."
                : "No lab results have been entered yet."}
            </p>
            {hasActiveFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearFilters}
                className="mt-4"
              >
                Clear Filters
              </Button>
            )}
          </div>
        ) : (
          // Results table
          <div className="bg-card rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="font-heading">Test</TableHead>
                  <TableHead className="font-heading">Order</TableHead>
                  <TableHead className="font-heading">Result</TableHead>
                  <TableHead className="font-heading">Reference</TableHead>
                  <TableHead className="font-heading">Status</TableHead>
                  <TableHead className="font-heading">Date</TableHead>
                  {canVerify && <TableHead className="font-heading text-right">Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredResults.map((result, index) => {
                  const flagConfig = getFlagConfig(result.flag);
                  const FlagIcon = flagConfig.icon;

                  return (
                    <TableRow
                      key={result.id}
                      className={cn(
                        "animate-chronicle-enter",
                        ["critical_low", "critical_high"].includes(result.flag) &&
                          "bg-rose-50/50 dark:bg-rose-900/10"
                      )}
                      style={{ animationDelay: `${index * 30}ms` }}
                    >
                      <TableCell>
                        <span className="font-medium">{result.test_name}</span>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">
                          {result.order_number}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {FlagIcon && (
                            <FlagIcon className={cn("h-4 w-4", flagConfig.className)} />
                          )}
                          <span className={cn("font-mono", flagConfig.className)}>
                            {result.value} {result.unit}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">
                          {result.reference_low || "-"} - {result.reference_high || "-"}
                        </span>
                      </TableCell>
                      <TableCell>
                        {result.is_verified ? (
                          <Badge
                            variant="outline"
                            className="bg-emerald-50 text-emerald-700 border-emerald-200"
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Verified
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="bg-amber-50 text-amber-700 border-amber-200"
                          >
                            <Clock className="h-3 w-3 mr-1" />
                            Pending
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">
                          {formatDate(result.performed_at)}
                        </span>
                      </TableCell>
                      {canVerify && (
                        <TableCell className="text-right">
                          {!result.is_verified && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleVerifyClick(result)}
                              className="text-xs"
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Verify
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </main>

      {/* Verify Dialog */}
      <AlertDialog open={verifyDialogOpen} onOpenChange={setVerifyDialogOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl">
              Verify Lab Result
            </AlertDialogTitle>
            <AlertDialogDescription>
              Confirm that you have reviewed this result and it is accurate.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {selectedResult && (
            <div className="bg-muted/50 rounded-lg p-4 my-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Test:</span>
                <span className="font-medium">{selectedResult.test_name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Result:</span>
                <span className="font-mono">
                  {selectedResult.value} {selectedResult.unit}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Flag:</span>
                <span className={getFlagConfig(selectedResult.flag).className}>
                  {selectedResult.flag_display || selectedResult.flag}
                </span>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="verify-notes" className="text-sm font-medium">
              Verification Notes (Optional)
            </Label>
            <Textarea
              id="verify-notes"
              placeholder="Add any notes about this verification..."
              value={verificationNotes}
              onChange={(e) => setVerificationNotes(e.target.value)}
              className="min-h-[80px] resize-none"
            />
          </div>

          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleVerifySubmit}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={verifyMutation.isPending}
            >
              {verifyMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Verify Result
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
