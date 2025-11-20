import { createContext, useContext, useState, useEffect } from 'react';

const ViewModeContext = createContext(undefined);

export const VIEW_MODES = {
  DOCUMENTATION: 'documentation',
  REVIEW: 'review',
  MONITORING: 'monitoring',
};

export function ViewModeProvider({ children }) {
  const [viewMode, setViewMode] = useState(() => {
    // Load from localStorage or default to documentation mode
    const saved = localStorage.getItem('encounter_view_mode');
    return saved || VIEW_MODES.DOCUMENTATION;
  });

  // Persist to localStorage when mode changes
  useEffect(() => {
    localStorage.setItem('encounter_view_mode', viewMode);
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

export function useViewMode() {
  const context = useContext(ViewModeContext);
  if (context === undefined) {
    throw new Error('useViewMode must be used within a ViewModeProvider');
  }
  return context;
}
