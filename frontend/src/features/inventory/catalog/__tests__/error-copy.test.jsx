import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { errorCopy } from '../model';
afterEach(cleanup);
it('normal operational-history conflict explains the blocker with static copy', () => { render(<p role="alert">{errorCopy({ data: { error: { code: 'inventory_item_has_operational_history' } } })}</p>); expect(screen.getByRole('alert')).toHaveTextContent('linked records'); });
it.each(['__proto__', 'constructor', 'toString'])('unknown error code %s always renders safe static fallback', code => { render(<p role="alert">{errorCopy({ data: { error: { code } } })}</p>); expect(screen.getByRole('alert')).toHaveTextContent('Current catalog evidence could not be confirmed'); });
