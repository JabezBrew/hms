import { createContext, useContext } from 'react';

const WorkspaceDisplayContext = createContext({ variant: 'overlay' });

export function WorkspaceDisplayProvider({ variant, children }) {
  return (
    <WorkspaceDisplayContext.Provider value={{ variant }}>
      {children}
    </WorkspaceDisplayContext.Provider>
  );
}

export function useWorkspaceDisplay() {
  return useContext(WorkspaceDisplayContext);
}
