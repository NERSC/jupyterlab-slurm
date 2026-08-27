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
jest.mock('ag-grid-react', () => ({
  AgGridReact: (props: any) => {
    const api = {
      isDestroyed: () => false,
      sizeColumnsToFit: jest.fn(),
      deselectAll: jest.fn()
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
    showSelectedOnly: false,
    setShowSelectedOnly: jest.fn(),
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

  test('the toolbar Refresh button calls reload()', () => {
    const reload = jest.fn();
    mockUseSlurmQueue.mockReturnValue(baseQueueState({ reload }));
    render(<SqueueDataTable {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    expect(reload).toHaveBeenCalled();
  });

  test('job actions (kill/hold/release) call handleJobAction via the toolbar', () => {
    const handleJobAction = jest.fn();
    mockUseSlurmQueue.mockReturnValue(
      baseQueueState({
        handleJobAction,
        selectedRows: [{ JOBID: '123' }]
      })
    );
    render(<SqueueDataTable {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Kill Job/i }));
    expect(handleJobAction).toHaveBeenCalledWith('kill');
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
    fireEvent.click(screen.getByRole('button', { name: /Show details/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /Show details/i }));
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
