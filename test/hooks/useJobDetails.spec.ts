import { renderHook, waitFor, act } from '@testing-library/react';
import { useJobDetails } from '../../src/hooks/useJobDetails';
import { requestAPI } from '../../src/handler';

jest.mock('../../src/handler');

const mockRequestAPI = requestAPI as jest.MockedFunction<typeof requestAPI>;

function routeRequest(handlers: Record<string, () => any>) {
  mockRequestAPI.mockImplementation((async (endPoint = '') => {
    const key = Object.keys(handlers).find(k => endPoint.startsWith(k));
    if (!key) {
      throw new Error(`Unexpected endpoint: ${endPoint}`);
    }
    return handlers[key]();
  }) as any);
}

describe('useJobDetails', () => {
  beforeEach(() => {
    mockRequestAPI.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('does not fetch details when no jobId is provided', async () => {
    routeRequest({ 'ui-config': () => ({ success: true, data: {} }) });
    const { result } = renderHook(() => useJobDetails(undefined));
    await waitFor(() => expect(result.current.uiCfg).toEqual({}));
    // Only the ui-config lookup should have run; never a job/<id> query.
    const calledEndpoints = mockRequestAPI.mock.calls.map(c => c[0]);
    expect(calledEndpoints.some(e => (e as string).startsWith('job/'))).toBe(
      false
    );
  });

  test('loads fields and steps for a job', async () => {
    routeRequest({
      'ui-config': () => ({
        success: true,
        data: { details_labels: { State: 'Status' } }
      }),
      'job/': () => ({
        success: true,
        data: {
          source: 'scontrol',
          fields: { State: 'RUNNING', JobId: '7040' },
          steps: [{ JobID: '7040.batch', State: 'RUNNING' }]
        }
      })
    });

    const { result } = renderHook(() => useJobDetails('7040'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.fields).toEqual({ State: 'RUNNING', JobId: '7040' });
    expect(result.current.steps).toHaveLength(1);
    await waitFor(() =>
      expect(result.current.uiCfg.details_labels?.State).toBe('Status')
    );
  });

  test('exposes an error when the backend reports failure', async () => {
    routeRequest({
      'ui-config': () => ({ success: true, data: {} }),
      'job/': () => ({
        success: false,
        errorMessage: 'Bad job array element specified: 7040_2'
      })
    });

    const { result } = renderHook(() => useJobDetails('7040_2'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(
      'Bad job array element specified: 7040_2'
    );
    expect(result.current.fields).toBeNull();
  });

  test('encodes array-element ids in the request path', async () => {
    routeRequest({
      'ui-config': () => ({ success: true, data: {} }),
      'job/': () => ({
        success: true,
        data: { source: 'sacct', fields: { State: 'FAILED' }, steps: [] }
      })
    });

    renderHook(() => useJobDetails('7040_2'));
    await waitFor(() => {
      const jobCall = mockRequestAPI.mock.calls.find(c =>
        (c[0] as string).startsWith('job/')
      );
      expect(jobCall?.[0]).toBe('job/7040_2');
    });
  });

  test('schedules a silent poll for a non-terminal (running) job', async () => {
    jest.useFakeTimers();
    let calls = 0;
    routeRequest({
      'ui-config': () => ({ success: true, data: {} }),
      'job/': () => {
        calls += 1;
        return {
          success: true,
          data: { source: 'scontrol', fields: { State: 'RUNNING' }, steps: [] }
        };
      }
    });

    renderHook(() => useJobDetails('7040'));

    // Let the initial async fetch resolve.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const afterInitial = calls;
    expect(afterInitial).toBeGreaterThanOrEqual(1);

    // Advancing past the poll interval triggers another (silent) fetch.
    await act(async () => {
      jest.advanceTimersByTime(15000);
      await Promise.resolve();
    });
    expect(calls).toBeGreaterThan(afterInitial);
  });

  test('does not poll a terminal (completed) job', async () => {
    jest.useFakeTimers();
    let calls = 0;
    routeRequest({
      'ui-config': () => ({ success: true, data: {} }),
      'job/': () => {
        calls += 1;
        return {
          success: true,
          data: {
            source: 'sacct',
            fields: { State: 'COMPLETED' },
            steps: []
          }
        };
      }
    });

    renderHook(() => useJobDetails('7040'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const afterInitial = calls;

    await act(async () => {
      jest.advanceTimersByTime(60000);
      await Promise.resolve();
    });
    // No additional fetch: the job is in a terminal state.
    expect(calls).toBe(afterInitial);
  });
});
