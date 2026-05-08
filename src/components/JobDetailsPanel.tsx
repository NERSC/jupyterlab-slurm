import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import EditNoteIcon from '@mui/icons-material/EditNote';

import { JupyterFrontEnd } from '@jupyterlab/application';
import { requestAPI } from '../handler';

type UiDetailsConfig = {
  details_field_groups?: Record<string, string[]>;
  details_labels?: Record<string, string>;
  details_sources?: Record<string, string>;
  details_hidden?: Record<string, any>;
};

export type JobDetailsPanelProps = {
  app: JupyterFrontEnd;
  jobIds: string[];
  initialIndex?: number;
  onSnapshotChange?: (jobIds: string[], index: number) => void;
  setBadge?: (n: number) => void;
};

type DetailsResponse = {
  success: boolean;
  exitCode?: number;
  errorMessage?: string | null;
  data?: {
    source: 'scontrol' | 'sacct' | string;
    fields: Record<string, any>;
    // Optional list of step rows when using sacct (e.g., <JOBID>.batch, .extern, task steps)
    steps?: Array<Record<string, any>>;
  };
};

function isPathLike(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^(~|\/.+|[A-Za-z]:\\)/.test(s) || /\/.+\.[A-Za-z0-9]{1,6}(\s|$)/.test(s);
}

// Join a POSIX workdir and a (possibly relative) path, and normalize .. and . segments.
function joinAndNormalizePosix(workdir: string, p: string): string {
  // If p is absolute (starts with '/') or home shortcut '~', or Windows drive, return as-is
  if (!p) return p;
  if (p.startsWith('/') || p.startsWith('~') || /^[A-Za-z]:\\/.test(p)) {
    return p;
  }
  // Ensure workdir is defined and absolute-like; fallback to p if not
  let base = workdir && workdir.length ? workdir : '';
  if (!base) return p;
  // Remove trailing slash from base (except root)
  if (base.length > 1 && base.endsWith('/')) {
    base = base.replace(/\/+$/, '');
  }
  // Build combined path and normalize segments
  const raw = `${base}/${p}`;
  const parts = raw.split('/');
  const stack: string[] = [];
  for (const seg of parts) {
    if (seg === '' || seg === '.') {
      continue;
    }
    if (seg === '..') {
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }
    stack.push(seg);
  }
  return '/' + stack.join('/');
}

function resolveForActions(pathValue?: string, workdir?: string): string | undefined {
  if (!pathValue) return undefined;
  try {
    return joinAndNormalizePosix(workdir ?? '', pathValue);
  } catch {
    return pathValue;
  }
}

export default function JobDetailsPanel(props: JobDetailsPanelProps) {
  const [uiCfg, setUiCfg] = useState<UiDetailsConfig>({});
  const [index, setIndex] = useState(props.initialIndex ?? 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, any> | null>(null);
  const [steps, setSteps] = useState<Array<Record<string, any>>>([]);

  const jobIds = props.jobIds ?? [];
  const currentJobId = jobIds[index];

  // Update badge on mount / change
  useEffect(() => {
    props.setBadge?.(jobIds.length);
  }, [jobIds.length]);

  // Fetch UI config once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await requestAPI<any>('ui-config');
        if (!cancelled) {
          setUiCfg(resp?.data ?? {});
        }
      } catch (e) {
        // ignore, use defaults
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const POLL_INTERVAL_MS = 15000;
  const TERMINAL_STATES = new Set([
    'COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'OUT_OF_MEMORY',
    'NODE_FAIL', 'PREEMPTED', 'BOOT_FAIL', 'DEADLINE', 'REVOKED'
  ]);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // Fetch job details. When `silent` is true (background refresh), errors are
  // swallowed and the existing fields stay visible so the UI is never blanked
  // by a transient network hiccup.
  const fetchDetails = useCallback(async (id: string, silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
      setFields(null);
      setSteps([]);
    }
    try {
      const resp = await requestAPI<DetailsResponse>(`job/${encodeURIComponent(id)}`);
      if (!resp.success) {
        throw new Error(resp.errorMessage || 'Failed to fetch job details');
      }
      setFields(resp.data?.fields ?? {});
      setSteps(Array.isArray(resp.data?.steps) ? (resp.data?.steps as any[]) : []);
    } catch (e: any) {
      if (!silent) {
        setError(e?.message ?? String(e));
        setFields(null);
        setSteps([]);
      }
      // Silent refreshes: keep existing data, just skip the update
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  // Initial fetch when job changes
  useEffect(() => {
    clearPollTimer();
    if (currentJobId) {
      void fetchDetails(currentJobId);
    }
  }, [currentJobId, fetchDetails, clearPollTimer]);

  // Auto-refresh polling for active (non-terminal) jobs
  useEffect(() => {
    clearPollTimer();
    const state = fields?.['State'];
    if (!currentJobId || !state || TERMINAL_STATES.has(state)) {
      return;
    }
    pollTimerRef.current = setTimeout(() => {
      void fetchDetails(currentJobId, true);
    }, POLL_INTERVAL_MS);
    return clearPollTimer;
  }, [fields, currentJobId, fetchDetails, clearPollTimer]);

  // Clean up timer on unmount
  useEffect(() => {
    return clearPollTimer;
  }, [clearPollTimer]);

  const labels = uiCfg.details_labels ?? {};

  const summaryRows = useMemo(() => {
    const f = fields ?? {};
    return [
      { k: 'JobID', v: f['JobID'] },
      { k: 'JobName', v: f['JobName'] },
      { k: 'Command', v: f['Command'] },
      { k: 'User', v: f['User'] },
      { k: 'QOS', v: f['QOS'] },
      { k: 'Account', v: f['Account'] },
      { k: 'Partition', v: f['Partition'] },
      { k: 'State', v: f['State'] },
      { k: 'Reason', v: f['Reason'] },
      { k: 'ExitCode', v: f['ExitCode'] }
    ];
  }, [fields]);

  const timingRows = useMemo(() => {
    const f = fields ?? {};
    return [
      { k: 'SubmitTime', v: f['SubmitTime'], label: 'Submitted' },
      { k: 'StartTime', v: f['StartTime'], label: 'Start' },
      { k: 'EndTime', v: f['EndTime'], label: 'End' },
      { k: 'Elapsed', v: f['Elapsed'], label: 'Elapsed' }
    ];
  }, [fields]);

  const resourceRows = useMemo(() => {
    const f = fields ?? {};
    return [
      { k: 'NodeList', v: f['NodeList'], label: 'Node(s)' },
      { k: 'Nodes', v: f['Nodes'], label: 'Num Nodes' },
      { k: 'CPUs', v: f['CPUs'], label: 'CPUs' },
      { k: 'GPUs', v: f['GPUs'], label: 'GPUs' },
      { k: 'Tasks', v: f['Tasks'], label: 'Tasks' },
      { k: 'ReqMem', v: f['ReqMem'], label: 'Requested Memory' },
      { k: 'MaxRSS', v: f['MaxRSS'], label: 'Peak Memory (MaxRSS)' },
      { k: 'TotalCPU', v: f['TotalCPU'], label: 'Total CPU Time' },
      { k: 'UserCPU', v: f['UserCPU'], label: 'User CPU' },
      { k: 'SystemCPU', v: f['SystemCPU'], label: 'System CPU' },
      { k: 'AveDiskRead', v: f['AveDiskRead'], label: 'Avg Disk Read' },
      { k: 'GRES', v: f['GRES'], label: 'GPUs / GRES' },
      { k: 'AveDiskWrite', v: f['AveDiskWrite'], label: 'Avg Disk Write' }
    ];
  }, [fields]);

  const [commandExpanded, setCommandExpanded] = useState(false);

  const onPrev = useCallback(() => {
    const n = Math.max(0, index - 1);
    setIndex(n);
    props.onSnapshotChange?.(jobIds, n);
  }, [index, jobIds]);
  const onNext = useCallback(() => {
    const n = Math.min(jobIds.length - 1, index + 1);
    setIndex(n);
    props.onSnapshotChange?.(jobIds, n);
  }, [index, jobIds]);

  const openInEditor = useCallback(async (path?: string) => {
    if (!path) return;
    try {
      await props.app.commands.execute('docmanager:open', { path, factory: 'Editor' });
    } catch (e) {
      console.warn('Failed to open in editor', e);
    }
  }, [props.app]);

  const openFolder = useCallback(async (path?: string) => {
    if (!path) return;
    try {
      await props.app.commands.execute('filebrowser:go-to-path', { path });
    } catch (e) {
      console.warn('Failed to open folder', e);
    }
  }, [props.app]);

  const copyToClipboard = useCallback(async (text?: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.warn('Failed to copy', e);
    }
  }, []);

  const copyMarkdownToClipboard = useCallback(() => {
    if (!fields) return;
    const labels = uiCfg.details_labels ?? {};
    let md = `### Slurm Job Report: ${fields['JobID'] || currentJobId}\n\n`;
    
    md += '| Field | Value |\n| :--- | :--- |\n';
    
    const allRows: Array<{ k: string; v: any; label?: string }> = [...summaryRows, ...timingRows, ...resourceRows];
    for (const row of allRows) {
      if (row.v !== undefined && row.v !== null) {
        const label = row.label || labels[row.k] || row.k;
        md += `| **${label}** | ${row.v} |\n`;
      }
    }

    if (fields['WorkDir']) md += `\n**WorkDir**: \`${fields['WorkDir']}\``;
    if (fields['Stdout']) md += `\n**Stdout**: \`${fields['Stdout']}\``;
    if (fields['Stderr']) md += `\n**Stderr**: \`${fields['Stderr']}\``;
    
    copyToClipboard(md);
  }, [fields, summaryRows, timingRows, resourceRows, uiCfg.details_labels, currentJobId, copyToClipboard]);

  const copyJsonToClipboard = useCallback(() => {
    if (!fields) return;
    copyToClipboard(JSON.stringify(fields, null, 2));
  }, [fields, copyToClipboard]);

  return (
    <Stack spacing={1} sx={{ p: 1.5 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="h6" sx={{ flex: 1 }}>
          Job {currentJobId ?? '—'}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold' }}>
            Copy Job Details to Clipboard:
          </Typography>
          <Button
            size="small"
            startIcon={<ContentCopyIcon fontSize="inherit" />}
            onClick={copyMarkdownToClipboard}
            disabled={!fields}
            sx={{ textTransform: 'none', fontSize: '0.75rem', py: 0 }}
          >
            Markdown
          </Button>
          <Button
            size="small"
            startIcon={<ContentCopyIcon fontSize="inherit" />}
            onClick={copyJsonToClipboard}
            disabled={!fields}
            sx={{ textTransform: 'none', fontSize: '0.75rem', py: 0 }}
          >
            JSON
          </Button>
          <IconButton size="small" onClick={onPrev} disabled={index <= 0} aria-label="Previous job" sx={{ ml: 1 }}>
            <ArrowBackIosNewIcon fontSize="small" />
          </IconButton>
          <Typography variant="body2">{jobIds.length ? `${index + 1} / ${jobIds.length}` : '0 / 0'}</Typography>
          <IconButton size="small" onClick={onNext} disabled={index >= jobIds.length - 1} aria-label="Next job">
            <ArrowForwardIosIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Stack>

      {loading && <Typography variant="body2">Loading…</Typography>}
      {!loading && error && <Typography color="error">{error}</Typography>}

      {!loading && !error && fields && (
        <Stack spacing={1.25}>
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Summary</Typography>
            <Stack spacing={0.5}>
              {summaryRows.map((row: { k: string; v: any }) => {
                const label = labels[row.k] ?? row.k;
                if (row.k === 'Command') {
                  const v = row.v as string | undefined;
                  const resolved = resolveForActions(v, fields?.['WorkDir']);
                  const truncated = !!v && v.length > 80; // heuristic
                  const showFullToggle = truncated && !commandExpanded;
                  const display = !v ? '—' : (commandExpanded || !truncated ? v : `${v.slice(0, 77)}…`);
                  return (
                    <Stack key={row.k} direction="row" alignItems="center" spacing={1}>
                      <Typography variant="body2" sx={{ minWidth: 96 }}>{label}:</Typography>
                      <Tooltip title={(v && resolved && resolved !== v) ? `${v}\n→ ${resolved}` : (v ?? '')} disableHoverListener={!truncated}>
                        <Typography variant="body2" sx={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {display}
                        </Typography>
                      </Tooltip>
                      {!!resolved && isPathLike(resolved) && (
                        <>
                          <Tooltip title="Open in Editor"><IconButton size="small" onClick={() => openInEditor(resolved)} aria-label="Open in Editor"><EditNoteIcon fontSize="small" /></IconButton></Tooltip>
                          <Tooltip title="Open containing folder"><IconButton size="small" onClick={() => openFolder(resolved)} aria-label="Open folder"><FolderOpenIcon fontSize="small" /></IconButton></Tooltip>
                        </>
                      )}
                      {!!v && (
                        <Tooltip title="Copy command"><IconButton size="small" onClick={() => copyToClipboard(v)} aria-label="Copy command"><ContentCopyIcon fontSize="small" /></IconButton></Tooltip>
                      )}
                      {showFullToggle && (
                        <Button size="small" onClick={() => setCommandExpanded(true)}>Show full</Button>
                      )}
                      {commandExpanded && truncated && (
                        <Button size="small" onClick={() => setCommandExpanded(false)}>Show less</Button>
                      )}
                    </Stack>
                  );
                }
                return (
                  <Stack key={row.k} direction="row" alignItems="center" spacing={1}>
                    <Typography variant="body2" sx={{ minWidth: 96 }}>{label}:</Typography>
                    <Typography variant="body2" sx={{ flex: 1 }}>{row.v ?? '—'}</Typography>
                    {row.k === 'State' && row.v && (
                      <Chip size="small" label={row.v} />
                    )}
                    {row.k === 'Reason' && row.v && row.v !== 'None' && (
                      <Chip size="small" label={row.v} color="warning" variant="outlined" />
                    )}
                  </Stack>
                );
              })}
            </Stack>
          </Box>

          {/* Timing section */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Timing</Typography>
            <Stack spacing={0.5}>
              {timingRows.map((row: { k: string; v: any; label: string }) => (
                <Stack key={row.k} direction="row" alignItems="center" spacing={1}>
                  <Typography variant="body2" sx={{ minWidth: 96 }}>{row.label}:</Typography>
                  <Typography variant="body2" sx={{ flex: 1 }}>{row.v ?? '—'}</Typography>
                </Stack>
              ))}
            </Stack>
          </Box>

          {/* Resources section */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Resources</Typography>
            <Stack spacing={0.5}>
              {resourceRows.filter((row: { k: string; v: any; label: string }) => row.v).map((row: { k: string; v: any; label: string }) => (
                <Stack key={row.k} direction="row" alignItems="center" spacing={1}>
                  <Typography variant="body2" sx={{ minWidth: 160 }}>{row.label}:</Typography>
                  <Typography variant="body2" sx={{ flex: 1 }}>{row.v ?? '—'}</Typography>
                </Stack>
              ))}
            </Stack>
          </Box>

          {/* Steps section (from sacct), if available */}
          {!!steps && steps.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Steps</Typography>
              <Stack spacing={0.5}>
                {steps.map((s, idx) => {
                  const jid = s['JobID'] ?? s['JobId'] ?? s['Id'] ?? `step-${idx}`;
                  const state = s['State'] ?? '—';
                  const exit = s['ExitCode'] ?? s['DerivedExitCode'] ?? '—';
                  const start = s['Start'] ?? s['StartTime'] ?? '—';
                  const end = s['End'] ?? s['EndTime'] ?? '—';
                  const elapsed = s['Elapsed'] ?? '—';
                  return (
                    <Stack key={`${jid}-${idx}`} direction="row" alignItems="center" spacing={1}>
                      <Typography variant="body2" sx={{ minWidth: 140 }}>{jid}</Typography>
                      <Chip size="small" label={state} />
                      <Typography variant="body2" sx={{ ml: 1 }}>Exit: {exit}</Typography>
                      <Typography variant="body2" sx={{ ml: 2 }}>Start: {start}</Typography>
                      <Typography variant="body2" sx={{ ml: 2 }}>End: {end}</Typography>
                      <Typography variant="body2" sx={{ ml: 2 }}>Elapsed: {elapsed}</Typography>
                    </Stack>
                  );
                })}
              </Stack>
            </Box>
          )}

          {/* Logs section (basic skeleton) */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Logs</Typography>
            {['Stdout','Stderr','WorkDir'].map(k => {
              const v = fields?.[k];
              const resolved = resolveForActions(typeof v === 'string' ? v : undefined, fields?.['WorkDir']);
              const label = labels[k] ?? k;
              const isDirectory = k === 'WorkDir';
              return (
                <Stack key={k} direction="row" alignItems="center" spacing={1}>
                  <Typography variant="body2" sx={{ minWidth: 96 }}>{label}:</Typography>
                  <Tooltip title={(v && resolved && resolved !== v) ? `${v}\n→ ${resolved}` : (v ?? '')}>
                    <Typography variant="body2" sx={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v ?? '—'}</Typography>
                  </Tooltip>
                  {resolved && isPathLike(resolved) && (
                    <>
                      {!isDirectory && (
                        <Tooltip title="Open in Editor"><IconButton size="small" onClick={() => openInEditor(resolved)} aria-label="Open in Editor"><EditNoteIcon fontSize="small" /></IconButton></Tooltip>
                      )}
                      <Tooltip title={isDirectory ? "Open folder" : "Open containing folder"}>
                        <IconButton size="small" onClick={() => openFolder(resolved)} aria-label="Open folder"><FolderOpenIcon fontSize="small" /></IconButton>
                      </Tooltip>
                    </>
                  )}
                  {!isDirectory && v && (
                    <Tooltip title="Copy path"><IconButton size="small" onClick={() => copyToClipboard(v)} aria-label="Copy path"><ContentCopyIcon fontSize="small" /></IconButton></Tooltip>
                  )}
                </Stack>
              );
            })}
          </Box>
        </Stack>
      )}
    </Stack>
  );
}
