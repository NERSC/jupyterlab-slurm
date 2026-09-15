import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockUseSlurmHistory = jest.fn();
jest.mock('../../src/hooks/useSlurmHistory', () => ({
  useSlurmHistory: (userName: string) => mockUseSlurmHistory(userName)
}));

const mockRequestAPI = jest.fn();
jest.mock('../../src/handler', () => ({
  requestAPI: (...args: any[]) => mockRequestAPI(...args)
}));

const mockNotificationError = jest.fn();
const mockNotificationSuccess = jest.fn();
jest.mock('@jupyterlab/apputils', () => ({
  Notification: {
    error: (...args: any[]) => mockNotificationError(...args),
    success: (...args: any[]) => mockNotificationSuccess(...args)
  }
}));

// AgGridReact pulls in a lot of internal DOM/measurement machinery that isn't
// meaningful to exercise here; stub it with a lightweight component that
// renders row data as plain text and exposes onGridReady/onSelectionChanged
// so the surrounding wiring (grid API refs, selection -> "Show details") can
// still be tested.
let lastColumnDefsProp: any[] = [];
jest.mock('ag-grid-react', () => ({
  AgGridReact: (props: any) => {
    lastColumnDefsProp = props.columnDefs || [];
    const api = {
      isDestroyed: () => false,
      getGridSize: () => ({ width: 100 }),
      sizeColumnsToFit: jest.fn(),
      getDisplayedRowCount: () => (props.rowData || []).length,
      getDisplayedRowAtIndex: (i: number) => ({
        data: props.rowData[i],
        isSelected: () => true
      })
    };
    React.useEffect(() => {
      props.onGridReady?.({ api });
    }, []);
    return (
      <div
        data-testid="ag-grid-stub"
        data-columndefs={JSON.stringify(props.columnDefs || [])}
      >
        {(props.rowData || []).map((row: any, idx: number) => (
          <div key={idx} data-testid="ag-grid-row">
            {JSON.stringify(row)}
          </div>
        ))}
        <button
          data-testid="ag-grid-select-all"
          onClick={() => props.onSelectionChanged?.()}
        >
          select all
        </button>
      </div>
    );
  }
}));

import SlurmJobHistory from '../../src/components/SlurmJobHistory';

function baseHistoryState(overrides: Partial<any> = {}) {
  return {
    loading: false,
    error: null,
    columns: ['JobID', 'State'],
    rows: [{ JobID: '123', State: 'COMPLETED' }],
    historyLabels: { JobID: 'Job ID', State: 'Status' },
    fetchHistory: jest.fn(),
    ...overrides
  };
}

describe('SlurmJobHistory', () => {
  beforeEach(() => {
    mockUseSlurmHistory.mockReset();
    mockRequestAPI.mockReset();
    mockNotificationError.mockReset();
    mockNotificationSuccess.mockReset();
    (navigator as any).clipboard = {
      writeText: jest.fn().mockResolvedValue(undefined)
    };
  });

  test('renders the loading state', () => {
    // Initial load: no columns yet. Loading transitions on a subsequent
    // refresh (columns already populated) intentionally keep the grid
    // mounted instead -- see the "refreshing keeps the grid mounted" test.
    mockUseSlurmHistory.mockReturnValue(
      baseHistoryState({ loading: true, rows: [], columns: [] })
    );
    render(
      <SlurmJobHistory
        userName="alice"
        jupyterLabFrontend={{ commands: { execute: jest.fn() } } as any}
      />
    );
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByTestId('ag-grid-stub')).not.toBeInTheDocument();
  });

  test('refreshing (loading again with columns already populated) keeps the grid mounted, preserving selection', () => {
    // Regression test: `loading` is true on every fetchHistory() call, not
    // just the first one. Previously the grid was unmounted whenever
    // `loading` was true, which destroyed AG Grid's selection state on
    // every refresh even though `getRowId` would otherwise have let AG
    // Grid preserve it across a rowData change.
    mockUseSlurmHistory.mockReturnValue(baseHistoryState({ loading: true }));
    render(
      <SlurmJobHistory
        userName="alice"
        jupyterLabFrontend={{ commands: { execute: jest.fn() } } as any}
      />
    );
    expect(screen.getByTestId('ag-grid-stub')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  test('renders the error state with a retry action', () => {
    const fetchHistory = jest.fn();
    mockUseSlurmHistory.mockReturnValue(
      baseHistoryState({
        error: 'Unknown error fetching sacct',
        rows: [],
        fetchHistory
      })
    );
    render(
      <SlurmJobHistory
        userName="alice"
        jupyterLabFrontend={{ commands: { execute: jest.fn() } } as any}
      />
    );
    expect(
      screen.getByText('Unknown error fetching sacct')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));
    expect(fetchHistory).toHaveBeenCalled();
  });

  test('renders rows in the grid once loaded', () => {
    mockUseSlurmHistory.mockReturnValue(baseHistoryState());
    render(
      <SlurmJobHistory
        userName="alice"
        jupyterLabFrontend={{ commands: { execute: jest.fn() } } as any}
      />
    );
    expect(screen.getByTestId('ag-grid-stub')).toBeInTheDocument();
    expect(screen.getByText('Job History for alice')).toBeInTheDocument();
  });

  test('the Refresh button calls fetchHistory', () => {
    const fetchHistory = jest.fn();
    mockUseSlurmHistory.mockReturnValue(baseHistoryState({ fetchHistory }));
    render(
      <SlurmJobHistory
        userName="alice"
        jupyterLabFrontend={{ commands: { execute: jest.fn() } } as any}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: /Refresh job history/i })
    );
    expect(fetchHistory).toHaveBeenCalled();
  });

  test('Markdown/JSON copy buttons are disabled with no rows and enabled with rows', () => {
    mockUseSlurmHistory.mockReturnValue(baseHistoryState({ rows: [] }));
    const { rerender } = render(
      <SlurmJobHistory
        userName="alice"
        jupyterLabFrontend={{ commands: { execute: jest.fn() } } as any}
      />
    );
    expect(screen.getByRole('button', { name: /Markdown/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /JSON/i })).toBeDisabled();

    mockUseSlurmHistory.mockReturnValue(baseHistoryState());
    rerender(
      <SlurmJobHistory
        userName="alice"
        jupyterLabFrontend={{ commands: { execute: jest.fn() } } as any}
      />
    );
    expect(
      screen.getByRole('button', { name: /Markdown/i })
    ).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /JSON/i })).not.toBeDisabled();
  });

  test('copying markdown writes a table to the clipboard', async () => {
    mockUseSlurmHistory.mockReturnValue(baseHistoryState());
    render(
      <SlurmJobHistory
        userName="alice"
        jupyterLabFrontend={{ commands: { execute: jest.fn() } } as any}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Markdown/i }));
    await waitFor(() =>
      expect((navigator as any).clipboard.writeText).toHaveBeenCalled()
    );
    const md = (navigator as any).clipboard.writeText.mock.calls[0][0];
    expect(md).toContain('Slurm Job History');
    expect(md).toContain('123');
  });

  test('"Show details" is disabled until a row is selected, then executes the command', () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    mockUseSlurmHistory.mockReturnValue(baseHistoryState());
    render(
      <SlurmJobHistory
        userName="alice"
        jupyterLabFrontend={{ commands: { execute } } as any}
      />
    );
    const showDetails = screen.getByRole('button', { name: /Show details/i });
    expect(showDetails).toBeDisabled();

    fireEvent.click(screen.getByTestId('ag-grid-select-all'));
    expect(showDetails).not.toBeDisabled();

    fireEvent.click(showDetails);
    expect(execute).toHaveBeenCalledWith(
      'jupyterlab-slurm:show-job-details',
      expect.objectContaining({ jobIds: ['123'] })
    );
  });

  test('defaults to sorting by Submit (desc) when no End column is present', () => {
    mockUseSlurmHistory.mockReturnValue(
      baseHistoryState({
        columns: ['JobID', 'State', 'Submit'],
        rows: [{ JobID: '123', State: 'COMPLETED', Submit: '2024-01-01' }]
      })
    );
    render(
      <SlurmJobHistory
        userName="alice"
        jupyterLabFrontend={{ commands: { execute: jest.fn() } } as any}
      />
    );
    const colDefs = JSON.parse(
      screen.getByTestId('ag-grid-stub').getAttribute('data-columndefs') || '[]'
    );
    const submitCol = colDefs.find((c: any) => c.field === 'Submit');
    expect(submitCol.sort).toBe('desc');
    const jobIdCol = colDefs.find((c: any) => c.field === 'JobID');
    expect(jobIdCol.sort).toBeUndefined();
  });

  test('prefers an End column over Submit for the default sort when both are present', () => {
    mockUseSlurmHistory.mockReturnValue(
      baseHistoryState({
        columns: ['JobID', 'Submit', 'End'],
        rows: [{ JobID: '123', Submit: '2024-01-01', End: '2024-01-02' }]
      })
    );
    render(
      <SlurmJobHistory
        userName="alice"
        jupyterLabFrontend={{ commands: { execute: jest.fn() } } as any}
      />
    );
    const colDefs = JSON.parse(
      screen.getByTestId('ag-grid-stub').getAttribute('data-columndefs') || '[]'
    );
    const endCol = colDefs.find((c: any) => c.field === 'End');
    expect(endCol.sort).toBe('desc');
    const submitCol = colDefs.find((c: any) => c.field === 'Submit');
    expect(submitCol.sort).toBeUndefined();
  });

  test('surfaces a failure to open Job Details as a JupyterLab notification', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('nope'));
    mockUseSlurmHistory.mockReturnValue(baseHistoryState());
    render(
      <SlurmJobHistory
        userName="alice"
        jupyterLabFrontend={{ commands: { execute } } as any}
      />
    );
    fireEvent.click(screen.getByTestId('ag-grid-select-all'));
    fireEvent.click(screen.getByRole('button', { name: /Show details/i }));
    await waitFor(() =>
      expect(mockNotificationError).toHaveBeenCalledWith(
        expect.stringMatching(/Failed to open Job Details/i),
        expect.anything()
      )
    );
  });

  test('Requeue is disabled until a row is selected, then calls scontrol/requeue and shows a success message', async () => {
    const fetchHistory = jest.fn();
    mockRequestAPI.mockResolvedValue({ success: true });
    mockUseSlurmHistory.mockReturnValue(baseHistoryState({ fetchHistory }));
    render(
      <SlurmJobHistory
        userName="alice"
        jupyterLabFrontend={{ commands: { execute: jest.fn() } } as any}
      />
    );
    const requeueButton = screen.getByRole('button', { name: /^Requeue$/i });
    expect(requeueButton).toBeDisabled();

    fireEvent.click(screen.getByTestId('ag-grid-select-all'));
    expect(requeueButton).not.toBeDisabled();

    fireEvent.click(requeueButton);
    await waitFor(() => expect(mockRequestAPI).toHaveBeenCalled());
    expect(mockRequestAPI.mock.calls[0][0]).toBe('scontrol/requeue');
    expect(mockRequestAPI.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ job_ids: ['123'] })
      })
    );
    await waitFor(() =>
      expect(mockNotificationSuccess).toHaveBeenCalledWith(
        expect.stringMatching(/Requeued 1 job: 123/i),
        expect.anything()
      )
    );
    expect(fetchHistory).toHaveBeenCalled();
  });

  test('choosing "Requeue & Hold" from the split-button menu calls scontrol/requeuehold', async () => {
    mockRequestAPI.mockResolvedValue({ success: true });
    mockUseSlurmHistory.mockReturnValue(baseHistoryState());
    render(
      <SlurmJobHistory
        userName="alice"
        jupyterLabFrontend={{ commands: { execute: jest.fn() } } as any}
      />
    );
    fireEvent.click(screen.getByTestId('ag-grid-select-all'));
    fireEvent.click(
      screen.getByRole('button', { name: /select requeue option/i })
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /Requeue & Hold/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Requeue$/i }));
    await waitFor(() =>
      expect(mockRequestAPI).toHaveBeenCalledWith(
        'scontrol/requeuehold',
        expect.anything(),
        expect.objectContaining({ method: 'PATCH' })
      )
    );
  });

  test('a Requeue failure (e.g. job purged from the scheduler) surfaces a clear, non-crashing error', async () => {
    mockRequestAPI.mockResolvedValue({
      success: false,
      errorMessage: 'Invalid job id specified'
    });
    mockUseSlurmHistory.mockReturnValue(baseHistoryState());
    render(
      <SlurmJobHistory
        userName="alice"
        jupyterLabFrontend={{ commands: { execute: jest.fn() } } as any}
      />
    );
    fireEvent.click(screen.getByTestId('ag-grid-select-all'));
    fireEvent.click(screen.getByRole('button', { name: /^Requeue$/i }));
    await waitFor(() =>
      expect(mockNotificationError).toHaveBeenCalledWith(
        expect.stringMatching(
          /Requeue failed for job\(s\) 123.*Invalid job id specified/i
        ),
        expect.anything()
      )
    );
  });

  test('the JobID column sorts numerically like the Queue tab, not alphabetically', () => {
    mockUseSlurmHistory.mockReturnValue(baseHistoryState());
    render(
      <SlurmJobHistory
        userName="alice"
        jupyterLabFrontend={{ commands: { execute: jest.fn() } } as any}
      />
    );
    const jobIdCol = lastColumnDefsProp.find((c: any) => c.field === 'JobID');
    expect(jobIdCol.comparator).toBeInstanceOf(Function);
    // Plain numeric string comparison would put "123" after "20", but the
    // numeric comparator must sort it before, matching the Queue tab.
    expect(jobIdCol.comparator('123', '20')).toBeGreaterThan(0);
    expect(jobIdCol.comparator('2', '10')).toBeLessThan(0);
    // Array-element ids sort after their plain base job.
    expect(jobIdCol.comparator('100', '100_1')).toBeLessThan(0);
  });
});
