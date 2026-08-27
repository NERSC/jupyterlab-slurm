import os
import sys
from slurm import SlurmControllerMock

class SlurmCommandMock:
    def __init__(self):
        # Use the shared on-disk squeue_test_data.txt in tests/data as the backing store
        self._controller = SlurmControllerMock()
        self._mocks_dir = os.path.dirname(__file__)
        self._squeue_file = os.path.normpath(os.path.join(self._mocks_dir, '..', 'data', 'squeue_test_data.txt'))
        self._sacct_file = os.path.normpath(os.path.join(self._mocks_dir, '..', 'data', 'sacct_test_data.txt'))

    def _read_lines(self):
        with open(self._squeue_file, 'r') as f:
            return f.readlines()

    def _write_lines(self, lines):
        with open(self._squeue_file, 'w') as f:
            f.writelines(lines)
        self._controller.raw_data = ''.join(lines)

    def _append_line(self, line):
        # Read the current content from the file to ensure we don't overwrite
        with open(self._squeue_file, 'r') as f:
            lines = f.readlines()
        lines.append(line)
        # Write back to file
        with open(self._squeue_file, 'w') as f:
            f.writelines(lines)
        # Sync the controller
        self._controller.raw_data = ''.join(lines)

    def _next_job_id(self):
        max_id = 0
        for line in self._controller.get_queued_jobs().splitlines():
            parts = line.strip().split()
            if not parts:
                continue
            try:
                jid = int(parts[0])
                if jid > max_id:
                    max_id = jid
            except ValueError:
                continue
        return str(max_id + 1 or 1)

    def squeue(self):
        # Print the current contents of the mutable backing file
        lines = self._read_lines()
        # Ensure exact content reproduction
        print(''.join(lines), end='')

    def scancel(self):
        # Accept job IDs from argv and remove them from the shared file
        job_ids = set(x.strip() for x in sys.argv[1:])
        if not job_ids:
            return
        original = self._read_lines()
        kept = []
        for line in original:
            parts = line.strip().split(maxsplit=7)
            if not parts:
                kept.append(line)
                continue
            jid = parts[0].strip()
            if jid in job_ids:
                # skip this line (deleted)
                continue
            kept.append(line)
        self._write_lines(kept)
        # Success: no output needed

    def sbatch(self):
        # Simulate adding a new job: append a line matching the expected squeue output format
        # Format per handlers: %.18i %.9P %j %.8u %.2t %.10M %.6D %R
        new_job_id = self._next_job_id()
        partition, job_name, nodes = self._scan_sbatch_script()
        new_line = f"{new_job_id:>18} {partition:<8} {job_name:<13} testuser PD       0:00      {nodes} (Dependency)\n"
        self._append_line(new_line)
        # Typical sbatch prints a confirmation
        print(f"Submitted batch job {new_job_id}")

    def _scan_sbatch_script(self):
        """Inspect the submitted script's `#SBATCH` directives to determine
        the partition/job name/node count that a real `sbatch` would honor,
        so a GPU submission (e.g. `#SBATCH --partition=gpu` or
        `#SBATCH --gres=gpu:...`) shows up correctly in the mock queue,
        matching real Perlmutter partitions like `gpu_ss11`. Falls back to
        a plain CPU/"batch" job when nothing GPU-related is found or the
        script can't be read.
        """
        partition = "batch"
        job_name = "test_submit"
        nodes = "1"
        script_path = sys.argv[1] if len(sys.argv) > 1 else None
        if not script_path or not os.path.isfile(script_path):
            return partition, job_name, nodes
        try:
            with open(script_path, 'r') as f:
                for line in f:
                    stripped = line.strip()
                    if not stripped.startswith('#SBATCH'):
                        continue
                    directive = stripped[len('#SBATCH'):].strip()
                    if directive.startswith('--partition=') or directive.startswith('-p '):
                        partition = directive.split('=', 1)[-1].split()[-1].strip()
                    elif directive.startswith('--gres=gpu') or directive.startswith('--gpus'):
                        # A GPU request without an explicit GPU partition:
                        # model it against a GPU partition so downstream
                        # scontrol/sacct GPU parsing gets exercised.
                        if 'gpu' not in partition.lower():
                            partition = "gpu"
                    elif directive.startswith('--job-name=') or directive.startswith('-J '):
                        job_name = directive.split('=', 1)[-1].split()[-1].strip()
                    elif directive.startswith('--nodes=') or directive.startswith('-N '):
                        nodes = directive.split('=', 1)[-1].split()[-1].strip()
        except OSError:
            pass
        return partition, job_name, nodes

    def scontrol(self):
        """
        Handle scontrol commands. Supports three formats:
        1. `scontrol show job <jobid>` - show job details
        2. `scontrol hold|release <jobid> [<jobid>...]` - hold/release form used by the handler
        3. `scontrol update JobId=<jobid> Hold=on|off` - legacy update form (still accepted)
        """
        args = sys.argv[1:]
        if not args:
            return

        # Handle 'show job <jobid>'
        if args[0] == 'show' and len(args) >= 3 and args[1] == 'job':
            job_id = args[2].strip()
            # print(f"DEBUG: scontrol show job {job_id}", file=sys.stderr)
            lines = self._read_lines()
            # squeue format: jobid partition jobname user state elapsed nodes reason/nodelist
            # NERSC/standard Slurm has no distinct held state code: a user hold
            # is a PENDING job with Reason=(JobHeldUser).
            state_map = {'R': 'RUNNING', 'PD': 'PENDING', 'CG': 'COMPLETING'}
            for line in lines:
                parts = line.strip().split(maxsplit=7)
                if not parts or len(parts) < 5:
                    continue
                # Normalize parts[0] for comparison (strip leading/trailing space)
                actual_jid = parts[0].strip()
                # print(f"DEBUG: checking {actual_jid} == {job_id}", file=sys.stderr)
                if actual_jid == job_id:
                    jid = actual_jid
                    partition = parts[1] if len(parts) > 1 else ''
                    jobname = parts[2] if len(parts) > 2 else ''
                    user = parts[3] if len(parts) > 3 else ''
                    state_code = parts[4] if len(parts) > 4 else ''
                    elapsed = parts[5] if len(parts) > 5 else '0:00'
                    nodes = parts[6] if len(parts) > 6 else '1'
                    reason_or_nodelist = parts[7] if len(parts) > 7 else ''
                    state = state_map.get(state_code, state_code)
                    nodelist = reason_or_nodelist if state_code == 'R' else '(none)'
                    # Real `scontrol show job` reports the reason without the
                    # surrounding parentheses that squeue uses (e.g. squeue
                    # "(JobHeldUser)" -> scontrol "JobHeldUser").
                    reason = reason_or_nodelist.strip('()') if state_code != 'R' else 'None'

                    # Resource values modeled on real Slurm (NERSC/Perlmutter)
                    # output: modern `ReqTRES=`/`AllocTRES=` strings (not the
                    # legacy `Gres=`), a per-node memory in `MinMemoryNode`, and
                    # a realistic CPU count. Paths are kept intentionally generic
                    # (not site-specific) so fixtures don't hardcode a real
                    # deployment's directory layout.
                    try:
                        nnodes = max(1, int(nodes))
                    except (TypeError, ValueError):
                        nnodes = 1
                    ncpus = 2 * nnodes
                    mem = "256M"

                    # A GPU allocation is only present for GPU partitions.
                    # Modeled on verified real Perlmutter `scontrol show job`
                    # output: jobs do NOT have a `Gres=` key at all (that
                    # only appears in `scontrol show node` output). Instead:
                    #   - a PENDING job reports `TresPerNode=gres/gpu:4`
                    #     (untyped) and `ReqTRES=...,gres/gpu=1024`, with
                    #     `AllocTRES=(null)`.
                    #   - a RUNNING job reports a typed, per-node GPU count
                    #     in `AllocTRES` (e.g. `gres/gpu:a100=4,gres/gpu=4`),
                    #     inferred from `sacct`'s equivalent AllocTRES for
                    #     completed jobs on real GPU allocations.
                    # `Features=gpu&a100&hbm80g` (node constraint) supplies
                    # the GPU memory variant, not a distinct GRES type.
                    is_gpu = 'gpu' in partition.lower()
                    ngpu = 4
                    tres_gpu_untyped = f",gres/gpu={ngpu * nnodes}" if is_gpu else ""
                    tres_gpu_typed = f",gres/gpu:a100={ngpu},gres/gpu={ngpu}" if is_gpu else ""
                    tres_per_node = f"gres/gpu:{ngpu}" if is_gpu else ""
                    features = "gpu&a100&hbm80g" if is_gpu else "cpu"

                    req_tres = f"cpu={ncpus},mem={mem},node={nnodes},billing={ncpus}{tres_gpu_untyped}"
                    # A pending job has no allocation yet; a running job's
                    # AllocTRES reports the typed per-node GPU count.
                    alloc_tres = "(null)" if state == 'PENDING' else \
                        f"cpu={ncpus},mem={mem},node={nnodes},billing={ncpus}{tres_gpu_typed}"
                    tres_per_node_field = f"TresPerNode={tres_per_node}" if is_gpu else "TresPerNode="

                    # Emit scontrol-style output
                    print(f"JobId={jid} JobName={jobname} UserId={user}(1000) "
                          f"Account=myaccount QOS={partition} "
                          f"JobState={state} Reason={reason} "
                          f"NumNodes={nnodes} NumCPUs={ncpus} NumTasks=1 CPUs/Task=1 "
                          f"ReqTRES={req_tres} AllocTRES={alloc_tres} "
                          f"MinMemoryNode={mem} "
                          f"Partition={partition} NodeList={nodelist} "
                          f"TimeLimit=00:05:00 "
                          f"SubmitTime=2026-01-20T10:00:00 StartTime=2026-01-20T10:05:00 "
                          f"EndTime=Unknown "
                          f"WorkDir=/home/{user}/jobs "
                          f"StdOut=/home/{user}/jobs/slurm-{jid}.out "
                          f"StdErr=/home/{user}/jobs/slurm-{jid}.err "
                          f"Command=/home/{user}/jobs/run.sh "
                          f"Features={features} "
                          f"{tres_per_node_field} "
                          f"TresPerTask=cpu=1")
                    return
            # Job not found in squeue
            print(f"slurm_load_jobs error: Invalid job id specified", file=sys.stderr)
            sys.exit(1)

        action = None
        job_ids = set()
        
        # Parse command format
        if args[0] == 'update':
            # Format: scontrol update JobId=X Hold=on|off
            for arg in args[1:]:
                if arg.startswith('JobId='):
                    job_ids.add(arg.split('=', 1)[1])
                elif arg.startswith('Hold='):
                    hold_val = arg.split('=', 1)[1].lower()
                    action = 'hold' if hold_val == 'on' else 'release'
        elif args[0] in {'hold', 'release'}:
            # Format: scontrol hold|release <jobid> [<jobid>...]
            action = args[0]
            job_ids = set(args[1:])
        
        if action not in {"hold", "release"} or not job_ids:
            return
        
        lines = self._read_lines()
        new_lines = []
        for line in lines:
            parts = line.rstrip('\n').split(maxsplit=7)
            if not parts or len(parts) < 5:
                new_lines.append(line)
                continue
            jid = parts[0].strip()
            if jid in job_ids:
                # NERSC/standard Slurm represents a user hold as a PENDING job
                # (ST=PD) with Reason=(JobHeldUser)
                if action == 'hold':
                    parts[4] = 'PD'
                    parts[7] = '(JobHeldUser)'
                else:  # release
                    if parts[7].strip() == '(JobHeldUser)':
                        parts[4] = 'PD'
                        parts[7] = '(Priority)'
                # Rebuild line while attempting to preserve formatting (simplified)
                rebuilt = f"{parts[0].strip():>18} {parts[1]:<8} {parts[2]:<13} {parts[3]:<8} {parts[4]:<8} {parts[5]:<9} {parts[6]:<1} {parts[7]}\n"
                new_lines.append(rebuilt)
            else:
                new_lines.append(line)
        self._write_lines(new_lines)

    def sacct(self):
        """
        Enhanced sacct mock that supports:
        - `-j <JOBID>` for filtering by job ID
        - `-o <format>` for specifying output columns
        - `--parsable2` for pipe-delimited output (default behavior)
        
        The test data file stores all possible fields; this method filters and formats as requested.
        """
        args = sys.argv[1:]
        
        # Parse arguments
        job_filter = None
        output_format = None
        allocations_only = False  # -X / --allocations: suppress job step rows
        i = 0
        while i < len(args):
            arg = args[i]
            if arg == '-j' and i + 1 < len(args):
                job_filter = args[i + 1]
                i += 2
            elif arg.startswith('-j'):
                job_filter = arg[2:]
                i += 1
            elif arg == '-o' and i + 1 < len(args):
                output_format = args[i + 1]
                i += 2
            elif arg.startswith('-o'):
                output_format = arg[2:]
                i += 1
            elif arg in ('-X', '--allocations'):
                allocations_only = True
                i += 1
            else:
                i += 1
        
        # Default columns that the basic test data file provides
        # Extended data file provides all columns; basic file provides subset
        default_columns = ['JobID', 'Partition', 'JobName', 'User', 'State', 'Elapsed', 'NNodes', 'ExitCode']
        
        # All columns available in extended test data (matches JobDetailsHandler needs)
        all_columns = [
            'JobID', 'JobName', 'User', 'Partition', 'Account', 'AllocCPUS', 'State', 'ExitCode',
            'Start', 'End', 'Elapsed', 'QOS', 'WorkDir', 'StdOut', 'StdErr', 'SubmitLine', 'NNodes'
        ]
        
        try:
            with open(self._sacct_file, 'r') as f:
                lines = f.readlines()
        except FileNotFoundError:
            print('', end='')
            return
        
        # Parse the file - first line may be a header comment starting with # listing columns
        data_lines = []
        file_columns = default_columns
        for line in lines:
            line = line.strip()
            if not line:
                continue
            if line.startswith('#COLUMNS:'):
                # Header line specifying columns: #COLUMNS:JobID,Partition,...
                file_columns = [c.strip() for c in line[9:].split(',')]
                continue
            if line.startswith('#'):
                continue
            data_lines.append(line)
        
        # Parse data into dicts
        rows = []
        for line in data_lines:
            parts = line.split('|')
            row = {}
            for idx, col in enumerate(file_columns):
                row[col] = parts[idx] if idx < len(parts) else ''
            rows.append(row)
        
        # Simulate the behavior of some Slurm versions where sacct rejects an
        # array-element / range job id (e.g. "7040_2" or "7040_[1-2]") with a
        # fatal error. Callers are expected to retry against the base array id.
        if job_filter and '_' in job_filter:
            base = job_filter.split('_', 1)[0]
            sys.stderr.write(
                f"sacct: fatal: Bad job array element specified: {base}\n"
            )
            sys.exit(1)

        # Honor -X / --allocations: real sacct returns only the allocation row
        # (JobID like "5025" or "7040_1") and suppresses step rows such as
        # "5025.batch", "5025.extern" or "5025.0".
        if allocations_only:
            rows = [r for r in rows if '.' not in r.get('JobID', '')]

        # Filter by job ID if specified
        if job_filter:
            # Handle array job format (e.g., "5025_1" matches "5025")
            base_job_id = job_filter.split('_')[0] if '_' in job_filter else job_filter
            filtered = []
            for row in rows:
                row_jid = row.get('JobID', '')
                row_base = row_jid.split('_')[0] if '_' in row_jid else row_jid
                # Match exact job ID or base job ID for array jobs, or step rows like "5025.batch"
                if row_jid == job_filter or row_base == base_job_id or row_jid.startswith(job_filter + '.'):
                    filtered.append(row)
            rows = filtered
        
        # Determine output columns
        if output_format:
            out_columns = [c.strip() for c in output_format.split(',')]
        else:
            out_columns = file_columns

        # Emulate modern Slurm removing the GRES accounting fields: requesting
        # AllocGRES/ReqGRES makes sacct fatal. Callers must use AllocTRES/ReqTRES.
        for removed in ('AllocGRES', 'ReqGRES'):
            if removed in out_columns:
                sys.stderr.write(
                    f"sacct: fatal: {removed} has been removed, please use "
                    f"{removed.replace('GRES', 'TRES')}\n"
                )
                sys.exit(1)
        
        # Output rows in requested format
        for row in rows:
            values = [row.get(col, '') for col in out_columns]
            print('|'.join(values))
        
        # Ensure no trailing newline issues (print adds newline per row already)


if __name__ == "__main__":
    # Custom parsing to handle arbitrary arguments after the command
    if len(sys.argv) < 2:
        print("Usage: slurm_commands.py <command> [args...]")
        sys.exit(1)
        
    cmd = sys.argv[1]
    # Remove the first two elements (script name and command name) for the command-specific logic
    # but the mocks use sys.argv[1:] which is fine.
    
    slurm_mock = SlurmCommandMock()

    if cmd == 'squeue':
        slurm_mock.squeue()
    elif cmd == 'scancel':
        slurm_mock.scancel()
    elif cmd == 'sbatch':
        slurm_mock.sbatch()
    elif cmd == 'scontrol':
        slurm_mock.scontrol()
    elif cmd == 'sacct':
        slurm_mock.sacct()
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
