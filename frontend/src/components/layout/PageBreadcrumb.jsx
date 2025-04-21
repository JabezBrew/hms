import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { 
  Breadcrumb, 
  BreadcrumbList, 
  BreadcrumbItem, 
  BreadcrumbLink, 
  BreadcrumbSeparator, 
  BreadcrumbPage 
} from '@/components/ui/breadcrumb';
import { useEffect, createContext, useContext, useState, useCallback } from 'react';

// Create a context for breadcrumb state
const BreadcrumbContext = createContext();

// Provider component for breadcrumb context
export function BreadcrumbProvider({ children }) {
  const [breadcrumbs, setBreadcrumbs] = useState([
    { label: 'Home', path: '/' }
  ]);

  const updateBreadcrumbs = useCallback((newBreadcrumbs) => {
    setBreadcrumbs([
      { label: 'Home', path: '/' },
      ...newBreadcrumbs
    ]);
  }, []);

  return (
    <BreadcrumbContext.Provider value={{ breadcrumbs, updateBreadcrumbs }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

// Hook to use breadcrumb context
export function useBreadcrumb() {
  const context = useContext(BreadcrumbContext);
  if (!context) {
    throw new Error('useBreadcrumb must be used within a BreadcrumbProvider');
  }
  return context;
}

// Component to set breadcrumbs for a page
export function BreadcrumbSetter({ breadcrumbs }) {
  const { updateBreadcrumbs } = useBreadcrumb();

  // Use JSON.stringify to compare breadcrumbs objects by value
  // This prevents unnecessary updates when breadcrumbs objects are recreated but have the same content
  useEffect(() => {
    updateBreadcrumbs(breadcrumbs);
  }, [JSON.stringify(breadcrumbs), updateBreadcrumbs]);

  return null;
}

// Main breadcrumb component
export function PageBreadcrumb() {
  const { breadcrumbs, updateBreadcrumbs } = useBreadcrumb();
  const location = useLocation();

  // Reset breadcrumbs when navigating to a different section
  useEffect(() => {
    // Check if the current path is not in the breadcrumbs
    const currentPath = location.pathname;
    const isPathInBreadcrumbs = breadcrumbs.some(crumb => 
      currentPath === crumb.path || currentPath.startsWith(crumb.path + '/')
    );

    // If not in wards section and breadcrumbs has ward-related paths, reset to home
    if (!currentPath.startsWith('/wards') && breadcrumbs.some(crumb => crumb.path.startsWith('/wards'))) {
      updateBreadcrumbs([]);
    }
  }, [location.pathname, breadcrumbs, updateBreadcrumbs]);

  if (breadcrumbs.length <= 1) {
    return null; // Don't show breadcrumb if only home is present
  }

  return (
    <Breadcrumb aria-label="breadcrumb" className="mb-4">
      <BreadcrumbList>
        {breadcrumbs.map((crumb, index) => {
          const isLast = index === breadcrumbs.length - 1;

          return (
            <React.Fragment key={index}>
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={crumb.path}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>

              {!isLast && <BreadcrumbSeparator />}
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
