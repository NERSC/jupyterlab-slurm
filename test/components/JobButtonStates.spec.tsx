import React from 'react';
import '@testing-library/jest-dom';
import { render, act, waitFor } from '@testing-library/react';
import { requestAPI } from '../../src/handler';

// This spec exercises the REAL useSlurmQueue derivation logic together
// with the REAL AG Grid and the REAL SqueueToolbar -- i.e. an actual
// end-to-end path from a given squeue row's ST/Reason all the way to the
// toolbar's Cancel/Pause/Resume/Requeue buttons' disabled state, rather
// than mocking the hook (as SqueueDataTable.spec.tsx does) or mocking the
// grid to skip real selection semantics. This is deliberately the same
// "don't mock the middle" approach as SqueueDataTable.real-aggrid.spec.tsx,
// applied to the job-action button matrix instead of pinned-row selection.

jest.mock('../../src/index', () => ({
  PLUGIN_ID: 'jupyterlab-slurm:plugin',
  COMMAND_ID_SHOW_DETAILS: 'jupyterlab-slurm:show-job-details'
}));

jest.mock('@jupyterlab/apputils', () => ({
  Notification: { error: jest.fn(), success: jest.fn(), info: jest.fn() }
}));

jest.mock('../../src/handler');
const mockRequestAPI = requestAPI as jest.MockedFunction<typeof requestAPI>;

import SqueueDataTable from '../../src/components/SqueueDataTable';

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

/** A single squeue row for a job in a given state. Owned by 'alice' unless
 * a different `user` is given. */
function row(
  jobId: string,
  st: string,
  reason: string,
  name = `job${jobId}`,
  user = 'alice'
) {
  return [jobId, 'debug', name, user, st, '0:00', '1', reason];
}

function mockSqueue(rows: string[][]) {
  mockRequestAPI.mockImplementation((async (endPoint = '') => {
    if (endPoint.startsWith('ui-config')) {
      return { success: true, data: {} };
    }
    if (endPoint.startsWith('squeue')) {
      return { success: true, data: { columns: SQUEUE_COLUMNS, rows } };
    }
    throw new Error(`Unexpected endpoint in JobButtonStates spec: ${endPoint}`);
  }) as any);
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
    settingRegistry: {
      load: jest.fn().mockResolvedValue({
        get: () => ({ composite: undefined }),
        set: jest.fn().mockResolvedValue(undefined)
      })
    } as any,
    ...overrides
  };
}

/** Selects the row whose NAME cell contains `name` via its real checkbox. */
async function selectRowByName(name: string) {
  const rows = document.querySelectorAll('.ag-row');
  const target = Array.from(rows).find(r =>
    r.textContent?.includes(name)
  ) as HTMLElement;
  expect(target).toBeTruthy();
  const checkbox = target.querySelector(
    'input[type="checkbox"]'
  ) as HTMLInputElement;
  expect(checkbox).toBeTruthy();
  await act(async () => {
    checkbox.click();
    await new Promise(r => setTimeout(r, 20));
  });
  return checkbox;
}

function getButton(name: RegExp): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll('button')).find(b =>
    name.test(b.textContent || '')
  ) as HTMLButtonElement;
  expect(found).toBeTruthy();
  return found;
}

async function renderAndWaitForRows(rows: string[][]) {
  mockSqueue(rows);
  render(<SqueueDataTable {...baseProps()} />);
  await act(async () => {
    await new Promise(r => setTimeout(r, 100));
  });
  const agRows = document.querySelectorAll('.ag-row');
  expect(agRows.length).toBe(rows.length);
}

describe('Job action buttons reflect real squeue state end-to-end', () => {
  beforeEach(() => {
    mockRequestAPI.mockReset();
  });

  test('RUNNING ("R") job: Cancel/Pause/Requeue enabled, Resume disabled', async () => {
    await renderAndWaitForRows([row('101', 'R', 'node001')]);
    await selectRowByName('job101');

    expect(getButton(/^Cancel/)).toBeEnabled();
    expect(getButton(/^Pause/)).toBeEnabled();
    expect(getButton(/^Resume/)).toBeDisabled();
    expect(getButton(/^Requeue/)).toBeEnabled();
  });

  test('SUSPENDED ("S") job: Cancel/Resume/Requeue enabled, Pause disabled', async () => {
    await renderAndWaitForRows([row('102', 'S', 'node001')]);
    await selectRowByName('job102');

    expect(getButton(/^Cancel/)).toBeEnabled();
    expect(getButton(/^Pause/)).toBeDisabled();
    expect(getButton(/^Resume/)).toBeEnabled();
    expect(getButton(/^Requeue/)).toBeEnabled();
  });

  test('PENDING, user-held ("PD"/"(JobHeldUser)") job: Cancel/Resume enabled, Pause/Requeue disabled', async () => {
    // Pause must be disabled here: the job is already held, and real
    // Slurm's `scontrol hold` is a silent no-op on an already-held job --
    // there's nothing left for Pause to meaningfully do.
    await renderAndWaitForRows([row('103', 'PD', '(JobHeldUser)')]);
    await selectRowByName('job103');

    expect(getButton(/^Cancel/)).toBeEnabled();
    expect(getButton(/^Pause/)).toBeDisabled();
    expect(getButton(/^Resume/)).toBeEnabled();
    expect(getButton(/^Requeue/)).toBeDisabled();
  });

  test('PENDING, admin-held ("PD"/"(JobHeldAdmin)") job: Resume/Pause disabled, Requeue disabled', async () => {
    // Pause disabled for the same "already held" reason as the user-held
    // case above; Resume is separately disabled because only an admin can
    // release an admin hold.
    await renderAndWaitForRows([row('104', 'PD', '(JobHeldAdmin)')]);
    await selectRowByName('job104');

    expect(getButton(/^Cancel/)).toBeEnabled();
    expect(getButton(/^Pause/)).toBeDisabled();
    expect(getButton(/^Resume/)).toBeDisabled();
    expect(getButton(/^Requeue/)).toBeDisabled();
  });

  test('PENDING but NOT held ("PD"/"(Priority)") job: Pause enabled (Hold), Resume disabled, Requeue disabled', async () => {
    // Regression test for the bug where a plain pending job (waiting on
    // priority/resources, not an actual Hold) incorrectly left Resume
    // enabled -- real Slurm's `scontrol release` is a silent no-op on such
    // a job, so Resume must only be enabled for a genuinely held job.
    await renderAndWaitForRows([row('105', 'PD', '(Priority)')]);
    await selectRowByName('job105');

    expect(getButton(/^Cancel/)).toBeEnabled();
    expect(getButton(/^Pause/)).toBeEnabled();
    expect(getButton(/^Resume/)).toBeDisabled();
    expect(getButton(/^Requeue/)).toBeDisabled();
  });

  test('COMPLETED ("CD") job: Cancel enabled (still addressable), Pause/Resume/Requeue disabled', async () => {
    // Requeue is disabled here: completed jobs don't actually linger in
    // the live squeue queue in practice (they drop out once done), so
    // Requeue only ever needs to apply to R/S rows in this UI -- there's
    // no realistic scenario where a CD row is present to requeue.
    await renderAndWaitForRows([row('106', 'CD', 'None')]);
    await selectRowByName('job106');

    expect(getButton(/^Cancel/)).toBeEnabled();
    expect(getButton(/^Pause/)).toBeDisabled();
    expect(getButton(/^Resume/)).toBeDisabled();
    expect(getButton(/^Requeue/)).toBeDisabled();
  });

  test('mixed PD(held)+R selection: Pause enabled via the R row only (the held PD row is skipped), Resume enabled', async () => {
    // Pause firing here only actually suspends job108 (R); job107 is
    // already held so it's excluded from the underlying `hold` call, but
    // the button itself is still enabled overall because of job108.
    await renderAndWaitForRows([
      row('107', 'PD', '(JobHeldUser)'),
      row('108', 'R', 'node002')
    ]);
    await selectRowByName('job107');
    await selectRowByName('job108');

    expect(getButton(/^Cancel/)).toBeEnabled();
    expect(getButton(/^Pause/)).toBeEnabled();
    expect(getButton(/^Resume/)).toBeEnabled();
    // Requeue is enabled via the R row only (job107 is PD and would be
    // skipped by the row filter, same "at least one applicable" pattern
    // as Pause/Resume) -- it's no longer disabled just because a PD job
    // is also in the selection.
    expect(getButton(/^Requeue/)).toBeEnabled();
  });

  test('mixed PD(not held)+R selection: Resume must stay disabled (no held/suspended row present)', async () => {
    await renderAndWaitForRows([
      row('109', 'PD', '(Priority)'),
      row('110', 'R', 'node003')
    ]);
    await selectRowByName('job109');
    await selectRowByName('job110');

    expect(getButton(/^Cancel/)).toBeEnabled();
    expect(getButton(/^Pause/)).toBeEnabled();
    expect(getButton(/^Resume/)).toBeDisabled();
    // Requeue is enabled via the R row only (job109 is a plain, unheld PD
    // job and would be skipped by the row filter) -- same "at least one
    // applicable" pattern as Pause/Resume.
    expect(getButton(/^Requeue/)).toBeEnabled();
  });

  test('nothing selected: Cancel/Pause/Resume/Requeue all disabled', async () => {
    await renderAndWaitForRows([row('111', 'R', 'node001')]);
    // No selection made.
    expect(getButton(/^Cancel/)).toBeDisabled();
    expect(getButton(/^Pause/)).toBeDisabled();
    expect(getButton(/^Resume/)).toBeDisabled();
    expect(getButton(/^Requeue/)).toBeDisabled();
  });

  test('Clear/Details badge counts accurately track real selection size as rows are selected/deselected', async () => {
    await renderAndWaitForRows([
      row('112', 'R', 'node001'),
      row('113', 'R', 'node002'),
      row('114', 'R', 'node003')
    ]);

    // Nothing selected yet: no badge on either button.
    expect(
      getButton(/^Clear/).querySelector('.MuiBadge-badge')
    ).toBeNull();
    expect(
      getButton(/^Details/).querySelector('.MuiBadge-badge')
    ).toBeNull();

    const cb112 = await selectRowByName('job112');
    expect(getButton(/^Clear/).querySelector('.MuiBadge-badge')).toHaveTextContent(
      '1'
    );
    expect(
      getButton(/^Details/).querySelector('.MuiBadge-badge')
    ).toHaveTextContent('1');

    await selectRowByName('job113');
    expect(getButton(/^Clear/).querySelector('.MuiBadge-badge')).toHaveTextContent(
      '2'
    );
    expect(
      getButton(/^Details/).querySelector('.MuiBadge-badge')
    ).toHaveTextContent('2');

    await selectRowByName('job114');
    expect(getButton(/^Clear/).querySelector('.MuiBadge-badge')).toHaveTextContent(
      '3'
    );
    expect(
      getButton(/^Details/).querySelector('.MuiBadge-badge')
    ).toHaveTextContent('3');

    // Deselecting one row (real checkbox click) must decrement the count.
    await act(async () => {
      cb112.click();
      await new Promise(r => setTimeout(r, 20));
    });
    expect(getButton(/^Clear/).querySelector('.MuiBadge-badge')).toHaveTextContent(
      '2'
    );
    expect(
      getButton(/^Details/).querySelector('.MuiBadge-badge')
    ).toHaveTextContent('2');

    // Clicking "Clear" itself must drop the count/badge back to zero.
    await act(async () => {
      getButton(/^Clear/).click();
      await new Promise(r => setTimeout(r, 20));
    });
    expect(getButton(/^Clear/).querySelector('.MuiBadge-badge')).toBeNull();
    expect(getButton(/^Details/).querySelector('.MuiBadge-badge')).toBeNull();
  });

  test('badge count matches the full row count when selecting all via the header "select all" checkbox', async () => {
    await renderAndWaitForRows([
      row('115', 'R', 'node001'),
      row('116', 'R', 'node002'),
      row('117', 'PD', '(Priority)'),
      row('118', 'S', 'node003'),
      row('119', 'CD', 'None')
    ]);

    const headerCheckbox = document.querySelector(
      '.ag-header-cell input[type="checkbox"]'
    ) as HTMLInputElement;
    expect(headerCheckbox).toBeTruthy();

    await act(async () => {
      headerCheckbox.click();
      await new Promise(r => setTimeout(r, 20));
    });

    // All 5 rows selected via one header click -- the badge must reflect
    // the *actual* selected count, not just "some selected"/a boolean.
    expect(
      getButton(/^Clear/).querySelector('.MuiBadge-badge')
    ).toHaveTextContent('5');
    expect(
      getButton(/^Details/).querySelector('.MuiBadge-badge')
    ).toHaveTextContent('5');

    // Clicking the header checkbox again (now in the "all selected" state)
    // deselects everything -- the badge must disappear entirely, not show
    // "0".
    await act(async () => {
      headerCheckbox.click();
      await new Promise(r => setTimeout(r, 20));
    });
    expect(getButton(/^Clear/).querySelector('.MuiBadge-badge')).toBeNull();
    expect(getButton(/^Details/).querySelector('.MuiBadge-badge')).toBeNull();
  });

  test('badge count auto-decrements (without any click) when a selected job leaves the queue entirely, e.g. it completes', async () => {
    // Real Slurm's squeue output stops listing a job once it's fully
    // gone from the scheduler's active queue -- a selected job doing this
    // between refreshes must silently drop out of the count instead of
    // leaving a stale/inflated badge (or, worse, an action button enabled
    // for a job that no longer exists).
    let squeueCallCount = 0;
    mockRequestAPI.mockImplementation((async (endPoint = '') => {
      if (endPoint.startsWith('ui-config')) {
        return { success: true, data: { squeue_reload_limit_ms: 0 } };
      }
      if (endPoint.startsWith('squeue')) {
        squeueCallCount += 1;
        const rows =
          squeueCallCount === 1
            ? [row('120', 'R', 'node001'), row('121', 'R', 'node002')]
            : [row('121', 'R', 'node002')]; // job 120 completed and left the queue
        return { success: true, data: { columns: SQUEUE_COLUMNS, rows } };
      }
      throw new Error(`Unexpected endpoint: ${endPoint}`);
    }) as any);

    render(<SqueueDataTable {...baseProps()} />);
    await act(async () => {
      await new Promise(r => setTimeout(r, 100));
    });
    expect(document.querySelectorAll('.ag-row').length).toBe(2);

    await selectRowByName('job120');
    await selectRowByName('job121');
    expect(
      getButton(/^Clear/).querySelector('.MuiBadge-badge')
    ).toHaveTextContent('2');

    // Trigger a refresh (the manual Refresh button, since autoReload is
    // off in baseProps) that returns job 120 as gone.
    await act(async () => {
      getButton(/^Refresh$/).click();
    });
    await waitFor(
      () => {
        expect(squeueCallCount).toBe(2);
        expect(document.querySelectorAll('.ag-row').length).toBe(1);
      },
      { timeout: 3000 }
    );
    // Only job 121 remains selected/selectable -- the count must drop to
    // 1, not stay at 2 or disappear to 0.
    expect(
      getButton(/^Clear/).querySelector('.MuiBadge-badge')
    ).toHaveTextContent('1');
    expect(
      getButton(/^Details/).querySelector('.MuiBadge-badge')
    ).toHaveTextContent('1');
  });

  test('toggling "My jobs only" prunes an already-selected other-user job from the badge count', async () => {
    // Regression test for a real bug reported live on Perlmutter: the
    // Clear/Details badge showed "1" with no checkbox visibly ticked,
    // then jumped to "2" as soon as a real (own) job was selected.
    // Root cause: AG Grid's selection is independent of column filtering
    // -- selecting a job belonging to another user, then turning on "My
    // jobs only" (which filters that row out of view via the USER column
    // filter), left the row selected internally even though it was no
    // longer visible/checked anywhere on screen.
    await renderAndWaitForRows([
      row('122', 'R', 'node001', 'job122', 'bob'), // note: NOT the current user
      row('123', 'R', 'node002', 'job123', 'alice')
    ]);

    // Select bob's job (own-user filter isn't on yet, so it's visible).
    await selectRowByName('job122');
    expect(
      getButton(/^Clear/).querySelector('.MuiBadge-badge')
    ).toHaveTextContent('1');

    // Now flip on "My jobs only" -- bob's row (still selected) becomes
    // hidden. The badge must NOT keep counting it.
    const userOnlySwitch = Array.from(
      document.querySelectorAll('input[type="checkbox"]')
    ).find(cb => cb.closest('label')?.textContent?.includes('My jobs only'));
    expect(userOnlySwitch).toBeTruthy();
    await act(async () => {
      (userOnlySwitch as HTMLInputElement).click();
      await new Promise(r => setTimeout(r, 50));
    });

    expect(
      getButton(/^Clear/).querySelector('.MuiBadge-badge')
    ).toBeNull();
    expect(
      getButton(/^Details/).querySelector('.MuiBadge-badge')
    ).toBeNull();

    // Selecting alice's own (visible) job afterward must show exactly 1,
    // not 2 -- confirming bob's job didn't silently linger in the count.
    await selectRowByName('job123');
    expect(
      getButton(/^Clear/).querySelector('.MuiBadge-badge')
    ).toHaveTextContent('1');
  });
});
