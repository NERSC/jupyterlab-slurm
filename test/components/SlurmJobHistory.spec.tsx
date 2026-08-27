import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockUseSlurmHistory = jest.fn();
jest.mock('../../src/hooks/useSlurmHistory', () => ({
  useSlurmHistory: (userName: string) => mockUseSlurmHistory(userName)
}));

// AgGridReact pulls in a lot of internal DOM/measurement machinery that isn't
// meaningful to exercise here; stub it with a lightweight component that
// renders row data as plain text and exposes onGridReady/onSelectionChanged
// so the surrounding wiring (grid API refs, selection -> "Show details") can
// still be tested.
jest.mock('ag-grid-react', () => ({
  AgGridReact: (props: any) => {
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
      <div data-testid="ag-grid-stub">
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
    (navigator as any).clipboard = {
      writeText: jest.fn().mockResolvedValue(undefined)
    };
  });

  test('renders the loading state', () => {
    mockUseSlurmHistory.mockReturnValue(
      baseHistoryState({ loading: true, rows: [] })
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

  test('surfaces a failure to open Job Details as a visible alert', async () => {
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
      expect(
        screen.getByText(/Failed to open Job Details/i)
      ).toBeInTheDocument()
    );
  });
});
