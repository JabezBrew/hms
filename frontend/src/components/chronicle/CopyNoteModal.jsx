import Copy from 'lucide-react/dist/esm/icons/copy.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useNoteEntrySections } from "@/features/clinical-notes/hooks";

const normalizeSectionKey = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/**
 * CopyNoteModal - Dialog for copying clinical notes with section selection
 *
 * Allows clinicians to:
 * - Select which sections to copy from a previous note
 * - Preview section content before copying
 * - Opens the note editor with selected sections pre-filled
 *
 * Props:
 * - open: boolean - controls modal visibility
 * - onOpenChange: (open: boolean) => void - callback when modal open state changes
 * - noteEntry: object - the source note to copy from (must have id, template, data)
 * - onCopyConfirm: (template, selectedData) => void - callback when user confirms copy
 */
const CopyNoteModal = ({
  open,
  onOpenChange,
  noteEntry,
  onCopyConfirm,
}) => {
  const [selectedSections, setSelectedSections] = useState(new Set());

  // Fetch available sections for the note
  const {
    data: sections,
    isLoading: sectionsLoading,
    error: sectionsError,
  } = useNoteEntrySections(noteEntry?.id, { enabled: open && !!noteEntry?.id });

  // Initialize selected sections when sections load
  useEffect(() => {
    if (sections && open) {
      // Pre-select all sections that have data
      const sectionsWithData = sections
        .filter((s) => s.has_data)
        .map((s) => s.name);
      setSelectedSections(new Set(sectionsWithData));
    }
  }, [sections, open]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedSections(new Set());
    }
  }, [open]);

  // Toggle section selection
  const toggleSection = (sectionName) => {
    const newSelected = new Set(selectedSections);
    if (newSelected.has(sectionName)) {
      newSelected.delete(sectionName);
    } else {
      newSelected.add(sectionName);
    }
    setSelectedSections(newSelected);
  };

  // Select/deselect all
  const toggleAll = () => {
    if (selectedSections.size === sections?.filter((s) => s.has_data).length) {
      setSelectedSections(new Set());
    } else {
      const allWithData = sections
        .filter((s) => s.has_data)
        .map((s) => s.name);
      setSelectedSections(new Set(allWithData));
    }
  };

  // Handle copy - pass selected data to parent instead of calling API
  const handleCopy = () => {
    if (selectedSections.size === 0) {
      return;
    }

    // Build the selected data from the source note
    const selectedData = {};
    const noteData = (noteEntry?.data && typeof noteEntry.data === "object") ? noteEntry.data : {};
    const sectionByName = new Map((sections || []).map((section) => [section.name, section]));
    const normalizedSourceKeys = new Map();

    Object.keys(noteData).forEach((key) => {
      const normalized = normalizeSectionKey(key);
      if (normalized && !normalizedSourceKeys.has(normalized)) {
        normalizedSourceKeys.set(normalized, key);
      }
    });

    selectedSections.forEach((sectionName) => {
      const sectionMeta = sectionByName.get(sectionName);
      const sourceKey =
        sectionMeta?.source_key ??
        (noteData[sectionName] !== undefined
          ? sectionName
          : normalizedSourceKeys.get(normalizeSectionKey(sectionName)));

      if (sourceKey !== undefined && sourceKey !== null && noteData[sourceKey] !== undefined) {
        // Preserve template section names for editor prefill, regardless of source key format.
        selectedData[sectionName] = noteData[sourceKey];
      }
    });

    // Call the callback with template info and selected data
    // Pass the full template object from the timeline entry
    onCopyConfirm?.({
      template: noteEntry.template,
      templateId: noteEntry.template?.id || noteEntry.template_id,
      templateTitle: noteEntry.template?.title || noteEntry.template_title || noteEntry.title,
      data: selectedData,
      sectionsCopied: Array.from(selectedSections),
    });

    onOpenChange(false);
  };

  // Get note title
  const noteTitle = noteEntry?.template_title || noteEntry?.title || "Clinical Note";

  // Count sections with data
  const sectionsWithDataCount = sections?.filter((s) => s.has_data).length || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="size-5 text-primary" />
            Copy Note
          </DialogTitle>
          <DialogDescription>
            Select sections to copy from "{noteTitle}". A new note will open with the selected content pre-filled for editing.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {sectionsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Loading sections…</span>
            </div>
          ) : sectionsError ? (
            <div className="flex items-center justify-center py-8 text-destructive">
              <AlertCircle className="size-5 mr-2" />
              <span>Failed to load sections</span>
            </div>
          ) : sections?.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <FileText className="size-5 mr-2" />
              <span>No sections available</span>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Select all toggle */}
              {sectionsWithDataCount > 1 && (
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <span className="text-sm text-muted-foreground">
                    {selectedSections.size} of {sectionsWithDataCount} sections selected
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleAll}
                    className="text-xs"
                  >
                    {selectedSections.size === sectionsWithDataCount
                      ? "Deselect All"
                      : "Select All"}
                  </Button>
                </div>
              )}

              {/* Section list */}
              <div className="space-y-2">
                {sections?.map((section) => {
                  const isSelected = selectedSections.has(section.name);
                  const hasData = section.has_data;

                  return (
                    <div
                      key={section.name}
                      className={cn(
                        "relative p-3 rounded-lg border transition-all",
                        hasData
                          ? "cursor-pointer hover:border-primary/50"
                          : "opacity-50 cursor-not-allowed",
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card/50"
                      )}
                      onClick={() => hasData && toggleSection(section.name)}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={isSelected}
                          disabled={!hasData}
                          className="mt-0.5"
                          onCheckedChange={() => hasData && toggleSection(section.name)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Label
                              className={cn(
                                "font-medium text-sm cursor-pointer",
                                !hasData && "text-muted-foreground"
                              )}
                            >
                              {section.name}
                            </Label>
                            {isSelected && (
                              <CheckCircle2 className="size-3.5 text-primary" />
                            )}
                          </div>

                          {hasData && section.preview ? (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {section.preview}
                            </p>
                          ) : !hasData ? (
                            <p className="text-xs text-muted-foreground/60 mt-1 italic">
                              No data in this section
                            </p>
                          ) : null}

                          <span className="inline-block mt-1.5 px-1.5 py-0.5 text-[10px] font-mono rounded bg-muted text-muted-foreground">
                            {section.type}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border pt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCopy}
            disabled={sectionsLoading || selectedSections.size === 0}
          >
            <Copy className="size-4 mr-2" />
            Copy & Edit {selectedSections.size > 0 ? `(${selectedSections.size})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CopyNoteModal;
