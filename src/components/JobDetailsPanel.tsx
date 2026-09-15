import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, Divider, IconButton, Stack, Typography } from '@mui/material';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import ArrowBackIosNewIconMui from '@mui/icons-material/ArrowBackIosNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

import { JupyterFrontEnd } from '@jupyterlab/application';
import { Notification } from '@jupyterlab/apputils';
import { JobField } from './JobField';
import { JupyterThemeProvider } from './JupyterThemeProvider';
import { useJobDetails } from '../hooks/useJobDetails';
import { toRootRelativePath } from '../utils/paths';

export type JobDetailsPanelProps = {
  app: JupyterFrontEnd;
  jobIds: string[];
  initialIndex?: number;
  onSnapshotChange?: (jobIds: string[], index: number) => void;
  setBadge?: (n: number) => void;
};

export default function JobDetailsPanel(props: JobDetailsPanelProps) {
  const [index, setIndex] = useState(props.initialIndex ?? 0);
  const [commandExpanded, setCommandExpanded] = useState(false);

  const jobIds = props.jobIds ?? [];
  const currentJobId = jobIds[index];

  const { uiCfg, loading, error, fields, steps, nextPollAt, pollIntervalMs } =
    useJobDetails(currentJobId);

  // Update badge
  React.useEffect(() => {
    props.setBadge?.(jobIds.length);
  }, [jobIds.length, props]);

  // Live "now" ticker so the "Next update" countdown/pie timer stays
  // current, following the same pattern used for the queue's refresh pie
  // timer in SqueueDataTable.tsx.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!nextPollAt) {
      return;
    }
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [nextPollAt]);

  const secondsToNextUpdate = useMemo(() => {
    if (!nextPollAt) {
      return null;
    }
    return Math.max(0, Math.ceil((nextPollAt.getTime() - now) / 1000));
  }, [nextPollAt, now]);

  const nextUpdateElapsedPercent = useMemo(() => {
    if (!nextPollAt || !pollIntervalMs) {
      return null;
    }
    const remainingMs = Math.max(0, nextPollAt.getTime() - now);
    const elapsedMs = Math.min(
      pollIntervalMs,
      Math.max(0, pollIntervalMs - remainingMs)
    );
    return (elapsedMs / pollIntervalMs) * 100;
  }, [nextPollAt, now, pollIntervalMs]);

  const labels = uiCfg.details_labels ?? {};

  const summaryRows = useMemo(() => {
    const f = fields ?? {};
    return [
      { k: 'JobID', v: f['JobID'] },
      { k: 'JobName', v: f['JobName'] },
      {
        k: 'Command',
        v: f['Command'],
        isCommand: true,
        commandScript: f['CommandScript']
      },
      { k: 'User', v: f['User'] },
      { k: 'QOS', v: f['QOS'] },
      { k: 'Account', v: f['Account'] },
      { k: 'Partition', v: f['Partition'] },
      { k: 'State', v: f['State'], isStatus: true },
      { k: 'Reason', v: f['Reason'], isReason: true },
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
      { k: 'GPUType', v: f['GPUType'], label: 'GPU Type' },
      { k: 'GPUMemVariant', v: f['GPUMemVariant'], label: 'GPU Memory Variant' },
      { k: 'GPUMem', v: f['GPUMem'], label: 'GPU Memory Used' },
      { k: 'GPUUtil', v: f['GPUUtil'], label: 'GPU Utilization (%)' },
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

  const onPrev = useCallback(() => {
    const n = Math.max(0, index - 1);
    setIndex(n);
    props.onSnapshotChange?.(jobIds, n);
  }, [index, jobIds, props]);

  const onNext = useCallback(() => {
    const n = Math.min(jobIds.length - 1, index + 1);
    setIndex(n);
    props.onSnapshotChange?.(jobIds, n);
  }, [index, jobIds, props]);

  const rootDir = uiCfg.server_root_dir;

  // `docmanager:open`/`filebrowser:go-to-path` take paths *relative to the
  // server's Contents root*, never a raw absolute OS path. `path` here is
  // always the absolute path Slurm reported (JobField only invokes these
  // callbacks when a path was resolved at all); translate it via
  // `server_root_dir` and surface a clear notification -- instead of a
  // silent no-op -- when the path genuinely falls outside root_dir and so
  // cannot be reached through JupyterLab's file APIs from this server.
  const openInEditor = useCallback(
    async (path: string) => {
      const relative = toRootRelativePath(path, rootDir);
      if (relative === undefined) {
        Notification.warning(
          `"${path}" is outside this server's root directory and can't be opened here.`,
          { autoClose: 6000 }
        );
        return;
      }
      try {
        await props.app.commands.execute('docmanager:open', {
          path: relative,
          factory: 'Editor'
        });
      } catch (e) {
        console.warn('Failed to open in editor', e);
      }
    },
    [props.app, rootDir]
  );

  const openFolder = useCallback(
    async (path: string) => {
      const relative = toRootRelativePath(path, rootDir);
      if (relative === undefined) {
        Notification.warning(
          `"${path}" is outside this server's root directory and can't be opened here.`,
          { autoClose: 6000 }
        );
        return;
      }
      try {
        await props.app.commands.execute('filebrowser:go-to-path', {
          path: relative
        });
      } catch (e) {
        console.warn('Failed to open folder', e);
      }
    },
    [props.app, rootDir]
  );

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.warn('Failed to copy', e);
    }
  }, []);

  const copyMarkdownToClipboard = useCallback(() => {
    if (!fields) {
      return;
    }
    let md = `### Slurm Job Report: ${fields['JobID'] || currentJobId}\n\n`;
    md += '| Field | Value |\n| :--- | :--- |\n';

    const allRows: Array<{ k: string; v: any; label?: string }> = [
      ...summaryRows,
      ...timingRows,
      ...resourceRows
    ];
    for (const row of allRows) {
      if (row.v !== undefined && row.v !== null) {
        const label = row.label || (uiCfg.details_labels ?? {})[row.k] || row.k;
        md += `| **${label}** | ${row.v} |\n`;
      }
    }

    if (fields['WorkDir']) {
      md += `\n**WorkDir**: \`${fields['WorkDir']}\``;
    }
    if (fields['Stdout']) {
      md += `\n**Stdout**: \`${fields['Stdout']}\``;
    }
    if (fields['Stderr']) {
      md += `\n**Stderr**: \`${fields['Stderr']}\``;
    }

    copyToClipboard(md);
  }, [
    fields,
    summaryRows,
    timingRows,
    resourceRows,
    uiCfg.details_labels,
    currentJobId,
    copyToClipboard
  ]);

  const copyJsonToClipboard = useCallback(() => {
    if (!fields) {
      return;
    }
    copyToClipboard(JSON.stringify(fields, null, 2));
  }, [fields, copyToClipboard]);

  return (
    <JupyterThemeProvider>
      <Stack
        spacing={1}
        sx={{
          p: 1.5,
          pb: 4,
          height: '100%',
          maxHeight: '100%',
          overflowY: 'auto',
          boxSizing: 'border-box'
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="h6" sx={{ flex: 1 }}>
            Job {currentJobId ?? '—'}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontWeight: 'bold' }}
            >
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
            <IconButton
              size="small"
              onClick={onPrev}
              disabled={index <= 0}
              aria-label="Previous job"
              sx={{ ml: 1 }}
            >
              <ArrowBackIosNewIconMui fontSize="small" />
            </IconButton>
            <Typography variant="body2">
              {jobIds.length ? `${index + 1} / ${jobIds.length}` : '0 / 0'}
            </Typography>
            <IconButton
              size="small"
              onClick={onNext}
              disabled={index >= jobIds.length - 1}
              aria-label="Next job"
            >
              <ArrowForwardIosIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>

        {secondsToNextUpdate !== null && (
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography variant="caption" color="text.secondary">
              Next update in {secondsToNextUpdate}s
            </Typography>
            {nextUpdateElapsedPercent !== null && (
              <span
                className="jp-SlurmWidget-refresh-pie"
                role="progressbar"
                aria-label="Time until next job details update"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(nextUpdateElapsedPercent)}
                style={
                  {
                    '--jp-slurm-pie-percent': `${nextUpdateElapsedPercent}%`
                  } as React.CSSProperties
                }
              />
            )}
          </Stack>
        )}

        {loading && <Typography variant="body2">Loading…</Typography>}
        {!loading && error && <Typography color="error">{error}</Typography>}

        {!loading && !error && fields && (
          <Stack spacing={1.5}>
            <Box>
              <Typography
                variant="subtitle2"
                className="jp-SlurmWidget-details-section-header"
              >
                Summary
              </Typography>
              <Divider sx={{ mb: 0.75 }} />
              <Stack spacing={0.5}>
                {summaryRows.map((row: any) => (
                  <JobField
                    key={row.k}
                    label={labels[row.k] ?? row.k}
                    value={row.v}
                    fieldKey={row.k}
                    workDir={fields?.['WorkDir']}
                    isCommand={row.isCommand}
                    commandScript={row.commandScript}
                    isStatus={row.isStatus}
                    isReason={row.isReason}
                    rootDir={rootDir}
                    expanded={commandExpanded}
                    onToggleExpand={() => setCommandExpanded(!commandExpanded)}
                    onOpenInEditor={openInEditor}
                    onOpenFolder={openFolder}
                    onCopy={copyToClipboard}
                  />
                ))}
              </Stack>
            </Box>

            <Box>
              <Typography
                variant="subtitle2"
                className="jp-SlurmWidget-details-section-header"
              >
                Timing
              </Typography>
              <Divider sx={{ mb: 0.75 }} />
              <Stack spacing={0.5}>
                {timingRows.map((row: any) => (
                  <JobField
                    key={row.k}
                    label={row.label}
                    value={row.v}
                    fieldKey={row.k}
                  />
                ))}
              </Stack>
            </Box>

            <Box>
              <Typography
                variant="subtitle2"
                className="jp-SlurmWidget-details-section-header"
              >
                Resources
              </Typography>
              <Divider sx={{ mb: 0.75 }} />
              <Stack spacing={0.5}>
                {resourceRows
                  .filter((row: any) => row.v)
                  .map((row: any) => (
                    <JobField
                      key={row.k}
                      label={row.label}
                      value={row.v}
                      fieldKey={row.k}
                      minLabelWidth={160}
                    />
                  ))}
              </Stack>
            </Box>

            {/* Steps section */}
            {!!steps && steps.length > 0 && (
              <Box>
                <Typography
                  variant="subtitle2"
                  className="jp-SlurmWidget-details-section-header"
                >
                  Steps
                </Typography>
                <Divider sx={{ mb: 0.75 }} />
                <Stack spacing={0.5}>
                  {steps.map((s, idx) => {
                    const jid =
                      s['JobID'] ?? s['JobId'] ?? s['Id'] ?? `step-${idx}`;
                    const state = s['State'] ?? '—';
                    const exit = s['ExitCode'] ?? s['DerivedExitCode'] ?? '—';
                    const start = s['Start'] ?? s['StartTime'] ?? '—';
                    const end = s['End'] ?? s['EndTime'] ?? '—';
                    const elapsed = s['Elapsed'] ?? '—';
                    return (
                      <Stack
                        key={`${jid}-${idx}`}
                        direction="row"
                        alignItems="center"
                        spacing={1}
                      >
                        <Typography variant="body2" sx={{ minWidth: 140 }}>
                          {jid}
                        </Typography>
                        {/* Using simple box for steps as they are compact */}
                        <Typography
                          variant="body2"
                          sx={{
                            backgroundColor: 'action.selected',
                            px: 1,
                            borderRadius: 1
                          }}
                        >
                          {state}
                        </Typography>
                        <Typography variant="body2" sx={{ ml: 1 }}>
                          Exit: {exit}
                        </Typography>
                        <Typography variant="body2" sx={{ ml: 2 }}>
                          Start: {start}
                        </Typography>
                        <Typography variant="body2" sx={{ ml: 2 }}>
                          End: {end}
                        </Typography>
                        <Typography variant="body2" sx={{ ml: 2 }}>
                          Elapsed: {elapsed}
                        </Typography>
                      </Stack>
                    );
                  })}
                </Stack>
              </Box>
            )}

            {/* TODO(sstat): Live monitoring (`sstat -j <id>`) belongs here,
                not on the queue toolbar -- it's inherently single-job, and
                this panel already knows the single job's current state.
                Add a "Live Usage" section/tab that:
                  1. Only renders/activates when fields['State'] === 'RUNNING'
                     (sstat is meaningless for PD/CD/F jobs).
                  2. Polls a new `/sstat/{job_id}` endpoint on its own short
                     interval while the panel is open and the job is running,
                     independent of the main queue's autoReload/reloadRate.
                  3. Stops polling on panel close/unmount.
                No new toolbar button is needed -- opening Job Details is
                itself the trigger. See prior design discussion for the full
                rationale (single-job scope, independent refresh cadence,
                avoids competing with the Suspend/Resume/Requeue toolbar
                button budget). */}

            <Box>
              <Typography
                variant="subtitle2"
                className="jp-SlurmWidget-details-section-header"
              >
                Logs
              </Typography>
              <Divider sx={{ mb: 0.75 }} />
              {['Stdout', 'Stderr', 'WorkDir'].map(k => (
                <JobField
                  key={k}
                  label={labels[k] ?? k}
                  value={fields?.[k]}
                  fieldKey={k}
                  workDir={fields?.['WorkDir']}
                  isPath={true}
                  fileExists={fields?.[k + 'Exists']}
                  fileSize={fields?.[k + 'Size']}
                  rootDir={rootDir}
                  onOpenInEditor={openInEditor}
                  onOpenFolder={openFolder}
                  onCopy={copyToClipboard}
                />
              ))}
            </Box>
          </Stack>
        )}
      </Stack>
    </JupyterThemeProvider>
  );
}
