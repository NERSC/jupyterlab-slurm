import asyncio
import datetime
import html
import json
import logging
import os
import re
import shlex
import shutil
import time

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
import tornado
import tornado.web

logger = logging.Logger(__file__)

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


# Here mainly as a sanity check that the extension is installed and running
class ExampleHandler(APIHandler):
    def initialize(self, log=logger):
        super().initialize()
        self._serverlog = log
        self._serverlog.info("ExampleHandler.initialize()")

    @tornado.web.authenticated
    def get(self):
        try:
            self._serverlog.info("ExampleHandler.get()")
            self.finish(json.dumps({
                "data": "This is the /jupyterlab_slurm/get_example endpoint!"
                }))
        except Exception as e:
            self.finish(json.dumps({
                "message": "ExampleHandler error", "exception": str(e)
                }))


# A simple request handler for retrieving the username
class UserFetchHandler(APIHandler):
    def initialize(self, log=logger):
        super().initialize()
        self._serverlog = log
        self._serverlog.info("UserFetchHandler.initialize()")

    @tornado.web.authenticated
    def get(self):
        try:
            username = os.environ.get('USER')
            self._serverlog.info("UserFetchHandler.get() {}".format(username))
            self.finish(json.dumps({
                "user": username
                }))
        except Exception as e:
            self._serverlog.exception(e)
            self.finish(json.dumps(e))


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
            jobIDs = body["job_ids"]
        else:
            # Accept both body arguments and query parameters for flexibility (e.g., DELETE with query params)
            # First, attempt to parse a JSON body even if Content-Type wasn't set correctly
            jobIDs = []
            try:
                if self.request.body:
                    body_text = self.request.body.decode() if isinstance(self.request.body, (bytes, bytearray)) else str(self.request.body)
                    text = body_text.strip()
                    if (text.startswith('{') and text.endswith('}')) or (text.startswith('[') and text.endswith(']')):
                        maybe_json = json.loads(text)
                        if isinstance(maybe_json, dict) and 'job_ids' in maybe_json:
                            jobIDs = [str(x) for x in maybe_json.get('job_ids', [])]
                        elif isinstance(maybe_json, list):
                            jobIDs = [str(x) for x in maybe_json]
            except Exception:
                # Fall back to arguments parsing
                jobIDs = []

            if not jobIDs:
                jobIDs = self.get_arguments('job_ids')
                # Normalize possible encodings like JSON-encoded list or comma-separated string
                if len(jobIDs) == 1:
                    raw = jobIDs[0]
                    if isinstance(raw, bytes):
                        raw = raw.decode()
                    raw_str = str(raw).strip()
                    # JSON list encoded into a single arg
                    if raw_str.startswith('[') and raw_str.endswith(']'):
                        # Try JSON first, then fall back to Python literal lists like ['123']
                        parsed = None
                        try:
                            parsed = json.loads(raw_str)
                        except Exception:
                            try:
                                import ast
                                parsed = ast.literal_eval(raw_str)
                            except Exception:
                                parsed = None
                        if isinstance(parsed, list):
                            jobIDs = [str(x) for x in parsed]
                    # Comma-separated list
                    elif ',' in raw_str and ' ' not in raw_str:
                        jobIDs = [s for s in raw_str.split(',') if s]

        for jobID in jobIDs:
            if not jobIDMatcher.search(jobID):
                raise InvalidSlurmJobID(jobID, "jobID {} is invalid".format(jobID))

        return jobIDs

    async def _run_command(self, command: str = None, stdin=None, cwd=None):
        """Run a Slurm command safely, resolving executable via PATH if needed.
        Returns dict: {stdout, stderr, returncode} and never raises on failure.
        """
        self._serverlog.info('SlurmCommandHandler._run_command(): {} {} {}'.format(command, stdin, cwd))
        commands = shlex.split(command)
        self._serverlog.info('SlurmCommandHandler._run_command(): {}'.format(commands))

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
            self._serverlog.info('SlurmCommandHandler._run_command(): resolved exe {} -> {}'.format(exe, resolved))
            # If still not found, return a clear error
            if not os.path.isabs(resolved) or not os.path.exists(resolved):
                return {
                    "stdout": "",
                    "stderr": f"Executable not found: {exe}. PATH={os.environ.get('PATH','')}",
                    "returncode": 127
                }
            commands[0] = resolved
        except Exception as e:
            # Best effort; try to run with original exe
            self._serverlog.warning(f"Command resolution failed for {exe}: {e}")

        # Execute with timeout
        proc = await asyncio.create_subprocess_exec(
            *commands,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            stdin=stdin,
            cwd=cwd
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60.0)
        return {
            "stdout": stdout.decode(errors='replace').strip(),
            "stderr": stderr.decode(errors='replace').strip(),
            "returncode": proc.returncode
        }

    async def run_command(self, args: list = None):
        responseMessage = ""
        errorMessage = "{} did not run!".format(self._slurm_command)
        returncode = -1
        try:
            jobIDs = " ".join(self.get_jobids())
            self._serverlog.info(jobIDs)

            if args is None:
                args = []

            out = await self._run_command("{} {} {}".format(self._slurm_command, " ".join(args), jobIDs))

            returncode = out["returncode"]
            cmd_stdout = ""
            if "stdout" in out and len(out["stdout"].strip()) > 0:
                cmd_stdout = out["stdout"]

            cmd_stderr = ""
            if "stderr" in out and len(out["stderr"].strip()) > 0:
                cmd_stderr = out["stderr"]

            if returncode != 0:
                responseMessage = "Failure: {} {} {}".format(self._slurm_command, jobIDs, cmd_stdout)
                errorMessage = cmd_stderr
            else:
                responseMessage = "Success: {} {}".format(self._slurm_command, jobIDs)
                errorMessage = ""
        except KeyError as ke:
            self._serverlog.exception(ke)
            try:
                jobIDs is not None
            except NameError:
                jobIDs = []

            responseMessage = "Failure: {} {}".format(self._slurm_command, jobIDs)
            errorMessage = "Missing key before running command: {}".format(str(ke))
            returncode = -1
        except MissingSlurmJobID as emj:
            self._serverlog.exception(emj)
            responseMessage = "Failure: {} missing jobID".format(self._slurm_command)
            errorMessage = emj.message
            returncode = -1
        except InvalidSlurmJobID as eij:
            self._serverlog.exception(eij)
            responseMessage = "Failure: {} invalid jobID {}".format(self._slurm_command, eij.jobid)
            errorMessage = eij.message
            returncode = -1
        except Exception as e:
            self._serverlog.exception(e)
            try:
                jobIDs is not None
            except NameError:
                jobIDs = []

            responseMessage = "Failure: {} {}".format(self._slurm_command, jobIDs)
            errorMessage = "Unhandled Exception: {}".format(str(e))
            returncode = -1
        finally:
            requested_ids = []
            try:
                requested_ids = self.get_jobids()
            except Exception:
                requested_ids = []
            success = (returncode == 0)
            data = {
                "requestedIds": requested_ids,
                "changedIds": requested_ids if success else []
            }
            return {
                "success": success,
                "responseMessage": responseMessage,
                "errorMessage": None if success else errorMessage,
                "exitCode": returncode,
                "data": data
                }


# Conventions: Query arguments: always settings for how to use or options provided by a SLURM command. Body
# arguments: always job designators, e.g. job ID, paths to SLURM scripts, input streams of SLURM script contents,
# etc. Path arguments: always commands (including commands sent to `scontrol`, e.g. `scontrol hold`/`scontrol resume`)

# Unsurprisingly, the job ID's are always (for scancel and scontrol) the body argument named 'jobID'

# Since this is idempotent, hypothetically one could also use PUT instead of DELETE here.
class ScancelHandler(SlurmCommandHandler):
    def initialize(self, scancel: str = "scancel", log=logger):
        super().initialize(scancel, log)
        self._serverlog.info("ScancelHandler.initialize(): {} {}".format(self._slurm_command, self._serverlog))

    # Add `-H "Authorization: token <token>"` to the curl command for any DELETE request
    @tornado.web.authenticated
    async def delete(self):
        self._serverlog.info('ScancelHandler.delete() - request: {}, command: {}'.format(
            self.request, self._slurm_command))
        try:
            out = await self.run_command()
            await self.finish(json.dumps(out))
            return
        except Exception as e:
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
        self._serverlog.info("ScontrolHandler.initialize()")

    # Add `-H "Authorization: token <token>"` to the curl command for any PATCH request
    @tornado.web.authenticated
    async def patch(self, action):
        self._serverlog.info("ScontrolHandler.patch(): {} {}".format(self._slurm_command, action))
        try:
            # Prefer maximally portable hold/release via update JobId=<id> Hold=on/off
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
                        "responseMessage": f"Failure {self._slurm_command} {action} missing jobIDs",
                        "errorMessage": "No job IDs provided",
                        "exitCode": -1,
                        "data": {"requestedIds": [], "changedIds": []}
                    }
                    await self.finish(json.dumps(resp))
                    return

                hold_val = "on" if action == "hold" else "off"
                for jid in requested:
                    cmd = f"{self._slurm_command} update JobId={shlex.quote(jid)} Hold={hold_val}"
                    out = await self._run_command(cmd)
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
            await self.finish(json.dumps(out))
            return
        except Exception as e:
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
        responseMessage = ""
        errorMessage = "{} has not run yet!".format(self._slurm_command)
        returncode = -1
        try:
            try:
                self._serverlog.info("SbatchHandler.post() - sbatch call - {} {} {}".format(
                    self._slurm_command, script_path, output_path))
                if not output_path:
                    output_path = os.getcwd()
                out = await self._run_command("{} {}".format(
                    self._slurm_command, script_path), cwd=output_path)
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
                responseMessage = "Failure: {} {}".format(self._slurm_command, cmd_stdout)
                errorMessage = cmd_stderr
            else:
                responseMessage = "Success: {}".format(self._slurm_command)
                errorMessage = ""
        except KeyError as ke:
            self._serverlog.exception(ke)
            responseMessage = "Failure: {}".format(self._slurm_command)
            errorMessage = "Missing key before running command: {}".format(str(ke))
            returncode = -1
        except Exception as e:
            self._serverlog.exception(e)
            responseMessage = "Failure: {}".format(self._slurm_command)
            errorMessage = "Unhandled Exception: {}".format(str(e))
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
                "responseMessage": responseMessage,
                "errorMessage": None if success else errorMessage,
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
            self._serverlog.info('SbatchHandler.post() - sbatch request: {} {}, inputPath: {}, outputPath: {}'.format(
                self.request, self.request.body, inputPath, outputPath))

            if not inputPath:
                raise tornado.web.MissingArgumentError('inputPath')

            out = await self.run_command(inputPath, outputPath)
            await self.finish(json.dumps(out))
            return
        except Exception as e:
            self._serverlog.exception(e)
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
        responseMessage = ""
        errorMessage = "{} did not run!".format(self._slurm_command)
        returncode = -1
        rows = []
        try:
            exec_command = self.get_command()
            self._serverlog.info("SqueueHandler.run_command(): {}".format(exec_command))
            out = await self._run_command(exec_command)

            returncode = out.get("returncode", -1)
            cmd_stdout = out.get("stdout", "").strip() if out.get("stdout") else ""
            cmd_stderr = out.get("stderr", "").strip() if out.get("stderr") else ""

            if returncode != 0:
                responseMessage = "Failure: {} {}".format(exec_command, cmd_stdout)
                errorMessage = cmd_stderr
            else:
                responseMessage = "Success: {}".format(exec_command)
                errorMessage = None

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
            responseMessage = "Failure: {}".format(self._slurm_command)
            errorMessage = "Missing key before running command: {}".format(str(ke))
            returncode = -1
            rows = []
        except Exception as e:
            self._serverlog.exception(e)
            responseMessage = "Failure: {}".format(self._slurm_command)
            errorMessage = "Unhandled Exception: {}".format(str(e))
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
                "responseMessage": responseMessage,
                "errorMessage": None if success else errorMessage,
                "exitCode": returncode,
                "data": data
            }

    @tornado.web.authenticated
    async def get(self):
        self._serverlog.info("SqueueHandler.get() {}".format(self._slurm_command))
        out = {
            "returncode": -1,
            "stderr": "Command did not run!",
            "stdout": ""
            }
        data_dict = {"data": []}
        try:
            out = await self.run_command()
            data_dict = out
        except Exception as e:
            self._serverlog.exception("Unhandled Exception: {}".format(e))
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
        # Default fields align with 8 columns similar to Squeue
        default_fields = "JobID,Partition,JobName,User,State,Elapsed,NNodes,ExitCode"
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
        responseMessage = ""
        errorMessage = f"{self._slurm_command} did not run!"
        returncode = -1
        rows = []
        columns = self._get_fields().split(',')
        try:
            exec_command = self.get_command(user=user)
            self._serverlog.info("SacctHandler.run_command(): {}".format(exec_command))
            out = await self._run_command(exec_command)

            returncode = out.get("returncode", -1)
            cmd_stdout = out.get("stdout", "").strip() if out.get("stdout") else ""
            cmd_stderr = out.get("stderr", "").strip() if out.get("stderr") else ""

            if returncode != 0:
                responseMessage = "Failure: {} {}".format(exec_command, cmd_stdout)
                errorMessage = cmd_stderr
            else:
                responseMessage = "Success: {}".format(exec_command)
                errorMessage = None

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
            responseMessage = "Failure: {}".format(self._slurm_command)
            errorMessage = "Missing key before running command: {}".format(str(ke))
            returncode = -1
            rows = []
        except Exception as e:
            self._serverlog.exception(e)
            responseMessage = "Failure: {}".format(self._slurm_command)
            errorMessage = "Unhandled Exception: {}".format(str(e))
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
                "responseMessage": responseMessage,
                "errorMessage": None if success else errorMessage,
                "exitCode": returncode,
                "data": data
            }

    @tornado.web.authenticated
    async def get(self):
        self._serverlog.info("SacctHandler.get() {}".format(self._slurm_command))
        try:
            # Optional user filter via query parameter
            user = None
            try:
                user = self.get_argument('user', default=None)
            except Exception:
                user = None
            out = await self.run_command(user=user)
            await self.finish(json.dumps(out))
        except Exception as e:
            self._serverlog.exception("Unhandled Exception: {}".format(e))
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

            payload = {
                "success": True,
                "data": {
                    "queue_column_labels": labels,
                    "queue_column_sizing": sizing,
                    "history_column_labels": history_labels,
                    "details_field_groups": details_field_groups,
                    "details_labels": details_labels,
                    "details_sources": details_sources,
                    "details_hidden": details_hidden,
                    "squeue_reload_limit_ms": reload_limit_ms,
                    "dev_diagnostics": dev_diag,
                }
            }
            await self.finish(json.dumps(payload))
        except Exception as e:
            self._serverlog.exception("Unhandled Exception in UiConfigHandler: {}".format(e))
            await self.finish(json.dumps({
                "success": False,
                "errorMessage": str(e),
                "data": {}
            }))


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
        """Expand Slurm placeholders and verify file exists. Return None if not found."""
        if not path:
            return None
        expanded = self.expand_slurm_path(path, jid, jname, user)
        if not expanded:
            return None
        # If path is relative, join with workdir
        if not expanded.startswith('/') and not expanded.startswith('~'):
            if workdir:
                expanded = os.path.join(workdir, expanded)
        # Expand ~ to home directory
        expanded = os.path.expanduser(expanded)
        # Check if file exists
        if os.path.isfile(expanded):
            return expanded
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
        try:
            ui_cfg = self.settings.get('SlurmUI')
            if not ui_cfg:
                return False
            # If this dict came from validated admin file loader, it may carry a marker
            # Fallback: consider any dict present as admin for now.
            return True
        except Exception:
            return False

    def _load_site_hooks(self):
        if self._hooks_loaded:
            return
        self._hooks_loaded = True
        ui_cfg = self.settings.get('SlurmUI') or {}
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
            # allow-list check unless dev_mode
            if allowlist and not dev_mode:
                if not any(mod == p or mod.startswith(p + '.') for p in allowlist):
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
            out_b, err_b = await proc.communicate()
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
                await self.finish(json.dumps({
                    "success": False,
                    "exitCode": 1,
                    "errorMessage": "Missing job_id",
                    "data": {}
                }))
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
                # Each pair is delimited by ' Key=' boundaries or end-of-line.
                kv = {}
                for line in text.splitlines():
                    stripped = line.strip()
                    if not stripped:
                        continue
                    for m in re.finditer(r'(\w+)=(.*?)(?=\s+\w+=|$)', stripped):
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

                # Parse GPUs from GRES
                gpus = None
                gres = kv.get('Gres')
                if gres:
                    # Gres examples: gpu:4, gpu:kepler:2, gpu:1(S:0)
                    for part in gres.split(','):
                        if part.startswith('gpu'):
                            m = re.search(r'gpu:.*?(\d+)', part)
                            if m:
                                gpus = m.group(1)
                                break
                            m = re.search(r'gpu:(\d+)', part)
                            if m:
                                gpus = m.group(1)
                                break
                
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
                                 "Start","End","Elapsed","QOS","NodeList","NNodes","NTasks","ReqMem","MaxRSS",
                                 "TotalCPU","UserCPU","SystemCPU","AveDiskRead","AveDiskWrite",
                                 "WorkDir","StdOut","StdErr","SubmitLine"
                             ],
                             "time_window_days": 30}
                # Use shlex.split to handle paths with spaces (e.g., "python /path/to/sacct")
                argv = shlex.split(self._sacct) + self._build_sacct_argv(alloc, job_id)
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

                    fields.update({
                        "JobName": jname,
                        "User": juser,
                        "Partition": get_field('Partition'),
                        "Account": get_field('Account'),
                        "CPUs": get_field('CPUs') or get_field('AllocCPUS'),
                        "State": get_field('State'),
                        "ExitCode": get_field('ExitCode'),
                        "StartTime": get_field('Start'),
                        "EndTime": get_field('End'),
                        "Elapsed": get_field('Elapsed'),
                        "QOS": get_field('QOS'),
                        "NodeList": get_field('NodeList'),
                        "Nodes": get_field('NNodes'),
                        "Tasks": get_field('NTasks'),
                        "ReqMem": get_field('ReqMem'),
                        "MaxRSS": get_field('MaxRSS'),
                        "TotalCPU": get_field('TotalCPU'),
                        "UserCPU": get_field('UserCPU'),
                        "SystemCPU": get_field('SystemCPU'),
                        "AveDiskRead": get_field('AveDiskRead'),
                        "AveDiskWrite": get_field('AveDiskWrite'),
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
                    await self.finish(json.dumps({
                        "success": False,
                        "exitCode": rc if rc is not None else 1,
                        "errorMessage": err.strip() or "Job not found",
                        "data": {}
                    }))
                    return

            # post_process hook (as final normalization opportunity)
            self._load_site_hooks()
            if self._hooks.get('post_process'):
                try:
                    fields = await self._hooks['post_process'](source, 0, '', '', fields, context) or fields
                except Exception as e:
                    self._serverlog.warning(f"post_process hook failed: {e}")

            payload = {
                "success": True,
                "exitCode": 0,
                "data": {
                    "source": source,
                    "fields": fields,
                    # Optional: present only when sacct returned multiple rows (steps)
                    **({"steps": steps} if source == 'sacct' and 'steps' in locals() and steps else {})
                }
            }
            await self.finish(json.dumps(payload))
        except Exception as e:
            self._serverlog.exception("Unhandled Exception in JobDetailsHandler: {}".format(e))
            await self.finish(json.dumps({
                "success": False,
                "exitCode": 1,
                "errorMessage": str(e),
                "data": {}
            }))


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

    base_url = web_app.settings['base_url']

    handlers = [
        (url_path_join(base_url, "jupyterlab_slurm", "get_example"), ExampleHandler, dict(log=log)),
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

    if log:
        log.debug("Slurm command paths: \nsqueue: {}\nscancel: {}\nscontrol: {}\nsbatch: {}\nsacct: {}\n".format(
            squeue_path, scancel_path, scontrol_path, sbatch_path, sacct_path
            ))

        log.info("Starting up handlers....\n")
        for h in handlers:
            log.debug("Handler: {}\tURI: {}\tdict: {}\n".format(
                h[1].__name__, h[0], h[2]))

    web_app.add_handlers(host_pattern, handlers)
