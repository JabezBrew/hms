import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export function useRouteTableState(stateKey, initialState) {
  const location = useLocation();
  const navigate = useNavigate();
  const locationStateRef = useRef(location.state || {});
  const [state, setState] = useState(() => ({
    ...initialState,
    ...(location.state?.[stateKey] || {}),
  }));
  const stateRef = useRef(state);

  useEffect(() => {
    locationStateRef.current = location.state || {};
  }, [location.state]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const persistState = useCallback((nextState) => {
    const nextLocationState = {
      ...locationStateRef.current,
      [stateKey]: nextState,
    };
    locationStateRef.current = nextLocationState;
    navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: nextLocationState,
      preventScrollReset: true,
    });
  }, [location.pathname, location.search, navigate, stateKey]);

  const setRouteTableState = useCallback((updater) => {
    const previous = stateRef.current;
    const next = typeof updater === 'function'
      ? updater(previous)
      : { ...previous, ...updater };
    stateRef.current = next;
    setState(next);
    persistState(next);
  }, [persistState]);

  return [state, setRouteTableState];
}
