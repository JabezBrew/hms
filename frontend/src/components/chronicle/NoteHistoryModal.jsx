import History from 'lucide-react/dist/esm/icons/history.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import ArrowLeftRight from 'lucide-react/dist/esm/icons/arrow-left-right.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

import { useNoteEntryHistory, useCompareNoteVersions } from "@/hooks/useClinicalNotesQueries";
import DiffRenderer from "./DiffRenderer";

/**
 * NoteHistoryModal - Modal for viewing clinical note version history
 *
 * Features:
 * - List of all versions with timestamps and authors
 * - View individual version content
 * - Compare two versions side by side
 */
const NoteHistoryModal = ({ open, onOpenChange, noteId, noteTitle }) => {
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareVersions, setCompareVersions] = useState({ a: null, b: null });

  const { data: history, isLoading } = useNoteEntryHistory(noteId, {
    enabled: open && !!noteId,
  });

  const { data: comparison, isLoading: isComparing } = useCompareNoteVersions(
    noteId,
    compareVersions.a,
    compareVersions.b,
    {
      enabled: compareMode && compareVersions.a !== null && compareVersions.b !== null,
    }
  );

  // Handle version selection for comparison
  const handleVersionSelect = (versionNumber) => {
    if (!compareMode) {
      setSelectedVersion(versionNumber);
      return;
    }

    // In compare mode, select versions
    if (compareVersions.a === null) {
      setCompareVersions({ a: versionNumber, b: null });
    } else if (compareVersions.b === null && versionNumber !== compareVersions.a) {
      setCompareVersions({ ...compareVersions, b: versionNumber });
    } else {
      // Reset and start over
      setCompareVersions({ a: versionNumber, b: null });
    }
  };

  // Toggle compare mode
  const toggleCompareMode = () => {
    setCompareMode(!compareMode);
    setCompareVersions({ a: null, b: null });
    setSelectedVersion(null);
  };

  // Reset state on close
  const handleClose = () => {
    setSelectedVersion(null);
    setCompareMode(false);
    setCompareVersions({ a: null, b: null });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-amber-600" />
            Version History
          </DialogTitle>
          <DialogDescription>
            {noteTitle} &middot; {history?.version_count || 0} version
            {history?.version_count !== 1 ? "s" : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex gap-4 min-h-0">
          {/* Version List */}
          <div className="w-64 flex-shrink-0 border-r border-border pr-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-mono text-xs uppercase text-muted-foreground">
                Versions
              </h4>
              <Button
                variant={compareMode ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={toggleCompareMode}
              >
                <ArrowLeftRight className="h-3 w-3 mr-1" />
                Compare
              </Button>
            </div>

            <ScrollArea className="h-[400px]">
              {isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Current Version */}
                  <VersionItem
                    version={{
                      version_number: 0,
                      created_at: history?.updated_at,
                      edited_by_name: "Current",
                    }}
                    isCurrent={true}
                    isSelected={selectedVersion === 0 || compareVersions.a === 0 || compareVersions.b === 0}
                    compareMode={compareMode}
                    comparePosition={
                      compareVersions.a === 0 ? "A" : compareVersions.b === 0 ? "B" : null
                    }
                    onClick={() => handleVersionSelect(0)}
                  />

                  {/* Historical Versions */}
                  {history?.versions?.map((version) => (
                    <VersionItem
                      key={version.id}
                      version={version}
                      isSelected={
                        selectedVersion === version.version_number ||
                        compareVersions.a === version.version_number ||
                        compareVersions.b === version.version_number
                      }
                      compareMode={compareMode}
                      comparePosition={
                        compareVersions.a === version.version_number
                          ? "A"
                          : compareVersions.b === version.version_number
                          ? "B"
                          : null
                      }
                      onClick={() => handleVersionSelect(version.version_number)}
                    />
                  ))}

                  {!history?.versions?.length && (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No previous versions
                    </p>
                  )}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Content Area */}
          <div className="flex-1 min-w-0">
            {compareMode && compareVersions.a !== null && compareVersions.b !== null ? (
              <CompareView comparison={comparison} isLoading={isComparing} />
            ) : selectedVersion !== null ? (
              <VersionDetailView
                data={
                  selectedVersion === 0
                    ? history?.current_data
                    : history?.versions?.find((v) => v.version_number === selectedVersion)?.data
                }
                version={
                  selectedVersion === 0
                    ? { version_number: 0, edited_by_name: "Current" }
                    : history?.versions?.find((v) => v.version_number === selectedVersion)
                }
              />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">
                    {compareMode
                      ? "Select two versions to compare"
                      : "Select a version to view its content"}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/**
 * VersionItem - Single version entry in the list
 */
const VersionItem = ({
  version,
  isCurrent,
  isSelected,
  compareMode,
  comparePosition,
  onClick,
}) => {
  const formatDateTime = (timestamp) => {
    if (!timestamp) return "";
    try {
      const date = new Date(timestamp);
      return date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-3 rounded-lg border transition-colors",
        isSelected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50 hover:bg-muted/50"
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          {isCurrent ? (
            <Badge variant="outline" className="text-[10px] px-1.5">
              Current
            </Badge>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">
              v{version.version_number}
            </span>
          )}
          {comparePosition && (
            <Badge className="text-[10px] px-1.5 bg-primary">
              {comparePosition}
            </Badge>
          )}
        </div>
        {isSelected && !compareMode && (
          <ChevronRight className="h-4 w-4 text-primary" />
        )}
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        <span>{formatDateTime(version.created_at)}</span>
      </div>
      {version.edited_by_name && version.edited_by_name !== "Current" && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
          <User className="h-3 w-3" />
          <span>{version.edited_by_name}</span>
        </div>
      )}
      {version.edit_reason && (
        <p className="text-xs text-muted-foreground mt-1 truncate">
          "{version.edit_reason}"
        </p>
      )}
    </button>
  );
};

/**
 * VersionDetailView - Show content of a single version
 */
const VersionDetailView = ({ data, version }) => {
  if (!data) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <p>No data available</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="mb-3 pb-2 border-b border-border">
        <h4 className="font-semibold">
          {version?.version_number === 0 ? "Current Version" : `Version ${version?.version_number}`}
        </h4>
        {version?.edited_by_name && version.edited_by_name !== "Current" && (
          <p className="text-xs text-muted-foreground">
            Edited by {version.edited_by_name}
          </p>
        )}
      </div>
      <ScrollArea className="flex-1">
        <DataRenderer data={data} />
      </ScrollArea>
    </div>
  );
};

/**
 * CompareView - Unified diff view of two versions with color highlighting
 */
const CompareView = ({ comparison, isLoading }) => {
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Loading comparison...</p>
        </div>
      </div>
    );
  }

  if (!comparison) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <p>Select two versions to compare</p>
      </div>
    );
  }

  const versionALabel =
    comparison.version_a?.version_number === "current"
      ? "Current"
      : `Version ${comparison.version_a?.version_number}`;
  const versionBLabel =
    comparison.version_b?.version_number === "current"
      ? "Current"
      : `Version ${comparison.version_b?.version_number}`;

  return (
    <div className="h-full flex flex-col">
      {/* Header showing which versions are being compared */}
      <div className="mb-3 pb-2 border-b border-border">
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="outline" className="bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800">
            {versionALabel}
          </Badge>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <Badge variant="outline" className="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800">
            {versionBLabel}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          <span className="inline-block w-3 h-3 bg-rose-100 dark:bg-rose-900/40 rounded mr-1 align-middle" /> Removed
          <span className="mx-2">·</span>
          <span className="inline-block w-3 h-3 bg-emerald-100 dark:bg-emerald-900/40 rounded mr-1 align-middle" /> Added
        </p>
      </div>

      {/* Diff content */}
      <ScrollArea className="flex-1">
        <DiffRenderer oldData={comparison.data_a} newData={comparison.data_b} />
      </ScrollArea>
    </div>
  );
};

/**
 * DataRenderer - Recursively render note data
 */
const DataRenderer = ({ data, depth = 0 }) => {
  if (!data) return null;

  const formatLabel = (str) => {
    return str
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  if (typeof data === "string") {
    return <p className="text-sm whitespace-pre-wrap">{data}</p>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return null;
    return (
      <ul className="list-disc list-inside text-sm space-y-1">
        {data.map((item, i) => (
          <li key={i}>{typeof item === "object" ? JSON.stringify(item) : String(item)}</li>
        ))}
      </ul>
    );
  }

  if (typeof data === "object") {
    return (
      <div className={cn("space-y-3", depth > 0 && "pl-3 border-l border-border/50")}>
        {Object.entries(data).map(([key, value]) => {
          if (value === null || value === undefined) return null;
          if (typeof value === "string" && value.trim() === "") return null;
          if (Array.isArray(value) && value.length === 0) return null;

          return (
            <div key={key}>
              <h5 className="font-mono text-xs uppercase text-muted-foreground mb-1">
                {formatLabel(key)}
              </h5>
              <DataRenderer data={value} depth={depth + 1} />
            </div>
          );
        })}
      </div>
    );
  }

  return <span className="text-sm">{String(data)}</span>;
};

export default NoteHistoryModal;
