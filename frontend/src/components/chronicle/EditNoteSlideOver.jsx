import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Save, Loader2 } from "lucide-react";
import { useUpdateNoteEntry } from "@/hooks/useClinicalNotesQueries";
import { toast } from "sonner";

/**
 * EditNoteSlideOver - Slide panel for editing clinical notes
 *
 * Provides a form interface for editing note data with:
 * - Auto-generated form fields from note structure
 * - Edit reason input for version tracking
 * - Optimistic updates with error handling
 */
const EditNoteSlideOver = ({ open, onOpenChange, entry, onSuccess }) => {
  const [formData, setFormData] = useState({});
  const [editReason, setEditReason] = useState("");

  const updateNote = useUpdateNoteEntry();

  // Initialize form data from entry
  useEffect(() => {
    if (entry?.data) {
      setFormData(JSON.parse(JSON.stringify(entry.data)));
    }
  }, [entry]);

  // Handle field change
  const handleFieldChange = (path, value) => {
    setFormData((prev) => {
      const updated = { ...prev };
      setNestedValue(updated, path, value);
      return updated;
    });
  };

  // Set nested value by path
  const setNestedValue = (obj, path, value) => {
    const keys = path.split(".");
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
  };

  // Handle save
  const handleSave = async () => {
    try {
      await updateNote.mutateAsync({
        id: entry.id,
        data: formData,
        editReason: editReason,
      });
      toast.success("Note updated successfully");
      onSuccess?.();
    } catch (error) {
      toast.error(error.message || "Failed to update note");
    }
  };

  // Handle close
  const handleClose = () => {
    setEditReason("");
    onOpenChange(false);
  };

  if (!open) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[99] bg-black/50 animate-in fade-in duration-200"
        onClick={handleClose}
      />
      {/* Slide panel */}
      <div
        className={cn(
          "fixed inset-y-0 right-0 z-[100]",
          "w-full max-w-md",
          "bg-background border-l border-border shadow-xl",
          "flex flex-col overflow-hidden",
          "animate-in slide-in-from-right duration-300"
        )}
      >
        {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h2 className="font-display text-lg font-semibold">Edit Note</h2>
          <p className="text-xs text-muted-foreground font-mono">
            {entry?.title || "Clinical Note"}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={handleClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-6 py-4 space-y-6">
          {/* Render form fields based on data structure */}
          {formData && typeof formData === "object" && (
            <FormFields
              data={formData}
              onChange={handleFieldChange}
              path=""
            />
          )}

          {/* Edit reason */}
          <div className="pt-4 border-t border-border">
            <Label htmlFor="edit-reason" className="text-xs font-mono uppercase text-muted-foreground">
              Reason for Edit (optional)
            </Label>
            <Textarea
              id="edit-reason"
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              placeholder="Describe why you're making this change..."
              className="mt-2 text-sm"
              rows={2}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              This will be recorded in the version history.
            </p>
          </div>
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-border bg-muted/30">
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={handleSave}
            disabled={updateNote.isPending}
          >
            {updateNote.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </div>
      </div>
    </>,
    document.body
  );
};

/**
 * FormFields - Recursively render form fields for note data
 */
const FormFields = ({ data, onChange, path }) => {
  if (!data || typeof data !== "object") return null;

  // Format label from key
  const formatLabel = (str) => {
    return str
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <div className="space-y-4">
      {Object.entries(data).map(([key, value]) => {
        const fieldPath = path ? `${path}.${key}` : key;
        const label = formatLabel(key);

        // Handle nested objects
        if (value && typeof value === "object" && !Array.isArray(value)) {
          return (
            <div key={key} className="space-y-3">
              <h4 className="font-mono text-xs uppercase tracking-wider text-muted-foreground border-b pb-1">
                {label}
              </h4>
              <div className="pl-3 border-l-2 border-border/50">
                <FormFields data={value} onChange={onChange} path={fieldPath} />
              </div>
            </div>
          );
        }

        // Handle arrays (render as comma-separated in textarea)
        if (Array.isArray(value)) {
          return (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={fieldPath} className="text-sm">
                {label}
              </Label>
              <Textarea
                id={fieldPath}
                value={value.join("\n")}
                onChange={(e) =>
                  onChange(
                    fieldPath,
                    e.target.value.split("\n").filter((v) => v.trim())
                  )
                }
                placeholder={`Enter ${label.toLowerCase()} (one per line)`}
                className="text-sm min-h-[80px]"
              />
            </div>
          );
        }

        // Handle string values
        if (typeof value === "string") {
          // Use textarea for longer content
          const isLongContent = value.length > 100;
          return (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={fieldPath} className="text-sm">
                {label}
              </Label>
              {isLongContent ? (
                <Textarea
                  id={fieldPath}
                  value={value}
                  onChange={(e) => onChange(fieldPath, e.target.value)}
                  className="text-sm min-h-[100px]"
                />
              ) : (
                <Input
                  id={fieldPath}
                  value={value}
                  onChange={(e) => onChange(fieldPath, e.target.value)}
                  className="text-sm"
                />
              )}
            </div>
          );
        }

        // Handle numbers
        if (typeof value === "number") {
          return (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={fieldPath} className="text-sm">
                {label}
              </Label>
              <Input
                id={fieldPath}
                type="number"
                value={value}
                onChange={(e) => onChange(fieldPath, Number(e.target.value))}
                className="text-sm"
              />
            </div>
          );
        }

        // Handle boolean
        if (typeof value === "boolean") {
          return (
            <div key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                id={fieldPath}
                checked={value}
                onChange={(e) => onChange(fieldPath, e.target.checked)}
                className="h-4 w-4"
              />
              <Label htmlFor={fieldPath} className="text-sm">
                {label}
              </Label>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
};

export default EditNoteSlideOver;
