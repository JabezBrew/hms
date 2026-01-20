/**
 * Hook for unit options in Duty Roster
 */
import { useMemo } from 'react';
import { useClinicalUnitsTree } from '@/hooks/useOrganization';
import { flattenUnitTree } from './utils';

export function useUnitOptions() {
  const { data, isLoading } = useClinicalUnitsTree();
  const tree = Array.isArray(data) ? data : (data?.data || data || []);
  const units = useMemo(() => flattenUnitTree(tree), [tree]);

  const departments = useMemo(
    () => units.filter((unit) => unit.unit_type_code === 'department'),
    [units]
  );

  const teams = useMemo(
    () => units.filter((unit) => unit.unit_type_code === 'team'),
    [units]
  );

  const unitById = useMemo(
    () => new Map(units.map((unit) => [unit.id, unit])),
    [units]
  );

  const getTeamOptions = (departmentId) => {
    if (!departmentId) return teams;
    return teams.filter((team) => team.parentId === departmentId);
  };

  return {
    isLoading,
    units,
    departments,
    teams,
    unitById,
    getTeamOptions,
  };
}
