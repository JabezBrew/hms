import { createContext, useState } from 'react';

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
