#!/bin/bash
# Scenario 7 -- "I need GPU resources for my job"
#
# Reuses the fake-GRES recipe (gres.conf File= entries on node g1) proven
# earlier this session. Submits 2 concurrent --gres=gpu:1 jobs plus a 3rd
# that should queue on Resources until one frees up.
#
# NOTE: this assumes node g1 with fake GRES (gpu:nvidia, 2 units, each with
# a File=/dev/null-style device mapping in gres.conf) is already configured
# on the cluster, per the "Synthetic GRES Configuration" recipe validated
# earlier this session. This script does not (re)configure GRES itself.
#
# NOTE (post cgroup.conf/slurm.conf changes for scenario 2's OOM enforcement):
# a full `docker compose build --no-cache` + container recreate was required
# for that fix, and that wipes any node registered only at runtime -- g1's
# fake-GPU registration does NOT survive such a rebuild, even though the
# `slurm-fake-gpu-worker` container itself keeps running afterward. If
# `sinfo` doesn't show g1: `docker restart slurm-fake-gpu-worker` alone was
# not sufficient to bring it back in testing after the rebuild -- you'll
# likely need to redo the "Synthetic GRES Configuration" setup (gres.conf/
# slurm.conf on that node) from scratch. This script only checks/warns; it
# does not attempt to fix GPU node registration itself.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

USER="testuser1"
DIR=$(ensure_scenario_dir "${USER}")

echo "Checking for a 'gpu' partition and node g1..."
if ! docker exec "${CTLD_CONTAINER}" sinfo -p gpu -h >/dev/null 2>&1 || \
   ! docker exec "${CTLD_CONTAINER}" sinfo -N -h -o "%N" | grep -qx g1; then
  echo "WARNING: no 'gpu' partition / node g1 found in sinfo."
  echo "If fake GRES was configured previously but the cluster was later" \
       "rebuilt (e.g. for the cgroup.conf memory-enforcement changes)," \
       "g1's registration was wiped and did not come back from a plain" \
       "'docker restart slurm-fake-gpu-worker' -- you'll likely need to" \
       "redo the 'Synthetic GRES Configuration' setup from scratch."
  echo "If GRES was never configured, set it up first: AutoDetect=off," \
       "GresTypes=gpu, Gres=gpu:nvidia:2 with File= entries in gres.conf on" \
       "a node, plus a 'gpu' partition."
fi

write_script_as "${USER}" "${DIR}/s07_gpu.sh" '#!/bin/bash
#SBATCH --job-name=s07_gpu
#SBATCH --partition=gpu
#SBATCH --gres=gpu:1
#SBATCH --mem=4000
#SBATCH --output='"${DIR}"'/s07_gpu_%j.out
#SBATCH --time=00:05:00
echo "Running on node: $SLURMD_NODENAME"
echo "CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES"
sleep 90
'

echo "Submitting 3 concurrent --gres=gpu:1 jobs (expect the 3rd to queue on Resources if only 2 GPUs exist)..."
J1=$(submit_as "${USER}" "${DIR}/s07_gpu.sh" | grep -oE '[0-9]+$')
J2=$(submit_as "${USER}" "${DIR}/s07_gpu.sh" | grep -oE '[0-9]+$')
J3=$(submit_as "${USER}" "${DIR}/s07_gpu.sh" | grep -oE '[0-9]+$')

echo "Jobs: ${J1}, ${J2}, ${J3}"
sleep 5
docker exec "${CTLD_CONTAINER}" squeue -j "${J1},${J2},${J3}" || true

print_checkpoint "Check the Queue/Job Details for ${J1}/${J2}/${J3}: two should be RUNNING with distinct CUDA_VISIBLE_DEVICES, one should be PD with reason Resources. Confirm GPU GRES info is visible in Job Details for both running and (once it starts) the third job."

echo "Scenario 7 done."
