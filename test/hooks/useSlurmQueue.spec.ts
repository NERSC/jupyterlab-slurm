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
  const rowNodes: Record<string, { setSelected: jest.Mock }> = {};
  for (const row of selected) {
    const jid = String(row.JOBID ?? row.jobid ?? '');
    if (jid) {
      rowNodes[jid] = { setSelected: jest.fn() };
    }
  }
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
    deselectAll: jest.fn(),
    getRowNode: jest.fn((id: string) => rowNodes[id]),
    _rowNodes: rowNodes
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

  test('canHoldSelected/canReleaseSelected reflect the selection\'s actual state', async () => {
    // Hold/Release are genuine no-ops on anything but a PENDING job -- real
    // Slurm returns exit code 0 for `scontrol hold`/`scontrol release` on a
    // RUNNING/COMPLETED job without actually changing its state, so the UI
    // must gate these actions on the selection's real ST, not just let the
    // backend's success response imply something happened.
    routeRequest({
      'ui-config': () => ({ success: true, data: {} }),
      squeue: () => defaultSqueue()
    });
    const { result } = renderHook(() => useSlurmQueue(makeProps()));
    await waitFor(() => expect(result.current.displayRows.length).toBe(2));

    // No selection at all: don't second-guess the user.
    expect(result.current.canHoldSelected).toBe(true);
    expect(result.current.canReleaseSelected).toBe(true);

    // A single PENDING ("PD") row selected, but NOT actually held
    // (Reason=(Priority), i.e. just waiting its turn): Hold is still
    // eligible (holding a plain pending job is meaningful), but Release is
    // NOT -- real Slurm's `scontrol release` is a silent no-op on a
    // non-held PD job, same as Hold is on a RUNNING one. `displayRows`
    // (not the raw `rows` string[][]) is the keyed-object shape AG Grid's
    // `getSelectedRows()` actually returns in production.
    act(() =>
      result.current.setSelectedRows([result.current.displayRows[1]])
    );
    expect(result.current.canHoldSelected).toBe(true);
    expect(result.current.canReleaseSelected).toBe(false);

    // A single RUNNING ("R") row selected: not eligible.
    act(() =>
      result.current.setSelectedRows([result.current.displayRows[0]])
    );
    expect(result.current.canHoldSelected).toBe(false);
    expect(result.current.canReleaseSelected).toBe(false);

    // Mixed selection (one PD, one R): not eligible, since Hold/Release
    // would be a no-op for at least one of the selected jobs.
    act(() =>
      result.current.setSelectedRows([
        result.current.displayRows[0],
        result.current.displayRows[1]
      ])
    );
    expect(result.current.canHoldSelected).toBe(false);
    expect(result.current.canReleaseSelected).toBe(false);
  });

  test('canReleaseSelected/hasAdminHoldSelected reflect an admin hold (e.g. after requeueing a suspended job)', async () => {
    // Real Slurm behavior, confirmed live: `scontrol requeue` on a
    // SUSPENDED job lands as PENDING with an *admin* hold --
    // NODELIST(REASON) = "(JobHeldAdmin)" -- which a regular user's
    // `scontrol release` always rejects with "Access/permission denied".
    // A plain PD check alone can't distinguish this from a normal
    // user-held ("(JobHeldUser)") job, so canReleaseSelected must also
    // consult the reason field.
    routeRequest({
      'ui-config': () => ({ success: true, data: {} }),
      squeue: () => ({
        success: true,
        data: {
          columns: SQUEUE_COLUMNS,
          rows: [
            [
              '201',
              'debug',
              'jobAdminHeld',
              'testuser',
              'PD',
              '0:00',
              '1',
              '(JobHeldAdmin)'
            ],
            [
              '202',
              'debug',
              'jobUserHeld',
              'testuser',
              'PD',
              '0:00',
              '1',
              '(JobHeldUser)'
            ]
          ]
        }
      })
    });
    const { result } = renderHook(() => useSlurmQueue(makeProps()));
    await waitFor(() => expect(result.current.displayRows.length).toBe(2));

    // Admin-held job selected: Release must be disabled, and the
    // admin-hold flag surfaced so the toolbar can show a clearer tooltip
    // than a generic "not eligible" message.
    act(() =>
      result.current.setSelectedRows([result.current.displayRows[0]])
    );
    expect(result.current.canReleaseSelected).toBe(false);
    expect(result.current.hasAdminHoldSelected).toBe(true);

    // A plain user-held ("(JobHeldUser)") PD job remains a normal,
    // fully-eligible Release target.
    act(() =>
      result.current.setSelectedRows([result.current.displayRows[1]])
    );
    expect(result.current.canReleaseSelected).toBe(true);
    expect(result.current.hasAdminHoldSelected).toBe(false);
  });

  test('canSuspendSelected/canResumeSelected reflect the selection\'s actual state', async () => {
    // Suspend only applies to a RUNNING job, Resume only to a suspended
    // ("S") one -- mirrors canHoldSelected/canReleaseSelected's PD-gating.
    routeRequest({
      'ui-config': () => ({ success: true, data: {} }),
      squeue: () => defaultSqueue()
    });
    const { result } = renderHook(() => useSlurmQueue(makeProps()));
    await waitFor(() => expect(result.current.displayRows.length).toBe(2));

    // No selection: don't second-guess the user.
    expect(result.current.canSuspendSelected).toBe(true);
    expect(result.current.canResumeSelected).toBe(true);

    // A single RUNNING ("R") row selected: Suspend eligible, Resume not.
    act(() =>
      result.current.setSelectedRows([result.current.displayRows[0]])
    );
    expect(result.current.canSuspendSelected).toBe(true);
    expect(result.current.canResumeSelected).toBe(false);

    // A single PENDING ("PD") row selected: neither is eligible.
    act(() =>
      result.current.setSelectedRows([result.current.displayRows[1]])
    );
    expect(result.current.canSuspendSelected).toBe(false);
    expect(result.current.canResumeSelected).toBe(false);
  });

  test('canRequeueSelected requires at least one R/S row, and is false for an all-PENDING selection', async () => {
    // Real Slurm rejects `scontrol requeue` on a job that's already
    // PENDING (even a held one) with "Job is pending execution for job
    // <id>" -- confirmed live against the Docker cluster. Like Pause/
    // Resume, this is an "at least one applicable row" gate, not an
    // "every row must qualify" one: `handleJobAction` scopes the actual
    // `requeue`/`requeuehold` call to only R/S rows, so a mixed selection
    // should still enable the button via its R/S row(s), while an
    // all-PENDING selection has nothing for it to apply to.
    routeRequest({
      'ui-config': () => ({ success: true, data: {} }),
      squeue: () => defaultSqueue()
    });
    const { result } = renderHook(() => useSlurmQueue(makeProps()));
    await waitFor(() => expect(result.current.displayRows.length).toBe(2));

    // No selection: don't second-guess the user.
    expect(result.current.canRequeueSelected).toBe(true);

    // A single RUNNING ("R") row selected: Requeue is eligible.
    act(() =>
      result.current.setSelectedRows([result.current.displayRows[0]])
    );
    expect(result.current.canRequeueSelected).toBe(true);

    // A single PENDING ("PD") row selected, with no R/S row at all:
    // Requeue is not eligible.
    act(() =>
      result.current.setSelectedRows([result.current.displayRows[1]])
    );
    expect(result.current.canRequeueSelected).toBe(false);

    // Mixed selection including a PENDING job alongside a RUNNING one:
    // still eligible, via the RUNNING row -- `requeueApplicableCount`
    // (not tested here) reflects that only 1 of the 2 selected rows
    // actually applies.
    act(() =>
      result.current.setSelectedRows([
        result.current.displayRows[0],
        result.current.displayRows[1]
      ])
    );
    expect(result.current.canRequeueSelected).toBe(true);
  });

  test('hasSuspendedSelected reflects whether any selected job is SUSPENDED', async () => {
    // Requeuing a SUSPENDED job lands it on an admin-only hold (see the
    // hasAdminHoldSelected test above) that the user can't undo -- the
    // toolbar uses this flag to warn/confirm before firing Requeue.
    routeRequest({
      'ui-config': () => ({ success: true, data: {} }),
      squeue: () => ({
        success: true,
        data: {
          columns: SQUEUE_COLUMNS,
          rows: [
            ['301', 'debug', 'jobSuspended', 'testuser', 'S', '0:00', '1', ''],
            ['302', 'debug', 'jobRunning', 'testuser', 'R', '0:00', '1', '']
          ]
        }
      })
    });
    const { result } = renderHook(() => useSlurmQueue(makeProps()));
    await waitFor(() => expect(result.current.displayRows.length).toBe(2));

    // No selection: don't flag a warning.
    expect(result.current.hasSuspendedSelected).toBe(false);

    // Suspended job selected: flag should be true.
    act(() =>
      result.current.setSelectedRows([result.current.displayRows[0]])
    );
    expect(result.current.hasSuspendedSelected).toBe(true);

    // A plain RUNNING job selected: flag should be false.
    act(() =>
      result.current.setSelectedRows([result.current.displayRows[1]])
    );
    expect(result.current.hasSuspendedSelected).toBe(false);

    // Mixed selection including a suspended job: flag should be true.
    act(() =>
      result.current.setSelectedRows([
        result.current.displayRows[0],
        result.current.displayRows[1]
      ])
    );
    expect(result.current.hasSuspendedSelected).toBe(true);
  });

  test('hasGroupedArrayRangeSelected flags a grouped array-range row (e.g. "301_[3-20%4]")', async () => {
    // squeue collapses multiple still-pending array tasks sharing a
    // throttle limit into a single grouped-range row. `/job/{id}` can't
    // resolve that form (real Slurm returns "Invalid job_id" for it), so
    // "Show Details" must be disabled whenever one is selected.
    routeRequest({
      'ui-config': () => ({ success: true, data: {} }),
      squeue: () => ({
        success: true,
        data: {
          columns: SQUEUE_COLUMNS,
          rows: [
            [
              '301_[3-20%4]',
              'debug',
              'jobArray',
              'testuser',
              'PD',
              '0:00',
              '1',
              '(JobArrayTaskLimit)'
            ],
            ['302', 'debug', 'jobPlain', 'testuser', 'R', '0:00', '1', '']
          ]
        }
      })
    });
    const { result } = renderHook(() => useSlurmQueue(makeProps()));
    await waitFor(() => expect(result.current.displayRows.length).toBe(2));

    expect(result.current.hasGroupedArrayRangeSelected).toBe(false);

    act(() =>
      result.current.setSelectedRows([result.current.displayRows[0]])
    );
    expect(result.current.hasGroupedArrayRangeSelected).toBe(true);

    act(() =>
      result.current.setSelectedRows([result.current.displayRows[1]])
    );
    expect(result.current.hasGroupedArrayRangeSelected).toBe(false);

    act(() =>
      result.current.setSelectedRows([
        result.current.displayRows[0],
        result.current.displayRows[1]
      ])
    );
    expect(result.current.hasGroupedArrayRangeSelected).toBe(true);
  });

  test('selected rows stay in sync with fresh queue data without requiring reselection', async () => {
    // AG Grid's selectionChanged event only fires when the set of selected
    // row IDs changes, not on a plain data refresh -- so `selectedRows`
    // must be re-derived from the latest `displayRows` on every fetch,
    // otherwise button eligibility (e.g. canHoldSelected) stays stuck on
    // whatever ST value was true at the moment of selection.
    let squeueCallCount = 0;
    routeRequest({
      // A manual reload() call goes through the same `reloadLimitMs`
      // throttle as the refresh button (see `getData(reloadLimitMs)`);
      // disable it here so the second fetch isn't silently skipped.
      'ui-config': () => ({
        success: true,
        data: { squeue_reload_limit_ms: 0 }
      }),
      squeue: () => {
        squeueCallCount += 1;
        return {
          success: true,
          data: {
            columns: SQUEUE_COLUMNS,
            rows: [
              [
                '102',
                'regular',
                'jobB',
                'otheruser',
                // First fetch: PD (Hold-eligible). Second fetch: released
                // back to R (no longer Hold-eligible), simulating a
                // Release action landing without the row being deselected.
                squeueCallCount === 1 ? 'PD' : 'R',
                '0:00',
                '1',
                '(Priority)'
              ]
            ]
          }
        };
      }
    });
    const { result } = renderHook(() => useSlurmQueue(makeProps()));
    await waitFor(() => expect(result.current.displayRows.length).toBe(1));

    act(() =>
      result.current.setSelectedRows([result.current.displayRows[0]])
    );
    expect(result.current.canHoldSelected).toBe(true);

    act(() => result.current.reload());
    await waitFor(() => expect(squeueCallCount).toBe(2));
    await waitFor(() =>
      expect(result.current.displayRows[0].ST).toBe('R')
    );

    // Without reselecting anything, the selection's derived eligibility
    // should now reflect the job's new ("R") state.
    await waitFor(() => expect(result.current.canHoldSelected).toBe(false));
    expect(result.current.selectedRows[0].ST).toBe('R');
  });

  test('pinnedRowIds snapshots the selection once per refresh, not live on every selection change', async () => {
    routeRequest({
      'ui-config': () => ({
        success: true,
        data: { squeue_reload_limit_ms: 0 }
      }),
      squeue: () => defaultSqueue()
    });
    const { result } = renderHook(() => useSlurmQueue(makeProps()));
    await waitFor(() => expect(result.current.displayRows.length).toBe(2));

    // No selection yet -- nothing pinned.
    expect(result.current.pinnedRowIds).toEqual([]);

    // Selecting a row does NOT immediately pin it -- pinning is a snapshot
    // taken at refresh time, not a live derivation of selectedRows. This
    // avoids a row visibly jumping to the top the instant it's clicked,
    // which would be disorienting for a user paging through a large list.
    act(() =>
      result.current.setSelectedRows([result.current.displayRows[0]])
    );
    expect(result.current.pinnedRowIds).toEqual([]);

    // Once the next refresh lands, the pin set is (re)computed from the
    // selection as it stood at that moment.
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.pinnedRowIds).toEqual(['101']));
  });

  test('pinnedRowIds and selectedRows are pruned once a selected job leaves the queue entirely', async () => {
    // A job that completes/is cancelled disappears from squeue's output
    // entirely; any stale reference to it must be dropped from both
    // selectedRows and pinnedRowIds so neither accumulates dangling IDs
    // (which could otherwise incorrectly apply to a future job that
    // happens to reuse the same numeric ID).
    let squeueCallCount = 0;
    routeRequest({
      'ui-config': () => ({
        success: true,
        data: { squeue_reload_limit_ms: 0 }
      }),
      squeue: () => {
        squeueCallCount += 1;
        return {
          success: true,
          data: {
            columns: SQUEUE_COLUMNS,
            rows:
              squeueCallCount <= 2
                ? [
                    [
                      '101',
                      'debug',
                      'jobA',
                      'testuser',
                      'R',
                      '0:10',
                      '1',
                      'node001'
                    ]
                  ]
                : [] // job 101 completed and left the queue
          }
        };
      }
    });
    const { result } = renderHook(() => useSlurmQueue(makeProps()));
    await waitFor(() => expect(result.current.displayRows.length).toBe(1));

    act(() =>
      result.current.setSelectedRows([result.current.displayRows[0]])
    );
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.pinnedRowIds).toEqual(['101']));

    // Next refresh: job 101 has left the queue entirely.
    act(() => result.current.reload());
    await waitFor(() => expect(squeueCallCount).toBe(3));
    await waitFor(() => expect(result.current.selectedRows).toEqual([]));
    expect(result.current.pinnedRowIds).toEqual([]);
  });

  test('onSelectionChanged ignores rowDataChanged-sourced events so pinning a row does not wipe out its selection', async () => {
    // Regression test for: selecting a row, then having it become pinned
    // to the top on the next refresh, appeared to silently deselect the
    // checkbox -- and a second refresh made it look fully deselected. Root
    // cause: AG Grid recreates a row's node when it moves between the main
    // `rowData` and `pinnedTopRowData` sections, and fires a spurious
    // `selectionChanged` event (source: 'rowDataChanged') reporting it as
    // unselected. Our handler must ignore that source so it doesn't
    // clobber `selectedRows` -- real selection content changes across
    // refreshes are already handled by the displayRows-sync effect.
    routeRequest({
      'ui-config': () => ({
        success: true,
        data: { squeue_reload_limit_ms: 0 }
      }),
      squeue: () => defaultSqueue()
    });
    const { result } = renderHook(() => useSlurmQueue(makeProps()));
    await waitFor(() => expect(result.current.displayRows.length).toBe(2));

    act(() =>
      result.current.setSelectedRows([result.current.displayRows[0]])
    );
    expect(result.current.selectedRows.length).toBe(1);

    // Simulate AG Grid's spurious event fired when the row is recreated
    // due to a data/pinning change -- e.g. via a fake gridApi that reports
    // zero selected rows.
    (result.current.gridApiRef as any).current = {
      getSelectedRows: () => []
    };
    act(() =>
      result.current.onSelectionChanged({ source: 'rowDataChanged' } as any)
    );

    // Selection must be untouched by the spurious event.
    expect(result.current.selectedRows.length).toBe(1);

    // A genuine user-driven selection change (any other source) should
    // still update selectedRows as before.
    act(() =>
      result.current.onSelectionChanged({ source: 'rowClicked' } as any)
    );
    expect(result.current.selectedRows).toEqual([]);
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

  test('a failed squeue fetch (e.g. Slurm controller unreachable) still reschedules the next auto-refresh and surfaces an error toast', async () => {
    // Regression test for scenario 11: previously the catch() branch in
    // getData() only cleared `loading`, leaving `nextAvailableSqueueFetch`
    // pointing at a time already in the past -- the "Next refresh" pie
    // timer/countdown would then freeze at 0s and auto-reload would never
    // fire again. It should reschedule just like the success path, and
    // also surface the failure via the existing error Snackbar mechanism
    // instead of only logging to the console.
    routeRequest({
      'ui-config': () => ({ success: true, data: {} }),
      squeue: () => {
        throw new Error(
          'slurm_load_jobs error: Unable to contact slurm controller (connect failure)'
        );
      }
    });

    const { result } = renderHook(() =>
      useSlurmQueue(makeProps({ autoReload: true, reloadRate: 60 }))
    );

    await waitFor(() => expect(result.current.errorOpen).toBe(true));
    expect(result.current.errorMessage).toContain(
      'Failed to refresh job queue'
    );
    // Rescheduled into the future rather than left null/in the past.
    expect(result.current.nextAvailableSqueueFetch).not.toBeNull();
    expect(
      (result.current.nextAvailableSqueueFetch as Date).getTime()
    ).toBeGreaterThan(Date.now());
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

  test('handleJobAction("hold"/"suspend") each filter a mixed PD+R selection down to their own applicable rows', async () => {
    // Regression test: a "select all" spanning a throttled array job's
    // pending tail alongside its (and other) already-running tasks (see
    // scenario 5) previously disabled Pause entirely, since Hold only
    // applies to PD and Suspend only to R. The toolbar now fires both
    // `hold` and `suspend`, each of which must only ever be sent the rows
    // it's actually valid for.
    const holdBodies: any[] = [];
    const suspendBodies: any[] = [];
    routeRequest({
      'ui-config': () => ({ success: true, data: {} }),
      squeue: () => defaultSqueue(),
      'scontrol/hold': (_e, init) => {
        holdBodies.push(JSON.parse(init.body));
        return { success: true, data: { changedIds: ['102'] } };
      },
      'scontrol/suspend': (_e, init) => {
        suspendBodies.push(JSON.parse(init.body));
        return { success: true, data: { changedIds: ['101'] } };
      }
    });

    const { result } = renderHook(() => useSlurmQueue(makeProps()));
    await waitFor(() => expect(result.current.displayRows.length).toBe(2));

    // displayRows[0] is JOBID 101 (ST=R), displayRows[1] is JOBID 102
    // (ST=PD) -- select both, mimicking a "select all" on a mixed queue.
    act(() =>
      result.current.setSelectedRows([
        result.current.displayRows[0],
        result.current.displayRows[1]
      ])
    );
    expect(result.current.hasPdSelected).toBe(true);
    expect(result.current.hasRSelected).toBe(true);

    await act(async () => {
      await result.current.handleJobAction('hold');
    });
    await act(async () => {
      await result.current.handleJobAction('suspend');
    });

    expect(holdBodies[0]).toEqual({ job_ids: ['102'] });
    expect(suspendBodies[0]).toEqual({ job_ids: ['101'] });
  });

  test('notifyOnStateChange only notifies for the current user\'s own jobs', async () => {
    // Both jobA (testuser) and jobB (otheruser) change state between the
    // first and second fetch, but only the current user's own job should
    // trigger a notification -- the queue can include jobs from every user
    // on the cluster, independent of the separate `userOnly` grid filter,
    // and notifying on other users' state changes would be noisy and
    // unrequested.
    let squeueCallCount = 0;
    routeRequest({
      'ui-config': () => ({
        success: true,
        data: { squeue_reload_limit_ms: 0 }
      }),
      squeue: () => {
        squeueCallCount += 1;
        const stateA = squeueCallCount === 1 ? 'R' : 'CD';
        const stateB = squeueCallCount === 1 ? 'PD' : 'R';
        return {
          success: true,
          data: {
            columns: SQUEUE_COLUMNS,
            rows: [
              ['101', 'debug', 'jobA', 'testuser', stateA, '0:10', '1', 'node001'],
              ['102', 'regular', 'jobB', 'otheruser', stateB, '0:00', '1', '(Priority)']
            ]
          }
        };
      }
    });
    mockNotificationInfo.mockClear();
    const { result } = renderHook(() =>
      useSlurmQueue(makeProps({ notifyOnStateChange: true }))
    );
    await waitFor(() => expect(result.current.displayRows.length).toBe(2));

    act(() => result.current.reload());
    await waitFor(() => expect(squeueCallCount).toBe(2));

    // Only job 101 (testuser's) should have triggered a notification;
    // job 102 (otheruser's) also changed state (PD -> R) but must not.
    await waitFor(() => expect(mockNotificationInfo).toHaveBeenCalledTimes(1));
    expect(mockNotificationInfo.mock.calls[0][0]).toContain('101');
    expect(
      mockNotificationInfo.mock.calls.some(call => call[0].includes('102'))
    ).toBe(false);
  });

  test('notifyOnStateChange uses the same human-readable status text as the queue/details/history (not raw codes)', async () => {
    // The raw ST codes ("R", "PD", "CD"...) are never shown anywhere else
    // in the UI -- the queue table, job details, and job history all
    // translate them via JOB_STATUS_CODES (e.g. "R" -> "RUNNING"), and a
    // held PENDING job additionally shows "(Held)". The notification text
    // must match that, not surface the raw codes.
    let squeueCallCount = 0;
    routeRequest({
      'ui-config': () => ({
        success: true,
        data: { squeue_reload_limit_ms: 0 }
      }),
      squeue: () => {
        squeueCallCount += 1;
        const rows =
          squeueCallCount === 1
            ? [
                [
                  '201',
                  'debug',
                  'jobA',
                  'testuser',
                  'PD',
                  '0:00',
                  '1',
                  '(Priority)'
                ],
                [
                  '202',
                  'debug',
                  'jobB',
                  'testuser',
                  'R',
                  '0:10',
                  '1',
                  'node001'
                ]
              ]
            : [
                [
                  '201',
                  'debug',
                  'jobA',
                  'testuser',
                  'PD',
                  '0:00',
                  '1',
                  '(JobHeldUser)'
                ], // stayed PD, but became held
                [
                  '202',
                  'debug',
                  'jobB',
                  'testuser',
                  'CD',
                  '0:12',
                  '1',
                  'None'
                ]
              ];
        return {
          success: true,
          data: { columns: SQUEUE_COLUMNS, rows }
        };
      }
    });
    mockNotificationInfo.mockClear();
    const { result } = renderHook(() =>
      useSlurmQueue(makeProps({ notifyOnStateChange: true }))
    );
    await waitFor(() => expect(result.current.displayRows.length).toBe(2));

    act(() => result.current.reload());
    await waitFor(() => expect(squeueCallCount).toBe(2));

    await waitFor(() =>
      expect(mockNotificationInfo).toHaveBeenCalledTimes(2)
    );
    const messages = mockNotificationInfo.mock.calls.map(call => call[0]);

    // job202: RUNNING -> COMPLETED, in plain English, not "R" -> "CD".
    expect(
      messages.some(
        m => m.includes('202') && /RUNNING.*COMPLETED/.test(m)
      )
    ).toBe(true);
    // job201: same raw code (PD) both times, but became held -- must
    // still notify, and must render as "PENDING" -> "PENDING (Held)".
    expect(
      messages.some(
        m =>
          m.includes('201') &&
          m.includes('PENDING (Held)') &&
          !/PENDING \(Held\).*PENDING \(Held\)/.test(m)
      )
    ).toBe(true);
    // No raw codes anywhere in the notification text.
    for (const m of messages) {
      expect(m).not.toMatch(/\bPD\b|\bCD\b/);
    }
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
      await result.current.handleJobAction('cancel');
    });

    // Cancel scopes to the entire selection (unlike requeue), so the acted-on
    // row's node is individually deselected -- not a blanket `deselectAll()`,
    // which would also clear rows unrelated to this action (see the
    // "only deselects the row(s) actually acted on" test below).
    expect(api._rowNodes['101'].setSelected).toHaveBeenCalledWith(false);
    await waitFor(() => expect(result.current.selectedRows).toHaveLength(0));
    expect(result.current.errorOpen).toBe(false);
  });

  test('a successful requeue only deselects the row(s) it actually acted on, not the entire original selection', async () => {
    // Regression test for a real bug reported live: selecting 20 jobs and
    // firing Requeue (only 1 of them R/S-eligible, the other 19 PENDING and
    // thus skipped by `handleJobAction`'s row filter) deselected all 20,
    // even though only the 1 eligible job was actually requeued.
    routeRequest({
      'ui-config': () => ({ success: true, data: {} }),
      squeue: () => ({
        success: true,
        data: {
          columns: SQUEUE_COLUMNS,
          rows: [
            ['101', 'debug', 'jobR', 'testuser', 'R', '0:10', '1', 'node001'],
            ['102', 'debug', 'jobPD', 'testuser', 'PD', '0:00', '1', '(Priority)']
          ]
        }
      }),
      'scontrol/requeue': () => ({ success: true })
    });

    const { result } = renderHook(() => useSlurmQueue(makeProps()));
    await waitFor(() => expect(result.current.rows.length).toBe(2));

    // Both the RUNNING and the plain PENDING job are selected -- only the
    // RUNNING one is actually eligible for requeue. Full row shape
    // (including ST/NODELIST(REASON)) is required here, matching what
    // AG Grid's real `getSelectedRows()` returns -- a row missing the
    // status field entirely would hit `handleJobAction`'s "don't
    // second-guess" fallback and incorrectly pass every row through.
    const api = makeFakeGridApi([
      { JOBID: '101', ST: 'R', 'NODELIST(REASON)': 'node001' },
      { JOBID: '102', ST: 'PD', 'NODELIST(REASON)': '(Priority)' }
    ]);
    result.current.gridApiRef.current = api;
    act(() => result.current.onSelectionChanged({} as any));
    expect(result.current.selectedRows).toHaveLength(2);

    await act(async () => {
      await result.current.handleJobAction('requeue');
    });

    // Only job 101's row node was deselected -- job 102's must be untouched.
    expect(api._rowNodes['101'].setSelected).toHaveBeenCalledWith(false);
    expect(api._rowNodes['102'].setSelected).not.toHaveBeenCalled();
    expect(api.deselectAll).not.toHaveBeenCalled();

    // React's selectedRows must reflect the same: 102 remains selected.
    await waitFor(() => expect(result.current.selectedRows).toHaveLength(1));
    expect(String(result.current.selectedRows[0]['JOBID'])).toBe('102');
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
      await result.current.handleJobAction('cancel');
    });

    await waitFor(() => expect(result.current.errorOpen).toBe(true));
    // The message must include the affected job id(s), the backend's
    // errorMessage detail, and a timestamp — not just the raw errorMessage.
    expect(result.current.errorMessage).toContain('101');
    expect(result.current.errorMessage).toContain('permission denied');
    expect(result.current.errorMessage).toMatch(/cancel/);
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

    // `setColumnFilterModel` is async (AG Grid v33+ semantics) and must be
    // awaited before `onFilterChanged()`; await the returned promise here so
    // the test doesn't leave a dangling microtask that resolves during a
    // later, unrelated test.
    await act(async () => {
      await result.current.reapplyGridFilters();
    });
    expect(api.setColumnFilterModel).toHaveBeenCalledWith('USER', {
      filterType: 'text',
      type: 'equals',
      filter: 'testuser'
    });

    const callsAfterFirst = api.setColumnFilterModel.mock.calls.length;
    // Second call with the model already in the desired state must be a no-op
    // (this protects an open column-filter dropdown from being reset).
    await act(async () => {
      await result.current.reapplyGridFilters();
    });
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

    await act(async () => {
      await result.current.reapplyGridFilters();
    });
    expect(api.setColumnFilterModel).toHaveBeenCalledWith('USER', null);
  });
});
