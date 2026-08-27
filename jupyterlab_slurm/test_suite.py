"""Opt-in, administrator-configured backend compatibility harness.

This module is intentionally kept separate from `handlers.py`/`config.py`
so that a production build/deployment can omit it entirely (see
`production_checklist.md` and `docs/contents/api.md` for the rationale and
build instructions). `handlers.py` imports `SlurmTestSuiteHandler` from
here inside a `try/except ImportError`, so if this file is stripped out of
a build, the `/test-suite` route is simply never registered and behaves
exactly like a route that never existed (HTTP 404).
"""
import asyncio
import json
import os
import shlex
import shutil
import tempfile
import time
import uuid

import tornado.web
from jupyter_server.base.handlers import APIHandler
from traitlets import Bool, Integer, List, Unicode
from traitlets.config import Configurable

from ._common import logger, make_envelope, SLURM_COMMAND_TIMEOUT_SECONDS


class SlurmTesting(Configurable):
    """Admin-only configuration for the opt-in cluster compatibility harness."""

    enabled = Bool(
        default_value=False,
        help="Register the server-side Slurm compatibility test API",
    ).tag(config=True)

    allow_mutations = Bool(
        default_value=False,
        help="Allow the harness to submit, hold, release, and cancel test jobs",
    ).tag(config=True)

    submission_args = List(
        Unicode(),
        default_value=[],
        help="Additional administrator-provided sbatch arguments for test jobs",
    ).tag(config=True)

    test_directory = Unicode(
        default_value="",
        help="Administrator-owned directory for temporary harness scripts",
    ).tag(config=True)

    max_runtime_seconds = Integer(
        default_value=900,
        help="Maximum runtime for one compatibility harness run",
    ).tag(config=True)

    def get_config(self):
        """Serialize testing policy for server-side use."""
        return {name: getattr(self, name) for name in self.trait_names(config=True)}


class SlurmTestSuiteHandler(APIHandler):
    """Opt-in, administrator-configured backend compatibility harness.

    The route is only registered when SlurmTesting.enabled is true. Requests
    select no commands or scripts; all scenarios are fixed in this handler.
    """

    _runs = {}
    _tasks = {}

    def initialize(self, squeue="squeue", sacct="sacct", scontrol="scontrol",
                   sbatch="sbatch", scancel="scancel", log=logger):
        super().initialize()
        self._commands = {
            "squeue": squeue,
            "sacct": sacct,
            "scontrol": scontrol,
            "sbatch": sbatch,
            "scancel": scancel,
        }
        self._serverlog = log
        self._policy = self.settings.get("SlurmTesting") or {}

    def _response(self, success, data=None, error=None, status=None):
        if status is not None:
            self.set_status(status)
        return make_envelope(success, data=data, error=error)

    async def _exec(self, command, args=None, timeout=SLURM_COMMAND_TIMEOUT_SECONDS):
        argv = shlex.split(command or "") + list(args or [])
        if not argv:
            return -1, "", "missing configured command"
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            return -1, "", "command timed out"
        except asyncio.CancelledError:
            proc.kill()
            await proc.communicate()
            raise
        return proc.returncode, stdout.decode(errors="replace"), stderr.decode(errors="replace")

    @staticmethod
    def _result(name, success, message="", **extra):
        result = {"name": name, "success": success, "message": message}
        result.update(extra)
        return result

    async def _submit(self, script_path, extra_args=None):
        args = ["--parsable"] + list(self._policy.get("submission_args") or [])
        args += list(extra_args or []) + [script_path]
        rc, out, err = await self._exec(self._commands["sbatch"], args)
        job_id = out.strip().splitlines()[-1].split(";")[0].strip() if out.strip() else None
        return rc, job_id, out.strip(), err.strip()

    async def _wait_for_terminal(self, job_id, deadline):
        terminal = {"COMPLETED", "FAILED", "CANCELLED", "TIMEOUT", "PREEMPTED", "OUT_OF_MEMORY"}
        last = ""
        while time.monotonic() < deadline:
            rc, out, err = await self._exec(
                self._commands["sacct"],
                ["-n", "-P", "-X", "-j", job_id, "-o", "JobID,State,ExitCode"],
                timeout=30,
            )
            if rc == 0 and out.strip():
                row = next((line for line in out.splitlines() if line.strip()), "")
                fields = row.split("|")
                if len(fields) >= 3:
                    last = fields[1].strip().split()[0]
                    if last in terminal:
                        return {"state": last, "exitCode": fields[2].strip()}
            await asyncio.sleep(2)
        return {"state": last or "UNKNOWN", "error": "timed out waiting for terminal state"}

    async def _run_suite(self, run_id):
        run = self._runs[run_id]
        workdir = None
        submitted = []
        deadline = time.monotonic() + max(60, int(self._policy.get("max_runtime_seconds", 900)))
        try:
            configured_dir = (self._policy.get("test_directory") or "").strip()
            if not configured_dir:
                raise RuntimeError("SlurmTesting.test_directory must be configured")
            if not os.path.isdir(configured_dir):
                raise RuntimeError("SlurmTesting.test_directory is not a directory")
            workdir = tempfile.mkdtemp(prefix="jupyterlab-slurm-test-", dir=configured_dir)
            run["status"] = "running"

            for name, command, args in (
                ("squeue", "squeue", ["-h", "-o", "%i|%u|%T"]),
                ("sacct", "sacct", ["-n", "-S", "now-1days", "-o", "JobID,State,ExitCode"]),
                ("scontrol", "scontrol", ["show", "config"]),
            ):
                if time.monotonic() >= deadline:
                    raise asyncio.TimeoutError()
                rc, _out, err = await self._exec(self._commands[command], args, timeout=30)
                run["results"].append(self._result(name, rc == 0, err[-500:]))

            if self._policy.get("allow_mutations", False):
                script = os.path.join(workdir, "completed.sh")
                with open(script, "w", encoding="utf-8") as stream:
                    stream.write("#!/bin/sh\necho jupyterlab-slurm-test\n")
                os.chmod(script, 0o700)
                rc, job_id, out, err = await self._submit(script)
                if rc == 0 and job_id:
                    submitted.append(job_id)
                    observed = await self._wait_for_terminal(job_id, deadline)
                    run["results"].append(self._result(
                        "submit-and-account", observed.get("state") == "COMPLETED",
                        err or observed.get("error", ""), jobId=job_id, observed=observed,
                    ))
                else:
                    run["results"].append(self._result("submit-and-account", False, err or out))
            else:
                run["results"].append(self._result(
                    "submit-and-account", True,
                    "skipped: SlurmTesting.allow_mutations is false", skipped=True,
                ))

            if self._policy.get("allow_mutations", False):
                script = os.path.join(workdir, "lifecycle.sh")
                with open(script, "w", encoding="utf-8") as stream:
                    stream.write("#!/bin/sh\nsleep 120\n")
                os.chmod(script, 0o700)
                rc, job_id, out, err = await self._submit(script, ["--hold"])
                lifecycle_ok = rc == 0 and bool(job_id)
                if lifecycle_ok:
                    submitted.append(job_id)
                    hold_rc, _hold_out, hold_err = await self._exec(
                        self._commands["scontrol"], ["hold", job_id], timeout=30)
                    release_rc, _release_out, release_err = await self._exec(
                        self._commands["scontrol"], ["release", job_id], timeout=30)
                    cancel_rc, _cancel_out, cancel_err = await self._exec(
                        self._commands["scancel"], [job_id], timeout=30)
                    lifecycle_ok = hold_rc == 0 and release_rc == 0 and cancel_rc == 0
                    err = " ".join(x for x in (hold_err, release_err, cancel_err) if x)
                run["results"].append(self._result(
                    "hold-release-cancel", lifecycle_ok, err or out,
                    jobId=job_id,
                ))
        except asyncio.CancelledError:
            run["status"] = "cancelled"
            raise
        except Exception as exc:
            run["status"] = "error"
            run["errorMessage"] = str(exc)
        finally:
            for job_id in submitted:
                try:
                    await self._exec(self._commands["scancel"], [job_id], timeout=30)
                except Exception:
                    pass
            if workdir:
                shutil.rmtree(workdir, ignore_errors=True)
            if run["status"] == "running":
                run["status"] = "completed"
            run["finishedAt"] = time.time()
            self._tasks.pop(run_id, None)

    @tornado.web.authenticated
    async def post(self, run_id=None):
        if not self._policy.get("enabled", False):
            await self.finish(json.dumps(self._response(False, error="Test suite disabled", status=404)))
            return
        active = [run for run in self._runs.values() if run.get("status") in {"queued", "running"}]
        if active:
            await self.finish(json.dumps(self._response(False, error="A test suite is already running", status=409)))
            return
        run_id = uuid.uuid4().hex
        self._runs[run_id] = {
            "runId": run_id,
            "status": "queued",
            "startedAt": time.time(),
            "results": [],
            "errorMessage": None,
        }
        self._tasks[run_id] = asyncio.create_task(self._run_suite(run_id))
        self.set_status(202)
        await self.finish(json.dumps(self._response(True, {"runId": run_id})))

    @tornado.web.authenticated
    async def get(self, run_id=None):
        if not self._policy.get("enabled", False):
            await self.finish(json.dumps(self._response(False, error="Test suite disabled", status=404)))
            return
        run = self._runs.get(run_id)
        if not run:
            await self.finish(json.dumps(self._response(False, error="Run not found", status=404)))
            return
        await self.finish(json.dumps(self._response(True, run)))

    @tornado.web.authenticated
    async def delete(self, run_id=None):
        task = self._tasks.get(run_id)
        if task:
            task.cancel()
        run = self._runs.get(run_id)
        if not run:
            await self.finish(json.dumps(self._response(False, error="Run not found", status=404)))
            return
        await self.finish(json.dumps(self._response(True, {"runId": run_id, "status": "cancel requested"})))


def register_handler(handlers, base_url, url_path_join, squeue_path, sacct_path,
                      scontrol_path, sbatch_path, scancel_path, log, web_app):
    """Append the `/test-suite` route to `handlers` when the harness is enabled.

    Kept as a module-level helper (rather than inline in `handlers.py`) so
    that callers only need this module to be importable, not any of its
    internal symbols beyond this function.
    """
    testing = web_app.settings.get("SlurmTesting") or {}
    if not testing.get("enabled", False):
        return
    handlers.append((
        url_path_join(base_url, 'jupyterlab_slurm', 'test-suite') + r'(?:/(?P<run_id>[^/]+))?',
        SlurmTestSuiteHandler,
        dict(squeue=squeue_path, sacct=sacct_path, scontrol=scontrol_path,
             sbatch=sbatch_path, scancel=scancel_path, log=log),
    ))
