/**
 * Parse a Slurm time string (e.g., "DD-HH:MM:SS" or "HH:MM:SS") into total seconds.
 */
export function parseTimeInSeconds(t: string): number {
  const splits: string[] = t.split(':');
  let days = 0;
  let hours = 0;
  let seconds = 0;

  switch (splits.length) {
    case 3:
      if (splits[0].indexOf('-') > -1) {
        days = Number(splits[0].split('-')[0]);
        hours = Number(splits[0].split('-')[1]) + days * 24;
      } else {
        hours = Number(splits[0]);
      }
      seconds = hours * 3600 + Number(splits[1]) * 60 + Number(splits[2]);
      break;
    case 2:
      seconds = Number(splits[0]) * 60 + Number(splits[1]);
      break;
    default:
      console.error('Unexpected time format:', splits);
  }

  return seconds;
}

/**
 * True for a Slurm-displayed *grouped* array-range job ID, e.g.
 * "1234_[3-20%4]" -- the form `squeue` uses to collapse multiple still-
 * pending array tasks sharing the same throttle limit into a single row.
 * This is not a real, individually-addressable job: `scontrol show job`/
 * `sacct -j` (and this extension's `/job/{id}` endpoint) only ever resolve
 * a single job or a single array *element* (e.g. "1234_5"), never a range
 * expression -- so any action that targets one specific job (like "Show
 * Details") can't be applied to a row in this form.
 */
export function isGroupedArrayRangeJobId(jobId: string): boolean {
  return /^\d+_\[.*\]$/.test(jobId.trim());
}

/**
 * JupyterLab's toast notifications render on a single line and clip
 * (rather than wrap) anything past their fixed width, so a long raw
 * backend error (e.g. a multi-job scontrol/scancel stderr) can get cut
 * off mid-word, hiding the actual error text from the user. Trim to a
 * reasonable length with an ellipsis so any toast built from arbitrary
 * backend text always ends up looking like a complete sentence; callers
 * should still log the untruncated text to the console separately.
 */
const TOAST_DETAIL_MAX_LENGTH = 160;
export function truncateForToast(text: string): string {
  return text.length > TOAST_DETAIL_MAX_LENGTH
    ? `${text.slice(0, TOAST_DETAIL_MAX_LENGTH - 1).trimEnd()}\u2026`
    : text;
}

/**
 * Build a stable numeric sort key for Slurm job IDs.
 * Supported forms:
 *   - "1234" (plain job)
 *   - "1234_5" (array element)
 *   - "1234_[1,3-5,10]" (array short form)
 */
export function parseJobID(jobId: string): number {
  try {
    const trimmed = jobId.trim();
    if (trimmed.length === 0) {
      return Number.MAX_SAFE_INTEGER;
    }

    // Extract base and optional suffix after underscore
    const match = trimmed.match(/^(\d+)(?:_(.+))?$/);
    if (!match) {
      // Not a recognizable numeric job id; push to bottom
      const asNum = Number(trimmed);
      return Number.isFinite(asNum) ? asNum : Number.MAX_SAFE_INTEGER;
    }

    const base = Number(match[1]);
    const suffix = match[2];
    const FACTOR = 1_000_000; // keep well within 53-bit integer for typical bases

    if (!suffix) {
      // Plain job: sub offset 0 so it sorts before any array entries of same base
      return base * FACTOR;
    }

    // Array single index: e.g., "5"
    // Array short form: e.g., "[1,3-5,10]"
    let subMin = Number.MAX_SAFE_INTEGER;
    if (suffix.startsWith('[') && suffix.endsWith(']')) {
      const inner = suffix.slice(1, -1);
      for (const token of inner.split(',')) {
        const part = token.trim();
        if (!part) {
          continue;
        }
        if (part.includes('-')) {
          const [start] = part.split('-', 1);
          const n = Number(start);
          if (Number.isFinite(n)) {
            subMin = Math.min(subMin, n);
          }
        } else {
          const n = Number(part);
          if (Number.isFinite(n)) {
            subMin = Math.min(subMin, n);
          }
        }
      }
    } else {
      const n = Number(suffix);
      if (Number.isFinite(n)) {
        subMin = n;
      }
    }

    if (!Number.isFinite(subMin) || subMin === Number.MAX_SAFE_INTEGER) {
      // Malformed array suffix; put after plain within base
      return base * FACTOR + (FACTOR - 1);
    }

    // Array entries: offset by (subMin + 1) so that plain (0) < array(>=1)
    const offset = subMin + 1;
    const safeOffset = Math.min(Math.max(1, offset), FACTOR - 1);
    return base * FACTOR + safeOffset;
  } catch (e) {
    return Number.MAX_SAFE_INTEGER;
  }
}
