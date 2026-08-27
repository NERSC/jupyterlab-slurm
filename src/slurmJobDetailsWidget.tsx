'use client';

import React from 'react';
import { ReactWidget } from '@jupyterlab/apputils';
import { JupyterFrontEnd } from '@jupyterlab/application';
import JobDetailsPanel from './components/JobDetailsPanel';

export class SlurmJobDetailsWidget extends ReactWidget {
  private app: JupyterFrontEnd;
  private jobIds: string[] = [];
  private index = 0;

  constructor(app: JupyterFrontEnd) {
    super();
    this.app = app;
    this.id = `slurm-job-details-${Private.nextId++}`;
    this.addClass('jp-Slurm-SlurmJobDetailsWidget');
    this.title.label = 'Job Details';
    this.title.closable = true;
  }

  setSnapshot(jobIds: string[], index = 0) {
    this.jobIds = jobIds ?? [];
    this.index = Math.max(
      0,
      Math.min(index, Math.max(0, this.jobIds.length - 1))
    );
    // Update badge: we reuse label text with [N] suffix for now
    const n = this.jobIds.length;
    this.title.label = n >= 1 ? `Job Details [${n}]` : 'Job Details';
    this.update();
  }

  private handleBadge = (n: number) => {
    this.title.label = n >= 1 ? `Job Details [${n}]` : 'Job Details';
  };

  private handleSnapshotChange = (jobIds: string[], index: number) => {
    this.jobIds = jobIds;
    this.index = index;
    this.handleBadge(jobIds.length);
  };

  render(): any {
    return (
      <JobDetailsPanel
        app={this.app}
        jobIds={this.jobIds}
        initialIndex={this.index}
        onSnapshotChange={this.handleSnapshotChange}
        setBadge={this.handleBadge}
      />
    );
  }
}

namespace Private {
  // Mutated via `Private.nextId++` above; eslint's static analysis doesn't
  // see namespace-export mutation, so prefer-const is a false positive here.
  // eslint-disable-next-line prefer-const
  export let nextId = 0;
}
