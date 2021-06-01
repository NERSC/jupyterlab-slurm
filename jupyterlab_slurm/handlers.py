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

logger = logging.Logger(__file__)

jobIDMatcher = re.compile("^[0-9]+$")

class InvalidJobID(Exception):
    def __init__(self, jobid, message):
        self.jobid = jobid
        self.message = message

class InvalidCommand(Exception):
    def __init__(self, command, message):
        self.command = command
        self.message = message


async def run_command(command, stdin=None, cwd=None):
    commands = shlex.split(command)
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


class ExampleHandler(APIHandler):
    def initialize(self, log=logger):
        self._serverlog = log
        self._serverlog.info("ExampleHandler.initialize()")

    @tornado.web.authenticated
    def get(self):
        try:
            self._serverlog.info("get_example")
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
        self._serverlog = logger
        self._serverlog.info("UserFetchHandler.initialize()")

    @tornado.web.authenticated
    def get(self):
        try:
            username = os.environ.get('USER')
            self._serverlog.info(username)
            self.finish(json.dumps({
                "user": username
                }))
        except Exception as e:
            self._serverlog.exception(e)
            self.finish(json.dumps(e))


# Conventions: Query arguments: always settings for how to use or options provided by a SLURM command. Body
# arguments: always job designators, e.g. job ID, paths to SLURM scripts, input streams of SLURM script contents,
# etc. Path arguments: always commands (including commands sent to `scontrol`, e.g. `scontrol hold`/`scontrol resume`)

# Unsurprisingly, the job ID's are always (for scancel and scontrol) the body argument named 'jobID'

# Since this is idempotent, hypothetically one could also use PUT instead of DELETE here.
class ScancelHandler(APIHandler):
    def initialize(self, scancel: str = None, log=logger):
        self._serverlog = log
        self.scancel = scancel
        self._serverlog.info("ScancelHandler.initialize()")

    # Add `-H "Authorization: token <token>"` to the curl command for any DELETE request
    @tornado.web.authenticated
    async def delete(self):
        self._serverlog.info('ScancelHandler.delete() - request: {}, command: {}'.format(self.request, self.scancel))

        responseMessage = ""
        errorMessage = "Command did not run!"
        returncode = -1
        try:
            if self.request.headers['Content-Type'] == 'application/json':
                jobID = json.loads(self.request.body)["jobID"]
            else:
                jobID = self.get_body_arguments('jobID')[0]

            if not jobIDMatcher.search(jobID):
                raise InvalidJobID(jobID, "jobID {} is invalid".format(jobID))

            out = await run_command(self.scancel + " " + jobID)

            self._serverlog.info("ScancelHandler.delete() command output: {}".format(out))

            returncode = out["returncode"]
            if "stderr" in out:
                responseMessage = ""
                errorMessage = out["stderr"]
            else:
                # stdout will be empty on success -- hence the custom success message
                responseMessage = "Success: scancel {}".format(jobID)
                errorMessage = ""
        except KeyError as ke:
            self._serverlog.exception(ke)
            responseMessage = ""
            errorMessage = "Missing key before running command: {}".format(str(ke))
            returncode = -1
        except InvalidJobID as eij:
            self._serverlog.exception(eij)
            responseMessage = ""
            errorMessage = eij.message
            returncode = -1
        except Exception as e:
            self._serverlog.exception(e)
            responseMessage = ""
            errorMessage = "Unhandled Exception: {}".format(str(e))
            returncode = -1
        finally:
            self.finish(json.dumps({
                "responseMessage": responseMessage,
                "returncode": returncode,
                "errorMessage": errorMessage
            }))


# scontrol isn't idempotent, so PUT isn't appropriate, and in general scontrol only modifies a subset of properties,
# so POST also is not ideal
class ScontrolHandler(APIHandler):
    def initialize(self, scontrol: str = None, log=logger):
        self._serverlog = log
        self.scontrol = scontrol
        self._serverlog.info("ScontrolHandler.initialize()")

    # Add `-H "Authorization: token <token>"` to the curl command for any PATCH request
    @tornado.web.authenticated
    async def patch(self, command):
        try:
            if self.request.headers['Content-Type'] == 'application/json':
                jobID = json.loads(self.request.body)["jobID"]
            else:
                jobID = self.get_body_arguments('jobID')[0]

            if not jobIDMatcher.search(jobID):
                raise InvalidJobID(jobID, "jobID {} is invalid".format(jobID))
            if command not in {'hold', 'release'}:
                raise InvalidCommand(command, "Invalid command: {}".format(command))

            out = await run_command("{} {} {}".format(self.scontrol, command, jobID))
            if "returncode" in out and out["returncode"] != 0:
                if "stderr" in out:
                    out["responseMessage"] = out["stderr"]
                    out["errorMessage"] = out["stderr"]
                else:
                    out["responseMessage"] = ""
                    out["errorMessage"] = "No stderr found"
            else:
                # stdout will be empty on success -- hence the custom success message
                out["responseMessage"] = "Success: scontrol " + command + " " + jobID
                out["errorMessage"] = ""
        except InvalidJobID as eij:
            self._serverlog.exception(eij)
            out = {
                "responseMessage": "",
                "errorMessage": eij.message,
                "returncode": -1
                }
        except InvalidCommand as eic:
            self._serverlog.exception(eic)
            out = {
                "responseMessage": "",
                "errorMessage": eic.message,
                "returncode": -1
                }
        except Exception as e:
            self._serverlog.exception("Unhandled Exception: {}".format(e))
            out = {
                "responseMessage": "",
                "errorMessage": "Unhandled Exception: {}".format(str(e)),
                "returncode": -1
                }
        finally:
            self.finish(json.dumps(out))


# sbatch clearly isn't idempotent, and resource ID (i.e. job ID) isn't known when running it, so only POST works for
# the C in CRUD here, not PUT
class SbatchHandler(APIHandler):
    def initialize(self, sbatch: str = None, temporary_directory: str = None, log=logger):
        self._serverlog = log
        self.sbatch = sbatch if sbatch is not None else "sbatch"
        self.temp_dir = temporary_directory
        self._serverlog.info("SbatchHandler.initialize()")

    # Add `-H "Authorization: token <token>"` to the curl command for any POST request
    @tornado.web.authenticated
    async def post(self):
        inputType = self.get_query_argument('inputType')
        outputDir = self.get_query_argument('outputDir', default='')
        sbatch_command = self.sbatch + ' '

        self._serverlog.info('SbatchHandler.post() - sbatch request: {} {}, inputType: {}, outputDir: {}'.format(
            self.request, self.request.body, inputType, outputDir))

        script_data = None
        if self.request.headers['Content-Type'] == 'application/json':
            script_data = json.loads(self.request.body)["input"]
        else:
            script_data = self.get_body_argument('input')

        out = {}
        # Have two options to specify SLURM script in the request body: either with a path to the script, or with the
        # script's text contents
        if inputType:
            if inputType == 'path':
                try:
                    self._serverlog.info("SbatchHandler.post() - sbatch call - {} {} {}".format(
                        sbatch_command, script_data, outputDir))
                    out = await run_command(sbatch_command + script_data, cwd=outputDir)
                    out["errorMessage"] = ""
                except Exception as e:
                    out = {
                        "stdout": "",
                        "stderr": "Attempted to run: " + \
                             "command - {}, path - {}, dir - {}. Check console for more details.".format(
                         sbatch_command,
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
                    temp.write(str.encode(script_data))
                    temp.flush()
                    temp.seek(0)
                    try:
                        self._serverlog.info("sbatch call - {} {} {}".format(
                            sbatch_command, "<stdin from tempfile>", outputDir))
                        out = await run_command(sbatch_command, stdin=temp.fileno(), cwd=outputDir)
                        out["errorMessage"] = ""
                    except Exception as e:
                        out = {
                        "stdout": "",
                        "stderr": "Attempted to run: " + \
                                 "command - {}, script - {}, dir - {}. Check console for more details.".format(
                            sbatch_command,
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
        else:
            raise tornado.web.MissingArgumentError('inputType')

        self._serverlog.info("out: {}".format(out))

        responseMessage = ""
        if "returncode" in out:
            if out["returncode"] == 0:
                responseMessage = "Success: " + out["stdout"]
            else:
                responseMessage = "Failure: " + out["stderr"]
        else:
            responseMessage = "Missing returncode from out: {}".format(out)
            self._serverlog.info(responseMessage)
            out["returncode"] = 1

        # jobID = re.compile('([0-9]+)$').search(stdout).group(1)
        self.finish(json.dumps({
            "responseMessage": responseMessage,
            "returncode": out["returncode"],
            "errorMessage": out["errorMessage"]
            }))


# all squeue does is request information from SLURM scheduler, which is idempotent (for the "server-side"),
# so clearly GET request is appropriate here
class SqueueHandler(APIHandler):
    def initialize(self, squeue: str = None, log=logger):
        self._serverlog = log
        self.squeue = squeue

    @tornado.web.authenticated
    async def get(self):
        self._serverlog.info("SqueueHandler.get() {}".format(self.squeue))

        out = {
            "returncode": -1,
            "stderr": "Command did not run!",
            "stdout": ""
            }
        data_dict = {"data": []}
        try:
            # what to keep in the mind if we want to add a view user's jobs only button -- it would just add the -u
            # flag to the command
            userOnly = self.get_query_argument('userOnly')
            if userOnly == 'true':
                self._serverlog.info(self.squeue + ' -u ' + os.environ["USER"] + ' -o "%.18i %.9P %.8j %.8u %.2t %.10M %.6D %R" -h')
                out = await run_command(
                    self.squeue + ' -u ' + os.environ["USER"] + ' -o "%.18i %.9P %.8j %.8u %.2t %.10M %.6D %R" -h')
            else:
                self._serverlog.info(self.squeue + ' -o "%.18i %.9P %.8j %.8u %.2t %.10M %.6D %R" -h')
                out = await run_command(self.squeue + ' -o "%.18i %.9P %.8j %.8u %.2t %.10M %.6D %R" -h')
            # squeue -h automatically removes the header row -o <format string> ensures that the output is in a
            # format expected by the extension Hard-coding this is not great -- ideally we would allow the user to
            # customize this, or have the default output be the user's output stdout, stderr, _ = await
            # run_command('squeue -o "%.18i %.9P %.8j %.8u %.2t %.10M %.6D %R" -h')

            self._serverlog.info("SqueueHandler response: {}".format(out))

            if out["returncode"] != 0:
                self._serverlog.warning("Non-zero return code from squeue: {}".format(out["returncode"]))
                self.send_error(500, out)
            elif len(out["stderr"]) > 0:
                self._serverlog.warning("stderr from squeue: {}".format(out["stderr"]))

            data = out["stdout"].splitlines()
            self._serverlog.info("SqueueHandler stdout: {}".format(data))

            data_dict = {}
            data_list = []
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
            data_dict['data'] = data_list[:]
        except Exception as e:
            self._serverlog.exception("Unhandled Exception: {}".format(e))
            data_dict = {"data": [], "squeue": out}
        finally:
            # finish(chunk) writes chunk to the output
            # buffer and ends the HTTP request
            self.finish(json.dumps(data_dict))


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
        (url_path_join(base_url, 'jupyterlab_slurm', 'scontrol', '(?P<command>.*)'), ScontrolHandler,
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
