import { useState } from "react";
import { diffWords } from "diff";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, Plus, Minus, RefreshCw } from "lucide-react";

/**
 * DiffRenderer - Renders a field-by-field diff between two note versions
 *
 * Shows changes with color highlighting:
 * - Additions: Green background
 * - Deletions: Red background with strikethrough
 * - Unchanged: Normal text (collapsible)
 */
const DiffRenderer = ({ oldData, newData }) => {
  // Get all unique keys from both objects
  const allKeys = new Set([
    ...Object.keys(oldData || {}),
    ...Object.keys(newData || {}),
  ]);

  // Categorize fields
  const fields = [];
  let changedCount = 0;

  for (const key of allKeys) {
    const oldValue = oldData?.[key];
    const newValue = newData?.[key];
    const hasOld = oldData && key in oldData;
    const hasNew = newData && key in newData;

    let status;
    if (!hasOld && hasNew) {
      status = "added";
      changedCount++;
    } else if (hasOld && !hasNew) {
      status = "removed";
      changedCount++;
    } else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      status = "changed";
      changedCount++;
    } else {
      status = "unchanged";
    }

    fields.push({ key, oldValue, newValue, status });
  }

  // Sort: changed fields first, then unchanged
  fields.sort((a, b) => {
    if (a.status === "unchanged" && b.status !== "unchanged") return 1;
    if (a.status !== "unchanged" && b.status === "unchanged") return -1;
    return 0;
  });

  return (
    <div className="space-y-1">
      {/* Summary */}
      <div className="text-xs text-muted-foreground mb-3 flex items-center gap-2">
        <RefreshCw className="h-3 w-3" />
        <span>
          {changedCount} field{changedCount !== 1 ? "s" : ""} changed
        </span>
      </div>

      {/* Fields */}
      <div className="space-y-3">
        {fields.map(({ key, oldValue, newValue, status }) => (
          <FieldDiff
            key={key}
            fieldName={key}
            oldValue={oldValue}
            newValue={newValue}
            status={status}
          />
        ))}
      </div>
    </div>
  );
};

/**
 * FieldDiff - Renders diff for a single field
 */
const FieldDiff = ({ fieldName, oldValue, newValue, status }) => {
  const [isExpanded, setIsExpanded] = useState(status !== "unchanged");

  const formatLabel = (str) => {
    return str
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const statusConfig = {
    added: {
      icon: Plus,
      badge: "Added",
      badgeClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
      borderClass: "border-l-emerald-500",
    },
    removed: {
      icon: Minus,
      badge: "Removed",
      badgeClass: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
      borderClass: "border-l-rose-500",
    },
    changed: {
      icon: RefreshCw,
      badge: "Changed",
      badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
      borderClass: "border-l-amber-500",
    },
    unchanged: {
      icon: null,
      badge: null,
      badgeClass: "",
      borderClass: "border-l-border",
    },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  // Skip empty values
  if (
    (oldValue === null || oldValue === undefined || oldValue === "") &&
    (newValue === null || newValue === undefined || newValue === "")
  ) {
    return null;
  }

  return (
    <div
      className={cn(
        "border-l-2 pl-3 py-1",
        config.borderClass,
        status === "unchanged" && "opacity-60"
      )}
    >
      {/* Field Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full text-left group"
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <span className="font-mono text-xs uppercase text-muted-foreground group-hover:text-foreground transition-colors">
          {formatLabel(fieldName)}
        </span>
        {config.badge && (
          <span
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded font-medium",
              config.badgeClass
            )}
          >
            {config.badge}
          </span>
        )}
      </button>

      {/* Field Content */}
      {isExpanded && (
        <div className="mt-1.5 text-sm">
          <ValueDiff
            oldValue={oldValue}
            newValue={newValue}
            status={status}
          />
        </div>
      )}
    </div>
  );
};

/**
 * ValueDiff - Renders the diff for a value (handles different types)
 */
const ValueDiff = ({ oldValue, newValue, status }) => {
  // Handle added field
  if (status === "added") {
    return <AddedValue value={newValue} />;
  }

  // Handle removed field
  if (status === "removed") {
    return <RemovedValue value={oldValue} />;
  }

  // Handle unchanged
  if (status === "unchanged") {
    return <UnchangedValue value={newValue} />;
  }

  // Handle changed - need to diff
  const oldType = getValueType(oldValue);
  const newType = getValueType(newValue);

  // If types differ, show old removed and new added
  if (oldType !== newType) {
    return (
      <div className="space-y-1">
        <RemovedValue value={oldValue} />
        <AddedValue value={newValue} />
      </div>
    );
  }

  // Same type - diff based on type
  switch (oldType) {
    case "string":
      return <TextDiff oldText={oldValue} newText={newValue} />;
    case "array":
      return <ArrayDiff oldArray={oldValue} newArray={newValue} />;
    case "object":
      return <ObjectDiff oldObj={oldValue} newObj={newValue} />;
    default:
      return (
        <div className="space-y-1">
          <RemovedValue value={oldValue} />
          <AddedValue value={newValue} />
        </div>
      );
  }
};

/**
 * TextDiff - Word-level diff for text strings
 */
const TextDiff = ({ oldText, newText }) => {
  const diff = diffWords(String(oldText || ""), String(newText || ""));

  return (
    <p className="whitespace-pre-wrap leading-relaxed">
      {diff.map((part, index) => {
        if (part.added) {
          return (
            <span
              key={index}
              className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 px-0.5 rounded"
            >
              {part.value}
            </span>
          );
        }
        if (part.removed) {
          return (
            <span
              key={index}
              className="bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 line-through px-0.5 rounded"
            >
              {part.value}
            </span>
          );
        }
        return <span key={index}>{part.value}</span>;
      })}
    </p>
  );
};

/**
 * ArrayDiff - Show added/removed array items
 */
const ArrayDiff = ({ oldArray, newArray }) => {
  const oldSet = new Set(oldArray.map((item) => JSON.stringify(item)));
  const newSet = new Set(newArray.map((item) => JSON.stringify(item)));

  const added = newArray.filter((item) => !oldSet.has(JSON.stringify(item)));
  const removed = oldArray.filter((item) => !newSet.has(JSON.stringify(item)));
  const unchanged = newArray.filter((item) => oldSet.has(JSON.stringify(item)));

  return (
    <ul className="space-y-1">
      {removed.map((item, i) => (
        <li
          key={`removed-${i}`}
          className="flex items-start gap-2 bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-300 px-2 py-1 rounded line-through"
        >
          <Minus className="h-3 w-3 mt-1 flex-shrink-0" />
          <span>{typeof item === "object" ? JSON.stringify(item) : String(item)}</span>
        </li>
      ))}
      {added.map((item, i) => (
        <li
          key={`added-${i}`}
          className="flex items-start gap-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300 px-2 py-1 rounded"
        >
          <Plus className="h-3 w-3 mt-1 flex-shrink-0" />
          <span>{typeof item === "object" ? JSON.stringify(item) : String(item)}</span>
        </li>
      ))}
      {unchanged.map((item, i) => (
        <li key={`unchanged-${i}`} className="flex items-start gap-2 text-muted-foreground px-2 py-1">
          <span className="w-3" />
          <span>{typeof item === "object" ? JSON.stringify(item) : String(item)}</span>
        </li>
      ))}
    </ul>
  );
};

/**
 * ObjectDiff - Recursive diff for nested objects
 */
const ObjectDiff = ({ oldObj, newObj }) => {
  return (
    <div className="pl-3 border-l border-border/50">
      <DiffRenderer oldData={oldObj} newData={newObj} />
    </div>
  );
};

/**
 * AddedValue - Display a newly added value
 */
const AddedValue = ({ value }) => {
  const type = getValueType(value);

  if (type === "string") {
    return (
      <p className="whitespace-pre-wrap bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300 px-2 py-1 rounded">
        {value}
      </p>
    );
  }

  if (type === "array") {
    return (
      <ul className="space-y-1">
        {value.map((item, i) => (
          <li
            key={i}
            className="flex items-start gap-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300 px-2 py-1 rounded"
          >
            <Plus className="h-3 w-3 mt-1 flex-shrink-0" />
            <span>{typeof item === "object" ? JSON.stringify(item) : String(item)}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (type === "object") {
    return (
      <div className="bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded">
        <pre className="text-xs text-emerald-800 dark:text-emerald-300 whitespace-pre-wrap">
          {JSON.stringify(value, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 px-1 rounded">
      {String(value)}
    </span>
  );
};

/**
 * RemovedValue - Display a removed value
 */
const RemovedValue = ({ value }) => {
  const type = getValueType(value);

  if (type === "string") {
    return (
      <p className="whitespace-pre-wrap bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-300 line-through px-2 py-1 rounded">
        {value}
      </p>
    );
  }

  if (type === "array") {
    return (
      <ul className="space-y-1">
        {value.map((item, i) => (
          <li
            key={i}
            className="flex items-start gap-2 bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-300 line-through px-2 py-1 rounded"
          >
            <Minus className="h-3 w-3 mt-1 flex-shrink-0" />
            <span>{typeof item === "object" ? JSON.stringify(item) : String(item)}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (type === "object") {
    return (
      <div className="bg-rose-50 dark:bg-rose-900/20 px-2 py-1 rounded">
        <pre className="text-xs text-rose-800 dark:text-rose-300 line-through whitespace-pre-wrap">
          {JSON.stringify(value, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <span className="bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 line-through px-1 rounded">
      {String(value)}
    </span>
  );
};

/**
 * UnchangedValue - Display an unchanged value
 */
const UnchangedValue = ({ value }) => {
  const type = getValueType(value);

  if (type === "string") {
    return <p className="whitespace-pre-wrap text-muted-foreground">{value}</p>;
  }

  if (type === "array") {
    return (
      <ul className="list-disc list-inside text-muted-foreground">
        {value.map((item, i) => (
          <li key={i}>
            {typeof item === "object" ? JSON.stringify(item) : String(item)}
          </li>
        ))}
      </ul>
    );
  }

  if (type === "object") {
    return (
      <div className="pl-3 border-l border-border/50">
        <DiffRenderer oldData={value} newData={value} />
      </div>
    );
  }

  return <span className="text-muted-foreground">{String(value)}</span>;
};

/**
 * Helper to determine value type
 */
const getValueType = (value) => {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  return "primitive";
};

export default DiffRenderer;
