import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

const EMPTY_RESET_PARAMS = Object.freeze([]);

export function useUrlEnumParam({
  param,
  values,
  defaultValue,
  resetParams = EMPTY_RESET_PARAMS,
  omitDefault = true,
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const valueSet = useMemo(() => new Set(values), [values]);
  const rawValue = searchParams.get(param);
  const value = valueSet.has(rawValue) ? rawValue : defaultValue;

  const setValue = useCallback((nextValue) => {
    if (!valueSet.has(nextValue)) {
      return;
    }

    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (omitDefault && nextValue === defaultValue) {
        params.delete(param);
      } else {
        params.set(param, nextValue);
      }
      resetParams.forEach((resetParam) => {
        params.delete(resetParam);
      });
      return params;
    });
  }, [defaultValue, omitDefault, param, resetParams, setSearchParams, valueSet]);

  return [value, setValue, searchParams, setSearchParams];
}
