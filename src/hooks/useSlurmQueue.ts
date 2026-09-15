import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { requestAPI } from '../handler';
import { JobAction, ISlurmWidgetProps } from '../types';
import { PLUGIN_ID } from '../index';
import { SelectionChangedEvent } from 'ag-grid-community';
import {
  isGroupedArrayRangeJobId,
  truncateForToast
} from '../utils/slurm-parsing';
import {
  isHeldReason,
  isAdminHeldReason,
  formatJobStatus
} from '../utils/slurm-column-defs';
// Import from the package root (not a deep `lib/...` path), see
// SqueueDataTable.tsx for why: it keeps the module-federation-shared
// `Notification.manager` singleton in sync with the running shell's toasts.
import { Notification } from '@jupyterlab/apputils';

export function useSlurmQueue(props: ISlurmWidgetProps) {
  const [rows, setRows] = useState<string[][]>([]);
  const [serverColumns, setServerColumns] = useState<string[]>([]);
  const [uiLabels, setUiLabels] = useState<Record<string, string>>({});
  const [uiSizing, setUiSizing] = useState<Record<string, any>>({});
  const [selectedRows, setSelectedRows] = useState<any[]>([]);
  // Snapshot of selected job IDs that should render pinned to the top of
  // the grid. Recomputed exactly once per successful `squeue` refresh (see
  // the effect below), never as a live/reactive derivation of
  // `selectedRows` -- otherwise a row would visibly jump to the top the
  // instant it's clicked, which is disorienting for a user paging through a
  // large job list. Between refreshes, selecting/deselecting rows only
  // updates `selectedRows`; the pinned set (and thus row position) stays
  // exactly as it was until the next refresh lands.
  const [pinnedRowIds, setPinnedRowIds] = useState<string[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [lastSqueueFetch, setLastSqueueFetch] = useState(
    new Date('1970-01-01')
  );
  const [nextAvailableSqueueFetch, setNextAvailableSqueueFetch] =
    useState<Date | null>(null);
  const [autoReload, setAutoReload] = useState<boolean>(props.autoReload);
  const reloadRate = props.reloadRate * 1000;
  // When the queue tab is kept mounted but hidden, `active` is false and we
  // pause background polling / initial fetches. Defaults to true when omitted.
  const active = props.active !== false;
  const [reloadQueue, setReloadQueue] = useState(false);
  // Mirrors the effect below: the manual Refresh button should start
  // enabled whenever auto-reload starts off (it's the only way to fetch in
  // that case), and disabled while auto-reload starts on (button hidden).
  const [disableManualRefresh, setDisableManualRefresh] = useState(
    props.autoReload
  );
  const [reloadLimitMs, setReloadLimitMs] = useState<number>(5000);
  const [userOnly, setUserOnly] = useState(props.userOnly);
  const [loading, setLoading] = useState(false);
  const [displayRows, setDisplayRows] = useState<Record<string, unknown>[]>([]);
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successOpen, setSuccessOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const gridApiRef = useRef<any>(null);
  const intervalIdRef = useRef<any>(null);
  // Job IDs awaiting a "flash" highlight once the next queue refresh lands
  // (used instead of a success Snackbar for Hold/Release, since the row is
  // still present afterward and can be highlighted directly).
  const pendingFlashJobIdsRef = useRef<string[] | null>(null);
  // Last-seen state (e.g. "R"/"PD"/"CD") per job ID, used to detect changes
  // for `notifyOnStateChange`. `null` means "not initialized yet" so we skip
  // notifying on the very first fetch (every job would otherwise appear to
  // have "changed" from nothing).
  const prevJobStatesRef = useRef<Record<
    string,
    { code: string; reason: unknown }
  > | null>(null);
  // Debounce timer for persisting ag-grid column state (order/width/
  // visibility/pinning) to the settings registry; column drags/resizes fire
  // many events in quick succession, so we coalesce them into one write.
  const columnStateSaveTimerRef = useRef<any>(null);

  const jobIDLabel = useMemo(() => {
    return serverColumns.includes('JOBID')
      ? 'JOBID'
      : serverColumns.length > 0
        ? serverColumns[0]
        : 'JOBID';
  }, [serverColumns]);

  // Helper: re-apply grid filters
  //
  // This runs on data refreshes, resizes and remounts. It must be idempotent:
  // if the USER filter is already in the desired state we return early WITHOUT
  // calling setColumnFilterModel / onFilterChanged. Re-applying the model and
  // firing onFilterChanged unconditionally would disturb (reset/close) any
  // column-filter dropdown the user currently has open, making it impossible
  // to pick a value while auto-refresh is running.
  const reapplyGridFilters = useCallback(async () => {
    const api = gridApiRef.current;
    if (!api) {
      return;
    }
    // The grid may have been destroyed (e.g. remounted via gridKey, or unmounted
    // on tab switch) while a deferred call is still pending. Guard against
    // calling into a destroyed grid, which logs AG Grid error #26.
    if (typeof api.isDestroyed === 'function' && api.isDestroyed()) {
      return;
    }
    try {
      const desired = userOnly
        ? {
            filterType: 'text',
            type: 'equals',
            filter: props.userName
          }
        : null;
      const current = api.getColumnFilterModel
        ? api.getColumnFilterModel('USER')
        : undefined;
      // Only touch the grid when the USER filter actually needs to change.
      if (JSON.stringify(current ?? null) === JSON.stringify(desired)) {
        return;
      }
      // `setColumnFilterModel` is asynchronous (AG Grid v33+) -- its Promise
      // must resolve *before* `onFilterChanged()` is called, or the grid may
      // re-run filtering against a not-yet-applied/partial model (per AG
      // Grid's own docs: "Must wait on the response before calling
      // api.onFilterChanged()"). Calling both back-to-back synchronously was
      // a real race that could leave "My jobs only" showing zero rows even
      // for a user with real jobs in the queue, since the equals-filter
      // value wasn't guaranteed to be in place yet when filtering re-ran.
      await api.setColumnFilterModel('USER', desired);
      if (api.onFilterChanged) {
        api.onFilterChanged();
      }
    } catch (e) {
      /* no-op */
    }
  }, [userOnly, props.userName]);

  // Re-apply grid filters whenever filterQuery or userOnly changes
  useEffect(() => {
    reapplyGridFilters();
  }, [reapplyGridFilters]);

  // Turning "My jobs only" ON hides every other user's rows via the USER
  // column filter above, but AG Grid's selection state is independent of
  // filtering -- a row that was already selected before the toggle stays
  // selected (and keeps counting toward the Clear/Details badge) even
  // though it's no longer visible/checked anywhere on screen. Confirmed
  // live: this is exactly what produced a "Clear (1)"/"Details (1)" badge
  // with no checkbox visibly ticked, jumping to 2 as soon as a real,
  // currently-visible job was selected. Prune any now-hidden (other
  // user's) row out of the selection the moment userOnly flips on, so the
  // badge only ever reflects rows the user can actually see/interact with.
  useEffect(() => {
    if (!userOnly) {
      return;
    }
    const hasUserField = serverColumns.includes('USER');
    if (!hasUserField) {
      return;
    }
    const hidden = selectedRows.filter(
      row => String(row['USER']) !== props.userName
    );
    if (hidden.length === 0) {
      return;
    }
    // Deselect the underlying grid row node(s) directly first -- our
    // React `selectedRows` state is kept in sync with AG Grid's own
    // `onSelectionChanged` events, so this naturally updates
    // `selectedRows` too via that callback (pruning React state alone,
    // without touching the grid's internal selection, would let a later
    // toggle back to "all jobs" re-reveal the row still showing as
    // checked, even though it no longer counted toward the badge).
    const api = gridApiRef.current;
    if (api && !(typeof api.isDestroyed === 'function' && api.isDestroyed())) {
      try {
        for (const row of hidden) {
          const node = api.getRowNode(String(row[jobIDLabel]));
          if (node) {
            node.setSelected(false);
          }
        }
      } catch (e) {
        /* no-op */
      }
    }
    // Belt-and-suspenders: if the grid API isn't available (e.g. this
    // fires before the grid is ready), still prune React state directly
    // so the badge is never wrong even without a live grid to sync from.
    setSelectedRows(prev =>
      prev.filter(row => String(row['USER']) === props.userName)
    );
  }, [userOnly, serverColumns, props.userName, jobIDLabel, selectedRows]);

  const sizeColumnsToFitSafe = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) {
      return;
    }
    if (typeof api.isDestroyed === 'function' && api.isDestroyed()) {
      return;
    }
    try {
      reapplyGridFilters();
      const sz = api.getGridSize ? api.getGridSize() : null;
      if (!sz || sz.width > 0) {
        api.sizeColumnsToFit();
      }
    } catch (e) {
      /* no-op */
    }
  }, [reapplyGridFilters]);

  // Fetch UI config
  useEffect(() => {
    (async () => {
      try {
        const resp = await requestAPI<any>('ui-config');
        if (resp && resp.success && resp.data) {
          const labels = resp.data.queue_column_labels || {};
          const sizing = resp.data.queue_column_sizing || {};
          setUiLabels(labels);
          setUiSizing(sizing);
          if (typeof resp.data.squeue_reload_limit_ms === 'number') {
            setReloadLimitMs(resp.data.squeue_reload_limit_ms);
          }
        }
      } catch (e) {
        console.warn('Failed to load /ui-config', e);
      }
    })();
  }, []);

  // Data fetching
  const getData = useCallback(
    async (rateLimit = 0) => {
      if (loading) {
        return;
      }
      if (rateLimit > 0) {
        const delta = Number(new Date()) - Number(lastSqueueFetch);
        if (delta < rateLimit) {
          return;
        }
      }

      setLoading(true);
      try {
        const data = await requestAPI<any>('squeue');
        const current = new Date();
        setLastSqueueFetch(current);
        setNextAvailableSqueueFetch(
          autoReload ? new Date(current.getTime() + reloadRate) : null
        );
        setLoading(false);
        const newRows = data?.data?.rows ?? [];
        const newCols = data?.data?.columns ?? [];
        setRows(newRows.slice());
        setServerColumns(newCols.slice());
        sizeColumnsToFitSafe();
      } catch (error) {
        console.error('Squeue fetch error', error);
        setLoading(false);
        // Even on failure (e.g. squeue error 500 when the Slurm controller
        // is unreachable), reschedule the next auto-refresh attempt just
        // like the success path does. Without this, `nextAvailableSqueueFetch`
        // is left pointing at a time that's already passed, so the "Next
        // refresh" pie timer/countdown freezes at 0s and auto-reload never
        // fires again until the tab is remounted or the user manually
        // refreshes.
        const current = new Date();
        setNextAvailableSqueueFetch(
          autoReload ? new Date(current.getTime() + reloadRate) : null
        );
        const message = error instanceof Error ? error.message : String(error);
        setErrorMessage(
          `Failed to refresh job queue: ${truncateForToast(message)} (${current.toLocaleTimeString()})`
        );
        setErrorOpen(true);
      }
    },
    [loading, lastSqueueFetch, autoReload, reloadRate, sizeColumnsToFitSafe]
  );

  // Re-apply grid filters after rows/columns update (e.g., after the queue tab
  // remounts and the first data load populates the USER column). Without this,
  // the "my jobs only" filter would only take effect on the next refresh.
  useEffect(() => {
    reapplyGridFilters();
  }, [displayRows, reapplyGridFilters]);

  useEffect(() => {
    // Only fetch while this tab is active. This keeps a hidden (but mounted)
    // queue from firing squeue in the background, and defers the initial load
    // until the tab is first shown.
    if (active && (reloadQueue || rows.length === 0)) {
      getData(reloadLimitMs).then(() => setReloadQueue(false));
    }
  }, [reloadQueue, reloadLimitMs, rows.length, getData, active]);

  // Polling logic
  //
  // The auto-fetch trigger is anchored directly to `nextAvailableSqueueFetch`
  // (via a self-rescheduling `setTimeout`) rather than a fixed-cadence
  // `setInterval` started once at mount. A fixed interval drifts out of sync
  // with the countdown display as soon as any fetch takes a non-trivial
  // amount of time (e.g. real `squeue` round-trip latency against a busy
  // cluster): the interval keeps ticking on its original mount-time
  // schedule, while `nextAvailableSqueueFetch` shifts later with each
  // fetch's actual completion time. That mismatch is what makes the
  // countdown appear to "hang" at 0s -- the interval fires too early (before
  // `nextAvailableSqueueFetch` is reached), gets silently throttled by
  // `reloadLimitMs` in the effect below, and the user has to wait for the
  // *next* out-of-sync tick before a real fetch (and a fresh countdown)
  // actually lands. Rescheduling relative to `nextAvailableSqueueFetch`
  // itself keeps the trigger and the displayed countdown in lockstep no
  // matter how long a fetch takes.
  useEffect(() => {
    if (!autoReload || !active) {
      if (intervalIdRef.current) {
        clearTimeout(intervalIdRef.current);
        intervalIdRef.current = null;
      }
      setNextAvailableSqueueFetch(null);
      setReloadQueue(false);
      // Auto-reload is off (or the tab is inactive): the manual Refresh
      // button is the only way to fetch, so it must be enabled here, not
      // disabled. (Previously this was `setDisableManualRefresh(!autoReload)`,
      // which -- with autoReload already false -- evaluated to `true` and
      // permanently disabled the button whenever it was actually needed.)
      setDisableManualRefresh(false);
      return;
    }

    // Auto-reload is on: the manual button is hidden (see the `Fade` around
    // it in SqueueToolbar), so its disabled state doesn't matter visually,
    // but keep it disabled for consistency/defensiveness.
    setDisableManualRefresh(true);

    // Bootstrap: if there's no target time yet (e.g. auto-reload was just
    // turned on, or the tab just became active), establish one. This effect
    // will immediately re-run once that state update lands, at which point
    // the branch below schedules the actual timer against it.
    if (!nextAvailableSqueueFetch) {
      setNextAvailableSqueueFetch(new Date(Date.now() + reloadRate));
      return;
    }

    const delay = Math.max(0, nextAvailableSqueueFetch.getTime() - Date.now());
    intervalIdRef.current = setTimeout(() => {
      setReloadQueue(true);
    }, delay);
    return () => {
      if (intervalIdRef.current) {
        clearTimeout(intervalIdRef.current);
      }
    };
  }, [autoReload, active, reloadRate, nextAvailableSqueueFetch]);

  // Sync with display rows
  useEffect(() => {
    const updateRows = rows.map((x: string[]) => {
      const item: Record<string, unknown> = {};
      for (let col = serverColumns.length - 1; col >= 0; col--) {
        item[serverColumns[col]] = x[col];
      }
      return item;
    });
    setDisplayRows(updateRows);
  }, [rows, serverColumns]);

  // After a Hold/Release causes a queue refresh, flash the status cell of
  // the affected row(s) once the new data has actually landed in the grid,
  // instead of showing a success Snackbar (the row is still visible, so a
  // direct highlight is more useful feedback than a toast).
  useEffect(() => {
    const jobIds = pendingFlashJobIdsRef.current;
    const api = gridApiRef.current;
    if (!jobIds || !api) {
      return;
    }
    pendingFlashJobIdsRef.current = null;
    const statusField = serverColumns.includes('ST')
      ? 'ST'
      : serverColumns.includes('STATE')
        ? 'STATE'
        : null;
    // Defer to the next tick so AG Grid has applied the new rowData before
    // we look up row nodes by id.
    const id = setTimeout(() => {
      if (typeof api.isDestroyed === 'function' && api.isDestroyed()) {
        return;
      }
      try {
        const rowNodes = jobIds.map(jid => api.getRowNode(jid)).filter(Boolean);
        if (rowNodes.length === 0) {
          return;
        }
        api.flashCells({
          rowNodes,
          columns: statusField ? [statusField, jobIDLabel] : undefined
        });
      } catch (e) {
        /* no-op */
      }
    }, 0);
    return () => clearTimeout(id);
  }, [displayRows, serverColumns, jobIDLabel]);

  // Notify when a tracked job's state (ST/STATE column, e.g. "R" -> "CD")
  // changes, if the user has opted in via `notifyOnStateChange`. Compares
  // against the previous fetch's snapshot rather than the grid, since a job
  // that leaves the queue entirely (e.g. completes) is still worth reporting.
  // Only the current user's own jobs are considered -- notifying on every
  // other user's job state changes too (the queue can include jobs from the
  // whole cluster, independent of the separate "My jobs only" grid filter)
  // would be noisy and not something the user actually asked to be told
  // about.
  useEffect(() => {
    const statusField = serverColumns.includes('ST')
      ? 'ST'
      : serverColumns.includes('STATE')
        ? 'STATE'
        : null;
    if (!statusField) {
      return;
    }
    const hasUserField = serverColumns.includes('USER');
    const currentStates: Record<string, { code: string; reason: unknown }> = {};
    for (const row of displayRows) {
      if (hasUserField && String(row['USER']) !== props.userName) {
        continue;
      }
      const jid = String(row[jobIDLabel]);
      currentStates[jid] = {
        code: String(row[statusField]),
        reason: row['NODELIST(REASON)']
      };
    }
    const prevStates = prevJobStatesRef.current;
    if (props.notifyOnStateChange && prevStates) {
      for (const [jid, curr] of Object.entries(currentStates)) {
        const prev = prevStates[jid];
        // Compare on the raw code, not the formatted text -- e.g. a job
        // going from a plain PENDING to a *held* PENDING (same "PD" code,
        // different Reason) is a real, notification-worthy change even
        // though naively comparing formatted text would also catch it;
        // comparing raw codes keeps this explicit and avoids relying on
        // string-formatting side effects for the actual change detection.
        if (
          prev !== undefined &&
          (prev.code !== curr.code ||
            isHeldReason(prev.reason) !== isHeldReason(curr.reason))
        ) {
          // Use the same status-text translation as the queue table/job
          // details/job history (e.g. "R" -> "RUNNING", "PD" + a Held
          // reason -> "PENDING (Held)"), instead of the raw squeue code,
          // so the notification reads consistently with the rest of the
          // UI.
          const prevText = formatJobStatus(prev.code, prev.reason);
          const currText = formatJobStatus(curr.code, curr.reason);
          Notification.info(
            `Job ${jid} changed state: ${prevText} \u2192 ${currText}`,
            { autoClose: 6000 }
          );
        }
      }
    }
    prevJobStatesRef.current = currentStates;
  }, [
    displayRows,
    serverColumns,
    jobIDLabel,
    props.notifyOnStateChange,
    props.userName
  ]);

  // Persist ag-grid column state (order/width/visibility/pinning) so the
  // user's customized layout survives reloads. Debounced since drag/resize
  // interactions fire many intermediate events.
  const saveColumnState = useCallback(() => {
    const api = gridApiRef.current;
    if (!api || typeof api.getColumnState !== 'function') {
      return;
    }
    if (columnStateSaveTimerRef.current) {
      clearTimeout(columnStateSaveTimerRef.current);
    }
    columnStateSaveTimerRef.current = setTimeout(async () => {
      try {
        const state = api.getColumnState();
        const settings = await props.settingRegistry.load(PLUGIN_ID);
        await settings.set('columnState', state);
      } catch (e) {
        /* no-op */
      }
    }, 500);
  }, [props.settingRegistry]);

  // Settings persistence
  useEffect(() => {
    (async () => {
      try {
        const settings = await props.settingRegistry.load(PLUGIN_ID);
        if (settings.get('userOnly').composite !== userOnly) {
          await settings.set('userOnly', userOnly);
        }
        if (settings.get('autoReload').composite !== autoReload) {
          await settings.set('autoReload', autoReload);
        }
      } catch (e) {
        /* no-op */
      }
    })();
  }, [userOnly, autoReload, props.settingRegistry]);

  // Keep the *contents* of already-selected rows in sync with the latest
  // queue data, and re-derive the pinned-to-top snapshot -- both exactly
  // once per refresh (i.e. whenever `displayRows` changes). AG Grid's
  // `selectionChanged` event (which populates `selectedRows` via
  // `onSelectionChanged` below) only fires when the set of selected row IDs
  // actually changes -- it does NOT fire on a plain data refresh. Without
  // this, `selectedRows` kept holding the exact snapshot captured at
  // selection time, so e.g. resuming a held job would update the
  // underlying queue data but the Pause/Resume buttons' enabled/disabled
  // state (derived from `selectedStatuses` below) stayed stuck on the
  // job's *old* ST value until the user deselected and reselected the row.
  //
  // Any job ID that no longer appears in the fresh data at all (completed,
  // cancelled, failed -- left the queue) is pruned here from both
  // `selectedRows` and `pinnedRowIds`, so neither accumulates stale IDs
  // indefinitely, and a future job that happens to reuse the same ID (Slurm
  // does recycle them) can't inherit a stale pin/selection it never earned.
  useEffect(() => {
    const freshIds = new Set(displayRows.map(row => String(row[jobIDLabel])));
    setSelectedRows(prev => {
      if (prev.length === 0) {
        setPinnedRowIds(p => (p.length === 0 ? p : []));
        return prev;
      }
      const byId = new Map(
        displayRows.map(row => [String(row[jobIDLabel]), row])
      );
      const next: any[] = [];
      for (const row of prev) {
        const id = String(row[jobIDLabel]);
        if (!freshIds.has(id)) {
          continue;
        }
        next.push(byId.get(id) ?? row);
      }
      // Snapshot the (pruned) selection as the new pinned set. This is the
      // one and only place pinnedRowIds is recomputed, tying the pin
      // reshuffle strictly to the refresh boundary rather than to live
      // selection changes.
      setPinnedRowIds(next.map(row => String(row[jobIDLabel])));
      return next;
    });
  }, [displayRows, jobIDLabel]);

  // Hold is a genuine no-op on anything but a PENDING job -- real Slurm
  // accepts `scontrol hold` on a RUNNING/COMPLETED job (exit code 0) but
  // doesn't actually change its state, so the previous "success" flash was
  // misleading (nothing happened, but the UI implied it did). Release is
  // similarly meaningless on a job that was never held. Gate both actions on
  // the selection's actual ST/STATE rather than relying on the backend's
  // exit code alone to infer whether anything real happened.
  const selectedStatuses = useMemo(() => {
    const statusField = serverColumns.includes('ST')
      ? 'ST'
      : serverColumns.includes('STATE')
        ? 'STATE'
        : null;
    if (!statusField) {
      return null;
    }
    return selectedRows.map(row => String(row[statusField] ?? ''));
  }, [selectedRows, serverColumns]);

  // Only a *plain*, not-yet-held pending job is a meaningful Hold target --
  // `scontrol hold` on a job that's already held (Reason matches
  // isHeldReason: JobHeldUser/JobHeldAdmin/requeuehold's reason) is a
  // real-Slurm no-op, the mirror image of Release being a no-op on a
  // non-held PD job (see canReleaseSelected below). If the ST column isn't
  // available at all (statuses === null), don't second-guess the user;
  // only disable when we can positively confirm the action would be a
  // no-op.
  const canHoldSelected =
    selectedRows.length === 0 ||
    selectedStatuses === null ||
    (selectedStatuses.every(s => s === 'PD') &&
      selectedRows.some(row => !isHeldReason(row['NODELIST(REASON)'])));

  // A job requeued while SUSPENDED lands as PENDING with an *admin* hold
  // (real Slurm behavior, confirmed live: `scontrol requeue` on a suspended
  // job produces `NODELIST(REASON)` = "(JobHeldAdmin)"), which a regular
  // user's `scontrol release` gets rejected for with "Access/permission
  // denied" -- only an admin can lift it. Without this check, `PD` alone
  // made Release/Resume look valid, letting the user hit that confusing
  // permission error instead of a clear "needs an admin" explanation.
  const selectedReasons = useMemo(() => {
    return selectedRows.map(row => String(row['NODELIST(REASON)'] ?? ''));
  }, [selectedRows]);
  const hasAdminHoldSelected = selectedReasons.some(r =>
    r.includes('JobHeldAdmin')
  );

  // A plain PENDING job (e.g. Reason=(Priority)/(Resources), waiting on
  // its own merits, not actually held) is NOT a valid Release target --
  // real Slurm's `scontrol release` is a silent no-op on it, same as Hold
  // is on a RUNNING job (see comment above). Only enable Release when the
  // selection is genuinely held (Reason matches isHeldReason: JobHeldUser/
  // JobHeldAdmin/requeuehold's reason), excluding admin holds which need a
  // privileged user.
  const canReleaseSelected =
    selectedRows.length === 0 ||
    selectedStatuses === null ||
    (!hasAdminHoldSelected &&
      selectedStatuses.every(s => s === 'PD') &&
      selectedRows.every(row => isHeldReason(row['NODELIST(REASON)'])));

  // Suspend/Resume mirror Hold/Release's state-gating, but for the
  // runtime-control pair: Suspend is only meaningful on a RUNNING job
  // (real Slurm SIGSTOPs the process while keeping its allocation), and
  // Resume is only meaningful on a job that's actually suspended ("S").
  const canSuspendSelected =
    selectedStatuses === null || selectedStatuses.every(s => s === 'R');
  const canResumeSelected =
    selectedStatuses === null || selectedStatuses.every(s => s === 'S');

  // Whether *any* (not necessarily all) selected job is a valid Hold/
  // Suspend target. A "select all" that mixes PD and R jobs (e.g. a
  // throttled array job's pending tail alongside its running tasks, plus
  // independent already-running jobs -- see scenario 5) previously made
  // the "Pause" button disabled entirely, even though most of the
  // selection genuinely could be paused. `handleJobAction` below filters
  // each underlying `hold`/`suspend` call down to only the applicable
  // rows, so it's safe to fire both when the selection is mixed.
  const hasPdSelectedForTooltip =
    selectedStatuses !== null && selectedStatuses.some(s => s === 'PD');
  const hasRSelected =
    selectedStatuses !== null && selectedStatuses.some(s => s === 'R');
  const hasSSelected =
    selectedStatuses !== null && selectedStatuses.some(s => s === 'S');

  // Narrower than hasPdSelectedForTooltip: true only when a selected PENDING row is
  // NOT already held. Used by the toolbar's merged Pause/Suspend button,
  // which must NOT enable/fire Hold on a job that's already held --
  // real Slurm's `scontrol hold` is a silent no-op on it (the mirror image
  // of hasHeldSelected below, which gates Release the same way).
  const hasUnheldPdSelected =
    selectedStatuses !== null &&
    selectedRows.some(
      (row, idx) =>
        selectedStatuses[idx] === 'PD' && !isHeldReason(row['NODELIST(REASON)'])
    );

  // Like hasPdSelectedForTooltip, but narrowed to rows that are actually held
  // (Reason matches isHeldReason) *and* user-releasable (excluding
  // JobHeldAdmin, same exclusion as canReleaseSelected above) -- used by
  // the toolbar's merged Release/Resume button, which must NOT enable/fire
  // Release for a plain, non-held pending job, nor for one only an admin
  // can release.
  const hasHeldSelected =
    selectedStatuses !== null &&
    selectedRows.some(
      (row, idx) =>
        selectedStatuses[idx] === 'PD' &&
        isHeldReason(row['NODELIST(REASON)']) &&
        !isAdminHeldReason(row['NODELIST(REASON)'])
    );

  // Requeue/Requeue & Hold are valid for RUNNING and SUSPENDED jobs (a
  // running job is stopped and returned to the head of the queue; a
  // suspended job is released and restarted from scratch), but real Slurm
  // rejects `scontrol requeue` on a job that's already PENDING -- even a
  // held one -- with "Job is pending execution for job <id>" (confirmed
  // live against the Docker cluster). Like Pause/Resume, this is an
  // "at least one applicable row" action, not an "every row must qualify"
  // one -- a mixed PD+R selection should still let Requeue fire for the
  // R row, so `handleJobAction`'s row filter (below) scopes `requeue`/
  // `requeuehold` to only R/S rows, and this only needs to confirm at
  // least one such row exists.
  const canRequeueSelected =
    selectedRows.length === 0 ||
    selectedStatuses === null ||
    selectedStatuses.some(s => s === 'R' || s === 'S');

  // Requeuing a SUSPENDED job is a real trap for a regular user: real
  // Slurm doesn't just restart it, it lands the job on an *admin* hold
  // (see hasAdminHoldSelected above) that only an administrator can lift
  // -- the user themselves has no way to undo it. Surface this so the UI
  // can warn/confirm before firing the action, rather than letting the
  // user discover the dead end only after clicking.
  const hasSuspendedSelected =
    selectedStatuses !== null && selectedStatuses.some(s => s === 'S');

  // "Applicable/total" counts for the Pause/Resume/Requeue buttons' badge
  // (e.g. "2/5"), so a partial-eligibility selection shows exactly how
  // many of the selected jobs the action will actually apply to, rather
  // than just the total selection size (which is what Clear/Details show,
  // since those two apply unconditionally/to every selected row).
  const pauseApplicableCount = useMemo(() => {
    if (selectedStatuses === null) {
      return 0;
    }
    return selectedRows.reduce((count, row, idx) => {
      const status = selectedStatuses[idx];
      const applies =
        status === 'R' ||
        (status === 'PD' && !isHeldReason(row['NODELIST(REASON)']));
      return applies ? count + 1 : count;
    }, 0);
  }, [selectedRows, selectedStatuses]);

  const resumeApplicableCount = useMemo(() => {
    if (selectedStatuses === null) {
      return 0;
    }
    return selectedRows.reduce((count, row, idx) => {
      const status = selectedStatuses[idx];
      const applies =
        status === 'S' ||
        (status === 'PD' &&
          isHeldReason(row['NODELIST(REASON)']) &&
          !isAdminHeldReason(row['NODELIST(REASON)']));
      return applies ? count + 1 : count;
    }, 0);
  }, [selectedRows, selectedStatuses]);

  const requeueApplicableCount = useMemo(() => {
    if (selectedStatuses === null) {
      return 0;
    }
    return selectedStatuses.filter(s => s === 'R' || s === 'S').length;
  }, [selectedStatuses]);

  // A row can represent a *grouped* range of still-pending array tasks
  // (e.g. "1234_[3-20%4]", squeue's display form for array elements that
  // share the same throttle limit) rather than one specific, addressable
  // job. `/job/{id}` (and real `scontrol show job`/`sacct -j`) can only
  // resolve a single job or a single array element -- never a range
  // expression -- so "Show Details" must be disabled for such a selection
  // instead of sending it a doomed request (confirmed live: this produces
  // a raw, confusing "Invalid job_id: 1234_[3-20%4]" error).
  const hasGroupedArrayRangeSelected = selectedRows.some(row =>
    isGroupedArrayRangeJobId(String(row[jobIDLabel] ?? ''))
  );

  const onSelectionChanged = useCallback((event: SelectionChangedEvent) => {
    // Defensively ignore AG Grid's `rowDataChanged`-sourced event, which
    // can fire on a plain data refresh even without any real selection
    // change. Real selection content/staleness across refreshes is already
    // handled separately by the displayRows-sync effect above (which also
    // recomputes `pinnedRowIds`), so reacting to this source here would
    // risk wiping out `selectedRows` from a refresh alone.
    //
    // Note: "pinning" no longer uses AG Grid's `pinnedTopRowData` feature
    // (see SqueueDataTable's `orderedRowData`) -- pinned rows are simply
    // reordered within the normal `rowData` array, keeping the same row
    // node (and its real selection/checkbox state) across refreshes rather
    // than recreating it. That was the actual root cause of pinned rows
    // silently losing their checkbox: AG Grid's data-driven pinned-row
    // model doesn't render selection checkboxes at all (confirmed directly
    // in AG Grid's source -- `CellCtrl.isIncludeControl` only allows the
    // checkbox control for rows pinned via the *manual*, UI-driven pinning
    // model, never for `pinnedTopRowData`), so no amount of resyncing
    // selection state after the fact could ever have fixed it.
    if (event.source === 'rowDataChanged') {
      return;
    }
    if (gridApiRef.current) {
      setSelectedRows(gridApiRef.current.getSelectedRows());
    }
  }, []);

  const actionVerb: Record<JobAction, string> = {
    cancel: 'Cancelled',
    hold: 'Held',
    release: 'Released',
    suspend: 'Suspended',
    resume: 'Resumed',
    requeue: 'Requeued',
    requeuehold: 'Requeued & Held'
  };

  const handleJobAction = useCallback(
    async (action: JobAction) => {
      const { route, method } = (action => {
        switch (action) {
          case 'cancel':
            return { route: 'scancel', method: 'DELETE' };
          case 'hold':
            return { route: 'scontrol/hold', method: 'PATCH' };
          case 'release':
            return { route: 'scontrol/release', method: 'PATCH' };
          case 'suspend':
            return { route: 'scontrol/suspend', method: 'PATCH' };
          case 'resume':
            return { route: 'scontrol/resume', method: 'PATCH' };
          case 'requeue':
            return { route: 'scontrol/requeue', method: 'PATCH' };
          case 'requeuehold':
            return { route: 'scontrol/requeuehold', method: 'PATCH' };
        }
      })(action);

      // Hold/Release/Suspend/Resume are only meaningful on a subset of
      // states (PD, PD-non-admin-held, R, S respectively -- see
      // canHoldSelected/canReleaseSelected/canSuspendSelected/
      // canResumeSelected above). Previously every action was sent the
      // *entire* selection verbatim, relying on the toolbar buttons being
      // disabled for anything but a uniform selection to prevent a no-op
      // call. That meant a mixed PD+R "select all" (e.g. scenario 5's
      // throttled array job) could never Pause/Resume at all, even though
      // most of the selection genuinely qualified. Filter here instead, so
      // each individual action only ever targets rows it actually applies
      // to -- letting the toolbar fire e.g. both `hold` and `suspend` for a
      // mixed selection, each safely scoped to its own applicable rows.
      const statusField = serverColumns.includes('ST')
        ? 'ST'
        : serverColumns.includes('STATE')
          ? 'STATE'
          : null;
      const rowsForAction = !statusField
        ? selectedRows
        : selectedRows.filter(row => {
            // If the row itself doesn't carry the status field at all
            // (shouldn't happen with real AG Grid row data, which always
            // includes every server column, but keep the same
            // "don't second-guess" fallback used above for a missing
            // column entirely), don't filter it out.
            if (!Object.prototype.hasOwnProperty.call(row, statusField)) {
              return true;
            }
            const status = String(row[statusField] ?? '');
            switch (action) {
              case 'hold':
                return (
                  status === 'PD' && !isHeldReason(row['NODELIST(REASON)'])
                );
              case 'release':
                return (
                  status === 'PD' &&
                  isHeldReason(row['NODELIST(REASON)']) &&
                  !String(row['NODELIST(REASON)'] ?? '').includes(
                    'JobHeldAdmin'
                  )
                );
              case 'suspend':
                return status === 'R';
              case 'resume':
                return status === 'S';
              case 'requeue':
              case 'requeuehold':
                // Real Slurm rejects `scontrol requeue` on a job that's
                // still PENDING (even a held one) with "Job is pending
                // execution for job <id>" -- scope this to only R/S rows
                // so a mixed selection (e.g. PD+R) doesn't also try, and
                // fail, to requeue the pending one(s). See
                // canRequeueSelected/requeueApplicableCount above.
                return status === 'R' || status === 'S';
              default:
                return true;
            }
          });
      const jobIDs = rowsForAction.map(row => String(row[jobIDLabel]));
      if (jobIDs.length === 0) {
        return;
      }
      try {
        const result = await requestAPI<any>(route, new URLSearchParams(), {
          body: JSON.stringify({ job_ids: jobIDs }),
          method,
          headers: { 'Content-Type': 'application/json' }
        });
        // The backend response envelope uses `success`/`exitCode` (see
        // SlurmCommandHandler.run_command and ScontrolHandler.patch); it does
        // not expose a `returncode` field. Treat either signal as success so the
        // queue reloads to reflect the new state (e.g. a held job's ST column).
        const succeeded = result?.success === true || result?.exitCode === 0;
        if (succeeded) {
          // Force an immediate, unthrottled refresh so the table reflects
          // the action right away. `reloadLimitMs` exists to prevent
          // manual-refresh-button spam, not to delay showing the result of
          // an action the user just took -- going through `setReloadQueue`
          // here would apply that same rate limit and leave a
          // just-cancelled job visible (or a just-held job's status stale)
          // until the throttle window happened to elapse.
          getData(0);
          if (
            action === 'cancel' ||
            action === 'requeue' ||
            action === 'requeuehold'
          ) {
            // Killed jobs disappear from the queue on the next refresh, and
            // Requeue/Requeue&Hold restart the job (potentially under a new
            // row identity once it re-enters the queue) -- in all three
            // cases there's no reliable row left to highlight afterward, so
            // a confirmation Snackbar is the only useful feedback here.
            // Build our own message rather than using the backend's
            // `responseMessage`, which embeds the full configured
            // executable path (e.g. "Success: /opt/slurm/bin/scancel 123")
            // and isn't meant for end-user display; also append a
            // timestamp so the user can tell when the action completed.
            const verb = actionVerb[action] ?? 'Updated';
            const jobWord = jobIDs.length === 1 ? 'job' : 'jobs';
            const timestamp = new Date().toLocaleTimeString();
            setSuccessMessage(
              `${verb} ${jobIDs.length} ${jobWord}: ${jobIDs.join(', ')} (${timestamp})`
            );
            setSuccessOpen(true);
            // Only deselect the row(s) `rowsForAction` actually scoped this
            // call to, not the *entire* original selection -- for `cancel`
            // those are always the same set (scancel applies unconditionally
            // to every selected row), but for requeue/requeuehold a mixed
            // selection (e.g. 20 selected, only 1 R/S) only actually acted
            // on the eligible subset, so the other, unaffected rows must
            // stay selected. Confirmed live: selecting 20 jobs and firing
            // Requeue (1/20 eligible) previously deselected all 20.
            const actedOnIds = new Set(jobIDs);
            for (const jid of actedOnIds) {
              const node = gridApiRef.current?.getRowNode(jid);
              if (node) {
                node.setSelected(false);
              }
            }
            setSelectedRows(prev =>
              prev.filter(row => !actedOnIds.has(String(row[jobIDLabel])))
            );
          } else {
            // Hold/Release/Suspend/Resume: the row is still present after
            // the refresh, so highlight its status cell directly instead of
            // a toast.
            pendingFlashJobIdsRef.current = jobIDs;
          }
        } else {
          // Log only the error message, never the full result object (which
          // may include job data under `data`), and always in full (never
          // truncated) since the console has no length constraints.
          const fullDetail = result?.errorMessage ?? result?.responseMessage;
          console.error(`Action ${action} failed`, fullDetail);
          const timestamp = new Date().toLocaleTimeString();
          const jobList = jobIDs.length > 0 ? jobIDs.join(', ') : 'unknown';
          // JupyterLab's toast notification renders as a single line and
          // silently clips anything past its fixed width -- with no
          // wrapping, a long detail (e.g. a raw multi-job scontrol/scancel
          // stderr) can get cut off mid-word, hiding the actual error. Keep
          // the toast itself short and point to the browser console (where
          // `fullDetail` was just logged in full) for the complete text.
          const detail = result?.errorMessage
            ? `: ${truncateForToast(result.errorMessage)}`
            : '';
          setErrorMessage(
            `Action ${action} failed for job(s) ${jobList}${detail} (${timestamp})`
          );
          setErrorOpen(true);
        }
      } catch (e) {
        console.error(`Action ${action} failed`, e);
        const timestamp = new Date().toLocaleTimeString();
        const jobList = jobIDs.length > 0 ? jobIDs.join(', ') : 'unknown';
        setErrorMessage(
          `Action ${action} failed for job(s) ${jobList} (${timestamp})`
        );
        setErrorOpen(true);
      }
    },
    [selectedRows, jobIDLabel, getData, serverColumns]
  );

  const reload = () => setReloadQueue(true);

  return {
    rows,
    serverColumns,
    lastSqueueFetch,
    nextAvailableSqueueFetch,
    uiLabels,
    uiSizing,
    selectedRows,
    setSelectedRows,
    canHoldSelected,
    canReleaseSelected,
    canSuspendSelected,
    canResumeSelected,
    canRequeueSelected,
    hasAdminHoldSelected,
    hasSuspendedSelected,
    hasGroupedArrayRangeSelected,
    hasPdSelected: hasPdSelectedForTooltip,
    hasRSelected,
    hasSSelected,
    hasUnheldPdSelected,
    hasHeldSelected,
    pauseApplicableCount,
    resumeApplicableCount,
    requeueApplicableCount,
    pinnedRowIds,
    filterQuery,
    setFilterQuery,
    autoReload,
    setAutoReload,
    userOnly,
    setUserOnly,
    loading,
    displayRows,
    errorOpen,
    setErrorOpen,
    errorMessage,
    setErrorMessage,
    successOpen,
    setSuccessOpen,
    successMessage,
    gridApiRef,
    jobIDLabel,
    handleJobAction,
    reload,
    onSelectionChanged,
    reapplyGridFilters,
    sizeColumnsToFitSafe,
    disableManualRefresh,
    saveColumnState,
    initialColumnState: props.columnState
  };
}
