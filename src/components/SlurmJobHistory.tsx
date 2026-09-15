'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

import {
  Badge,
  Button,
  ButtonGroup,
  CircularProgress,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography
} from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ReplayIcon from '@mui/icons-material/Replay';
import RestartAltIcon from '@mui/icons-material/RestartAlt';

import { requestAPI } from '../handler';
// Import from the package root (not a deep `lib/...` path) so webpack's
// module-federation sharing keys on `@jupyterlab/apputils` and reuses the
// same `Notification.manager` singleton the running JupyterLab shell's
// toast UI is subscribed to; a deep import bundles a private, disconnected
// copy that the shell never observes. This matches the pattern already
// used by the Queue tab (SqueueDataTable.tsx) so both tabs' notifications
// surface through the same JupyterLab toast UI, rather than Job History
// using its own separate MUI Snackbar/Alert popups.
import { Notification } from '@jupyterlab/apputils';

import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ColDef,
  ITooltipParams,
  ModuleRegistry,
  RowSelectionOptions,
  themeQuartz,
  colorSchemeDark
} from 'ag-grid-community';

// Register Community features we need
ModuleRegistry.registerModules([AllCommunityModule]);

import { JupyterFrontEnd } from '@jupyterlab/application';
import { useSlurmHistory } from '../hooks/useSlurmHistory';
import { useJupyterThemeMode } from '../utils/theme';
import { truncateForToast, parseJobID } from '../utils/slurm-parsing';

namespace types {
  export type Props = {
    userName: string;
    jupyterLabFrontend: JupyterFrontEnd;
    // Whether this tab is currently visible/active. History is refetched when
    // it becomes active so a kept-mounted tab shows fresh data on each visit.
    active?: boolean;
  };
}

export default function SlurmJobHistory(props: types.Props) {
  const gridApiRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { loading, error, columns, rows, historyLabels, fetchHistory } =
    useSlurmHistory(props.userName);

  const [selectedCount, setSelectedCount] = useState<number>(0);
  const [requeueMenuAnchor, setRequeueMenuAnchor] =
    useState<HTMLElement | null>(null);
  const [requeueOption, setRequeueOption] = useState<
    'requeue' | 'requeuehold'
  >('requeue');
  const [requeueInFlight, setRequeueInFlight] = useState(false);

  const copyToClipboard = useCallback(async (text: string, format: string) => {
    try {
      await navigator.clipboard.writeText(text);
      Notification.success(`${format} copied to clipboard`, { autoClose: 3000 });
    } catch (e) {
      console.warn('Failed to copy', e);
      Notification.error('Failed to copy to clipboard', { autoClose: 3000 });
    }
  }, []);

  const copyMarkdownToClipboard = useCallback(() => {
    if (!rows.length) {
      return;
    }
    const labels = historyLabels;
    const cols = columns;
    const headerRow = cols.map(c => labels[c] ?? c);
    let md = '### Slurm Job History\n\n';
    md += '| ' + headerRow.join(' | ') + ' |\n';
    md += '| ' + headerRow.map(() => ':---').join(' | ') + ' |\n';
    for (const row of rows) {
      const vals = cols.map(c => (row[c] ?? '').toString());
      md += '| ' + vals.join(' | ') + ' |\n';
    }
    copyToClipboard(md, 'Markdown');
  }, [rows, columns, historyLabels, copyToClipboard]);

  const copyJsonToClipboard = useCallback(() => {
    if (!rows.length) {
      return;
    }
    const labels = historyLabels;
    const labeled = rows.map(row => {
      const obj: Record<string, string> = {};
      for (const c of columns) {
        obj[labels[c] ?? c] = (row[c] ?? '').toString();
      }
      return obj;
    });
    copyToClipboard(JSON.stringify(labeled, null, 2), 'JSON');
  }, [rows, columns, historyLabels, copyToClipboard]);

  const sizeColumnsToFitSafe = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) {
      return;
    }
    if (typeof api.isDestroyed === 'function' && api.isDestroyed()) {
      return;
    }
    try {
      const sz = api.getGridSize ? api.getGridSize() : null;
      if (!sz || (sz && sz.width > 0)) {
        api.sizeColumnsToFit();
      }
    } catch (e) {
      // ignore
    }
  }, []);

  const onGridReady = useCallback((params: any) => {
    gridApiRef.current = params.api;
    try {
      const sz = params.api.getGridSize ? params.api.getGridSize() : null;
      if (!sz || (sz && sz.width > 0)) {
        params.api.sizeColumnsToFit();
      }
    } catch (e) {
      // ignore
    }
  }, []);

  const getSelectedJobIdsInDisplayOrder = useCallback((): string[] => {
    const api = gridApiRef.current;
    if (!api) {
      return [];
    }
    const ids: string[] = [];
    const count = api.getDisplayedRowCount ? api.getDisplayedRowCount() : 0;
    for (let i = 0; i < count; i++) {
      const row = api.getDisplayedRowAtIndex(i);
      if (row && row.isSelected && row.isSelected()) {
        const data = row.data || {};
        const id = (data['JobID'] ?? data['JOBID'] ?? '').toString();
        if (id) {
          ids.push(id);
        }
      }
    }
    return ids;
  }, []);

  // Without a stable `getRowId`, AG Grid falls back to identifying rows by
  // array index/object identity. Every `fetchHistory()` call (including the
  // "Refresh" button) replaces `rows` with a brand-new array, which AG Grid
  // then treats as an entirely new row set -- silently clearing the current
  // selection even though the same jobs are still present. `selectedCount`
  // (driven by `onSelectionChanged`) doesn't fire for this implicit clear,
  // which is why "Show Details" kept showing a stale badge count for a
  // selection that visually looked cleared. Keying rows by JobID lets AG
  // Grid recognize "the same job" across a refresh and preserve selection.
  const getRowId = useCallback((params: any) => {
    const data = params.data || {};
    return (data['JobID'] ?? data['JOBID'] ?? '').toString();
  }, []);

  const onSelectionChanged = useCallback(() => {
    const ids = getSelectedJobIdsInDisplayOrder();
    setSelectedCount(ids.length);
  }, [getSelectedJobIdsInDisplayOrder]);

  // Requeue is the one queue-management action that can genuinely still
  // succeed on a job shown in Job History: real Slurm keeps a finished job
  // live in the controller (and thus requeueable) for a short,
  // site-configurable grace window after it ends (`MinJobAge` --
  // e.g. 300s/5min on both this test cluster and real Perlmutter), after
  // which `scontrol requeue` fails with "Invalid job id specified" because
  // the job has been fully purged to the accounting database. Rather than
  // guessing that window client-side (site-dependent, and scheduler timing
  // adds slack anyway), always offer the action and let the real API
  // response be the source of truth -- success refreshes history and
  // reloads the job back into the live queue; failure surfaces a clear,
  // non-crashing message via the existing error Snackbar.
  const requeueActionVerb: Record<'requeue' | 'requeuehold', string> = {
    requeue: 'Requeued',
    requeuehold: 'Requeued & Held'
  };

  const handleRequeue = useCallback(
    async (action: 'requeue' | 'requeuehold') => {
      const jobIds = getSelectedJobIdsInDisplayOrder();
      if (!jobIds.length) {
        return;
      }
      setRequeueInFlight(true);
      try {
        const result = await requestAPI<any>(
          `scontrol/${action}`,
          new URLSearchParams(),
          {
            body: JSON.stringify({ job_ids: jobIds }),
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' }
          }
        );
        const succeeded = result?.success === true || result?.exitCode === 0;
        if (succeeded) {
          const verb = requeueActionVerb[action];
          const jobWord = jobIds.length === 1 ? 'job' : 'jobs';
          const timestamp = new Date().toLocaleTimeString();
          Notification.success(
            `${verb} ${jobIds.length} ${jobWord}: ${jobIds.join(', ')} (${timestamp}). It will now appear in the live Queue.`,
            { autoClose: 6000 }
          );
          void fetchHistory();
        } else {
          console.error(
            `Action ${action} failed`,
            result?.errorMessage ?? result?.responseMessage
          );
          // JupyterLab's toast renders on a single line and clips (rather
          // than wraps) anything past its fixed width, so a long raw
          // scontrol/scancel error can get cut off mid-word. Truncate the
          // detail shown in the toast; the untruncated text was already
          // logged to the console above.
          const detail = result?.errorMessage
            ? `: ${truncateForToast(result.errorMessage)}`
            : '';
          Notification.error(
            `Requeue failed for job(s) ${jobIds.join(', ')}${detail}. This is expected once a job has been purged from the scheduler (typically a few minutes after it finishes).`,
            { autoClose: 6000 }
          );
        }
      } catch (e: any) {
        console.error('Requeue action failed', e);
        Notification.error(
          `Requeue failed for job(s) ${jobIds.join(', ')}${e?.message ? `: ${e.message}` : ''}. This is expected once a job has been purged from the scheduler (typically a few minutes after it finishes).`,
          { autoClose: 6000 }
        );
      } finally {
        setRequeueInFlight(false);
      }
    },
    [getSelectedJobIdsInDisplayOrder, fetchHistory]
  );

  // Default sort: most recently finished jobs at the top. The set of sacct
  // fields is admin-configurable (`SlurmAccounting.sacct_fields`), so we
  // can't assume a fixed column exists -- prefer a genuine end-time column
  // if the site has configured one, otherwise fall back to submit time
  // (which is included by default), so history is still time-descending
  // even without an explicit "End" field.
  const defaultSortField = useMemo(() => {
    if (columns.includes('End')) {
      return 'End';
    }
    if (columns.includes('Submit')) {
      return 'Submit';
    }
    return null;
  }, [columns]);

  const columnDefs = useMemo<ColDef[]>(() => {
    return columns.map(c => {
      const col: ColDef = {
        field: c,
        headerName: historyLabels[c] ?? c,
        sortable: true,
        resizable: true,
        filter: true,
        tooltipValueGetter: (p: ITooltipParams) => `${p.value ?? ''}`
      };
      // The JobID column should sort numerically on the underlying Slurm
      // job id (matching the Queue tab's JOBID comparator), not as a plain
      // string -- otherwise e.g. "10" sorts before "2" and array-job ids
      // like "123_5" sort unpredictably relative to their base job.
      if (c === 'JobID' || c === 'JOBID') {
        col.comparator = (valueA: any, valueB: any) =>
          parseJobID(String(valueA ?? '')) - parseJobID(String(valueB ?? ''));
      }
      if (defaultSortField && c === defaultSortField) {
        col.sort = 'desc';
      }
      return col;
    });
  }, [columns, historyLabels, defaultSortField]);

  const themeMode = useJupyterThemeMode();
  const gridTheme = useMemo(() => {
    const base = themeQuartz.withParams({ headerHeight: 34, rowHeight: 30 });
    return themeMode === 'dark' ? base.withPart(colorSchemeDark) : base;
  }, [themeMode]);

  const defaultColDef = useMemo<ColDef>(
    () => ({
      resizable: true,
      sortable: true,
      filter: true,
      // AG Grid doesn't show a "Clear Filter" button in the filter popup
      // by default -- without this, the only way to clear a column filter
      // is to manually delete the typed text. `buttons: ['clear']` adds
      // the native clear button to every column's filter popup.
      filterParams: { buttons: ['clear'] },
      flex: 1,
      minWidth: 120,
      wrapHeaderText: true as any,
      autoHeaderHeight: true as any,
      wrapText: false as any,
      autoHeight: false as any
    }),
    []
  );

  // Modern object-form `rowSelection` config (the string values
  // 'single'/'multiple', plus `rowMultiSelectWithClick` and
  // `suppressRowClickSelection`, were deprecated in AG Grid v32.2 in favor
  // of this). `checkboxes: true` + `headerCheckbox: true` fully own
  // checkbox rendering now -- do NOT also set a per-column
  // `checkboxSelection`/`headerCheckboxSelection` flag, since combining
  // both renders two checkboxes per row. `enableClickSelection` +
  // `enableSelectionWithoutKeys` preserve the previous
  // `suppressRowClickSelection={false}` + `rowMultiSelectWithClick={true}`
  // behavior (row click selects, and multiple rows can be selected via
  // click without holding ctrl/shift). Memoized with an empty dep array
  // since it's static and this component re-renders periodically.
  const rowSelection: RowSelectionOptions = useMemo(
    () => ({
      mode: 'multiRow',
      checkboxes: true,
      headerCheckbox: true,
      enableClickSelection: true,
      enableSelectionWithoutKeys: true
    }),
    []
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    let rafId: number | null = null;
    let lastWidth = 0;
    const ro = new (window as any).ResizeObserver(() => {
      const w = el.offsetWidth || 0;
      if (w > 0 && w !== lastWidth) {
        lastWidth = w;
        if (rafId) {
          cancelAnimationFrame(rafId);
        }
        rafId = requestAnimationFrame(() => {
          sizeColumnsToFitSafe();
        });
      }
    });
    ro.observe(el);
    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      ro.disconnect();
    };
  }, [sizeColumnsToFitSafe]);

  // Refetch history when the tab transitions from hidden -> active. The hook
  // already fetches once on mount, so we skip the very first activation to
  // avoid a duplicate initial request.
  const wasActiveRef = useRef<boolean>(props.active !== false);
  useEffect(() => {
    const isActive = props.active !== false;
    if (isActive && !wasActiveRef.current) {
      void fetchHistory();
      // Re-fit columns once shown; AG Grid measures width 0 while hidden.
      const id = setTimeout(() => sizeColumnsToFitSafe(), 50);
      wasActiveRef.current = isActive;
      return () => clearTimeout(id);
    }
    wasActiveRef.current = isActive;
  }, [props.active, fetchHistory, sizeColumnsToFitSafe]);

  return (
    <div className="jp-SlurmWidget-content">
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ mb: 1, mx: 1 }}
      >
        <Typography variant="h6" component="div" sx={{ flex: 1, ml: 1 }}>
          Job History{props.userName ? ` for ${props.userName}` : ''}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontWeight: 'bold' }}
          >
            Copy to Clipboard:
          </Typography>
          <Button
            size="small"
            startIcon={<ContentCopyIcon fontSize="inherit" />}
            onClick={copyMarkdownToClipboard}
            disabled={!rows.length}
            sx={{ textTransform: 'none', fontSize: '0.75rem', py: 0 }}
          >
            Markdown
          </Button>
          <Button
            size="small"
            startIcon={<ContentCopyIcon fontSize="inherit" />}
            onClick={copyJsonToClipboard}
            disabled={!rows.length}
            sx={{ textTransform: 'none', fontSize: '0.75rem', py: 0 }}
          >
            JSON
          </Button>
        </Stack>
        <Button
          onClick={fetchHistory}
          variant="outlined"
          size="small"
          startIcon={<ReplayIcon fontSize="small" />}
          aria-label="Refresh job history"
        >
          Refresh
        </Button>
        <Tooltip
          title={
            requeueOption === 'requeue'
              ? 'Requeue the selected job(s) from the beginning. Only works within a short window after a job finishes (typically a few minutes, site-dependent) -- Slurm rejects requeuing a job it has already purged from the scheduler.'
              : 'Requeue the selected job(s) and immediately hold them. Only works within a short window after a job finishes (typically a few minutes, site-dependent) -- Slurm rejects requeuing a job it has already purged from the scheduler.'
          }
        >
          <span>
            <ButtonGroup size="small" disabled={selectedCount === 0 || requeueInFlight}>
              <Button onClick={() => handleRequeue(requeueOption)}>
                <RestartAltIcon fontSize="small" />
                Requeue
              </Button>
              <Button
                size="small"
                aria-label="select requeue option"
                onClick={event => setRequeueMenuAnchor(event.currentTarget)}
              >
                <ArrowDropDownIcon />
              </Button>
            </ButtonGroup>
          </span>
        </Tooltip>
        <Menu
          anchorEl={requeueMenuAnchor}
          open={Boolean(requeueMenuAnchor)}
          onClose={() => setRequeueMenuAnchor(null)}
        >
          <MenuItem
            selected={requeueOption === 'requeue'}
            onClick={() => {
              setRequeueOption('requeue');
              setRequeueMenuAnchor(null);
            }}
          >
            Requeue
          </MenuItem>
          <MenuItem
            selected={requeueOption === 'requeuehold'}
            onClick={() => {
              setRequeueOption('requeuehold');
              setRequeueMenuAnchor(null);
            }}
          >
            Requeue &amp; Hold
          </MenuItem>
        </Menu>
        <Button
          onClick={() => {
            const ids = getSelectedJobIdsInDisplayOrder();
            if (!ids.length) {
              return;
            }
            try {
              const result = props.jupyterLabFrontend.commands.execute(
                'jupyterlab-slurm:show-job-details',
                { jobIds: ids, index: 0 }
              );
              if (result && typeof (result as any).then === 'function') {
                (result as Promise<any>).catch(e => {
                  console.error('Failed to open Job Details from history', e);
                  Notification.error(
                    'Failed to open Job Details. You may not have permission to view one or more selected jobs.',
                    { autoClose: 6000 }
                  );
                });
              }
            } catch (e) {
              console.error('Failed to open Job Details from history', e);
              Notification.error(
                'Failed to open Job Details. You may not have permission to view one or more selected jobs.',
                { autoClose: 6000 }
              );
            }
          }}
          variant="contained"
          size="small"
          disabled={selectedCount === 0}
        >
          Show Details
          {selectedCount > 0 && (
            <Badge
              className={'jp-SlurmWidget-table-button-badge'}
              badgeContent={selectedCount}
              color={'secondary'}
            />
          )}
        </Button>
      </Stack>

      {/* Only show the full-panel spinner on the very first load (before we
          have any columns to render a grid with). Subsequent refreshes
          (e.g. clicking "Refresh") keep the AG Grid mounted -- unmounting
          it on every `loading` transition would destroy the grid's
          internal selection state entirely, regardless of `getRowId`,
          which is why refreshing history with jobs selected previously
          cleared the selection. */}
      {loading && columns.length === 0 && (
        <Stack
          alignItems="center"
          justifyContent="center"
          sx={{ flex: 1, minHeight: 160 }}
        >
          <CircularProgress size={24} />
        </Stack>
      )}

      {!(loading && columns.length === 0) && error && (
        <Stack spacing={1} sx={{ p: 2 }}>
          <Typography color="error">{error}</Typography>
          <Button onClick={fetchHistory} variant="contained" size="small">
            Try Again
          </Button>
        </Stack>
      )}

      {!(loading && columns.length === 0) && !error && (
        <div className={'jp-SlurmWidget-table'} ref={containerRef}>
          <AgGridReact
            columnDefs={columnDefs}
            rowData={rows}
            getRowId={getRowId}
            defaultColDef={defaultColDef}
            theme={gridTheme}
            onGridReady={onGridReady}
            onFirstDataRendered={sizeColumnsToFitSafe}
            onGridSizeChanged={sizeColumnsToFitSafe}
            rowSelection={rowSelection}
            onSelectionChanged={onSelectionChanged as any}
          />
        </div>
      )}
    </div>
  );
}
