import { useEffect, useState } from 'react';

export function useAuthenticatedWebSocketToken({
  enabled,
  isAuthenticated,
  getAccessToken,
  refreshAccessToken,
}) {
  const [refreshedToken, setRefreshedToken] = useState(null);
  const currentAccessToken = enabled && isAuthenticated ? getAccessToken?.() : null;

  useEffect(() => {
    let isMounted = true;

    if (!enabled || !isAuthenticated || currentAccessToken) {
      return () => {
        isMounted = false;
      };
    }

    (async () => {
      try {
        const nextToken = await refreshAccessToken?.();
        if (isMounted) {
          setRefreshedToken(nextToken || null);
        }
      } catch {
        if (isMounted) {
          setRefreshedToken(null);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [enabled, isAuthenticated, currentAccessToken, refreshAccessToken]);

  return currentAccessToken || (enabled && isAuthenticated ? refreshedToken : null);
}
