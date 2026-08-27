from typing import Any, Dict, List, Tuple


async def pre_exec(command_name: str, argv: List[str], env: Dict[str, str], context: Dict[str, Any]) -> Tuple[List[str], Dict[str, str]]:
  """
  Add a default sacct time window if the caller did not specify one.
  This prevents empty results when querying jobs older than today.
  """
  if command_name == 'sacct' and '-S' not in argv:
    argv += ['-S', 'now-14days', '-E', 'now']
  return argv, env


async def post_process(command_name: str, rc: int, out: str, err: str, parsed: Any, context: Dict[str, Any]) -> Any:
  """
  Normalize fields for the UI. Perlmutter exposes SubmitLine; users expect "Command".
  Fill small UX hints for common cases.
  """
  # Allocation (single dict)
  if isinstance(parsed, dict):
    if 'SubmitLine' in parsed and 'Command' not in parsed:
      parsed['Command'] = parsed['SubmitLine']
    if parsed.get('State') == 'TIMEOUT' and parsed.get('ExitCode') in ('0:0', '0'):
      parsed['ExitCodeHint'] = 'Timed out; check batch step and stdout/stderr for cause'
  # Steps (list of dicts)
  if isinstance(parsed, list):
    for row in parsed:
      if isinstance(row, dict) and 'AllocCPUS' in row and 'CPUs' not in row:
        row['CPUs'] = row['AllocCPUS']
  return parsed


async def audit(command_name: str, rc: int, duration_ms: int, argv: List[str], context: Dict[str, Any]) -> None:
  """Lightweight structured audit log to stdout."""
  user = context.get('username', '-')
  job_id = context.get('job_id', '-')
  print({
    'event': 'slurm_cmd', 'cmd': command_name, 'rc': rc, 'ms': duration_ms,
    'argv': argv, 'user': user, 'job': job_id
  })
