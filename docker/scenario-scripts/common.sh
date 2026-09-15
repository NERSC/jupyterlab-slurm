#!/bin/bash
# Shared helpers sourced by every scenario script in this directory. See
# docker/scenario-scripts/README.md for the full list of scenarios and how
# to run them.
#
# Assumes the Slurm Docker cluster (docker/cluster.sh up) and, for
# multi-user scenarios, the JupyterHub rig (docker/cluster.sh hub-up) are
# already running, with testuser1/testuser2 provisioned via
# docker/jupyterhub/setup_cluster_users.sh.

set -uo pipefail

CTLD_CONTAINER="slurmctld"
JOBDIR_HOST="/data"

# submit_as <user> <sbatch-args...>
# Submits a job as the given Linux user on the controller container (which
# shares /etc/munge, /etc/slurm, and /data with the worker containers), and
# prints the resulting job ID.
submit_as() {
  local user="$1"
  shift
  docker exec -u "${user}" "${CTLD_CONTAINER}" sbatch "$@"
}

# run_as <user> <command...>
# Runs an arbitrary command as the given user on the controller container
# (e.g. scontrol, scancel, mkdir, cat).
run_as() {
  local user="$1"
  shift
  docker exec -u "${user}" "${CTLD_CONTAINER}" "$@"
}

# wait_for_state <jobid> <state-regex> <timeout-seconds>
# Polls `squeue`/`sacct` until the job's state matches <state-regex> (an
# ST/State abbreviation such as R, PD, S, CD, F, TO) or the timeout elapses.
# Prints the final observed state.
wait_for_state() {
  local jobid="$1"
  local want="$2"
  local timeout="${3:-60}"
  local waited=0
  local st=""
  while [ "${waited}" -lt "${timeout}" ]; do
    st=$(docker exec "${CTLD_CONTAINER}" squeue -j "${jobid}" -h -o '%T' 2>/dev/null)
    if [ -z "${st}" ]; then
      # Job may have already left the live queue -- check sacct instead.
      st=$(docker exec "${CTLD_CONTAINER}" sacct -j "${jobid}" -n -o State --noheader 2>/dev/null | head -1 | awk '{print $1}')
    fi
    if [[ "${st}" =~ ${want} ]]; then
      echo "Job ${jobid} reached state: ${st}"
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  echo "Timed out after ${timeout}s waiting for job ${jobid} to match '${want}' (last seen: '${st}')"
  return 1
}

# print_checkpoint <message>
# Prints a clearly-formatted banner and pauses until Enter is pressed, so
# you have time to go check the browser before the script continues.
print_checkpoint() {
  echo ""
  echo "================================================================"
  echo "  CHECKPOINT: $1"
  echo "================================================================"
  read -r -p "Press Enter to continue... "
}

# ensure_scenario_dir <user>
# Ensures a shared scratch directory for scenario job scripts/output exists
# for the given user under /data (the volume shared between the controller
# and worker containers -- testuser1's/testuser2's own home directories are
# NOT shared, per earlier findings this session).
ensure_scenario_dir() {
  local user="$1"
  local dir="${JOBDIR_HOST}/${user}_scenarios"
  # /data itself is owned by root (mode 755), so a non-root user can't
  # mkdir directly under it -- create it as root first, then chown it to
  # the target user so subsequent writes/sbatch calls as that user work.
  if ! docker exec "${CTLD_CONTAINER}" mkdir -p "${dir}"; then
    echo "ERROR: failed to create ${dir} as root inside ${CTLD_CONTAINER}" >&2
    return 1
  fi
  if ! docker exec "${CTLD_CONTAINER}" chown "${user}:${user}" "${dir}"; then
    echo "ERROR: failed to chown ${dir} to ${user}:${user}" >&2
    return 1
  fi
  echo "${dir}"
}

# write_script_as <user> <path> <content>
# Writes a job script to the given absolute path (inside the shared /data
# scratch dir), as the given user, and makes it executable.
write_script_as() {
  local user="$1"
  local path="$2"
  local content="$3"
  docker exec -i -u "${user}" "${CTLD_CONTAINER}" bash -c "cat > '${path}' && chmod +x '${path}'" <<< "${content}"
}
