import { useCallback, useEffect, useRef, useState } from 'react';
import { DetailsResponse, UiDetailsConfig } from '../types';
import { requestAPI } from '../handler';

const POLL_INTERVAL_MS = 15000;
const TERMINAL_STATES = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TIMEOUT',
  'OUT_OF_MEMORY',
  'NODE_FAIL',
  'PREEMPTED',
  'BOOT_FAIL',
  'DEADLINE',
  'REVOKED'
]);

// Slurm's `State` field isn't always one of the bare TERMINAL_STATES values
// verbatim -- e.g. a cancelled job is reported as the literal text
// "CANCELLED by <user>", not just "CANCELLED". A strict Set.has() lookup
// never matches that, so polling (and the "Next update" pie timer) would
// never stop for such finished jobs. Match on the leading whitespace-
// delimited token instead of exact string equality.
function isTerminalState(state: string | undefined): boolean {
  if (!state) {
    return false;
  }
  const leadingToken = state.trim().split(/\s+/)[0];
  return TERMINAL_STATES.has(leadingToken);
}

export function useJobDetails(jobId: string | undefined) {
  const [uiCfg, setUiCfg] = useState<UiDetailsConfig>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, any> | null>(null);
  const [steps, setSteps] = useState<Array<Record<string, any>>>([]);
  // When the next silent background poll is scheduled to fire, used by the
  // panel to render a "Next update" countdown/pie timer. `null` whenever no
  // poll is currently scheduled (job terminal, no job selected, etc.).
  const [nextPollAt, setNextPollAt] = useState<Date | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setNextPollAt(null);
  }, []);

  const fetchDetails = useCallback(async (id: string, silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
      setFields(null);
      setSteps([]);
    }
    try {
      const resp = await requestAPI<DetailsResponse>(
        `job/${encodeURIComponent(id)}`
      );
      if (!resp.success) {
        throw new Error(resp.errorMessage || 'Failed to fetch job details');
      }
      setFields(resp.data?.fields ?? {});
      setSteps(
        Array.isArray(resp.data?.steps) ? (resp.data?.steps as any[]) : []
      );
    } catch (e: any) {
      if (!silent) {
        setError(e?.message ?? String(e));
        setFields(null);
        setSteps([]);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

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

  // Initial fetch when job changes
  useEffect(() => {
    clearPollTimer();
    if (jobId) {
      void fetchDetails(jobId);
    }
  }, [jobId, fetchDetails, clearPollTimer]);

  // Auto-refresh polling for active (non-terminal) jobs
  useEffect(() => {
    clearPollTimer();
    const state = fields?.['State'];
    if (!jobId || !state || isTerminalState(state)) {
      return;
    }
    setNextPollAt(new Date(Date.now() + POLL_INTERVAL_MS));
    pollTimerRef.current = setTimeout(() => {
      void fetchDetails(jobId, true);
    }, POLL_INTERVAL_MS);
    return clearPollTimer;
  }, [fields, jobId, fetchDetails, clearPollTimer]);

  useEffect(() => {
    return clearPollTimer;
  }, [clearPollTimer]);

  return {
    uiCfg,
    loading,
    error,
    fields,
    steps,
    nextPollAt,
    pollIntervalMs: POLL_INTERVAL_MS,
    refresh: () => jobId && fetchDetails(jobId)
  };
}
