import { SlurmWidget } from "./slurmWidget";
import * as $ from 'jquery';

export function pathOnClick(slurmWidget: SlurmWidget) { return (
  (event) => {
    event.preventDefault();
    slurmWidget.submitJobPath($("#batchPath").val() as string);
    // Reset form fields
    document.forms["jobSubmitForm"].reset();
    // Hide the modal
    ($('#submitJobModal') as any).modal('hide');
  }
);   
}

export function scriptOnClick(slurmWidget: SlurmWidget) { return (
  (event) => {
    event.preventDefault();
    slurmWidget.submitJobScript($("#batchScript").val().toString() as string);
    // Reset form fields
    document.forms["jobSubmitForm"].reset();
    // Hide the modal
    ($('#submitJobModal') as any).modal('hide');
  }
);
}
