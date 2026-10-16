import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import { PatientRow } from '@/features/ward-board/components/PatientRow';
import { getPatientUrgency, patientNeedsAttention, getWatchlist } from '@/features/ward-board/components/wardBoardUtils';
import { adaptV2WardBoardMonitoringItem } from '@/hooks/nursingQueriesV2Bridge';
it('renders derived fluid conditions separately from manual alerts and preserves urgency/attention', () => {
 const item={admission_id:'synthetic-admission',patient_id:'synthetic-patient',patient_display_name:'Synthetic patient',admission_status:'admitted',ward_name:'Synthetic ward',fluid_condition_count:2,fluid_critical_count:1,fluid_assessment_status:'assessed',active_alert_count:0,critical_alert_count:0};
 const monitoring=adaptV2WardBoardMonitoringItem(item);expect(monitoring.active_alerts).toEqual([]);expect(monitoring.fluid_condition_count).toBe(2);expect(monitoring.fluid_critical_count).toBe(1);expect(getPatientUrgency(item)).toBe('critical');expect(patientNeedsAttention(item)).toBe(true);expect(getWatchlist({},[item])).toEqual([item]);
 render(<MemoryRouter><table><tbody><PatientRow patient={item} /></tbody></table></MemoryRouter>);expect(screen.getByText('2 fluid conditions · critical balance')).toBeInTheDocument();expect(screen.queryByText('2 active')).not.toBeInTheDocument();
});
