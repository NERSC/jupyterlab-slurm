import { SlurmWidget } from "./slurmWidget";
import * as $ from 'jquery';

export function reload(slurmWidget: SlurmWidget)  {return  {
            text: 'Reload',
            name: 'Reload',
            action: (e, dt, node, config) => {
              dt.ajax.reload(null, false);
            }
          };  }

export function kill(slurmWidget: SlurmWidget) { return {
    extend: 'selected',
    text: 'Kill Job(s)',
    action: (e, dt, node, config) => {
      slurmWidget.runOnSelectedRows('/scancel', 'DELETE', dt);
    }
  }; }

export function hold(slurmWidget: SlurmWidget) { return {
    extend: 'selected',
    text: 'Hold Job(s)',
    action: (e, dt, node, config) => {
      slurmWidget.runOnSelectedRows('/scontrol/hold', 'PATCH', dt);
    }
  };
}

export function release(slurmWidget: SlurmWidget) {return           {
    extend: 'selected',
    text: 'Release Job(s)',
    action: (e, dt, node, config) => {
      slurmWidget.runOnSelectedRows('/scontrol/release', 'PATCH', dt);
    }
  }; }

function launchSubmitModal() {
    ($('#submitJobModal') as any).modal('show');
    $('.modal-backdrop').detach().appendTo('#jupyterlab-slurm');
}

export var submit =  {
    text: "Submit Job",
    action: (e, dt, node, config) => {
      launchSubmitModal();
    }
  }
