import React from 'react';
import '@testing-library/jest-dom';
import { render, act } from '@testing-library/react';

// Deliberately do NOT mock ag-grid-react/ag-grid-community here -- this
// spec exists specifically to observe the REAL AG Grid's behavior, since
// the mocked spec (SqueueDataTable.spec.tsx) has repeatedly given false
// confidence for pinned-row selection bugs by not faithfully reproducing
// AG Grid's actual node lifecycle.

jest.mock('../../src/index', () => ({
  COMMAND_ID_SHOW_DETAILS: 'jupyterlab-slurm:show-job-details'
}));

jest.mock('@jupyterlab/apputils', () => ({
  Notification: { error: jest.fn(), success: jest.fn() }
}));

let currentQueueState: any;
jest.mock('../../src/hooks/useSlurmQueue', () => ({
  useSlurmQueue: () => currentQueueState
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
    displayRows: [
      { JOBID: '123', NAME: 'myjob' },
      { JOBID: '124', NAME: 'otherjob' }
    ],
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
    canHoldSelected: true,
    canReleaseSelected: true,
    canSuspendSelected: true,
    canResumeSelected: true,
    canRequeueSelected: true,
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

describe('SqueueDataTable with real AG Grid', () => {
  test('checkbox stays checked after the selected row becomes pinned to the top', async () => {
    currentQueueState = baseQueueState();

    const { rerender } = render(<SqueueDataTable {...baseProps()} />);

    // Let AG Grid finish its async init (onGridReady setTimeout, internal
    // rendering microtasks).
    await act(async () => {
      await new Promise(r => setTimeout(r, 100));
    });

    // Find job 123's row checkbox and select it, exactly as a real user
    // would (this drives AG Grid's real internal selection state, not a
    // mock).
    const rows = document.querySelectorAll('.ag-row');
    expect(rows.length).toBeGreaterThan(0);

    const jobRow = Array.from(rows).find(r =>
      r.textContent?.includes('myjob')
    ) as HTMLElement;
    expect(jobRow).toBeDefined();

    const checkbox = jobRow.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement;
    expect(checkbox).toBeDefined();

    await act(async () => {
      checkbox.click();
      await new Promise(r => setTimeout(r, 20));
    });

    expect(checkbox.checked).toBe(true);

    // Simulate the refresh boundary: the row becomes pinned to the top
    // (as useSlurmQueue would do after a real refresh with this row
    // selected).
    currentQueueState = baseQueueState({
      selectedRows: [{ JOBID: '123', NAME: 'myjob' }],
      pinnedRowIds: ['123']
    });
    await act(async () => {
      rerender(<SqueueDataTable {...baseProps()} />);
      await new Promise(r => setTimeout(r, 50));
    });

    // Row 123 should now be reordered to the top of the *normal* row
    // section (no separate pinned-top section is used anymore, since AG
    // Grid never renders selection checkboxes for data-driven pinned rows
    // -- see the comment in SqueueDataTable.tsx for the full explanation).
    const rowsAfterPin = document.querySelectorAll('.ag-center-cols-container .ag-row');
    const job123Row = Array.from(rowsAfterPin).find(r =>
      r.textContent?.includes('myjob')
    ) as HTMLElement;
    expect(job123Row).toBeTruthy();
    const checkboxAfterPin = job123Row.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement;
    expect(checkboxAfterPin).toBeTruthy();

    // THIS is the assertion that matters: does the checkbox remain
    // checked after the row is reordered to the top?
    expect(checkboxAfterPin.checked).toBe(true);
  });
});
