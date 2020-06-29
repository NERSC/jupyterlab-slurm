import json
import re
import shlex
import asyncio
import html
import json
import os
import re
import tempfile

from notebook.base.handlers import IPythonHandler
from tornado.web import MissingArgumentError, authenticated

jobIDMatcher = re.compile("^[0-9]+$")


class ShellExecutionHandler(IPythonHandler):
    async def run_command(self, command, stdin=None, cwd=None):
        commands = shlex.split(command)
        process = await asyncio.create_subprocess_exec(*commands,
                                                       stdout=asyncio.subprocess.PIPE,
                                                       stderr=asyncio.subprocess.PIPE,
                                                       stdin=stdin,
                                                       cwd=cwd)
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=60.0)
        # decode stdout and from bytes to str, and return stdout, stderr, and returncode
        return (stdout.decode().strip(), stderr.decode().strip(), process.returncode)


# Conventions:
# Query arguments: always settings for how to use or options provided by a SLURM command.
# Body arguments: always job designators, e.g. job ID, paths to SLURM scripts, input streams of SLURM script contents, etc.
# Path arguments: always commands (including commands sent to `scontrol`, e.g. `scontrol hold`/`scontrol resume`)

# Unsurprisingly, the job ID's are always (for scancel and scontrol) the body argument named 'jobID'

# Since this is idempotent, hypothetically one could also use PUT instead of DELETE here.
class ScancelHandler(ShellExecutionHandler):
    def initialize(self, scancel: str = None):
        self.scancel = scancel

    # Add `-H "Authorization: token <token>"` to the curl command for any DELETE request
    @authenticated
    async def delete(self):
        if self.request.headers['Content-Type'] == 'application/json':
            jobID = json.loads(self.request.body)["jobID"]
        else:
            jobID = self.get_body_arguments('jobID')[0]
        if not jobIDMatcher.search(jobID):
            raise Exception("jobID is invalid")
        stdout, stderr, returncode = await self.run_command(self.scancel + " " + jobID)
        if stderr:
            responseMessage = stderr
        else:
            # stdout will be empty on success -- hence the custom success message
            responseMessage = "Success: scancel " + jobID
        self.finish({"responseMessage": responseMessage,
                     "returncode": returncode})


# scontrol isn't idempotent, so PUT isn't appropriate, and in general scontrol only modifies a subset of properties, so POST also is not ideal
class ScontrolHandler(ShellExecutionHandler):
    def initialize(self, scontrol: str = None):
        self.scontrol = scontrol

    # Add `-H "Authorization: token <token>"` to the curl command for any PATCH request
    @authenticated
    async def patch(self, command):
        if self.request.headers['Content-Type'] == 'application/json':
            jobID = json.loads(self.request.body)["jobID"]
        else:
            jobID = self.get_body_arguments('jobID')[0]
        if not jobIDMatcher.search(jobID):
            raise Exception("jobID is invalid")
        if command not in {'hold', 'release'}:
            raise Exception("Invalid command")
        stdout, stderr, returncode = await self.run_command(self.scontrol + " " + command + " " + jobID)
        if stderr:
            responseMessage = stderr
        else:
            # stdout will be empty on success -- hence the custom success message
            responseMessage = "Success: scontrol " + command + " " + jobID
        self.finish({"responseMessage": responseMessage,
                     "returncode": returncode})


# sbatch clearly isn't idempotent, and resource ID (i.e. job ID) isn't known when running it, so only POST works for the C in CRUD here, not PUT
class SbatchHandler(ShellExecutionHandler):
    def initialize(self, sbatch: str = None, temporary_directory: str = None):
        self.sbatch = sbatch if sbatch is not None else "sbatch"
        self.temp_dir = temporary_directory

    # Add `-H "Authorization: token <token>"` to the curl command for any POST request
    @authenticated
    async def post(self):

        inputType = self.get_query_argument('inputType')
        outputDir = self.get_query_argument('outputDir', default='')
        sbatch_command = self.sbatch + ' '

        # Have two options to specify SLURM script in the request body: either with a path to the script, or with the script's text contents
        if inputType:
            if inputType == 'path':
                if self.request.headers['Content-Type'] == 'application/json':
                    script_path = json.loads(self.request.body)["input"]
                else:
                    script_path = self.get_body_argument('input')
                try:
                    stdout, stderr, returncode = await self.run_command(sbatch_command + script_path, cwd=outputDir)
                    errorMessage = ""
                except Exception as e:
                    stdout, stderr, returncode, errorMessage = (
                        "", "Something went wrong. Check console for more details.", 1, str(e))
            elif inputType == 'contents':
                if self.request.headers['Content-Type'] == 'application/json':
                    script_contents = json.loads(self.request.body)["input"]
                else:
                    script_contents = self.get_body_argument('input')
                with tempfile.TemporaryFile(mode='w+b', dir=self.temp_dir) as temp:
                    temp.write(str.encode(script_contents))
                    temp.flush()
                    temp.seek(0)
                    try:
                        stdout, stderr, returncode = await self.run_command(sbatch_command, stdin=temp.fileno(), cwd=outputDir)
                        errorMessage = ""
                    except Exception as e:
                        stdout, stderr, returncode, errorMessage = (
                            "", "Something went wrong. Check console for more details.", 1, str(e))
            else:
                raise Exception(
                    'The query argument inputType needs to be either \'path\' or \'contents\'.')
        else:
            raise MissingArgumentError('inputType')
        if stdout:
            responseMessage = "Success: " + stdout
        else:
            responseMessage = "Failure: " + stderr
    # jobID = re.compile('([0-9]+)$').search(stdout).group(1)
        self.finish({"responseMessage": responseMessage,
                     "returncode": returncode, "errorMessage": errorMessage})

# all squeue does is request information from SLURM scheduler, which is idempotent (for the "server-side"), so clearly GET request is appropriate here


class SqueueHandler(ShellExecutionHandler):
    def initialize(self, squeue: str = None):
        self.squeue = squeue

    @authenticated
    async def get(self):
        # what to keep in the mind if we want to add a view user's jobs only button -- it would just add the -u flag to the command
        userOnly = self.get_query_argument('userOnly')
        if (userOnly == 'true'):
            stdout, stderr, _ = await self.run_command(self.squeue + ' -u ' + os.environ["USER"] + ' -o "%.18i %.9P %.8j %.8u %.2t %.10M %.6D %R" -h')
        else:
            stdout, stderr, _ = await self.run_command(self.squeue + ' -o "%.18i %.9P %.8j %.8u %.2t %.10M %.6D %R" -h')
        # squeue -h automatically removes the header row
        # -o <format string> ensures that the output is in a format expected by the extension
        # Hard-coding this is not great -- ideally we would allow the user to customize this, or have the default output be the user's output
        # stdout, stderr, _ = await self.run_command('squeue -o "%.18i %.9P %.8j %.8u %.2t %.10M %.6D %R" -h')
        data = stdout.splitlines()
        data_dict = {}
        data_list = []
        for row in data:
            # maxsplit=7 so we can still display squeue entries with final columns with spaces like the following:
            # (burst_buffer/cray: dws_data_in: DataWarp REST API error: offline namespaces: [34831] - ask a system administrator to consult the dwmd log for more information
            if len(row.split(maxsplit=7)) == 8:
                # html.escape because some job ID's might have '<'s and similar characters in them.
                # Also, hypothetically we could be Bobbytable'd without html.escape here,
                # e.g. if someone had as a jobname '<script>virus.js</script>'.
                data_list += [[(html.escape(entry)).strip()
                               for entry in row.split(maxsplit=7)]]
            else:
                continue
        data_dict['data'] = data_list[:]
        # finish(chunk) writes chunk to the output
        # buffer and ends the HTTP request
        self.finish(json.dumps(data_dict))

# A simple request handler for retrieving the username


class UserFetchHandler(ShellExecutionHandler):
    @authenticated
    def get(self):
        username = os.environ.get('USER')
        self.finish(username)
