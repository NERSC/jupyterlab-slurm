import asyncio
import datetime
import html
import json
import os
import re
import shlex
import shutil
import time

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
import tornado
import tornado.web

try:
    from ._version import __version__
except Exception:  # pragma: no cover - fallback for uninstalled/dev use
    __version__ = "dev"

from ._common import logger, make_envelope, SLURM_COMMAND_TIMEOUT_SECONDS

# The compatibility test-suite harness lives in its own optional module so
# that it can be omitted entirely from a production build/deployment (see
# `test_suite.py` and `production_checklist.md`). If it isn't present, the
# `/test-suite` route is simply never registered below.
try:
    from .test_suite import SlurmTestSuiteHandler
except ImportError:  # pragma: no cover - expected in a stripped-down prod build
    SlurmTestSuiteHandler = None

jobIDMatcher = re.compile(r"^[0-9]+(_[0-9]+)?$")


class MissingSlurmJobID(Exception):
    def __init__(self, message):
        self.message = message


class InvalidSlurmJobID(Exception):
    def __init__(self, jobid, message):
        self.jobid = jobid
        self.message = message


class MissingBatchScript(Exception):
    def __init__(self, message):
        self.message = message


class InvalidCommand(Exception):
    def __init__(self, command, message):
        self.command = command
        self.message = message


class TooManySlurmJobIDs(Exception):
    def __init__(self, count, limit):
        self.count = count
        self.limit = limit
        self.message = "Requested {} job IDs, exceeding the limit of {}".format(count, limit)


class InvalidSlurmPath(Exception):
    def __init__(self, field, value):
        self.field = field
        self.message = "Invalid {}: must be a plain string with no NUL bytes".format(field)


# Maximum number of job IDs accepted in a single request body/query, to
# bound the number of Slurm subprocesses a single request can spawn.
MAX_JOB_IDS_PER_REQUEST = 200

# Global cap on concurrently running Slurm subprocesses across all handlers,
# so unbounded/overlapping polling or bursts of requests cannot fork an
# unbounded number of `squeue`/`sacct`/`scontrol`/etc. processes.
MAX_CONCURRENT_SLURM_PROCESSES = 8
_slurm_process_semaphore = asyncio.Semaphore(MAX_CONCURRENT_SLURM_PROCESSES)


def http_status_for_failure(exit_code: int, error_message: str = None) -> int:
    """Map a handler-level failure to an appropriate HTTP status code.

    Genuine Slurm command failures (e.g. `scancel` on a job that already
    finished) are still valid responses to a valid request and stay at 200
    with `success: false` in the envelope. This helper is only used for the
    handler-level failure classes called out by the production checklist:
    malformed requests, unavailable commands, and internal errors.
    """
    if exit_code == 127:
        # Executable could not be resolved on PATH / configured path.
        return 503
    return 500


# Health-check endpoint: confirms the server extension is installed, running,
# and reports its version so the frontend can verify a matched deployment.
class HealthCheckHandler(APIHandler):
    def initialize(self, log=logger):
        super().initialize()
        self._serverlog = log
        self._serverlog.info("HealthCheckHandler.initialize()")

    @tornado.web.authenticated
    def get(self):
        try:
            self._serverlog.debug("HealthCheckHandler.get()")
            envelope = make_envelope(
                True,
                data={"name": "jupyterlab_slurm", "version": __version__},
                message="ok",
            )
            # Keep the legacy top-level `status`/`name`/`version` fields for one
            # release in case anything outside the extension polls this
            # endpoint directly (also mirrored under `data`).
            envelope["status"] = "ok"
            envelope["name"] = "jupyterlab_slurm"
            envelope["version"] = __version__
            self.finish(json.dumps(envelope))
        except Exception as e:
            self._serverlog.exception(e)
            self.set_status(500)
            envelope = make_envelope(False, error=str(e), exit_code=1)
            envelope["status"] = "error"
            self.finish(json.dumps(envelope))


# A simple request handler for retrieving the username
class UserFetchHandler(APIHandler):
    def initialize(self, log=logger):
        super().initialize()
        self._serverlog = log
        self._serverlog.info("UserFetchHandler.initialize()")

    @tornado.web.authenticated
    def get(self):
        try:
            # Prefer the authenticated Jupyter identity (works correctly under
            # multi-user deployments, e.g. JupyterHub, where the OS process
            # `USER` env var may be shared, unset, or belong to a service
            # account rather than the actual signed-in user). Fall back to the
            # process `USER` only for single-user/local deployments where no
            # Jupyter identity is configured.
            username = None
            current_user = getattr(self, "current_user", None)
            if current_user is not None:
                username = getattr(current_user, "username", None) or getattr(current_user, "name", None)
                if username is None and isinstance(current_user, str):
                    username = current_user
            if not username:
                username = os.environ.get('USER')
            self._serverlog.info("UserFetchHandler.get() {}".format(username))
            self.finish(json.dumps(make_envelope(True, data={"user": username})))
        except Exception as e:
            self._serverlog.exception(e)
            self.set_status(500)
            self.finish(json.dumps(make_envelope(False, error=str(e), exit_code=1)))


# common utility methods for running slurm commands, and defaults to the run_command() for scancel and scontrol
# sbatch and squeue need special handling of the command and override run_command()
class SlurmCommandHandler(APIHandler):
    """
    Base class for Slurm command handlers.
    
    Provides utility methods for parsing job IDs from requests and executing 
    shell commands safely using asyncio.
    """
    def initialize(self, command: str = None, log=logger):
        super().initialize()
        self._slurm_command = command
        self._serverlog = log
        self._serverlog.info("SlurmCommandHandler.initialize(): {} {}".format(self._slurm_command, self._serverlog))

    def get_jobids(self):
        content_type = self.request.headers.get('Content-Type', '')
        if content_type.startswith('application/json'):
            body = json.loads(self.request.body or b"{}")
            if "job_ids" not in body:
                raise MissingSlurmJobID("")
            job_ids = body["job_ids"]
        else:
            # Query parameter(s), e.g. ?job_ids=123&job_ids=456
            job_ids = self.get_arguments('job_ids')

        if len(job_ids) > MAX_JOB_IDS_PER_REQUEST:
            raise TooManySlurmJobIDs(len(job_ids), MAX_JOB_IDS_PER_REQUEST)

        for job_id in job_ids:
            if not jobIDMatcher.search(job_id):
                raise InvalidSlurmJobID(job_id, "job_id {} is invalid".format(job_id))

        return job_ids

    async def _run_command(self, command=None, stdin=None, cwd=None):
        """Run a Slurm command safely, resolving executable via PATH if needed.
        Returns dict: {stdout, stderr, returncode} and never raises on failure.

        `command` may be either a pre-built argv list (preferred boundary for
        any value that can contain user-controlled/free-form content, such as
        a submitted script path) or a plain string of already-validated,
        space-free tokens (legacy call sites), which is split with `shlex`
        only for backwards compatibility. Prefer passing a list so arbitrary
        user input is never re-tokenized.
        """
        # Log at debug level only: the full argv/cwd can contain filesystem
        # paths (job script/output locations, usernames embedded in home
        # directories), which shouldn't appear in production-default (INFO)
        # logs per the redaction policy in production_checklist.md section 4.
        self._serverlog.debug('SlurmCommandHandler._run_command(): %s %s %s', command, stdin, cwd)
        if isinstance(command, (list, tuple)):
            commands = list(command)
        else:
            commands = shlex.split(command)
        self._serverlog.debug('SlurmCommandHandler._run_command(): %s', commands)

        # Resolve executable via PATH when not absolute
        exe = commands[0]
        resolved = exe
        try:
            import shutil, os
            if not os.path.isabs(exe):
                which = shutil.which(exe)
                if which:
                    resolved = which
            # Log resolution
            self._serverlog.debug('SlurmCommandHandler._run_command(): resolved exe %s -> %s', exe, resolved)
            # If still not found, return a clear error. Do not include the raw
            # PATH environment value in the response body: PATH is an
            # environment value, not something that should be returned to the
            # client (production_checklist.md section 4). Log it at debug
            # level instead, for operator troubleshooting only.
            if not os.path.isabs(resolved) or not os.path.exists(resolved):
                self._serverlog.debug(
                    'SlurmCommandHandler._run_command(): executable not found: %s. PATH=%s',
                    exe, os.environ.get('PATH', ''))
                return {
                    "stdout": "",
                    "stderr": "Executable not found: {}".format(exe),
                    "returncode": 127
                }
            commands[0] = resolved
        except Exception as e:
            # Best effort; try to run with original exe
            self._serverlog.warning('Command resolution failed for %s: %s', exe, e)

        # Execute with timeout. Bound the number of concurrently running Slurm
        # subprocesses so overlapping polling/requests cannot fork an unbounded
        # number of processes.
        async with _slurm_process_semaphore:
            proc = await asyncio.create_subprocess_exec(
                *commands,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                stdin=stdin,
                cwd=cwd
            )
            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=SLURM_COMMAND_TIMEOUT_SECONDS)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
                return {
                    "stdout": "",
                    "stderr": "command timed out after {}s".format(SLURM_COMMAND_TIMEOUT_SECONDS),
                    "returncode": -1
                }
        return {
            "stdout": stdout.decode(errors='replace').strip(),
            "stderr": stderr.decode(errors='replace').strip(),
            "returncode": proc.returncode
        }

    async def run_command(self, args: list = None):
        response_message = ""
        error_message = "{} did not run!".format(self._slurm_command)
        returncode = -1
        http_status = 200
        requested_ids = []
        try:
            requested_ids = self.get_jobids()
            job_ids = " ".join(requested_ids)
            self._serverlog.info(job_ids)

            if args is None:
                args = []

            out = await self._run_command("{} {} {}".format(self._slurm_command, " ".join(args), job_ids))

            returncode = out["returncode"]
            cmd_stdout = ""
            if "stdout" in out and len(out["stdout"].strip()) > 0:
                cmd_stdout = out["stdout"]

            cmd_stderr = ""
            if "stderr" in out and len(out["stderr"].strip()) > 0:
                cmd_stderr = out["stderr"]

            if returncode != 0:
                response_message = "Failure: {} {} {}".format(self._slurm_command, job_ids, cmd_stdout)
                error_message = cmd_stderr
                if returncode == 127:
                    http_status = 503
            else:
                response_message = "Success: {} {}".format(self._slurm_command, job_ids)
                error_message = ""
        except KeyError as ke:
            self._serverlog.exception(ke)
            try:
                job_ids is not None
            except NameError:
                job_ids = []

            response_message = "Failure: {} {}".format(self._slurm_command, job_ids)
            error_message = "Missing key before running command: {}".format(str(ke))
            returncode = -1
            http_status = 400
        except MissingSlurmJobID as emj:
            self._serverlog.exception(emj)
            response_message = "Failure: {} missing job_id".format(self._slurm_command)
            error_message = emj.message
            returncode = -1
            http_status = 400
        except InvalidSlurmJobID as eij:
            self._serverlog.exception(eij)
            response_message = "Failure: {} invalid job_id {}".format(self._slurm_command, eij.jobid)
            error_message = eij.message
            returncode = -1
            http_status = 400
        except TooManySlurmJobIDs as etm:
            self._serverlog.exception(etm)
            response_message = "Failure: {} too many job_ids".format(self._slurm_command)
            error_message = etm.message
            returncode = -1
            http_status = 400
        except json.JSONDecodeError as je:
            self._serverlog.exception(je)
            response_message = "Failure: {} malformed request body".format(self._slurm_command)
            error_message = "Malformed JSON body: {}".format(str(je))
            returncode = -1
            http_status = 400
        except Exception as e:
            self._serverlog.exception(e)
            try:
                job_ids is not None
            except NameError:
                job_ids = []

            response_message = "Failure: {} {}".format(self._slurm_command, job_ids)
            error_message = "Unhandled Exception: {}".format(str(e))
            returncode = -1
            http_status = 500
        finally:
            success = (returncode == 0)
            data = {
                "requestedIds": requested_ids,
                "changedIds": requested_ids if success else []
            }
            return {
                "success": success,
                "responseMessage": response_message,
                "errorMessage": None if success else error_message,
                "exitCode": returncode,
                "data": data,
                "_httpStatus": 200 if success else http_status
                }


# Conventions: Query arguments: always settings for how to use or options provided by a SLURM command. Body
# arguments: always job designators, e.g. job ID, paths to SLURM scripts, input streams of SLURM script contents,
# etc. Path arguments: always commands (including commands sent to `scontrol`, e.g. `scontrol hold`/`scontrol resume`)

# Unsurprisingly, the job ID's are always (for scancel and scontrol) the body argument named 'jobID'

# Since this is idempotent, hypothetically one could also use PUT instead of DELETE here.
class ScancelHandler(SlurmCommandHandler):
    def initialize(self, scancel: str = "scancel", log=logger):
        super().initialize(scancel, log)
        self._serverlog.debug("ScancelHandler.initialize(): %s", self._slurm_command)

    # Add `-H "Authorization: token <token>"` to the curl command for any DELETE request
    @tornado.web.authenticated
    async def delete(self):
        # Never log the raw `self.request` object: it carries request headers
        # (auth cookies, XSRF tokens) that must not be written to logs.
        self._serverlog.debug('ScancelHandler.delete() - method: %s, command: %s',
            self.request.method, self._slurm_command)
        try:
            out = await self.run_command()
            http_status = out.pop("_httpStatus", 200)
            self.set_status(http_status)
            await self.finish(json.dumps(out))
            return
        except Exception as e:
            self._serverlog.exception(e)
            self.set_status(500)
            error_resp = {
                "success": False,
                "responseMessage": "Failure {}".format(self._slurm_command),
                "errorMessage": str(e),
                "exitCode": -1,
                "data": {"requestedIds": [], "changedIds": []}
            }
            await self.finish(json.dumps(error_resp))


# scontrol isn't idempotent, so PUT isn't appropriate, and in general scontrol only modifies a subset of properties,
# so POST also is not ideal
class ScontrolHandler(SlurmCommandHandler):
    def initialize(self, scontrol: str = "scontrol", log=logger):
        super().initialize(scontrol, log)
        self._serverlog.debug("ScontrolHandler.initialize()")

    # Add `-H "Authorization: token <token>"` to the curl command for any PATCH request
    @tornado.web.authenticated
    async def patch(self, action):
        self._serverlog.debug("ScontrolHandler.patch(): %s %s", self._slurm_command, action)
        try:
            # Use the native `scontrol hold|release <jobid>` subcommands. The
            # `update JobId=<id> Hold=on/off` form is rejected on some sites
            # (e.g. NERSC/Perlmutter) with "Update of this parameter is not
            # supported: Hold=on".
            if action in ("hold", "release"):
                requested = []
                changed = []
                exit_codes = []
                errors = []
                try:
                    requested = self.get_jobids()
                except Exception:
                    requested = []

                if not requested:
                    resp = {
                        "success": False,
                        "responseMessage": f"Failure {self._slurm_command} {action} missing job_ids",
                        "errorMessage": "No job IDs provided",
                        "exitCode": -1,
                        "data": {"requestedIds": [], "changedIds": []}
                    }
                    self.set_status(400)
                    await self.finish(json.dumps(resp))
                    return

                for jid in requested:
                    out = await self._run_command([self._slurm_command, action, jid])
                    exit_codes.append(out.get("returncode", -1))
                    if out.get("returncode", -1) == 0:
                        changed.append(jid)
                    else:
                        err = out.get("stderr") or out.get("stdout") or "unknown error"
                        errors.append(f"{jid}: {err}")

                # Aggregate result
                success = all(ec == 0 for ec in exit_codes) if exit_codes else False
                resp = {
                    "success": success,
                    "responseMessage": f"{('Success' if success else 'Partial/Failure')} {self._slurm_command} {action}",
                    "errorMessage": None if success else "\n".join(errors) if errors else "",
                    "exitCode": 0 if success else (exit_codes[0] if exit_codes else -1),
                    "data": {"requestedIds": requested, "changedIds": changed}
                }
                await self.finish(json.dumps(resp))
                return

            # Default behavior for other scontrol actions
            out = await self.run_command([action])
            http_status = out.pop("_httpStatus", 200)
            self.set_status(http_status)
            await self.finish(json.dumps(out))
            return
        except Exception as e:
            self._serverlog.exception(e)
            self.set_status(500)
            error_resp = {
                "success": False,
                "responseMessage": "Failure {} {}".format(self._slurm_command, action),
                "errorMessage": str(e),
                "exitCode": -1,
                "data": {"requestedIds": [], "changedIds": []}
            }
            await self.finish(json.dumps(error_resp))


# sbatch clearly isn't idempotent, and resource ID (i.e. job ID) isn't known when running it, so only POST works for
# the C in CRUD here, not PUT
class SbatchHandler(SlurmCommandHandler):
    def initialize(self, sbatch: str = "sbatch", log=logger):
        super().initialize(sbatch, log)
        self._serverlog.debug("SbatchHandler.initialize()")

    async def run_command(self, script_path: str = None, output_path: str = None):
        response_message = ""
        error_message = "{} has not run yet!".format(self._slurm_command)
        returncode = -1
        try:
            try:
                self._serverlog.debug("SbatchHandler.post() - sbatch call - %s %s %s",
                    self._slurm_command, script_path, output_path)
                if not output_path:
                    output_path = os.getcwd()
                # Pass the script path as its own argv element (never build a
                # string command out of it) so it can never be re-tokenized
                # by shlex, e.g. a path containing whitespace.
                out = await self._run_command([self._slurm_command, script_path], cwd=output_path)
                out["errorMessage"] = ""
            except Exception as e:
                out = {
                    "stdout": "",
                    "stderr": "Attempted to run: " +
                              "command - {}, path - {}, dir - {}. Check console for more details.".format(
                                  self._slurm_command,
                                  script_path,
                                  output_path
                                  ),
                    "returncode": 1,
                    "errorMessage": str(e)
                    }
                self._serverlog.error("Error running sbatch: {}".format(out["stderr"]))
                self._serverlog.exception(e)

            returncode = out["returncode"]
            cmd_stdout = ""
            if "stdout" in out and len(out["stdout"].strip()) > 0:
                cmd_stdout = out["stdout"]

            cmd_stderr = ""
            if "stderr" in out and len(out["stderr"].strip()) > 0:
                cmd_stderr = out["stderr"]

            if returncode != 0:
                response_message = "Failure: {} {}".format(self._slurm_command, cmd_stdout)
                error_message = cmd_stderr
            else:
                response_message = "Success: {}".format(self._slurm_command)
                error_message = ""
        except KeyError as ke:
            self._serverlog.exception(ke)
            response_message = "Failure: {}".format(self._slurm_command)
            error_message = "Missing key before running command: {}".format(str(ke))
            returncode = -1
        except Exception as e:
            self._serverlog.exception(e)
            response_message = "Failure: {}".format(self._slurm_command)
            error_message = "Unhandled Exception: {}".format(str(e))
            returncode = -1
        finally:
            success = (returncode == 0)
            # Try to extract a jobId from typical sbatch stdout: "Submitted batch job <id>"
            job_id = None
            try:
                if 'cmd_stdout' in locals() and cmd_stdout:
                    parts = cmd_stdout.strip().split()
                    if parts and parts[-1].isdigit():
                        job_id = parts[-1]
            except Exception:
                job_id = None
            data = {}
            if job_id:
                data = {"jobId": job_id, "submissionMessage": cmd_stdout.strip()}
            return {
                "success": success,
                "responseMessage": response_message,
                "errorMessage": None if success else error_message,
                "exitCode": returncode,
                "data": data
                }

    # Add `-H "Authorization: token <token>"` to the curl command for any POST request
    @tornado.web.authenticated
    async def post(self):
        self._serverlog.debug('SbatchHandler.post()')
        inputPath = None
        outputPath = None
        try:
            body = json.loads(self.request.body)
            self._serverlog.debug("SbatchHandler.post() - {} {}".format(self._slurm_command, body))
            if 'inputPath' in body:
                inputPath = body['inputPath']
            if 'outputPath' in body:
                outputPath = body['outputPath']
        except Exception as e:
            self._serverlog.exception(e)

        try:
            # Never log `self.request` or `self.request.body` directly:
            # the request carries auth headers/cookies, and the body may be
            # arbitrary request content; only the already-validated path
            # fields are safe/useful to record, and only at debug level.
            self._serverlog.debug('SbatchHandler.post() - inputPath: %s, outputPath: %s', inputPath, outputPath)

            if not inputPath:
                raise tornado.web.MissingArgumentError('inputPath')

            # Boundary validation: inputPath/outputPath must be plain strings
            # with no embedded NUL bytes before being handed to argv-based
            # execution (they are already passed as their own argv elements,
            # never shell-interpreted, but a non-string or NUL-containing
            # value indicates a malformed/malicious request and must be
            # rejected outright rather than reaching the subprocess call).
            for name, value in (('inputPath', inputPath), ('outputPath', outputPath)):
                if value is not None:
                    if not isinstance(value, str) or '\x00' in value:
                        raise InvalidSlurmPath(name, value)

            out = await self.run_command(inputPath, outputPath)
            await self.finish(json.dumps(out))
            return
        except tornado.web.MissingArgumentError as e:
            self._serverlog.exception(e)
            self.set_status(400)
            error_resp = {
                "success": False,
                "responseMessage": "Failure: {}".format(self._slurm_command),
                "errorMessage": "Malformed request: {}".format(str(e)),
                "exitCode": -1,
                "data": {}
            }
            await self.finish(json.dumps(error_resp))
        except InvalidSlurmPath as e:
            self._serverlog.exception(e)
            self.set_status(400)
            error_resp = {
                "success": False,
                "responseMessage": "Failure: {}".format(self._slurm_command),
                "errorMessage": e.message,
                "exitCode": -1,
                "data": {}
            }
            await self.finish(json.dumps(error_resp))
        except Exception as e:
            self._serverlog.exception(e)
            self.set_status(500)
            error_resp = {
                "success": False,
                "responseMessage": "Failure: {}".format(self._slurm_command),
                "errorMessage": "Unhandled Exception: {}".format(str(e)),
                "exitCode": -1,
                "data": {}
            }
            await self.finish(json.dumps(error_resp))


# all squeue does is request information from SLURM scheduler, which is idempotent (for the "server-side"),
# so clearly GET request is appropriate here
class SqueueHandler(SlurmCommandHandler):
    def initialize(self, squeue: str = None, log=logger):
        super().initialize(squeue, log)
        self._serverlog.debug("SqueueHandler.initialize()")

        # squeue -h automatically removes the header row -o <format string> ensures that the output is in a
        # format expected by the extension Hard-coding this is not great -- ideally we would allow the user to
        # customize this, or have the default output be the user's output stdout, stderr, _ = await
        # run_command('squeue -o "%.18i %.9P %j %.8u %.2t %.10M %.6D %R" -h')
        self.output_formatting = '-o "%.18i %.9P %j %.8u %.2t %.10M %.6D %R" -h'

    def get_command(self):
        exec_command = "{} {}".format(self._slurm_command, self.output_formatting)
        return exec_command

    async def run_command(self, args: list = None):
        response_message = ""
        error_message = "{} did not run!".format(self._slurm_command)
        returncode = -1
        rows = []
        try:
            exec_command = self.get_command()
            self._serverlog.debug("SqueueHandler.run_command(): %s", exec_command)
            out = await self._run_command(exec_command)

            returncode = out.get("returncode", -1)
            cmd_stdout = out.get("stdout", "").strip() if out.get("stdout") else ""
            cmd_stderr = out.get("stderr", "").strip() if out.get("stderr") else ""

            if returncode != 0:
                response_message = "Failure: {} {}".format(exec_command, cmd_stdout)
                error_message = cmd_stderr
            else:
                response_message = "Success: {}".format(exec_command)
                error_message = None

            data_lines = cmd_stdout.splitlines() if cmd_stdout else []
            for row in data_lines:
                if not row:
                    continue
                if row[0] == '"' and row[-1] == '"':
                    values = row.split('"')[1].strip().split(maxsplit=7)
                else:
                    values = row.strip().split(maxsplit=7)
                if len(values) == 8:
                    rows.append([(html.escape(entry)).strip() for entry in values])
        except KeyError as ke:
            self._serverlog.exception(ke)
            response_message = "Failure: {}".format(self._slurm_command)
            error_message = "Missing key before running command: {}".format(str(ke))
            returncode = -1
            rows = []
        except Exception as e:
            self._serverlog.exception(e)
            response_message = "Failure: {}".format(self._slurm_command)
            error_message = "Unhandled Exception: {}".format(str(e))
            returncode = -1
            rows = []
        finally:
            success = (returncode == 0)
            data = {
                "rows": rows,
                "columns": [
                    "JOBID",
                    "PARTITION",
                    "NAME",
                    "USER",
                    "ST",
                    "TIME",
                    "NODES",
                    "NODELIST(REASON)"
                ]
            }
            return {
                "success": success,
                "responseMessage": response_message,
                "errorMessage": None if success else error_message,
                "exitCode": returncode,
                "data": data
            }

    @tornado.web.authenticated
    async def get(self):
        self._serverlog.debug("SqueueHandler.get() %s", self._slurm_command)
        out = {
            "returncode": -1,
            "stderr": "Command did not run!",
            "stdout": ""
            }
        data_dict = {"data": []}
        try:
            out = await self.run_command()
            data_dict = out
            if not data_dict.get("success", False):
                self.set_status(500 if out.get("exitCode") not in (127,) else 503)
        except Exception as e:
            self._serverlog.exception("Unhandled Exception: {}".format(e))
            self.set_status(500)
            data_dict = {
                "success": False,
                "responseMessage": "Failure: {}".format(self._slurm_command),
                "errorMessage": str(e),
                "exitCode": -1,
                "data": {"rows": [], "columns": ["JOBID","PARTITION","NAME","USER","ST","TIME","NODES","NODELIST(REASON)"]}
            }
        finally:
            await self.finish(json.dumps(data_dict))


class SacctHandler(SlurmCommandHandler):
    def initialize(self, sacct: str = None, log=logger):
        super().initialize(sacct, log)
        self._serverlog.debug("SacctHandler.initialize()")

    def _get_fields(self):
        # Default fields include Submit time so users can distinguish jobs with
        # the same name/id in the history view.
        default_fields = "JobID,Partition,JobName,User,State,Submit,Elapsed,NNodes,ExitCode"
        try:
            acc = self.settings.get('SlurmAccounting')
            if acc is not None:
                fields = acc.get('sacct_fields', default_fields)
                if isinstance(fields, str) and fields:
                    return fields
        except Exception:
            pass
        return default_fields

    def _get_time_window_days(self):
        """Return the time window in days for job history queries. Default 30 days."""
        default_days = 30
        try:
            acc = self.settings.get('SlurmAccounting')
            if acc is not None:
                days = acc.get('sacct_time_window_days', default_days)
                if isinstance(days, int) and days > 0:
                    return days
        except Exception:
            pass
        return default_days

    def get_command(self, user: str = None):
        fields = self._get_fields()
        time_window = self._get_time_window_days()
        # -P to use pipe delimiter, -n no header, -X allocation only (no steps)
        base = f"{self._slurm_command} -P -n -X -o {shlex.quote(fields)} -S now-{time_window}days"
        # If a user is provided, prefer server-side filtering by passing -u where supported
        if user:
            # Quote the user param to avoid shell injection
            base = f"{base} -u {shlex.quote(user)}"
        return base

    async def run_command(self, args: list = None, user: str = None):
        response_message = ""
        error_message = f"{self._slurm_command} did not run!"
        returncode = -1
        rows = []
        columns = self._get_fields().split(',')
        try:
            exec_command = self.get_command(user=user)
            self._serverlog.debug("SacctHandler.run_command(): %s", exec_command)
            out = await self._run_command(exec_command)

            returncode = out.get("returncode", -1)
            cmd_stdout = out.get("stdout", "").strip() if out.get("stdout") else ""
            cmd_stderr = out.get("stderr", "").strip() if out.get("stderr") else ""

            if returncode != 0:
                response_message = "Failure: {} {}".format(exec_command, cmd_stdout)
                error_message = cmd_stderr
            else:
                response_message = "Success: {}".format(exec_command)
                error_message = None

            data_lines = cmd_stdout.splitlines() if cmd_stdout else []
            for line in data_lines:
                if not line:
                    continue
                values = [html.escape(x).strip() for x in line.split('|')]
                # Ensure list size matches columns count (pad or trim)
                if len(values) < len(columns):
                    values += [""] * (len(columns) - len(values))
                elif len(values) > len(columns):
                    values = values[:len(columns)]
                rows.append(values)

            # If user was provided and underlying command didn't filter, filter here by the 'User' column
            if user:
                try:
                    # Find index of User column (case-insensitive safety)
                    idx = next(i for i, c in enumerate(columns) if c.lower() == 'user')
                    rows = [r for r in rows if len(r) > idx and r[idx] == user]
                except StopIteration:
                    # 'User' column is not present; nothing to filter
                    pass
        except KeyError as ke:
            self._serverlog.exception(ke)
            response_message = "Failure: {}".format(self._slurm_command)
            error_message = "Missing key before running command: {}".format(str(ke))
            returncode = -1
            rows = []
        except Exception as e:
            self._serverlog.exception(e)
            response_message = "Failure: {}".format(self._slurm_command)
            error_message = "Unhandled Exception: {}".format(str(e))
            returncode = -1
            rows = []
        finally:
            success = (returncode == 0)
            data = {
                "rows": rows,
                "columns": columns
            }
            return {
                "success": success,
                "responseMessage": response_message,
                "errorMessage": None if success else error_message,
                "exitCode": returncode,
                "data": data
            }

    @tornado.web.authenticated
    async def get(self):
        self._serverlog.debug("SacctHandler.get() %s", self._slurm_command)
        try:
            # Optional user filter via query parameter
            user = None
            try:
                user = self.get_argument('user', default=None)
            except Exception:
                user = None
            out = await self.run_command(user=user)
            if not out.get("success", False):
                self.set_status(503 if out.get("exitCode") == 127 else 500)
            await self.finish(json.dumps(out))
        except Exception as e:
            self._serverlog.exception("Unhandled Exception: {}".format(e))
            self.set_status(500)
            await self.finish(json.dumps({
                "success": False,
                "responseMessage": "Failure: {}".format(self._slurm_command),
                "errorMessage": str(e),
                "exitCode": -1,
                "data": {"rows": [], "columns": self._get_fields().split(',')}
            }))


class UiConfigHandler(APIHandler):
    def initialize(self, log=logger):
        self._serverlog = log if log else logger

    @tornado.web.authenticated
    async def get(self):
        """
        Return deployment-only UI hints configured via Traitlets on the server.
        This endpoint is read-only and intended to provide canonical defaults
        that are not user-editable from the front-end settings schema.
        """
        try:
            ui_cfg = self.settings.get('SlurmUI')
            labels = {}
            sizing = {}
            history_labels = {}
            details_field_groups = {}
            details_labels = {}
            details_sources = {}
            details_hidden = {}
            reload_limit_ms = None
            dev_diag = {
                "dev_mode_active": bool(os.environ.get('JLSLURM_DEV')) and not bool(os.environ.get('JLSLURM_DEV_DISABLED')),
                "policy_source": "runtime",
            }
            if ui_cfg is not None:
                try:
                    labels = ui_cfg.get('queue_column_labels', {}) or {}
                except Exception:
                    labels = {}
                try:
                    sizing = ui_cfg.get('queue_column_sizing', {}) or {}
                except Exception:
                    sizing = {}
                try:
                    history_labels = ui_cfg.get('history_column_labels', {}) or {}
                except Exception:
                    history_labels = {}
                # Job Details UI config (all optional)
                try:
                    details_field_groups = ui_cfg.get('details_field_groups', {}) or {}
                except Exception:
                    details_field_groups = {}
                try:
                    details_labels = ui_cfg.get('details_labels', {}) or {}
                except Exception:
                    details_labels = {}
                try:
                    details_sources = ui_cfg.get('details_sources', {}) or {}
                except Exception:
                    details_sources = {}
                try:
                    details_hidden = ui_cfg.get('details_hidden', {}) or {}
                except Exception:
                    details_hidden = {}
                try:
                    # Integer or string convertible to int; ignore if missing
                    reload_limit_ms = ui_cfg.get('squeue_reload_limit_ms', None)
                except Exception:
                    reload_limit_ms = None
                # Development diagnostics if present in server settings (optional future enhancement)
                try:
                    src = ui_cfg.get('_policy_source')
                    if src:
                        dev_diag["policy_source"] = src
                except Exception:
                    pass

            payload = make_envelope(True, data={
                "queue_column_labels": labels,
                "queue_column_sizing": sizing,
                "history_column_labels": history_labels,
                "details_field_groups": details_field_groups,
                "details_labels": details_labels,
                "details_sources": details_sources,
                "details_hidden": details_hidden,
                "squeue_reload_limit_ms": reload_limit_ms,
                "dev_diagnostics": dev_diag,
            })
            await self.finish(json.dumps(payload))
        except Exception as e:
            self._serverlog.exception("Unhandled Exception in UiConfigHandler: {}".format(e))
            self.set_status(500)
            await self.finish(json.dumps(make_envelope(False, error=str(e), exit_code=1)))


class JobDetailsHandler(APIHandler):
    """
    Handler for retrieving detailed information about a specific Slurm job.
    
    It implements a two-stage data retrieval strategy:
    1. Active Jobs: Attempts to use `scontrol show job <id>`. This provides the most
       up-to-date info for running or pending jobs.
    2. Completed Jobs: If scontrol fails or returns no data, it falls back to `sacct`.
    
    Data is normalized into a consistent 'fields' dictionary regardless of the source.
    """
    def get_field_factory(self, pick, aliases, field_map):
        def get_field(name: str):
            # field_map and aliases normalization
            # find raw candidates for normalized name
            raw_name = None
            # reverse map: if map says Raw->Norm, we look up Raw when Norm requested
            for raw, norm in field_map.items():
                if norm == name:
                    raw_name = raw; break
            candidates = [raw_name] if raw_name else []
            candidates += aliases.get(name, [])
            # Also consider direct same-name
            if not candidates:
                candidates = [name]
            for key in candidates:
                if key and key in pick:
                    return pick.get(key)
            return pick.get(name)
        return get_field

    # Helper to expand Slurm path placeholders like %j, %x, %u, etc.
    def expand_slurm_path(self, path: str, jid: str, jname: str, user: str) -> str:
        if not path:
            return path
        # Common Slurm filename placeholders
        path = path.replace('%j', jid or '')
        path = path.replace('%J', jid.split('_')[0] if jid and '_' in jid else (jid or ''))
        path = path.replace('%x', jname or '')
        path = path.replace('%u', user or '')
        # %A = array parent, %a = array index - use job_id for now
        path = path.replace('%A', jid.split('_')[0] if jid and '_' in jid else (jid or ''))
        path = path.replace('%a', jid.split('_')[1] if jid and '_' in jid else '0')
        return path

    def expand_and_verify_path(self, path: str, jid: str, jname: str, user: str, workdir: str) -> str:
        """Expand Slurm placeholders and verify file exists. Return None if not found.

        Path policy (documented for `production_checklist.md` §4):
          - Absolute paths (including those resolved from `~`) are trusted as
            configured by Slurm/the admin's `details_queries` policy or the
            job's own recorded `StdOut`/`StdErr`/`WorkDir` values; they are not
            user-request-controlled, so no traversal restriction applies.
          - Relative paths are joined against the job's own `WorkDir` (as
            reported by Slurm for that job) and then normalized; the result
            must still resolve inside that `WorkDir` so a relative value
            containing `..` cannot escape the job's working directory
            (path-traversal protection).
          - Symlinks are followed (`os.path.isfile`/`os.stat` naturally
            dereference them) since Slurm output files are commonly symlinked
            on shared filesystems (e.g. `latest.log` -> `job_123.log`); we do
            not restrict symlink targets beyond the relative-path containment
            check above, since Slurm's own filesystem/ownership controls are
            the authoritative enforcement point for a shared cluster mount.
          - Ownership/ACL enforcement is intentionally left to the underlying
            filesystem and Slurm's own permissions; the server process reads
            with its own privileges and `os.path.isfile`/`os.stat` will simply
            fail (treated as "not found") if access is denied.
        """
        if not path:
            return None
        expanded = self.expand_slurm_path(path, jid, jname, user)
        if not expanded:
            return None
        # If path is relative, join with workdir and enforce containment so a
        # value like "../../etc/passwd" cannot escape the job's working
        # directory. Absolute paths (or ~-prefixed) are trusted as-is.
        if not expanded.startswith('/') and not expanded.startswith('~'):
            if workdir:
                joined = os.path.normpath(os.path.join(workdir, expanded))
                real_workdir = os.path.realpath(workdir)
                real_joined = os.path.realpath(joined)
                if os.path.commonpath([real_workdir, real_joined]) != real_workdir:
                    self._serverlog.warning(
                        "expand_and_verify_path(): rejected path escaping workdir: {} (workdir={})".format(
                            path, workdir))
                    return None
                expanded = joined
        # Expand ~ to home directory
        expanded = os.path.expanduser(expanded)
        # Check if file exists (symlinks are followed; ownership/permission
        # enforcement is delegated to the filesystem itself)
        if os.path.isfile(expanded):
            return expanded
        return None

    @staticmethod
    def _get_file_info(path):
        """Return dict with exists flag and size in bytes for a file path, or None/0 if missing."""
        if not path:
            return {"exists": False, "size": 0}
        try:
            st = os.stat(path)
            return {"exists": True, "size": st.st_size}
        except OSError:
            return {"exists": False, "size": 0}

    @staticmethod
    def _extract_script_path(command):
        """Extract the script path from a command string like 'sbatch /path/to/script.sh'."""
        if not command:
            return None
        # Strip leading sbatch/srun/salloc and their flags to get the script path
        parts = shlex.split(command)
        if not parts:
            return None
        # Skip the submitter command (sbatch, srun, etc.) and any flags
        i = 0
        if parts[0] in ('sbatch', 'srun', 'salloc') or parts[0].endswith('/sbatch') or parts[0].endswith('/srun') or parts[0].endswith('/salloc'):
            i = 1
        # Skip flags (start with -)
        while i < len(parts) and parts[i].startswith('-'):
            # Some flags take a value argument (e.g. -p partition, --qos=xxx)
            if '=' not in parts[i] and i + 1 < len(parts) and not parts[i + 1].startswith('-') and not parts[i + 1].startswith('/'):
                i += 2
            else:
                i += 1
        if i < len(parts):
            return parts[i]
        return None

    def initialize(self, log=logger, scontrol: str = "scontrol", sacct: str = "sacct"):
        self._serverlog = log if log else logger
        self._scontrol = scontrol
        self._sacct = sacct
        # cache for hooks (per process); in practice handler instances are short-lived
        self._hooks_loaded = False
        self._hooks = {
            'pre_build': None,
            'pre_exec': None,
            'around_exec': None,
            'post_process': None,
            'audit': None,
        }

    # ------------------------
    # Hook and policy utilities
    # ------------------------
    def _is_admin_policy_present(self) -> bool:
        """
        Whether `web_app.settings['SlurmUI']` reflects admin-controlled policy.

        `SlurmUI` is populated exactly once, at server-extension load time, from
        Traitlets config (e.g. `jupyter_server_config.py` / `*.d` JSON files) —
        see `_load_jupyter_server_extension()` in `__init__.py`. `UiConfigHandler`
        (the only route that exposes it) is GET-only, so no user-facing endpoint
        can ever mutate `web_app.settings['SlurmUI']`; a populated dict here is
        therefore, by construction, admin/server-scope policy, never
        user-scope/request-scope data.
        """
        try:
            ui_cfg = self.settings.get('SlurmUI')
            return bool(ui_cfg)
        except Exception:
            return False

    def _load_site_hooks(self):
        if self._hooks_loaded:
            return
        self._hooks_loaded = True
        ui_cfg = self.settings.get('SlurmUI') or {}
        # `JLSLURM_DEV` only relaxes admin-only checks when no admin policy has
        # actually been loaded (i.e. a bare local/dev server with no
        # `SlurmUI` config at all); once an admin has configured `SlurmUI`
        # (even in a dev deployment), that config is authoritative.
        dev_env = bool(os.environ.get('JLSLURM_DEV')) and not self._is_admin_policy_present()
        allow_user_hooks = ui_cfg.get('allow_user_hooks', False) or dev_env
        dev_mode = ui_cfg.get('dev_mode', False) or dev_env
        allowlist = ui_cfg.get('site_hook_allowlist', [])

        def import_hook(path: str):
            if not path:
                return None
            mod, _, attr = path.partition(':')
            if not attr:
                return None
            # Fail-closed allow-list check: outside dev_mode, a hook is only
            # loaded if its module prefix is explicitly present in the
            # allowlist. An *empty* allowlist must reject every hook in
            # production rather than silently permitting any configured
            # import (the previous `if allowlist and not dev_mode:` guard
            # was bypassed entirely whenever the allowlist was empty).
            if not dev_mode:
                if not allowlist or not any(mod == p or mod.startswith(p + '.') for p in allowlist):
                    self._serverlog.warning(f"Rejected hook import not in allowlist: {path}")
                    return None
            try:
                import importlib
                m = importlib.import_module(mod)
                fn = getattr(m, attr, None)
                return fn
            except Exception as e:
                self._serverlog.warning(f"Failed to import hook {path}: {e}")
                return None

        self._hooks['pre_build'] = import_hook((ui_cfg.get('site_hook_pre_build') or os.environ.get('SLURM_UI_DEV_HOOKS_PREBUILD') or '').strip())
        self._hooks['pre_exec'] = import_hook((ui_cfg.get('site_hook_pre_exec') or os.environ.get('SLURM_UI_DEV_HOOKS_PREEXEC') or '').strip())
        self._hooks['around_exec'] = import_hook((ui_cfg.get('site_hook_around_exec') or os.environ.get('SLURM_UI_DEV_HOOKS_AROUND') or '').strip())
        self._hooks['post_process'] = import_hook((ui_cfg.get('site_hook_post_process') or os.environ.get('SLURM_UI_DEV_HOOKS_POST') or '').strip())
        self._hooks['audit'] = import_hook((ui_cfg.get('site_hook_audit') or os.environ.get('SLURM_UI_DEV_HOOKS_AUDIT') or '').strip())

    def _get_dev_queries_overrides(self):
        try:
            if bool(os.environ.get('JLSLURM_DEV')) and not self._is_admin_policy_present():
                q = os.environ.get('SLURM_UI_DEV_QUERIES_JSON')
                fmap = os.environ.get('SLURM_UI_DEV_FIELD_MAP_JSON')
                aliases = os.environ.get('SLURM_UI_DEV_ALIASES_JSON')
                return {
                    'details_queries': json.loads(q) if q else None,
                    'details_field_map': json.loads(fmap) if fmap else None,
                    'details_field_aliases': json.loads(aliases) if aliases else None,
                }
        except Exception as e:
            self._serverlog.warning(f"Failed to parse SLURM_UI_DEV_* env overrides: {e}")
        return {'details_queries': None, 'details_field_map': None, 'details_field_aliases': None}

    @staticmethod
    def _parse_gpu_from_tres(tres_str: str):
        """Parse GPU count/type/mem/util from a Slurm TRES string, e.g.
        "cpu=128,mem=229902M,node=1,billing=128,gres/gpu:a100=4,gres/gpu=4".
        Modern Slurm (real Perlmutter output, both `scontrol show job`'s
        AllocTRES/ReqTRES and `sacct`'s AllocTRES/ReqTRES) reports GPUs this
        way; the untyped `gres/gpu=N` key is always present, with an
        additional typed `gres/gpu:<type>=N` key when a specific GPU
        architecture was requested/allocated.
        Returns a dict with keys: gpus, gpu_type, gpu_mem, gpu_util (each
        None if not present).
        """
        result = {"gpus": None, "gpu_type": None, "gpu_mem": None, "gpu_util": None}
        if not tres_str or tres_str == "(null)":
            return result
        for part in tres_str.split(','):
            part = part.strip()
            if part.startswith('gres/gpumem'):
                m = re.search(r'=(\d+)', part)
                if m:
                    result["gpu_mem"] = m.group(1)
            elif part.startswith('gres/gpuutil'):
                m = re.search(r'=(\d+)', part)
                if m:
                    result["gpu_util"] = m.group(1)
            elif part.startswith('gres/gpu'):
                mtype = re.match(r'gres/gpu:([^=]+)=(\d+)', part)
                if mtype:
                    result["gpu_type"] = mtype.group(1)
                    result["gpus"] = mtype.group(2)
                else:
                    m = re.match(r'gres/gpu=(\d+)', part)
                    if m and result["gpus"] is None:
                        result["gpus"] = m.group(1)
        return result

    @staticmethod
    def _parse_gpu_from_tres_per_node(tres_per_node: str):
        """Parse GPU count from a `TresPerNode`/`TresPerTask`-style string,
        e.g. "gres/gpu:4" (real Perlmutter `scontrol show job` format for a
        pending/requested job that has no typed GRES). Returns the count as
        a string, or None.
        """
        if not tres_per_node:
            return None
        m = re.search(r'gres/gpu:(\d+)', tres_per_node)
        if m:
            return m.group(1)
        return None

    def _build_sacct_argv(self, qprofile: dict, job_id: str):
        args = list(qprofile.get('args') or [])
        fmt = qprofile.get('format') or []
        # Compose -o "A,B,C" once
        if fmt:
            args += ['-o', ','.join(fmt)]
        # Add job id
        args = ['-j', job_id] + args
        # Time window (optional)
        tw = qprofile.get('time_window_days')
        if tw:
            args += ['-S', f'now-{int(tw)}days', '-E', 'now']
        return args

    async def _run_with_hooks(self, command_name: str, argv: list, env: dict, context: dict):
        start = time.time()
        async def _exec(cmdv, envv):
            proc = await asyncio.create_subprocess_exec(*cmdv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=envv or None)
            try:
                out_b, err_b = await asyncio.wait_for(proc.communicate(), timeout=SLURM_COMMAND_TIMEOUT_SECONDS)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
                return -1, "", "command timed out after {}s".format(SLURM_COMMAND_TIMEOUT_SECONDS)
            except asyncio.CancelledError:
                proc.kill()
                await proc.communicate()
                raise
            return proc.returncode, out_b.decode(errors='replace'), err_b.decode(errors='replace')

        self._load_site_hooks()
        hooks = self._hooks

        # pre_exec
        if hooks['pre_exec']:
            try:
                updated = await hooks['pre_exec'](command_name, list(argv), dict(env or {}), context)
                if isinstance(updated, (list, tuple)) and len(updated) == 2:
                    argv, env = updated
            except Exception as e:
                self._serverlog.warning(f"pre_exec hook failed: {e}")

        # around_exec
        if hooks['around_exec']:
            try:
                rc, out, err = await hooks['around_exec'](_exec, command_name, argv, env, context)
            except Exception as e:
                self._serverlog.warning(f"around_exec hook failed, falling back to direct exec: {e}")
                rc, out, err = await _exec(argv, env)
        else:
            rc, out, err = await _exec(argv, env)

        dur_ms = int((time.time() - start) * 1000)
        # audit
        if hooks['audit']:
            try:
                await hooks['audit'](command_name, rc, dur_ms, list(argv), context)
            except Exception:
                pass
        return rc, out, err

    @tornado.web.authenticated
    async def get(self, job_id: str):
        """
        Return normalized job details. Minimal skeleton implementation that tries
        `scontrol show job <id>` and, if not found, falls back to `sacct`.
        This is intentionally conservative and will be expanded with richer parsing.
        """
        try:
            job_id = (job_id or "").strip()
            if not job_id:
                self.set_status(400)
                await self.finish(json.dumps(make_envelope(False, error="Missing job_id", exit_code=1)))
                return
            if not jobIDMatcher.search(job_id):
                self.set_status(400)
                await self.finish(json.dumps(make_envelope(
                    False, error="Invalid job_id: {}".format(job_id), exit_code=1)))
                return

            # Load policy and possible dev overrides for this process
            ui_cfg = self.settings.get('SlurmUI') or {}
            overrides = self._get_dev_queries_overrides()
            if overrides['details_queries']:
                ui_cfg = dict(ui_cfg)
                ui_cfg['details_queries'] = overrides['details_queries']
            field_map = ui_cfg.get('details_field_map') or overrides.get('details_field_map') or {}
            aliases = ui_cfg.get('details_field_aliases') or overrides.get('details_field_aliases') or {}

            # Try scontrol first (active job) if configured
            queries = ui_cfg.get('details_queries') or {}
            context = {
                'username': self.current_user if isinstance(self.current_user, str) else None,
                'job_id': job_id,
                'handler': 'job-details'
            }

            # Helper: parse scontrol text to kv dict
            source = 'scontrol'
            fields = {
                "JobID": job_id,
                "JobName": None,
                "User": None,
                "QOS": None,
                "Account": None,
                "State": None,
                "Command": None,
                "Partition": None,
                "SubmitTime": None,
                "StartTime": None,
                "EndTime": None,
                "Elapsed": None,
                "Nodes": None,
                "Nodelist": None,
                "CPUs": None,
                "GPUs": None,
                "GPUType": None,
                "GPUMemVariant": None,
                "GPUMem": None,
                "GPUUtil": None,
                "Mem": None,
                "GRES": None,
                "TimeLimit": None,
                "Stdout": None,
                "Stderr": None,
                "WorkDir": None,
                "ArrayParent": None,
                "ArrayRanges": None,
                "ExitCode": None,
                "DerivedExitCode": None,
                "Reason": None,
                "RawScontrol": None,
            }

            def parse_scontrol(text: str):
                # Parse scontrol Key=Value output, handling values that contain spaces.
                # Each pair is delimited by ' Key=' boundaries or end-of-line. Keys can
                # themselves contain a colon (e.g. real scontrol output like
                # "Partition=gpu AllocNode:Sid=slurmctld:1362" -- verified against a
                # real Docker Slurm cluster run), so the key pattern must allow
                # `[\w:]+`, not just `\w+`, or a compound key like `AllocNode:Sid`
                # would fail to match as a boundary and bleed into the previous
                # value (e.g. `Partition` would incorrectly include everything up
                # to the next real boundary).
                kv = {}
                for line in text.splitlines():
                    stripped = line.strip()
                    if not stripped:
                        continue
                    for m in re.finditer(r'([\w:]+)=(.*?)(?=\s+[\w:]+=|$)', stripped):
                        kv[m.group(1)] = m.group(2).strip()
                return kv

            # Execute scontrol (use config if present, otherwise default to 'scontrol show job <id>')
            rc = -1; out = ''; err = ''
            if 'active' in queries:
                argv = [self._scontrol] + list(queries['active'].get('args') or []) + [job_id]
            else:
                self._serverlog.info("No 'details_queries.active' config found; using default: scontrol show job %s", job_id)
                argv = [self._scontrol, 'show', 'job', job_id]
            rc, out, err = await self._run_with_hooks('scontrol', argv, os.environ.copy(), context)

            if rc == 0 and out:
                kv = parse_scontrol(out)

                # Parse GPUs. Real `scontrol show job` output (verified
                # against actual Perlmutter data) does NOT have a `Gres=`
                # key -- that only appears in `scontrol show node` output.
                # A job instead reports its GPU allocation/request via
                # `AllocTRES`/`ReqTRES` (e.g. "gres/gpu:a100=4,gres/gpu=4")
                # once running, or `TresPerNode`/`TresPerTask`
                # (e.g. "gres/gpu:4", untyped) while still pending. Fall
                # back to the legacy `Gres=` key for older Slurm sites that
                # might still emit it there.
                tres_gpu = self._parse_gpu_from_tres(kv.get('AllocTRES') or kv.get('ReqTRES') or '')
                gpus = tres_gpu["gpus"]
                gpu_type = tres_gpu["gpu_type"]
                if gpus is None:
                    gpus = self._parse_gpu_from_tres_per_node(kv.get('TresPerNode') or kv.get('TresPerTask') or '')
                gres = kv.get('Gres')
                if gpus is None and gres:
                    # Gres examples: gpu:4, gpu:kepler:2, gpu:1(S:0),
                    # gpu:a100:4(S:0-3) (real Perlmutter node format).
                    for part in gres.split(','):
                        if part.startswith('gpu'):
                            # Strip trailing socket-affinity info, e.g. "(S:0-3)".
                            clean = re.sub(r'\(.*\)$', '', part)
                            segs = clean.split(':')
                            if len(segs) >= 3:
                                # gpu:<type>:<count>
                                gpu_type = segs[1]
                                gpus = segs[2]
                                break
                            m = re.search(r'gpu:(\d+)', clean)
                            if m:
                                gpus = m.group(1)
                                break

                # GPU memory variant (e.g. hbm40g/hbm80g) is exposed via node
                # Features/constraints on Perlmutter, not a distinct GRES type
                # (e.g. Features=gpu&a100&hbm80g).
                gpu_mem_variant = None
                features = kv.get('Features') or kv.get('ActiveFeatures')
                if features:
                    m = re.search(r'hbm(\d+g)', features, re.IGNORECASE)
                    if m:
                        gpu_mem_variant = m.group(1)
                
                # Compute Elapsed
                elapsed = None
                start_str = kv.get('StartTime')
                end_str = kv.get('EndTime')
                if start_str and start_str != 'Unknown' and start_str != 'N/A':
                    try:
                        # Slurm usually uses ISO-like format: 2024-03-21T10:00:00
                        # or with space: 2024-03-21 10:00:00
                        s_str = start_str.replace(' ', 'T')
                        start_dt = datetime.datetime.fromisoformat(s_str)
                        if end_str and end_str != 'Unknown' and end_str != 'N/A':
                            e_str = end_str.replace(' ', 'T')
                            end_dt = datetime.datetime.fromisoformat(e_str)
                        else:
                            end_dt = datetime.datetime.now()
                        
                        delta = end_dt - start_dt
                        if delta.total_seconds() >= 0:
                            # Format as [[DD-]HH:]MM:SS
                            seconds = int(delta.total_seconds())
                            days, remainder = divmod(seconds, 86400)
                            hours, remainder = divmod(remainder, 3600)
                            minutes, seconds = divmod(remainder, 60)
                            if days > 0:
                                elapsed = f"{days}-{hours:02d}:{minutes:02d}:{seconds:02d}"
                            elif hours > 0:
                                elapsed = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
                            else:
                                elapsed = f"{minutes:02d}:{seconds:02d}"
                    except (ValueError, TypeError):
                        pass

                fields.update({
                    "JobName": kv.get('JobName'),
                    "User": kv.get('UserId') or kv.get('User'),
                    "QOS": kv.get('QOS'),
                    "Account": kv.get('Account'),
                    "State": (kv.get('JobState') or kv.get('State')),
                    "Command": kv.get('Command'),
                    "Partition": kv.get('Partition'),
                    "SubmitTime": kv.get('SubmitTime'),
                    "StartTime": kv.get('StartTime'),
                    "EndTime": kv.get('EndTime'),
                    "Elapsed": elapsed,
                    "Nodes": kv.get('NumNodes'),
                    "NodeList": kv.get('NodeList'),
                    "CPUs": kv.get('NumCPUs') or kv.get('NumCPUsRaw'),
                    "GPUs": gpus,
                    "GPUType": gpu_type,
                    "GPUMemVariant": gpu_mem_variant,
                    "GPUMem": tres_gpu["gpu_mem"],
                    "GPUUtil": tres_gpu["gpu_util"],
                    "Mem": kv.get('MinMemoryNode') or kv.get('MinMemoryCPU'),
                    "GRES": kv.get('Gres'),
                    "TimeLimit": kv.get('TimeLimit'),
                    "Stdout": kv.get('StdOut'),
                    "Stderr": kv.get('StdErr'),
                    "WorkDir": kv.get('WorkDir'),
                    "ArrayParent": kv.get('ArrayJobId') or kv.get('ArrayJobID'),
                    "Reason": kv.get('Reason'),
                    "RawScontrol": out.strip(),
                })
            else:
                # Fallback to sacct for completed jobs
                source = 'sacct'
                # Build from policy, fallback to a reasonable default format
                alloc = queries.get('allocation') or {}
                if not alloc:
                    # Default format augmented to include WorkDir/StdOut/StdErr/SubmitLine for richer details
                    # Note: omit -X in args to allow step rows (.batch/.extern) to be returned if present
                    # Include resource usage fields for debugging failed jobs
                    alloc = {"command": "sacct", "args": ["--parsable2","-n"],
                             "format": [
                                 "JobID","JobName","User","Partition","Account","AllocCPUS","State","ExitCode",
                                 "Start","End","Elapsed","Submit","Timelimit","QOS","NodeList","NNodes","NTasks",
                                 "ReqMem","MaxRSS","TotalCPU","UserCPU","SystemCPU","AveDiskRead","AveDiskWrite",
                                 "WorkDir","StdOut","StdErr","SubmitLine",
                                 "DerivedExitCode","AllocTRES","ReqTRES"
                             ],
                             "time_window_days": 30}
                # Use shlex.split to handle paths with spaces (e.g., "python /path/to/sacct")
                sacct_prefix = shlex.split(self._sacct)
                # Sanitize the job id for sacct: drop an array throttle suffix
                # (e.g. "123_[1-4%2]") which Slurm's job-array parser rejects.
                query_job_id = re.sub(r'%\d+', '', job_id)
                argv = sacct_prefix + self._build_sacct_argv(alloc, query_job_id)
                rc, out, err = await self._run_with_hooks('sacct', argv, os.environ.copy(), context)
                # An array element / range job id (e.g. "123_4" or "123_[1-4]")
                # can be rejected by some Slurm versions with a fatal
                # "Bad job array element specified" error (non-zero exit, no
                # output). In that case, retry against the base array job id,
                # which returns every element; the row-pick below still selects
                # the requested element by its JobID.
                if (rc != 0 or not out.strip()) and '_' in query_job_id:
                    base_job_id = query_job_id.split('_', 1)[0]
                    if base_job_id and base_job_id != query_job_id:
                        self._serverlog.info(
                            "sacct job-details failed for '%s' (rc=%s); retrying with base array id '%s'",
                            query_job_id, rc, base_job_id
                        )
                        argv = sacct_prefix + self._build_sacct_argv(alloc, base_job_id)
                        rc, out, err = await self._run_with_hooks('sacct', argv, os.environ.copy(), context)
                if rc == 0 and out.strip():
                    lines = [l for l in out.splitlines() if l.strip()]
                    # derive columns from alloc.format
                    col_list = [c.strip() for c in (alloc.get('format') or [])]

                    # Parse all lines into dicts
                    parsed_rows = []
                    for line in lines:
                        parts = line.split('|') if '|' in line else line.split()
                        # Pad or trim to align with columns length
                        if len(parts) < len(col_list):
                            parts = parts + ([""] * (len(col_list) - len(parts)))
                        elif len(parts) > len(col_list):
                            parts = parts[:len(col_list)]
                        parsed_rows.append(dict(zip(col_list, parts)))

                    # Preferred row for main job
                    pick = next((r for r in parsed_rows if r.get('JobID') == job_id), None)
                    if pick is None and parsed_rows:
                        pick = parsed_rows[0]

                    field_map = ui_cfg.get('details_field_map') or overrides.get('details_field_map') or {}
                    aliases = ui_cfg.get('details_field_aliases') or overrides.get('details_field_aliases') or {}

                    get_field = self.get_field_factory(pick, aliases, field_map)

                    raw_stdout = get_field('StdOut')
                    raw_stderr = get_field('StdErr')
                    jname = get_field('JobName')
                    juser = get_field('User')
                    workdir = get_field('WorkDir')

                    # Parse GPUs from AllocTRES/ReqTRES. Modern Slurm removed
                    # AllocGRES/ReqGRES (sacct fatals with "AllocGRES has been
                    # removed, please use AllocTRES"), so GPU counts now come
                    # from the TRES string, e.g. "cpu=2,mem=256M,node=1,gres/gpu=4"
                    # or "gres/gpu:a100=2".
                    sacct_tres = get_field('AllocTRES') or get_field('ReqTRES')
                    sacct_tres_gpu = self._parse_gpu_from_tres(sacct_tres)
                    sacct_gpus = sacct_tres_gpu["gpus"]
                    sacct_gpu_type = sacct_tres_gpu["gpu_type"]
                    sacct_gpu_mem = sacct_tres_gpu["gpu_mem"]
                    sacct_gpu_util = sacct_tres_gpu["gpu_util"]
                    # Present only the GRES portion of TRES (e.g. "gres/gpu=1"),
                    # not the full cpu/mem/node TRES string, for the details view.
                    gres_tokens = [p for p in (sacct_tres or '').split(',') if p.startswith('gres/')]
                    sacct_gres = ','.join(gres_tokens) if gres_tokens else None

                    # Pull resource-usage fields from .batch step row when available,
                    # since the main job row typically has these empty.
                    batch_row = next((r for r in parsed_rows if '.batch' in (r.get('JobID') or '')), None)
                    if batch_row:
                        batch_get = self.get_field_factory(batch_row, aliases, field_map)
                    else:
                        batch_get = get_field

                    fields.update({
                        "JobName": jname,
                        "User": juser,
                        "Partition": get_field('Partition'),
                        "Account": get_field('Account'),
                        "CPUs": get_field('CPUs') or get_field('AllocCPUS'),
                        "State": get_field('State'),
                        "ExitCode": get_field('ExitCode'),
                        "DerivedExitCode": get_field('DerivedExitCode'),
                        "SubmitTime": get_field('Submit'),
                        "StartTime": get_field('Start'),
                        "EndTime": get_field('End'),
                        "Elapsed": get_field('Elapsed'),
                        "TimeLimit": get_field('Timelimit'),
                        "QOS": get_field('QOS'),
                        "NodeList": get_field('NodeList'),
                        "Nodelist": get_field('NodeList'),
                        "Nodes": get_field('NNodes'),
                        "Tasks": get_field('NTasks'),
                        "ReqMem": get_field('ReqMem'),
                        "Mem": get_field('ReqMem'),
                        "GRES": sacct_gres,
                        "GPUs": sacct_gpus,
                        "GPUType": sacct_gpu_type,
                        "GPUMem": sacct_gpu_mem,
                        "GPUUtil": sacct_gpu_util,
                        "MaxRSS": batch_get('MaxRSS'),
                        "TotalCPU": batch_get('TotalCPU'),
                        "UserCPU": batch_get('UserCPU'),
                        "SystemCPU": batch_get('SystemCPU'),
                        "AveDiskRead": batch_get('AveDiskRead'),
                        "AveDiskWrite": batch_get('AveDiskWrite'),
                        "WorkDir": workdir,
                        "Stdout": self.expand_and_verify_path(raw_stdout, job_id, jname, juser, workdir),
                        "Stderr": self.expand_and_verify_path(raw_stderr, job_id, jname, juser, workdir),
                        "Command": get_field('Command') or get_field('SubmitLine'),
                    })
                    # Build steps list (other rows like <JOBID>.batch, .extern, task steps)
                    steps = []
                    try:
                        for r in parsed_rows:
                            if not r:
                                continue
                            jid = r.get('JobID') or ''
                            if jid and jid != job_id:
                                steps.append(r)
                    except Exception:
                        steps = []
                else:
                    self.set_status(404)
                    await self.finish(json.dumps(make_envelope(
                        False,
                        error=err.strip() or "Job not found",
                        exit_code=rc if rc is not None else 1,
                    )))
                    return

            # Enrich Stdout/Stderr with file existence and size info
            for fkey in ('Stdout', 'Stderr'):
                fpath = fields.get(fkey)
                info = self._get_file_info(fpath)
                fields[fkey + 'Exists'] = info['exists']
                fields[fkey + 'Size'] = info['size']

            # Extract script path from Command for editor actions
            cmd = fields.get('Command')
            fields['CommandScript'] = self._extract_script_path(cmd)

            # post_process hook (as final normalization opportunity)
            self._load_site_hooks()
            if self._hooks.get('post_process'):
                try:
                    fields = await self._hooks['post_process'](source, 0, '', '', fields, context) or fields
                except Exception as e:
                    self._serverlog.warning(f"post_process hook failed: {e}")

            payload = make_envelope(True, exit_code=0, data={
                "source": source,
                "fields": fields,
                # Optional: present only when sacct returned multiple rows (steps)
                **({"steps": steps} if source == 'sacct' and 'steps' in locals() and steps else {})
            })
            await self.finish(json.dumps(payload))
        except Exception as e:
            self._serverlog.exception("Unhandled Exception in JobDetailsHandler: {}".format(e))
            self.set_status(500)
            await self.finish(json.dumps(make_envelope(False, error=str(e), exit_code=1)))


def _validate_slurm_command_path(name, path, log=None):
    """Warn at server startup if a configured Slurm command path does not
    look trustworthy: an absolute path that doesn't exist or isn't
    executable, or a bare command name that can't be resolved on `PATH` at
    all. This is advisory rather than fatal (many valid deployments
    intentionally rely on `PATH` resolution, and `sacct_path` may
    legitimately be an "interpreter script" form like
    "/usr/bin/python3 /path/to/wrapper.py"), but it surfaces obvious
    misconfiguration at startup instead of failing silently on every
    request.
    """
    log = log or logger
    if not path:
        return
    try:
        first_token = shlex.split(path)[0]
    except Exception:
        first_token = path
    if not first_token:
        return
    if os.path.isabs(first_token):
        if not os.path.exists(first_token):
            log.warning("Configured %s command path does not exist: %s", name, first_token)
        elif not os.path.isfile(first_token) or not os.access(first_token, os.X_OK):
            log.warning("Configured %s command path is not an executable file: %s", name, first_token)
    else:
        if not shutil.which(first_token):
            log.warning(
                "Configured %s command '%s' could not be resolved on PATH; "
                "requests to this endpoint will fail with HTTP 503",
                name, first_token)


def setup_handlers(web_app, temporary_directory=None, log=None):
    if log:
        log.debug(web_app.settings)

    host_pattern = ".*$"

    spath = os.path.normpath(
        web_app.settings['spath']) + "/" if 'spath' in web_app.settings else ''

    def obtain_path(method):
        if log:
            log.debug(web_app.settings)

        # Start with system path resolution
        local_path = shutil.which(method)

        # 1) Allow flat settings override (e.g., 'squeue_path')
        if method + '_path' in web_app.settings:
            local_path = web_app.settings[method + '_path']

        # 2) Support nested traitlets Config provided by tests via 'SlurmCommandPaths'
        #    The test fixture sets web_app.settings['SlurmCommandPaths'] to a traitlets Config
        #    containing keys like 'squeue_path', 'scancel_path', etc.
        try:
            scp = web_app.settings.get('SlurmCommandPaths')
            if scp is not None:
                nested_key = method + '_path'
                # traitlets.Config behaves like a dict for key membership
                if nested_key in scp and scp[nested_key]:
                    local_path = scp[nested_key]
        except Exception:
            # If anything goes wrong, keep previously resolved local_path
            pass

        return local_path

    squeue_path = obtain_path("squeue")
    scancel_path = obtain_path("scancel")
    scontrol_path = obtain_path("scontrol")
    sbatch_path = obtain_path("sbatch")
    # Optional accounting path (sacct); if not configured, fallback to PATH
    sacct_path = obtain_path("sacct")

    for _name, _path in (
        ("squeue", squeue_path), ("scancel", scancel_path),
        ("scontrol", scontrol_path), ("sbatch", sbatch_path),
        ("sacct", sacct_path),
    ):
        _validate_slurm_command_path(_name, _path, log)

    base_url = web_app.settings['base_url']

    handlers = [
        (url_path_join(base_url, "jupyterlab_slurm", "status"), HealthCheckHandler, dict(log=log)),
        (url_path_join(base_url, "jupyterlab_slurm", "user"), UserFetchHandler, dict(log=log)),
        (url_path_join(base_url, "jupyterlab_slurm", "ui-config"), UiConfigHandler, dict(log=log)),
        (url_path_join(base_url, 'jupyterlab_slurm', 'squeue'), SqueueHandler, dict(squeue=squeue_path, log=log)),
        (url_path_join(base_url, 'jupyterlab_slurm', 'scancel'), ScancelHandler, dict(scancel=scancel_path, log=log)),
        (url_path_join(base_url, 'jupyterlab_slurm', 'scontrol', '(?P<action>.*)'), ScontrolHandler,
         dict(scontrol=scontrol_path, log=log)),
        (url_path_join(base_url, 'jupyterlab_slurm', 'sbatch'), SbatchHandler,
         dict(sbatch=sbatch_path, log=log)),
        # new accounting endpoint
        (url_path_join(base_url, 'jupyterlab_slurm', 'sacct'), SacctHandler,
         dict(sacct=sacct_path, log=log)),
        # job details (new)
        (url_path_join(base_url, 'jupyterlab_slurm', 'job', '(?P<job_id>.*)'), JobDetailsHandler,
         dict(scontrol=scontrol_path, sacct=sacct_path, log=log))
     ]

    # The test-suite harness route is only appended when its (optional) module
    # is present *and* an admin has explicitly enabled it via SlurmTesting.enabled.
    # See test_suite.py for why this module can be omitted from a production build.
    if SlurmTestSuiteHandler is not None:
        from .test_suite import register_handler as _register_test_suite_handler
        _register_test_suite_handler(
            handlers, base_url, url_path_join, squeue_path, sacct_path,
            scontrol_path, sbatch_path, scancel_path, log, web_app,
        )

    if log:
        log.debug("Slurm command paths: \nsqueue: {}\nscancel: {}\nscontrol: {}\nsbatch: {}\nsacct: {}\n".format(
            squeue_path, scancel_path, scontrol_path, sbatch_path, sacct_path
            ))

        log.info("Starting up handlers....\n")
        for h in handlers:
            log.debug("Handler: {}\tURI: {}\tdict: {}\n".format(
                h[1].__name__, h[0], h[2]))

    web_app.add_handlers(host_pattern, handlers)
