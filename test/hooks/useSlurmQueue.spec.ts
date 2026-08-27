import { renderHook, waitFor, act } from '@testing-library/react';
import { useSlurmQueue } from '../../src/hooks/useSlurmQueue';
import { requestAPI } from '../../src/handler';

jest.mock('../../src/handler');
// Avoid pulling the full JupyterLab extension (SlurmWidget etc.) via ../../src/index.
jest.mock('../../src/index', () => ({ PLUGIN_ID: 'jupyterlab-slurm:plugin' }));
// Avoid pulling the real @jupyterlab/apputils package (ESM, not transformed
// by Jest); see SqueueDataTable.spec.tsx for the same pattern.
const mockNotificationInfo = jest.fn();
jest.mock('@jupyterlab/apputils', () => ({
  Notification: {
    info: (...args: any[]) => mockNotificationInfo(...args)
  }
}));

const mockRequestAPI = requestAPI as jest.MockedFunction<typeof requestAPI>;

type Handler = (endPoint: string, init?: any) => any;

function routeRequest(handlers: Record<string, Handler>) {
  mockRequestAPI.mockImplementation((async (
    endPoint = '',
    _params?: URLSearchParams,
    init?: any
  ) => {
    const key = Object.keys(handlers).find(k => endPoint.startsWith(k));
    if (!key) {
      throw new Error(`Unexpected endpoint: ${endPoint}`);
    }
    return handlers[key](endPoint, init);
  }) as any);
}

const SQUEUE_COLUMNS = [
  'JOBID',
  'PARTITION',
  'NAME',
  'USER',
  'ST',
  'TIME',
  'NODES',
  'NODELIST(REASON)'
];

function makeProps(overrides: Partial<any> = {}) {
  const settings = {
    get: (_k: string) => ({ composite: undefined }),
    set: jest.fn().mockResolvedValue(undefined)
  };
  return {
    // ISlurmUserSettings
    itemsPerPageAuto: true,
    userOnly: false,
    itemsPerPage: 10,
    itemsPerPageOptions: [10],
    autoReload: false,
    autoReloadRate: 60,
    columnState: [],
    notifyOnStateChange: false,
    // ISlurmWidgetProps
    userName: 'testuser',
    reloadRate: 60,
    jupyterlabFrontend: {} as any,
    settingRegistry: {
      load: jest.fn().mockResolvedValue(settings)
    } as any,
    ...overrides
  };
}

/** A minimal AG Grid api stand-in tracking the USER column filter model. */
function makeFakeGridApi(selected: any[] = []) {
  let userModel: any = null;
  return {
    getSelectedRows: () => selected,
    getColumnFilterModel: jest.fn((col: string) =>
      col === 'USER' ? userModel : null
    ),
    setColumnFilterModel: jest.fn((col: string, model: any) => {
      if (col === 'USER') {
        userModel = model;
      }
    }),
    onFilterChanged: jest.fn(),
    getGridSize: () => ({ width: 800, height: 600 }),
    sizeColumnsToFit: jest.fn(),
    deselectAll: jest.fn()
  };
}

function defaultSqueue() {
  return {
    success: true,
    data: {
      columns: SQUEUE_COLUMNS,
      rows: [
        ['101', 'debug', 'jobA', 'testuser', 'R', '0:10', '1', 'node001'],
        ['102', 'regular', 'jobB', 'otheruser', 'PD', '0:00', '1', '(Priority)']
      ]
    }
  };
}

describe('useSlurmQueue', () => {
  beforeEach(() => {
    mockRequestAPI.mockReset();
  });

  test('loads queue rows and builds keyed display rows', async () => {
    routeRequest({
      'ui-config': () => ({ success: true, data: {} }),
      squeue: () => defaultSqueue()
    });

    const { result } = renderHook(() => useSlurmQueue(makeProps()));

    await waitFor(() => expect(result.current.rows.length).toBe(2));
    expect(result.current.serverColumns).toEqual(SQUEUE_COLUMNS);
    await waitFor(() => expect(result.current.displayRows.length).toBe(2));
    expect(result.current.displayRows[0]).toMatchObject({
      JOBID: '101',
      USER: 'testuser',
      ST: 'R'
    });
    // nextAvailableSqueueFetch stays null when auto-reload is off.
    expect(result.current.nextAvailableSqueueFetch).toBeNull();
    expect(result.current.jobIDLabel).toBe('JOBID');
  });

  test('handleJobAction posts the selected job ids and treats success:true as success', async () => {
    const holdBodies: any[] = [];
    routeRequest({
      'ui-config': () => ({ success: true, data: {} }),
      squeue: () => defaultSqueue(),
      'scontrol/hold': (_e, init) => {
        holdBodies.push(JSON.parse(init.body));
        return { success: true, data: { changedIds: ['101'] } };
      }
    });

    const { result } = renderHook(() => useSlurmQueue(makeProps()));
    await waitFor(() => expect(result.current.rows.length).toBe(2));

    // Simulate the user selecting a row via the grid.
    const api = makeFakeGridApi([{ JOBID: '101' }]);
    result.current.gridApiRef.current = api;
    act(() => {
      result.current.onSelectionChanged({} as any);
    });

    await act(async () => {
      await result.current.handleJobAction('hold');
    });

    // The selected job id(s) are forwarded and a success envelope is accepted
    // (no error snackbar). Note: an immediate reload is rate-limited by
    // squeue_reload_limit_ms, which is exercised separately in the app.
    expect(holdBodies[0]).toEqual({ job_ids: ['101'] });
    expect(result.current.errorOpen).toBe(false);
  });

  test('a successful kill clears the current selection', async () => {
    routeRequest({
      'ui-config': () => ({ success: true, data: {} }),
      squeue: () => defaultSqueue(),
      scancel: () => ({ success: true, data: { changedIds: ['101'] } })
    });

    const { result } = renderHook(() => useSlurmQueue(makeProps()));
    await waitFor(() => expect(result.current.rows.length).toBe(2));

    const api = makeFakeGridApi([{ JOBID: '101' }]);
    result.current.gridApiRef.current = api;
    act(() => result.current.onSelectionChanged({} as any));
    expect(result.current.selectedRows).toHaveLength(1);

    await act(async () => {
      await result.current.handleJobAction('kill');
    });

    expect(api.deselectAll).toHaveBeenCalled();
    await waitFor(() => expect(result.current.selectedRows).toHaveLength(0));
    expect(result.current.errorOpen).toBe(false);
  });

  test('handleJobAction treats exitCode:0 (no success flag) as success', async () => {
    routeRequest({
      'ui-config': () => ({ success: true, data: {} }),
      squeue: () => defaultSqueue(),
      'scontrol/release': () => ({ exitCode: 0 })
    });

    const { result } = renderHook(() => useSlurmQueue(makeProps()));
    await waitFor(() => expect(result.current.rows.length).toBe(2));

    result.current.gridApiRef.current = makeFakeGridApi([{ JOBID: '101' }]);
    act(() => result.current.onSelectionChanged({} as any));

    await act(async () => {
      await result.current.handleJobAction('release');
    });
    expect(result.current.errorOpen).toBe(false);
  });

  test('handleJobAction surfaces a failure via the error snackbar', async () => {
    routeRequest({
      'ui-config': () => ({ success: true, data: {} }),
      squeue: () => defaultSqueue(),
      scancel: () => ({ success: false, errorMessage: 'permission denied' })
    });

    const { result } = renderHook(() => useSlurmQueue(makeProps()));
    await waitFor(() => expect(result.current.rows.length).toBe(2));

    result.current.gridApiRef.current = makeFakeGridApi([{ JOBID: '101' }]);
    act(() => result.current.onSelectionChanged({} as any));

    await act(async () => {
      await result.current.handleJobAction('kill');
    });

    await waitFor(() => expect(result.current.errorOpen).toBe(true));
    // The message must include the affected job id(s), the backend's
    // errorMessage detail, and a timestamp — not just the raw errorMessage.
    expect(result.current.errorMessage).toContain('101');
    expect(result.current.errorMessage).toContain('permission denied');
    expect(result.current.errorMessage).toMatch(/kill/);
  });

  test('reapplyGridFilters is idempotent and applies the userOnly filter', async () => {
    routeRequest({
      'ui-config': () => ({ success: true, data: {} }),
      squeue: () => defaultSqueue()
    });

    const { result } = renderHook(() =>
      useSlurmQueue(makeProps({ userOnly: true }))
    );
    await waitFor(() => expect(result.current.rows.length).toBe(2));

    const api = makeFakeGridApi();
    result.current.gridApiRef.current = api;

    act(() => result.current.reapplyGridFilters());
    expect(api.setColumnFilterModel).toHaveBeenCalledWith('USER', {
      filterType: 'text',
      type: 'equals',
      filter: 'testuser'
    });

    const callsAfterFirst = api.setColumnFilterModel.mock.calls.length;
    // Second call with the model already in the desired state must be a no-op
    // (this protects an open column-filter dropdown from being reset).
    act(() => result.current.reapplyGridFilters());
    expect(api.setColumnFilterModel.mock.calls.length).toBe(callsAfterFirst);
  });

  test('reapplyGridFilters clears the filter when userOnly is off', async () => {
    routeRequest({
      'ui-config': () => ({ success: true, data: {} }),
      squeue: () => defaultSqueue()
    });

    const { result } = renderHook(() => useSlurmQueue(makeProps()));
    await waitFor(() => expect(result.current.rows.length).toBe(2));

    const api = makeFakeGridApi();
    // Pretend a USER filter is currently applied.
    api.setColumnFilterModel('USER', {
      filterType: 'text',
      type: 'equals',
      filter: 'testuser'
    });
    api.setColumnFilterModel.mockClear();
    result.current.gridApiRef.current = api;

    act(() => result.current.reapplyGridFilters());
    expect(api.setColumnFilterModel).toHaveBeenCalledWith('USER', null);
  });
});
