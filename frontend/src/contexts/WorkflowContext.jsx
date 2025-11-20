import { createContext, useContext, useState } from 'react';

const WorkflowContext = createContext(undefined);

export function WorkflowProvider({ children }) {
  const [activeWorkflow, setActiveWorkflow] = useState(null);
  const [workflowType, setWorkflowType] = useState(null);

  const value = {
    activeWorkflow,
    setActiveWorkflow,
    workflowType,
    setWorkflowType,
    isInWorkflow: !!activeWorkflow,
  };

  return (
    <WorkflowContext.Provider value={value}>
      {children}
    </WorkflowContext.Provider>
  );
}

export function useWorkflowContext() {
  const context = useContext(WorkflowContext);
  if (context === undefined) {
    throw new Error('useWorkflowContext must be used within a WorkflowProvider');
  }
  return context;
}
