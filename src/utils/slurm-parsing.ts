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
