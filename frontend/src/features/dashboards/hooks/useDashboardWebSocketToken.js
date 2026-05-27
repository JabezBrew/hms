import { useEffect, useState } from 'react';

export function useDashboardWebSocketToken({
  shouldConnect,
  getAccessToken,
  refreshAccessToken,
}) {
  const [wsToken, setWsToken] = useState(null);

  useEffect(() => {
    let isMounted = true;

    if (!shouldConnect) {
      return () => {
        isMounted = false;
      };
    }

    const existingToken = getAccessToken?.();
    if (existingToken) {
      setWsToken(existingToken);
      return () => {
        isMounted = false;
      };
    }

    (async () => {
      try {
        const refreshed = await refreshAccessToken?.();
        if (isMounted) {
          setWsToken(refreshed || null);
        }
      } catch {
        if (isMounted) {
          setWsToken(null);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [shouldConnect, getAccessToken, refreshAccessToken]);

  return [shouldConnect ? wsToken : null, setWsToken];
}
