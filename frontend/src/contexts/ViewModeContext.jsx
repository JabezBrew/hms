import { createContext, useState, useEffect } from 'react';
import { safeStorage } from '@/lib/safe-storage';

const ViewModeContext = createContext(undefined);

const VIEW_MODES = {
  DOCUMENTATION: 'documentation',
  REVIEW: 'review',
  MONITORING: 'monitoring',
};

export function ViewModeProvider({ children }) {
  const [viewMode, setViewMode] = useState(() => {
    // Load from safe storage or default to documentation mode
    return safeStorage.get('encounter_view_mode', VIEW_MODES.DOCUMENTATION);
  });

  // Persist to safe storage when mode changes
  useEffect(() => {
    safeStorage.set('encounter_view_mode', viewMode);
  }, [viewMode]);

  const value = {
    viewMode,
    setViewMode,
    isDocumentationMode: viewMode === VIEW_MODES.DOCUMENTATION,
    isReviewMode: viewMode === VIEW_MODES.REVIEW,
    isMonitoringMode: viewMode === VIEW_MODES.MONITORING,
  };

  return (
    <ViewModeContext.Provider value={value}>
      {children}
    </ViewModeContext.Provider>
  );
}
