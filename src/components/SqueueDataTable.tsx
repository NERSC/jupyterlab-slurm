'use client';

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo
} from 'react';

import { Box, CircularProgress } from '@mui/material';
// Import from the package root (not a deep `lib/...` path) so webpack's
// module-federation sharing keys on `@jupyterlab/apputils` and reuses the
// same `Notification.manager` singleton the running JupyterLab shell's
// toast UI is subscribed to; a deep import bundles a private, disconnected
// copy that the shell never observes.
import { Notification } from '@jupyterlab/apputils';

import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ClientSideRowModelModule,
  ModuleRegistry,
  RowSelectionModule,
  RowSelectionOptions,
  ValidationModule,
  themeQuartz,
  colorSchemeDark
} from 'ag-grid-community';

// Local
import { COMMAND_ID_SHOW_DETAILS } from '../index';
import { useSlurmQueue } from '../hooks/useSlurmQueue';
import { ISlurmWidgetProps } from '../types';
import { SqueueToolbar } from './SqueueToolbar';
import { createDisplayColumnsFromServer } from '../utils/slurm-column-defs';
import { isGroupedArrayRangeJobId } from '../utils/slurm-parsing';
import { useJupyterThemeMode } from '../utils/theme';

// Register all Community features
ModuleRegistry.registerModules([
  AllCommunityModule,
  ClientSideRowModelModule,
  RowSelectionModule,
  ValidationModule
]);

export default function SqueueDataTable(props: ISlurmWidgetProps) {
  const {
    lastSqueueFetch,
    nextAvailableSqueueFetch,
    uiLabels,
    uiSizing,
    selectedRows,
    canHoldSelected,
    canReleaseSelected,
    canSuspendSelected,
    canResumeSelected,
    canRequeueSelected,
    hasAdminHoldSelected,
    hasSuspendedSelected,
    hasGroupedArrayRangeSelected,
    hasPdSelected,
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
    initialColumnState
  } = useSlurmQueue(props);

  const themeMode = useJupyterThemeMode();
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Surface action failures via JupyterLab's native toast notifications
  // (rather than an MUI Snackbar) so they match the rest of JupyterLab's UI.
  useEffect(() => {
    if (errorOpen && errorMessage) {
      Notification.error(errorMessage, { autoClose: 6000 });
      setErrorOpen(false);
    }
  }, [errorOpen, errorMessage, setErrorOpen]);

  // Kill/Cancel success is the one queue action whose row disappears from
  // the grid, so a toast is the only useful confirmation (Hold/Release
  // instead flash the still-visible row's status cell, see useSlurmQueue).
  useEffect(() => {
    if (successOpen && successMessage) {
      Notification.success(successMessage, { autoClose: 4000 });
      setSuccessOpen(false);
    }
  }, [successOpen, successMessage, setSuccessOpen]);

  // Live "now" ticker so the countdown to the next refresh stays current.
  // Resynced to Date.now() whenever nextAvailableSqueueFetch changes (e.g.
  // after each fetch), so the very next tick isn't stale by up to 1s left
  // over from the previous interval's schedule (which previously caused the
  // countdown to briefly display one second too many, e.g. 11s instead of
  // 10s for a 10s refresh rate).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!autoReload) {
      return;
    }
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [autoReload, nextAvailableSqueueFetch]);

  const hasFetched =
    lastSqueueFetch.getTime() > new Date('1970-01-01').getTime();

  const lastUpdatedLabel = useMemo(() => {
    if (!hasFetched) {
      return '\u2014';
    }
    return `${lastSqueueFetch.toLocaleDateString()} ${lastSqueueFetch.toLocaleTimeString()}`;
  }, [hasFetched, lastSqueueFetch]);

  const secondsToNextRefresh = useMemo(() => {
    if (!autoReload || !nextAvailableSqueueFetch) {
      return null;
    }
    return Math.max(
      0,
      Math.ceil((nextAvailableSqueueFetch.getTime() - now) / 1000)
    );
  }, [autoReload, nextAvailableSqueueFetch, now]);

  // Percentage of the refresh interval elapsed so far, used to draw the pie
  // timer below. Derived from the same `now`/`nextAvailableSqueueFetch`
  // values as the text countdown, so both stay perfectly in sync and update
  // on the same 1s tick -- no separate animation loop needed.
  const refreshElapsedPercent = useMemo(() => {
    if (!autoReload || !nextAvailableSqueueFetch) {
      return null;
    }
    const totalMs = props.reloadRate * 1000;
    if (!totalMs) {
      return null;
    }
    const remainingMs = Math.max(0, nextAvailableSqueueFetch.getTime() - now);
    const elapsedMs = Math.min(totalMs, Math.max(0, totalMs - remainingMs));
    return (elapsedMs / totalMs) * 100;
  }, [autoReload, nextAvailableSqueueFetch, now, props.reloadRate]);

  // Remount key for AgGrid
  const gridKey = useMemo(() => {
    const opts = Array.isArray(props.itemsPerPageOptions)
      ? props.itemsPerPageOptions.join(',')
      : '';
    return `squeue-${props.itemsPerPageAuto}-${opts}`;
  }, [props.itemsPerPageAuto, props.itemsPerPageOptions]);

  const effectivePageSize = useMemo(() => {
    const options = props.itemsPerPageOptions || [];
    if (options.length === 0) {
      return props.itemsPerPage;
    }
    return options.includes(props.itemsPerPage)
      ? props.itemsPerPage
      : options[0];
  }, [props.itemsPerPage, props.itemsPerPageOptions]);

  // Re-fit columns when this tab becomes active. AG Grid measures width 0 while
  // the container is hidden (display:none), so column sizing computed while
  // inactive is a no-op; we re-run it once the tab is shown again.
  useEffect(() => {
    if (props.active === false) {
      return;
    }
    const id = setTimeout(() => {
      sizeColumnsToFitSafe();
      reapplyGridFilters();
    }, 50);
    return () => clearTimeout(id);
  }, [props.active, sizeColumnsToFitSafe, reapplyGridFilters]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const ro = new (window as any).ResizeObserver(() => {
      if (el.offsetWidth > 0) {
        sizeColumnsToFitSafe();
        reapplyGridFilters();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [sizeColumnsToFitSafe, reapplyGridFilters]);

  // Build column defs
  //
  // Memoized on the *set of field names* (a stable, comma-joined string),
  // not on `displayRows` itself. `displayRows` gets a brand-new array
  // reference on every squeue refresh (every `reloadRate` seconds) even
  // when the underlying columns haven't changed at all -- if this memo
  // depended on `displayRows` directly, `displayColumns` (and therefore
  // the `columnDefs` prop passed to `AgGridReact`) would get a new
  // identity on every single auto-refresh tick. AG Grid treats a new
  // `columnDefs` reference as "columns changed" and fully tears down and
  // rebuilds each column's filter UI, which silently steals focus away
  // from (and discards in-progress input in) any column filter the user
  // happens to be typing into when a refresh lands mid-keystroke -- making
  // it effectively impossible to type a manual filter value. Keying off
  // the field-name list instead means `displayColumns` (and `columnDefs`)
  // only gets a new identity when columns are actually added/removed, not
  // on every ordinary data refresh.
  const columnFieldsKey = useMemo(
    () => Object.keys(displayRows[0] || {}).join(','),
    [displayRows]
  );
  const displayColumns = useMemo(() => {
    return createDisplayColumnsFromServer(
      columnFieldsKey ? columnFieldsKey.split(',') : [],
      uiLabels,
      uiSizing
    );
  }, [columnFieldsKey, uiLabels, uiSizing]);

  // Handle "Show Details". Grouped array-range rows (e.g. "1234_[3-20%4]",
  // squeue's display form for still-pending array tasks sharing a throttle
  // limit) aren't a single addressable job, so `/job/{id}` can't resolve
  // them -- the Details button is disabled for this case (see
  // `hasGroupedArrayRangeSelected`), but filter defensively here too rather
  // than ever forwarding one of these IDs to the backend.
  const onShowDetails = useCallback(() => {
    const jobIds = selectedRows
      .map(r => String(r[jobIDLabel]))
      .filter(id => !isGroupedArrayRangeJobId(id));
    if (jobIds.length === 0) {
      return;
    }
    props.jupyterlabFrontend.commands
      .execute(COMMAND_ID_SHOW_DETAILS, { jobIds, index: 0 })
      .catch((e: unknown) => {
        setErrorMessage('Failed to open Job Details.');
        setErrorOpen(true);
      });
  }, [selectedRows, jobIDLabel, props.jupyterlabFrontend]);

  // "Pinned" rows are a snapshot of the selection taken at the last
  // refresh (see useSlurmQueue for why it's not a live derivation of
  // `selectedRows`), reordered to the front of the *ordinary* `rowData`
  // array -- deliberately NOT using AG Grid's `pinnedTopRowData`/pinned-row
  // feature.
  //
  // This wasn't the original design: `pinnedTopRowData` was tried first,
  // since it's the obvious AG Grid feature for "keep this at the top
  // regardless of sort/scroll". But direct inspection of AG Grid's own
  // source (`CellCtrl.isIncludeControl`) confirmed a hard, structural
  // limitation: the checkbox-selection control is only ever rendered for a
  // pinned row when `_isManualPinnedRow(rowNode)` is true -- i.e. only for
  // rows pinned via AG Grid's *manual*, UI-driven pinning model
  // (`enableRowPinning`, right-click "Pin Row"), never for rows supplied
  // through the data-driven `pinnedTopRowData` prop (`StaticPinnedRowModel`,
  // whose `isManual()` always returns `false`). There is also no supported
  // public API to pin a row into that manual model programmatically. So a
  // row pinned via `pinnedTopRowData` can never show a selection checkbox,
  // no matter what we do to its node's selection state after the fact --
  // which is exactly why every previous attempt to "resync" the checkbox
  // (`forEachNode`, `getRowNode`, `getPinnedTopRowCount`/`getPinnedTopRow`)
  // kept failing: the checkbox DOM element for that cell was never created
  // in the first place, so there was nothing to check.
  //
  // The fix is to stop using the pinned-row feature entirely and instead
  // just reorder the pinned IDs to the front of the normal `rowData`. Since
  // this keeps the rows in the *same* row model, and `getRowId` is
  // configured below, AG Grid's own immutable-data diffing keys off row id
  // and updates matching nodes in place rather than recreating them -- so
  // the node (and its real selection state/checkbox) is never destroyed by
  // this reordering, and no manual selection-resync effect is needed at
  // all. This ordering alone is only the *default* order though -- if the
  // user actively sorts by a column, AG Grid's own sort takes over the
  // entire row set (pinned rows included), so a pinned/selected job could
  // land on any page depending on where it falls in that column's sort
  // order. `displayColumnsWithPinning` below wraps every column's
  // comparator so pinned rows are always ordered ahead of non-pinned ones,
  // regardless of which column(s) are sorted or in which direction --
  // keeping pinned rows pinned to the top even under an active sort.
  // Keyed on a stable, joined string of ids rather than the `pinnedRowIds`
  // array reference directly: `pinnedRowIds` gets a brand-new array
  // reference on every successful squeue refresh (see its definition in
  // useSlurmQueue) even when the actual pinned id set is unchanged. Since
  // `pinnedIdSet` feeds `displayColumnsWithPinning` below (which wraps
  // every column's comparator), an unstable `pinnedIdSet` identity would
  // propagate into an unstable `columnDefs` identity on every refresh --
  // exactly the kind of unnecessary column-filter-UI rebuild that steals
  // focus from an in-progress filter edit (see `displayColumns` above for
  // the fuller explanation of why that matters).
  const pinnedIdKey = pinnedRowIds.join(',');
  const pinnedIdSet = useMemo(() => new Set(pinnedRowIds), [pinnedIdKey]);

  const orderedRowData = useMemo(() => {
    if (pinnedIdSet.size === 0) {
      return displayRows;
    }
    const byId = new Map(
      displayRows.map(row => [String(row[jobIDLabel]), row])
    );
    const pinned = pinnedRowIds
      .map(id => byId.get(id))
      .filter((row): row is Record<string, unknown> => row !== undefined);
    const rest = displayRows.filter(
      r => !pinnedIdSet.has(String(r[jobIDLabel]))
    );
    return [...pinned, ...rest];
  }, [pinnedRowIds, pinnedIdSet, displayRows, jobIDLabel]);

  // Generic fallback comparator for columns that don't define their own
  // (mirrors AG Grid's own default text/number comparison closely enough
  // for our purposes: numeric when both values are numbers, else a plain
  // string comparison, with nulls sorted first).
  const defaultCompare = useCallback((valueA: any, valueB: any) => {
    if (valueA === valueB) {
      return 0;
    }
    if (valueA === null || valueA === undefined) {
      return -1;
    }
    if (valueB === null || valueB === undefined) {
      return 1;
    }
    if (typeof valueA === 'number' && typeof valueB === 'number') {
      return valueA - valueB;
    }
    return String(valueA).localeCompare(String(valueB));
  }, []);

  // Wrap every column's comparator (whether the custom ones set in
  // `createDisplayColumnsFromServer` for NODES/TIME/JOBID, or the implicit
  // default for everything else) so a pinned row always sorts ahead of a
  // non-pinned one, no matter which column(s) the user has sorted by or in
  // which direction. AG Grid inverts a comparator's result for a
  // descending sort, so we counteract that here to keep pinned rows on top
  // even then. When both rows share the same pinned status, fall through
  // to the original per-column comparator (or the generic fallback) so
  // normal sorting behavior is otherwise unchanged.
  const displayColumnsWithPinning = useMemo(() => {
    return displayColumns.map((col: Record<string, unknown>) => {
      const original = col['comparator'] as
        | ((
            valueA: any,
            valueB: any,
            nodeA: any,
            nodeB: any,
            isDescending: boolean
          ) => number)
        | undefined;
      return {
        ...col,
        comparator: (
          valueA: any,
          valueB: any,
          nodeA: any,
          nodeB: any,
          isDescending: boolean
        ) => {
          const aPinned = pinnedIdSet.has(String(nodeA?.data?.[jobIDLabel]));
          const bPinned = pinnedIdSet.has(String(nodeB?.data?.[jobIDLabel]));
          if (aPinned !== bPinned) {
            const result = aPinned ? -1 : 1;
            return isDescending ? -result : result;
          }
          return original
            ? original(valueA, valueB, nodeA, nodeB, isDescending)
            : defaultCompare(valueA, valueB);
        }
      };
    });
  }, [displayColumns, pinnedIdSet, jobIDLabel, defaultCompare]);

  // Memoized with an empty dep array: this object is static and never
  // needs to change, but the component re-renders every second (see the
  // `now`/setInterval ticker driving the refresh-pie countdown above). A
  // plain object literal here would get a brand-new reference on every one
  // of those ticks, and AgGridReact treats a new `defaultColDef` reference
  // the same way it treats a new `columnDefs` reference: it reprocesses
  // and rebuilds each column (including its filter UI), which silently
  // steals keyboard/mouse focus from an in-progress column filter roughly
  // once a second -- the exact same class of bug already fixed for
  // `columnDefs` itself, just via a different prop.
  const defaultColDef = useMemo(
    () => ({
      editable: false,
      flex: 1,
      filter: true,
      // AG Grid doesn't show a "Clear Filter" button in the filter popup
      // by default -- without this, the only way to clear a column filter
      // is to manually delete the typed text. `buttons: ['clear']` adds
      // the native clear button to every column's filter popup.
      filterParams: { buttons: ['clear'] },
      resizable: true,
      minWidth: 120,
      wrapHeaderText: true,
      autoHeaderHeight: true,
      wrapText: false,
      autoHeight: false,
      // Shift+click multi-sort is a real AG Grid feature with zero visual
      // affordance -- without this hint, users have no way to discover it.
      // A native header tooltip is the cheapest way to surface it (shown
      // on hover, no persistent UI/toolbar real estate needed).
      headerTooltip: 'Click to sort. Shift+click to sort by multiple columns.'
    }),
    []
  );

  // Same reasoning as `defaultColDef` above: memoize so this doesn't get a
  // new reference on every per-second re-render.
  const rowSelection: RowSelectionOptions = useMemo(
    () => ({
      mode: 'multiRow',
      selectAll: 'filtered',
      checkboxes: true,
      headerCheckbox: true,
      enableClickSelection: true
    }),
    []
  );

  return (
    <div className="jp-SlurmWidget-content">
      <SqueueToolbar
        filterQuery={filterQuery}
        setFilterQuery={setFilterQuery}
        autoReload={autoReload}
        onReloadClick={reload}
        disableManualRefresh={disableManualRefresh}
        selectedCount={selectedRows.length}
        canHoldSelected={canHoldSelected}
        canReleaseSelected={canReleaseSelected}
        canSuspendSelected={canSuspendSelected}
        canResumeSelected={canResumeSelected}
        hasHeldSelected={hasHeldSelected}
        hasUnheldPdSelected={hasUnheldPdSelected}
        pauseApplicableCount={pauseApplicableCount}
        resumeApplicableCount={resumeApplicableCount}
        requeueApplicableCount={requeueApplicableCount}
        canRequeueSelected={canRequeueSelected}
        hasAdminHoldSelected={hasAdminHoldSelected}
        hasSuspendedSelected={hasSuspendedSelected}
        hasGroupedArrayRangeSelected={hasGroupedArrayRangeSelected}
        hasPdSelected={hasPdSelected}
        hasRSelected={hasRSelected}
        hasSSelected={hasSSelected}
        onClearSelected={() => gridApiRef.current?.deselectAll()}
        onShowDetails={onShowDetails}
        onJobAction={handleJobAction}
        userOnly={userOnly}
        onUserOnlyClick={() => setUserOnly(!userOnly)}
      />

      <Box
        sx={{ paddingLeft: '15px', paddingRight: '15px', marginBottom: '8px' }}
      >
        <div className={'jp-SlurmWidget-status'}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>Last updated: {lastUpdatedLabel}</span>
            {loading && <CircularProgress size={12} thickness={5} />}
          </Box>
          {loading ? (
            <div>Refreshing&hellip;</div>
          ) : (
            secondsToNextRefresh !== null && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span>Next refresh in {secondsToNextRefresh}s</span>
                {refreshElapsedPercent !== null && (
                  <span
                    className="jp-SlurmWidget-refresh-pie"
                    role="progressbar"
                    aria-label="Time until next refresh"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(refreshElapsedPercent)}
                    style={
                      {
                        '--jp-slurm-pie-percent': `${refreshElapsedPercent}%`
                      } as React.CSSProperties
                    }
                  />
                )}
              </Box>
            )
          )}
          {/* Selected rows are re-pinned to the front of `orderedRowData` on
              every refresh (see the pinning effect in useSlurmQueue), so a
              job selected while browsing a page other than the first one
              will jump onto page 1 on the next refresh -- from the user's
              current page it just looks like the selected row vanished.
              Surface that up front so it isn't mistaken for a bug/lost
              selection. */}
          {pinnedRowIds.length > 0 && (
            <div className="jp-SlurmWidget-pinned-hint">
              Selected job{pinnedRowIds.length > 1 ? 's are' : ' is'} pinned to
              page 1 and will move there on the next refresh.
            </div>
          )}
        </div>
      </Box>

      <div
        ref={containerRef}
        className="jp-SlurmWidget-table-container"
        style={{ flex: 1, minHeight: 0, width: '100%' }}
      >
        <AgGridReact
          key={gridKey}
          theme={
            themeMode === 'dark'
              ? themeQuartz.withPart(colorSchemeDark)
              : themeQuartz
          }
          rowData={orderedRowData}
          columnDefs={displayColumnsWithPinning}
          defaultColDef={defaultColDef as any}
          rowSelection={rowSelection}
          onSelectionChanged={onSelectionChanged}
          quickFilterText={filterQuery || undefined}
          onGridReady={params => {
            gridApiRef.current = params.api;
            setTimeout(() => {
              if (
                typeof params.api.isDestroyed === 'function' &&
                params.api.isDestroyed()
              ) {
                return;
              }
              // Restore the user's persisted column order/width/visibility/
              // pinning, if any, before fitting/filtering.
              if (
                Array.isArray(initialColumnState) &&
                initialColumnState.length > 0 &&
                typeof params.api.applyColumnState === 'function'
              ) {
                try {
                  params.api.applyColumnState({
                    state: initialColumnState as any,
                    applyOrder: true
                  });
                } catch (e) {
                  /* no-op */
                }
              }
              // Use the guarded helper (checks the grid's measured width is
              // > 0 before calling sizeColumnsToFit) instead of calling the
              // API directly -- a raw call here fires unconditionally 50ms
              // after grid-ready, which can land before the tab/panel is
              // actually visible/laid out (e.g. on initial app startup),
              // producing AG Grid's "error #29 ... zero width" console
              // warning.
              sizeColumnsToFitSafe();
            }, 50);
          }}
          onColumnMoved={saveColumnState}
          onColumnResized={saveColumnState}
          onColumnVisible={saveColumnState}
          onColumnPinned={saveColumnState}
          pagination={true}
          paginationAutoPageSize={props.itemsPerPageAuto}
          paginationPageSize={
            props.itemsPerPageAuto ? undefined : effectivePageSize
          }
          getRowId={params => params.data[jobIDLabel]}
          loading={loading && displayRows.length === 0}
        />
      </div>
    </div>
  );
}
