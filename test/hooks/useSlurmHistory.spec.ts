import { renderHook, waitFor, act } from '@testing-library/react';
import { useSlurmHistory } from '../../src/hooks/useSlurmHistory';
import { requestAPI } from '../../src/handler';

jest.mock('../../src/handler');

const mockRequestAPI = requestAPI as jest.MockedFunction<typeof requestAPI>;

/**
 * Route the mocked requestAPI by endpoint so a single hook can service both
 * the `sacct` history query and the `ui-config` label lookup.
 */
function routeRequest(
  handlers: Record<string, (params?: URLSearchParams) => any>
) {
  mockRequestAPI.mockImplementation((async (
    endPoint = '',
    params?: URLSearchParams
  ) => {
    const key = Object.keys(handlers).find(k => endPoint.startsWith(k));
    if (!key) {
      throw new Error(`Unexpected endpoint: ${endPoint}`);
    }
    return handlers[key](params);
  }) as any);
}

describe('useSlurmHistory', () => {
  beforeEach(() => {
    mockRequestAPI.mockReset();
  });

  test('loads history rows as keyed objects and clears loading', async () => {
    const seen: string[] = [];
    routeRequest({
      sacct: params => {
        seen.push(params?.get('user') ?? '');
        return {
          success: true,
          exitCode: 0,
          data: {
            columns: ['JobID', 'State', 'Elapsed'],
            rows: [
              ['7040', 'COMPLETED', '00:01:00'],
              ['7041', 'FAILED', '00:00:30']
            ]
          }
        };
      },
      'ui-config': () => ({
        success: true,
        data: { history_column_labels: { State: 'Status' } }
      })
    });

    const { result } = renderHook(() => useSlurmHistory('testuser'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.columns).toEqual(['JobID', 'State', 'Elapsed']);
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.rows[0]).toEqual({
      JobID: '7040',
      State: 'COMPLETED',
      Elapsed: '00:01:00'
    });
    // The user filter is forwarded to the sacct query.
    expect(seen).toContain('testuser');
    // Server labels override bundled defaults.
    await waitFor(() =>
      expect(result.current.historyLabels.State).toBe('Status')
    );
  });

  test('surfaces backend failures via the error field', async () => {
    routeRequest({
      sacct: () => ({
        success: false,
        errorMessage: 'sacct blew up',
        data: { columns: [], rows: [] }
      }),
      'ui-config': () => ({ success: true, data: {} })
    });

    const { result } = renderHook(() => useSlurmHistory('testuser'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('sacct blew up');
    expect(result.current.rows).toEqual([]);
    expect(result.current.columns).toEqual([]);
  });

  test('does not send a user param when the userName is blank', async () => {
    const seen: Array<string | null> = [];
    routeRequest({
      sacct: params => {
        seen.push(params?.get('user') ?? null);
        return {
          success: true,
          exitCode: 0,
          data: { columns: ['JobID'], rows: [['1']] }
        };
      },
      'ui-config': () => ({ success: true, data: {} })
    });

    const { result } = renderHook(() => useSlurmHistory('   '));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(seen).toEqual([null]);
  });

  test('refetches on demand via fetchHistory', async () => {
    let calls = 0;
    routeRequest({
      sacct: () => {
        calls += 1;
        return {
          success: true,
          exitCode: 0,
          data: { columns: ['JobID'], rows: [[String(calls)]] }
        };
      },
      'ui-config': () => ({ success: true, data: {} })
    });

    const { result } = renderHook(() => useSlurmHistory('testuser'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const initialCalls = calls;

    await act(async () => {
      await result.current.fetchHistory();
    });
    expect(calls).toBe(initialCalls + 1);
  });
});
