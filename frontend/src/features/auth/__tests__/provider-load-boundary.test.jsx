import { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { AuthProvider } from '@/lib/auth/AuthProvider';
import { authSessionRuntime } from '@/lib/auth/authSessionLoader';
afterEach(cleanup);
it('mounts no consumers while the actual module loader is pending', async () => {
  let finish; let mounted = 0;
  function Child() { useEffect(() => { mounted += 1; }, []); return <p>Synthetic protected child</p>; }
  const Runtime = authSessionRuntime(() => new Promise(resolve => { finish = resolve; }));
  render(<AuthProvider Runtime={Runtime}><Child /></AuthProvider>);
  expect(screen.getByRole('status')).toBeInTheDocument(); expect(mounted).toBe(0); expect(screen.queryByText('Synthetic protected child')).toBeNull();
  await act(async () => finish({ default: ({ children }) => children })); expect(mounted).toBe(1);
});
it('fails closed on module rejection without exposing the private error or mounting children', async () => {
  const Runtime = authSessionRuntime(() => Promise.reject(new Error('SYNTHETIC PRIVATE MODULE DETAIL')));
  render(<AuthProvider Runtime={Runtime}><p>Synthetic protected child</p></AuthProvider>);
  await screen.findByRole('button', { name: 'Reload HMS' }); expect(screen.queryByText('Synthetic protected child')).toBeNull(); expect(screen.queryByText(/PRIVATE MODULE/)).toBeNull();
});
it('keeps the loaded provider and child instance through host rerenders', async () => {
  let loads = 0; let mounts = 0;
  function Child() { const [text, setText] = useState(''); useEffect(() => { mounts += 1; }, []); return <input aria-label="Synthetic retained text" value={text} onChange={e => setText(e.target.value)} />; }
  const Runtime = authSessionRuntime(async () => { loads += 1; return { default: ({ children }) => children }; });
  const view = render(<AuthProvider Runtime={Runtime}><Child /></AuthProvider>); await screen.findByLabelText('Synthetic retained text'); fireEvent.change(screen.getByLabelText('Synthetic retained text'), { target: { value: 'Unsubmitted text' } });
  view.rerender(<AuthProvider Runtime={Runtime}><Child /></AuthProvider>); expect(mounts).toBe(1); expect(loads).toBe(1); expect(screen.getByLabelText('Synthetic retained text')).toHaveValue('Unsubmitted text');
});
it('rejects an unusable loaded module without publishing any child', async () => {
  const Runtime = authSessionRuntime(async () => ({ default: null })); render(<AuthProvider Runtime={Runtime}><p>Synthetic protected child</p></AuthProvider>);
  await screen.findByRole('button', { name: 'Reload HMS' }); expect(screen.queryByText('Synthetic protected child')).toBeNull();
});
