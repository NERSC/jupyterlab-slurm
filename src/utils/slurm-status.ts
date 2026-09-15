export const JOB_STATUS_CODES: Record<string, Record<string, string>> = {
  BF: {
    name: 'BOOT_FAIL',
    description:
      'Job terminated due to launch failure, typically due to a hardware failure (e.g. unable to boot the node or block and the job can not be requeued).'
  },
  CA: {
    name: 'CANCELLED',
    description:
      'Job was explicitly cancelled by the user or system administrator. The job may or may not have been initiated.'
  },
  CD: {
    name: 'COMPLETED',
    description:
      'Job has terminated all processes on all nodes with an exit code of zero.'
  },
  CF: {
    name: 'CONFIGURING',
    description:
      'Job has been allocated resources, but are waiting for them to become ready for use (e.g. booting).'
  },
  CG: {
    name: 'COMPLETING',
    description:
      'Job is in the process of completing. Some processes on some nodes may still be active.'
  },
  DL: { name: 'DEADLINE', description: 'Job terminated on deadline.' },
  F: {
    name: 'FAILED',
    description:
      'Job terminated with non-zero exit code or other failure condition.'
  },
  NF: {
    name: 'NODE_FAIL',
    description: 'Job terminated due to failure of one or more allocated nodes.'
  },
  OOM: {
    name: 'OUT_OF_MEMORY',
    description: 'Job experienced out of memory error.'
  },
  PD: { name: 'PENDING', description: 'Job is awaiting resource allocation.' },
  PR: { name: 'PREEMPTED', description: 'Job terminated due to preemption.' },
  R: { name: 'RUNNING', description: 'Job currently has an allocation.' },
  RD: {
    name: 'RESV_DEL_HOLD',
    description: 'Job is being held after requested reservation was deleted.'
  },
  RF: {
    name: 'REQUEUE_FED',
    description: 'Job is being requeued by a federation.'
  },
  RH: { name: 'REQUEUE_HOLD', description: 'Held job is being requeued.' },
  RQ: { name: 'REQUEUED', description: 'Completing job is being requeued.' },
  RS: { name: 'RESIZING', description: 'Job is about to change size.' },
  RV: {
    name: 'REVOKED',
    description:
      'Sibling was removed from cluster due to other cluster starting the job.'
  },
  SI: { name: 'SIGNALING', description: 'Job is being signaled.' },
  SE: {
    name: 'SPECIAL_EXIT',
    description:
      'The job was requeued in a special state. This state can be set by users, typically in EpilogSlurmctld, if the job has terminated with a particular exit value.'
  },
  SO: { name: 'STAGE_OUT', description: 'Job is staging out files.' },
  ST: {
    name: 'STOPPED',
    description:
      'Job has an allocation, but execution has been stopped with SIGSTOP signal. CPUS have been retained by this job.'
  },
  S: {
    name: 'SUSPENDED',
    description:
      'Job has an allocation, but execution has been suspended and CPUs have been released for other jobs.'
  },
  TO: {
    name: 'TIMEOUT',
    description: 'Job terminated upon reaching its time limit.'
  }
};
