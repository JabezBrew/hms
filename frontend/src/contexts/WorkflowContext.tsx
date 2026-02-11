import { createContext, useContext, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'

export interface WorkflowContextValue {
  activeWorkflow: unknown
  setActiveWorkflow: Dispatch<SetStateAction<unknown>>
  workflowType: string | null
  setWorkflowType: Dispatch<SetStateAction<string | null>>
  isInWorkflow: boolean
}

const WorkflowContext = createContext<WorkflowContextValue | undefined>(undefined)

export function WorkflowProvider({ children }: { children: ReactNode }) {
  const [activeWorkflow, setActiveWorkflow] = useState<unknown>(null)
  const [workflowType, setWorkflowType] = useState<string | null>(null)

  const value = {
    activeWorkflow,
    setActiveWorkflow,
    workflowType,
    setWorkflowType,
    isInWorkflow: !!activeWorkflow,
  }

  return (
    <WorkflowContext.Provider value={value}>
      {children}
    </WorkflowContext.Provider>
  )
}

export function useWorkflowContext(): WorkflowContextValue {
  const context = useContext(WorkflowContext)
  if (context === undefined) {
    throw new Error('useWorkflowContext must be used within a WorkflowProvider')
  }
  return context
}
