import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('../../src/index', () => ({
  COMMAND_ID_SHOW_DETAILS: 'jupyterlab-slurm:show-job-details'
}));

const mockNotificationError = jest.fn();
const mockNotificationSuccess = jest.fn();
jest.mock('@jupyterlab/apputils', () => ({
  Notification: {
    error: (...args: any[]) => mockNotificationError(...args),
    success: (...args: any[]) => mockNotificationSuccess(...args)
  }
}));

const mockUseSlurmQueue = jest.fn();
jest.mock('../../src/hooks/useSlurmQueue', () => ({
  useSlurmQueue: (props: any) => mockUseSlurmQueue(props)
}));

// Stub AgGridReact the same way as the SlurmJobHistory spec: render row data
// as plain markers and expose onGridReady so gridApiRef wiring can be
// exercised without pulling in AG Grid's full DOM/measurement machinery.
// Note: SqueueDataTable no longer uses AG Grid's `pinnedTopRowData` feature
// at all (see the comment in SqueueDataTable.tsx for why -- data-driven
// pinned rows never render selection checkboxes, a hard AG Grid
// limitation). Pinned rows are just reordered to the front of the normal
// `rowData` array, so this stub only needs to render `rowData`.
export const mockGridNodes: any[] = [];
export const mockGridProps: {
  columnDefs?: any[];
  defaultColDef?: any;
  rowSelection?: any;
} = {};

jest.mock('ag-grid-react', () => ({
  AgGridReact: (props: any) => {
    mockGridNodes.length = 0;
    mockGridProps.columnDefs = props.columnDefs;
    mockGridProps.defaultColDef = props.defaultColDef;
    mockGridProps.rowSelection = props.rowSelection;
    const selectedFlags = new Map<string, boolean>();
    const mainNodes = (props.rowData || []).map((row: any) => {
      const id = props.getRowId ? props.getRowId({ data: row }) : row.JOBID;
      const node = {
        data: row,
        isSelected: () => selectedFlags.get(id) ?? false,
        setSelected: jest.fn((selected: boolean) => {
          selectedFlags.set(id, selected);
        })
      };
      mockGridNodes.push(node);
      return node;
    });
    const api = {
      isDestroyed: () => false,
      sizeColumnsToFit: jest.fn(),
      deselectAll: jest.fn(),
      forEachNode: (cb: (node: any) => void) => {
        mainNodes.forEach(cb);
      },
      getRowNode: (id: string) =>
        mainNodes.find(
          (n: any) =>
            (props.getRowId
              ? props.getRowId({ data: n.data })
              : n.data.JOBID) === id
        )
    };
    React.useEffect(() => {
      props.onGridReady?.({ api });
    }, []);
    return (
      <div data-testid="ag-grid-stub">
        {(props.rowData || []).map((row: any, idx: number) => (
          <div key={idx} data-testid="ag-grid-row">
            {JSON.stringify(row)}
          </div>
        ))}
      </div>
    );
  }
}));

import SqueueDataTable from '../../src/components/SqueueDataTable';

function baseQueueState(overrides: Partial<any> = {}) {
  return {
    lastSqueueFetch: new Date('1970-01-01'),
    nextAvailableSqueueFetch: null,
    uiLabels: {},
    uiSizing: {},
    selectedRows: [],
    pinnedRowIds: [],
    filterQuery: '',
    setFilterQuery: jest.fn(),
    autoReload: false,
    userOnly: false,
    setUserOnly: jest.fn(),
    loading: false,
    displayRows: [{ JOBID: '123', NAME: 'myjob' }],
    errorOpen: false,
    setErrorOpen: jest.fn(),
    errorMessage: '',
    setErrorMessage: jest.fn(),
    gridApiRef: { current: null },
    jobIDLabel: 'JOBID',
    handleJobAction: jest.fn(),
    reload: jest.fn(),
    onSelectionChanged: jest.fn(),
    reapplyGridFilters: jest.fn(),
    sizeColumnsToFitSafe: jest.fn(),
    disableManualRefresh: false,
    saveColumnState: jest.fn(),
    initialColumnState: [],
    ...overrides
  };
}

function baseProps(overrides: Partial<any> = {}) {
  return {
    itemsPerPageAuto: true,
    userOnly: false,
    itemsPerPage: 10,
    itemsPerPageOptions: [10],
    autoReload: false,
    autoReloadRate: 60,
    columnState: [],
    notifyOnStateChange: false,
    userName: 'alice',
    reloadRate: 60,
    jupyterlabFrontend: { commands: { execute: jest.fn() } } as any,
    settingRegistry: {} as any,
    ...overrides
  };
}

describe('SqueueDataTable', () => {
  beforeEach(() => {
    mockUseSlurmQueue.mockReset();
  });

  test('renders the grid with the server-provided rows', () => {
    mockUseSlurmQueue.mockReturnValue(baseQueueState());
    render(<SqueueDataTable {...baseProps()} />);
    expect(screen.getByTestId('ag-grid-stub')).toBeInTheDocument();
    expect(screen.getByText(/myjob/)).toBeInTheDocument();
  });

  test('reorders a selected/pinned row to the front of the normal rowData, not into a separate pinned section', () => {
    // Regression context: pinning was previously implemented via AG Grid's
    // `pinnedTopRowData` feature, which turned out to have a hard, built-in
    // limitation -- confirmed directly in AG Grid's own source -- that
    // selection checkboxes are never rendered for data-driven pinned rows.
    // The fix was to stop using that feature entirely and instead just
    // reorder pinned IDs to the front of the ordinary `rowData` array, so
    // the row stays in the normal (fully interactive/selectable) row
    // model. This test asserts that reordering, using the component's real
    // (unmocked) `useSlurmQueue`-derived data flow via props.
    mockUseSlurmQueue.mockReturnValue(
      baseQueueState({
        selectedRows: [{ JOBID: '124', NAME: 'otherjob' }],
        pinnedRowIds: ['124'],
        displayRows: [
          { JOBID: '123', NAME: 'myjob' },
          { JOBID: '124', NAME: 'otherjob' }
        ]
      })
    );
    render(<SqueueDataTable {...baseProps()} />);
    const rendered = screen.getAllByTestId('ag-grid-row');
    // The pinned job (124) should be reordered to the front.
    expect(rendered[0].textContent).toContain('124');
    expect(rendered[1].textContent).toContain('123');
  });

  test('columnDefs identity stays stable across refreshes that only change row data (not fields), so column filters keep focus', () => {
    // Regression test: `displayColumns`/`columnDefs` previously depended
    // directly on the `displayRows` array reference, which changes on
    // every squeue refresh even when the field set is identical. AG Grid
    // treats a new `columnDefs` reference as "columns changed" and rebuilds
    // each column's filter UI, silently stealing focus from (and
    // discarding) whatever the user was typing into a column filter when a
    // refresh landed mid-keystroke.
    // `uiLabels`/`uiSizing` are stable object references in the real hook
    // (set once from `/ui-config`, not recreated per fetch) -- share the
    // same references across both renders here to accurately reflect that,
    // rather than each `baseQueueState()` call's fresh `{}` literals.
    const stableUiLabels = {};
    const stableUiSizing = {};
    mockUseSlurmQueue.mockReturnValue(
      baseQueueState({
        uiLabels: stableUiLabels,
        uiSizing: stableUiSizing,
        displayRows: [{ JOBID: '123', NAME: 'myjob' }]
      })
    );
    const { rerender } = render(<SqueueDataTable {...baseProps()} />);
    const firstColumnDefs = mockGridProps.columnDefs;

    // Simulate a subsequent auto-refresh: brand-new `displayRows` array
    // reference, same fields, different values.
    mockUseSlurmQueue.mockReturnValue(
      baseQueueState({
        uiLabels: stableUiLabels,
        uiSizing: stableUiSizing,
        displayRows: [{ JOBID: '123', NAME: 'myjob-updated' }]
      })
    );
    rerender(<SqueueDataTable {...baseProps()} />);

    expect(mockGridProps.columnDefs).toBe(firstColumnDefs);
  });

  test('defaultColDef/rowSelection identity stays stable across re-renders, so column filters keep focus', () => {
    // Regression test: `defaultColDef` and `rowSelection` were previously
    // plain object literals recreated on every render. The component
    // re-renders every second (the `now`/setInterval ticker driving the
    // refresh-pie countdown), and AgGridReact treats a new
    // `defaultColDef` reference the same way it treats a new `columnDefs`
    // reference -- it reprocesses/rebuilds every column (including its
    // filter UI), silently stealing keyboard/mouse focus from an
    // in-progress column filter roughly once a second.
    mockUseSlurmQueue.mockReturnValue(baseQueueState());
    const { rerender } = render(<SqueueDataTable {...baseProps()} />);
    const firstDefaultColDef = mockGridProps.defaultColDef;
    const firstRowSelection = mockGridProps.rowSelection;

    // Simulate a per-second re-render (e.g. the refresh-pie ticker) with no
    // actual data change.
    mockUseSlurmQueue.mockReturnValue(baseQueueState());
    rerender(<SqueueDataTable {...baseProps()} />);

    expect(mockGridProps.defaultColDef).toBe(firstDefaultColDef);
    expect(mockGridProps.rowSelection).toBe(firstRowSelection);
  });

  test('column comparators keep a pinned row ahead of a non-pinned row regardless of sort column/direction', () => {
    // Regression test: reordering `rowData` (the previous test) only
    // controls the *default* row order -- once the user actively sorts by
    // a column (including a secondary/multi-sort column via shift+click),
    // AG Grid re-sorts the whole row set using that column's comparator,
    // which previously had no concept of pinning at all. A pinned/selected
    // job could therefore be sorted anywhere, including onto a later page.
    // Every column def now wraps its comparator so a pinned row always
    // compares as "less than" a non-pinned one, and that ordering is
    // preserved under a descending sort too (AG Grid inverts a
    // comparator's raw result for descending columns).
    mockUseSlurmQueue.mockReturnValue(
      baseQueueState({
        selectedRows: [{ JOBID: '124', NAME: 'aaa' }],
        pinnedRowIds: ['124'],
        displayRows: [
          { JOBID: '123', NAME: 'aaa' },
          { JOBID: '124', NAME: 'zzz' }
        ]
      })
    );
    render(<SqueueDataTable {...baseProps()} />);

    const nameCol = mockGridProps.columnDefs?.find(
      (c: any) => c.field === 'NAME'
    );
    expect(nameCol).toBeDefined();

    const pinnedNode = { data: { JOBID: '124', NAME: 'zzz' } };
    const nonPinnedNode = { data: { JOBID: '123', NAME: 'aaa' } };

    // Ascending sort: without the pin-aware wrapping, 'aaa' < 'zzz' would
    // put the non-pinned row first. With it, the pinned row must still win.
    expect(
      nameCol.comparator('zzz', 'aaa', pinnedNode, nonPinnedNode, false)
    ).toBeLessThan(0);
    // Descending sort: AG Grid inverts the raw comparator result, so the
    // wrapped comparator must return a value that, after inversion, still
    // keeps the pinned row ahead.
    expect(
      nameCol.comparator('zzz', 'aaa', pinnedNode, nonPinnedNode, true)
    ).toBeGreaterThan(0);
  });

  test('shows a hint that selected jobs are pinned to page 1 when there is a pinned selection', () => {
    mockUseSlurmQueue.mockReturnValue(
      baseQueueState({
        selectedRows: [{ JOBID: '124', NAME: 'otherjob' }],
        pinnedRowIds: ['124']
      })
    );
    render(<SqueueDataTable {...baseProps()} />);
    expect(screen.getByText(/pinned to page 1/i)).toBeInTheDocument();
  });

  test('does not show the pinned-selection hint when nothing is selected/pinned', () => {
    mockUseSlurmQueue.mockReturnValue(baseQueueState({ pinnedRowIds: [] }));
    render(<SqueueDataTable {...baseProps()} />);
    expect(screen.queryByText(/pinned to page 1/i)).not.toBeInTheDocument();
  });

  test('shows "Last updated: —" before the first successful fetch', () => {
    mockUseSlurmQueue.mockReturnValue(baseQueueState());
    render(<SqueueDataTable {...baseProps()} />);
    expect(screen.getByText(/Last updated: —/)).toBeInTheDocument();
  });

  test('shows a formatted "Last updated" timestamp once fetched', () => {
    mockUseSlurmQueue.mockReturnValue(
      baseQueueState({ lastSqueueFetch: new Date('2026-01-01T00:00:00Z') })
    );
    render(<SqueueDataTable {...baseProps()} />);
    expect(screen.queryByText(/Last updated: —/)).not.toBeInTheDocument();
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
  });

  test('shows "Refreshing…" while loading', () => {
    mockUseSlurmQueue.mockReturnValue(baseQueueState({ loading: true }));
    render(<SqueueDataTable {...baseProps()} />);
    expect(screen.getByText(/Refreshing…/)).toBeInTheDocument();
  });

  test('the "next refresh in" countdown starts at exactly the refresh rate, not one second too many', () => {
    // Regression test: the "now" ticker used to only tick on its own
    // independent 1s interval, so if a new nextAvailableSqueueFetch landed
    // shortly *before* the ticker's next scheduled tick, "now" could be up
    // to ~1s stale, causing the countdown to briefly display 11s instead of
    // 10s for a 10s refresh rate. Simulate that by mounting, advancing time
    // by 900ms (before the ticker's first 1000ms tick fires), then
    // delivering a fresh nextAvailableSqueueFetch exactly 10s out.
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const reloadRateMs = 10000;

    mockUseSlurmQueue.mockReturnValue(
      baseQueueState({ autoReload: true, nextAvailableSqueueFetch: null })
    );
    const { rerender } = render(
      <SqueueDataTable
        {...baseProps({ autoReload: true, autoReloadRate: 10 })}
      />
    );

    jest.advanceTimersByTime(900);
    mockUseSlurmQueue.mockReturnValue(
      baseQueueState({
        autoReload: true,
        nextAvailableSqueueFetch: new Date(Date.now() + reloadRateMs)
      })
    );
    rerender(
      <SqueueDataTable
        {...baseProps({ autoReload: true, autoReloadRate: 10 })}
      />
    );

    const expectedSeconds = Math.ceil(reloadRateMs / 1000);
    const countdown = screen.getByText(/Next refresh in \d+s/);
    const actualSeconds = Number(countdown.textContent?.match(/(\d+)s/)?.[1]);
    expect(actualSeconds).toBe(expectedSeconds);
    jest.useRealTimers();
  });

  test('the toolbar Refresh button calls reload()', () => {
    const reload = jest.fn();
    mockUseSlurmQueue.mockReturnValue(baseQueueState({ reload }));
    render(<SqueueDataTable {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    expect(reload).toHaveBeenCalled();
  });

  test('job actions (kill) call handleJobAction via the toolbar', () => {
    const handleJobAction = jest.fn();
    mockUseSlurmQueue.mockReturnValue(
      baseQueueState({
        handleJobAction,
        selectedRows: [{ JOBID: '123' }]
      })
    );
    render(<SqueueDataTable {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Cancel/i }));
    expect(handleJobAction).toHaveBeenCalledWith('cancel');
  });

  test('"Show details" executes the show-job-details command with selected job ids', () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    mockUseSlurmQueue.mockReturnValue(
      baseQueueState({ selectedRows: [{ JOBID: '123' }, { JOBID: '456' }] })
    );
    render(
      <SqueueDataTable
        {...baseProps({ jupyterlabFrontend: { commands: { execute } } })}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^Details/i }));
    expect(execute).toHaveBeenCalledWith(
      'jupyterlab-slurm:show-job-details',
      expect.objectContaining({ jobIds: ['123', '456'] })
    );
  });

  test('surfaces a failure to open Job Details as a JupyterLab notification', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('nope'));
    const setErrorMessage = jest.fn();
    const setErrorOpen = jest.fn();
    mockUseSlurmQueue.mockReturnValue(
      baseQueueState({
        selectedRows: [{ JOBID: '123' }],
        setErrorMessage,
        setErrorOpen
      })
    );
    render(
      <SqueueDataTable
        {...baseProps({ jupyterlabFrontend: { commands: { execute } } })}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^Details/i }));
    await waitFor(() => expect(setErrorOpen).toHaveBeenCalledWith(true));
    expect(setErrorMessage).toHaveBeenCalledWith('Failed to open Job Details.');
  });

  test('an open error state triggers a JupyterLab error notification and closes', () => {
    const setErrorOpen = jest.fn();
    mockUseSlurmQueue.mockReturnValue(
      baseQueueState({
        errorOpen: true,
        errorMessage: 'Something failed',
        setErrorOpen
      })
    );
    render(<SqueueDataTable {...baseProps()} />);
    expect(mockNotificationError).toHaveBeenCalledWith(
      'Something failed',
      expect.objectContaining({ autoClose: expect.any(Number) })
    );
    expect(setErrorOpen).toHaveBeenCalledWith(false);
  });

  test('an open success state triggers a JupyterLab success notification and closes', () => {
    const setSuccessOpen = jest.fn();
    mockUseSlurmQueue.mockReturnValue(
      baseQueueState({
        successOpen: true,
        successMessage: 'Cancelled 1 job: 123',
        setSuccessOpen
      })
    );
    render(<SqueueDataTable {...baseProps()} />);
    expect(mockNotificationSuccess).toHaveBeenCalledWith(
      'Cancelled 1 job: 123',
      expect.objectContaining({ autoClose: expect.any(Number) })
    );
    expect(setSuccessOpen).toHaveBeenCalledWith(false);
  });
});
