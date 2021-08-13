import asyncio
import html
import json
import logging
import os
import re
import shlex
import tempfile

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
import tornado
import tornado.web

logger = logging.Logger(__file__)

jobIDMatcher = re.compile("^[0-9]+$")


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
    def initialize(self, command: str = None, log=logger):
        super().initialize()
        self._slurm_command = command
        self._serverlog = log
        self._serverlog.info("SlurmCommandHandler.initialize(): {} {}".format(self._slurm_command, self._serverlog))

    def get_jobid(self):
        if self.request.headers['Content-Type'] == 'application/json':
            body = json.loads(self.request.body)
            if "jobID" not in body:
                raise MissingSlurmJobID("")
            jobID = body["jobID"]
        else:
            jobID = self.get_body_arguments('jobID')[0]

        if not jobIDMatcher.search(jobID):
            raise InvalidSlurmJobID(jobID, "jobID {} is invalid".format(jobID))

        return jobID

    async def _run_command(self, command: str = None, stdin=None, cwd=None):
        self._serverlog.info('SlurmCommandHandler._run_command(): {} {} {}'.format(command, stdin, cwd))
        commands = shlex.split(command)
        self._serverlog.info('SlurmCommandHandler._run_command(): {}'.format(commands))
        process = await asyncio.create_subprocess_exec(*commands,
                                                       stdout=asyncio.subprocess.PIPE,
                                                       stderr=asyncio.subprocess.PIPE,
                                                       stdin=stdin,
                                                       cwd=cwd)
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=60.0)
        # decode stdout and from bytes to str, and return stdout, stderr, and returncode
        return {
            "stdout": stdout.decode().strip(),
            "stderr": stderr.decode().strip(),
            "returncode": process.returncode
            }

    async def run_command(self, args: list = None):
        responseMessage = ""
        errorMessage = "{} did not run!".format(self._slurm_command)
        returncode = -1
        try:
            jobID = self.get_jobid()

            if args is None:
                args = []

            out = await self._run_command("{} {} {}".format(self._slurm_command, " ".join(args), jobID))

            returncode = out["returncode"]
            cmd_stdout = ""
            if "stdout" in out and len(out["stdout"].strip()) > 0:
                cmd_stdout = out["stdout"]

            cmd_stderr = ""
            if "stderr" in out and len(out["stderr"].strip()) > 0:
                cmd_stderr = out["stderr"]

            if returncode != 0:
                responseMessage = "Failure: {} {} {}".format(self._slurm_command, jobID, cmd_stdout)
                errorMessage = cmd_stderr
            else:
                responseMessage = "Success: {} {}".format(self._slurm_command, jobID)
                errorMessage = ""
        except KeyError as ke:
            self._serverlog.exception(ke)
            try:
                jobID is not None
            except NameError:
                jobID = "No jobID parsed"

            responseMessage = "Failure: {} {}".format(self._slurm_command, jobID)
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
                jobID is not None
            except NameError:
                jobID = "No jobID parsed"

            responseMessage = "Failure: {} {}".format(self._slurm_command, jobID)
            errorMessage = "Unhandled Exception: {}".format(str(e))
            returncode = -1
        finally:
            return {
                "responseMessage": responseMessage,
                "returncode": returncode,
                "errorMessage": errorMessage
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
        results = {
            "responseMessage": "{} has not run yet!".format(self._slurm_command),
            "errorMessage": "",
            "returncode": -1
            }
        try:
            results = await self.run_command()
        except Exception as e:
            results = {
                "responseMessage": "Failure {}".format(self._slurm_command),
                "errorMessage": str(e),
                "returncode": -1
                }
        finally:
            await self.finish(json.dumps(results))


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
        results = {
            "responseMessage": "{} has not run yet!".format(self._slurm_command),
            "errorMessage": "",
            "returncode": -1
            }
        try:
            results = await self.run_command([action])
        except Exception as e:
            results = {
                "responseMessage": "Failure {} {}".format(self._slurm_command, action),
                "errorMessage": str(e),
                "returncode": -1
                }
        finally:
            await self.finish(json.dumps(results))


# sbatch clearly isn't idempotent, and resource ID (i.e. job ID) isn't known when running it, so only POST works for
# the C in CRUD here, not PUT
class SbatchHandler(SlurmCommandHandler):
    def initialize(self, sbatch: str = "sbatch", temporary_directory: str = None, log=logger):
        super().initialize(sbatch, log)
        self.temp_dir = temporary_directory
        self._serverlog.debug("SbatchHandler.initialize()")

    def get_batch_script(self):
        script_data = None
        try:
            if self.request.headers['Content-Type'] == 'application/json':
                body = json.loads(self.request.body)
                if "input" in body:
                    script_data = json.loads(self.request.body)["input"]
                else:
                    raise MissingBatchScript("'input' argument was not found for a batch script!")
            else:
                script_data = self.get_body_argument('input')
        finally:
            return script_data

    async def run_command(self, script_data: str = None, inputType: str = None, outputDir: str = None):
        responseMessage = ""
        errorMessage = "{} has not run yet!".format(self._slurm_command)
        returncode = -1
        try:
            if inputType == 'path':
                try:
                    self._serverlog.info("SbatchHandler.post() - sbatch call - {} {} {}".format(
                        self._slurm_command, script_data, outputDir))
                    out = await self._run_command("{} {}".format(
                        self._slurm_command, script_data), cwd=outputDir)
                    out["errorMessage"] = ""
                except Exception as e:
                    out = {
                        "stdout": "",
                        "stderr": "Attempted to run: " +
                                  "command - {}, path - {}, dir - {}. Check console for more details.".format(
                                      self._slurm_command,
                                      script_data,
                                      outputDir
                                      ),
                        "returncode": 1,
                        "errorMessage": str(e)
                        }
                    self._serverlog.error("Error running sbatch: {}".format(out["stderr"]))
                    self._serverlog.exception(e)
            elif inputType == 'contents':
                self._serverlog.info("Writing script data to temp file for sbatch: {}".format(script_data))
                with tempfile.TemporaryFile(mode='w+b', dir=self.temp_dir) as temp:
                    buffer = str.encode(script_data)
                    temp.write(buffer)
                    temp.flush()
                    temp.seek(0)
                    try:
                        self._serverlog.info("sbatch call - {} {} {}".format(
                            self._slurm_command, buffer, outputDir))
                        out = await self._run_command(self._slurm_command, stdin=temp.fileno(), cwd=outputDir)
                        out["errorMessage"] = ""
                    except Exception as e:
                        out = {
                            "stdout": "",
                            "stderr": "Attempted to run: " +
                                      "command - {}, script - {}, dir - {}. Check console for more details.".format(
                                          self._slurm_command,
                                          script_data,
                                          outputDir
                                          ),
                            "returncode": 1,
                            "errorMessage": str(e)
                            }
                        self._serverlog.error("Error running sbatch: {}".format(out["stderr"]))
                        self._serverlog.exception(e)
            else:
                raise Exception(
                    'The query argument inputType needs to be either \'path\' or \'contents\', received {}.'.format(
                        inputType))

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
            return {
                "responseMessage": responseMessage,
                "returncode": returncode,
                "errorMessage": errorMessage
                }

    # Add `-H "Authorization: token <token>"` to the curl command for any POST request
    @tornado.web.authenticated
    async def post(self):
        self._serverlog.debug('SbatchHandler.post()')

        inputType = self.get_query_argument('inputType')
        outputDir = self.get_query_argument('outputDir', default='')

        self._serverlog.info('SbatchHandler.post() - sbatch request: {} {}, inputType: {}, outputDir: {}'.format(
            self.request, self.request.body, inputType, outputDir))

        responseMessage = "{} has not run yet!".format(self._slurm_command)
        errorMessage = ""
        returncode = -1
        try:
            out = {}
            # Have two options to specify SLURM script in the request body: either with a path to the script, or with the
            # script's text contents

            script_data = self.get_batch_script()

            if inputType:
                out = await self.run_command(script_data, inputType, outputDir)
            else:
                raise tornado.web.MissingArgumentError('inputType')

            self._serverlog.info("out: {}".format(out))

            responseMessage = out["responseMessage"]
            errorMessage = out["errorMessage"]
            returncode = out["returncode"]
        except Exception as e:
            self._serverlog.exception(e)
            responseMessage = "Failure: {}".format(self._slurm_command)
            errorMessage = "Unhandled Exception: {}".format(str(e))
            returncode = -1
        finally:
            await self.finish(json.dumps({
                "responseMessage": responseMessage,
                "errorMessage": errorMessage,
                "returncode": returncode
                }))


# all squeue does is request information from SLURM scheduler, which is idempotent (for the "server-side"),
# so clearly GET request is appropriate here
class SqueueHandler(SlurmCommandHandler):
    def initialize(self, squeue: str = None, log=logger):
        super().initialize(squeue, log)
        self._serverlog.debug("SqueueHandler.initialize()")

        # squeue -h automatically removes the header row -o <format string> ensures that the output is in a
        # format expected by the extension Hard-coding this is not great -- ideally we would allow the user to
        # customize this, or have the default output be the user's output stdout, stderr, _ = await
        # run_command('squeue -o "%.18i %.9P %.8j %.8u %.2t %.10M %.6D %R" -h')
        self.output_formatting = '-o "%.18i %.9P %.8j %.8u %.2t %.10M %.6D %R" -h'

    def get_command(self):
        userOnly = self.get_query_argument('userOnly')

        if userOnly == 'true':
            exec_command = "{} -u {} {}".format(self._slurm_command, os.environ["USER"], self.output_formatting)
        else:
            exec_command = "{} {}".format(self._slurm_command, self.output_formatting)

        return exec_command

    async def run_command(self, args: list = None):
        responseMessage = ""
        errorMessage = "{} did not run!".format(self._slurm_command)
        returncode = -1
        data_list = []
        try:
            exec_command = self.get_command()
            self._serverlog.info("SqueueHandler.run_command(): {}".format(exec_command))
            out = await self._run_command(exec_command)
            # self._serverlog.info("SqueueHandler response: {}".format(out))

            returncode = out["returncode"]
            cmd_stdout = ""
            if "stdout" in out and len(out["stdout"].strip()) > 0:
                cmd_stdout = out["stdout"]

            cmd_stderr = ""
            if "stderr" in out and len(out["stderr"].strip()) > 0:
                cmd_stderr = out["stderr"]

            if returncode != 0:
                responseMessage = "Failure: {} {}".format(exec_command, cmd_stdout)
                errorMessage = cmd_stderr
            else:
                responseMessage = "Success: {}".format(exec_command)
                errorMessage = ""

            data = out["stdout"].splitlines()
            # self._serverlog.info("SqueueHandler stdout: {}".format(data))

            for row in data:
                # maxsplit=7 so we can still display squeue entries with final columns with spaces like the
                # following: (burst_buffer/cray: dws_data_in: DataWarp REST API error: offline namespaces: [34831] -
                # ask a system administrator to consult the dwmd log for more information
                if len(row.split(maxsplit=7)) == 8:
                    # html.escape because some job ID's might have '<'s and similar characters in them.
                    # Also, hypothetically we could be Bobbytable'd without html.escape here,
                    # e.g. if someone had as a jobname '<script>virus.js</script>'.
                    data_list += [[(html.escape(entry)).strip()
                                   for entry in row.split(maxsplit=7)]]
                else:
                    continue
        except KeyError as ke:
            self._serverlog.exception(ke)
            responseMessage = "Failure: {}".format(self._slurm_command)
            errorMessage = "Missing key before running command: {}".format(str(ke))
            returncode = -1
            data_list = []
        except Exception as e:
            self._serverlog.exception(e)
            responseMessage = "Failure: {}".format(self._slurm_command)
            errorMessage = "Unhandled Exception: {}".format(str(e))
            returncode = -1
            data_list = []
        finally:
            return {
                "data": data_list[:],
                "squeue": {
                    "responseMessage": responseMessage,
                    "returncode": returncode,
                    "errorMessage": errorMessage
                    }
                }

    # we want to limit the rate at which this is called for a user
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
            # self._serverlog.info("SqueueHandler response: {}".format(out))
            data = out["data"]
            # self._serverlog.info("SqueueHandler stdout: {}".format(data))

            data_dict = {
                "data": data,
                "squeue": out
                }
        except Exception as e:
            self._serverlog.exception("Unhandled Exception: {}".format(e))
            data_dict = {"data": [], "squeue": out}
        finally:
            # finish(chunk) writes chunk to the output
            # buffer and ends the HTTP request
            await self.finish(json.dumps(data_dict))


def setup_handlers(web_app, temporary_directory=None, log=None):
    if log:
        log.info(web_app.settings)

    host_pattern = ".*$"

    spath = os.path.normpath(
        web_app.settings['spath']) + "/" if 'spath' in web_app.settings else ''

    def obtain_path(method):
        return web_app.settings[method + '_path'] if method + '_path' in web_app.settings else spath + method

    squeue_path = obtain_path("squeue")
    scancel_path = obtain_path("scancel")
    scontrol_path = obtain_path("scontrol")
    sbatch_path = obtain_path("sbatch")

    base_url = web_app.settings['base_url']

    handlers = [
        (url_path_join(base_url, "jupyterlab_slurm", "get_example"), ExampleHandler, dict(log=log)),
        (url_path_join(base_url, "jupyterlab_slurm", "user"), UserFetchHandler, dict(log=log)),
        (url_path_join(base_url, 'jupyterlab_slurm', 'squeue'), SqueueHandler, dict(squeue=squeue_path, log=log)),
        (url_path_join(base_url, 'jupyterlab_slurm', 'scancel'), ScancelHandler, dict(scancel=scancel_path, log=log)),
        (url_path_join(base_url, 'jupyterlab_slurm', 'scontrol', '(?P<action>.*)'), ScontrolHandler,
         dict(scontrol=scontrol_path, log=log)),
        (url_path_join(base_url, 'jupyterlab_slurm', 'sbatch'), SbatchHandler,
         dict(sbatch=sbatch_path, temporary_directory=temporary_directory, log=log))
        ]

    if log:
        log.info("Slurm command paths: \nsqueue: {}\nscancel: {}\nscontrol: {}\nsbatch: {}\n".format(
            squeue_path, scancel_path, scontrol_path, sbatch_path
            ))

        log.info("Starting up handlers....\n")
        for h in handlers:
            log.info("Handler: {}\tURI: {}\tdict: {}\n".format(
                h[1].__name__, h[0], h[2]))

    web_app.add_handlers(host_pattern, handlers)
