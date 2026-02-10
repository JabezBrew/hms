import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage
} from '@/components/ui/breadcrumb';
import { useEffect, createContext, useContext, useState, useCallback, useRef } from 'react';

// Create a context for breadcrumb state
const BreadcrumbContext = createContext();

// Provider component for breadcrumb context
export function BreadcrumbProvider({ children }) {
  const [breadcrumbs, setBreadcrumbs] = useState([
    { label: 'Home', path: '/' }
  ]);
  const location = useLocation();
  const lastPathRef = useRef(location.pathname);
  const lastAppliedPathRef = useRef(location.pathname);

  const updateBreadcrumbs = useCallback((newBreadcrumbs, appliedPath) => {
    const safeBreadcrumbs = Array.isArray(newBreadcrumbs) ? newBreadcrumbs : [];
    // Filter out any "Home" breadcrumbs from the input (we add it automatically)
    const filteredBreadcrumbs = safeBreadcrumbs.filter(
      crumb => crumb.label !== 'Home' && crumb.path !== '/'
    );

    lastAppliedPathRef.current = appliedPath || lastAppliedPathRef.current;
    setBreadcrumbs([
      { label: 'Home', path: '/' },
      ...filteredBreadcrumbs
    ]);
  }, []);

  // Reset breadcrumbs when navigating to a new route
  useEffect(() => {
    if (location.pathname !== lastPathRef.current) {
      lastPathRef.current = location.pathname;
      // Skip reset if breadcrumbs were already applied for this path.
      if (lastAppliedPathRef.current === location.pathname) {
        return;
      }
      // Reset to just Home when route changes
      setBreadcrumbs([{ label: 'Home', path: '/' }]);
    }
  }, [location.pathname]);

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
  const location = useLocation();
  const { updateBreadcrumbs } = useBreadcrumb();

  useEffect(() => {
    updateBreadcrumbs(breadcrumbs, location.pathname);
  }, [breadcrumbs, location.pathname, updateBreadcrumbs]);

  return null;
}

// Main breadcrumb component
export function PageBreadcrumb() {
  const { breadcrumbs } = useBreadcrumb();

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
