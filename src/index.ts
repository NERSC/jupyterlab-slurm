import { PageConfig } from '@jupyterlab/coreutils';

import {
  JupyterLab, JupyterLabPlugin, ILayoutRestorer
} from '@jupyterlab/application';

import {
  ICommandPalette, InstanceTracker
} from '@jupyterlab/apputils';

import {
  JSONExt 
} from '@phosphor/coreutils';

import {
  Message
} from '@phosphor/messaging';

import {
  Widget
} from '@phosphor/widgets';

import * as $ from 'jquery';
import 'datatables.net';
import 'datatables.net-buttons';
import 'datatables.net-select';
import 'datatables.net-dt/css/jquery.dataTables.css';

import '../style/index.css';

class SlurmWidget extends Widget {
  /**
  * The table element containing Slurm queue data. */ 
  private queue_table: HTMLElement;
  // The column index of job ID
  readonly JOBID_IDX = 0;

  /* Construct a new Slurm widget. */
  constructor() {
    super();
    console.log('constructor called');
    this.id = 'jupyterlab-slurm';
    this.title.label = 'Slurm Queue Manager';
    this.title.closable = true;
    this.addClass('jp-queueWidget');

    this.queue_table = document.createElement('table');
    this.queue_table.setAttribute('id', 'queue');
    this.queue_table.setAttribute('width', '100%');
    this.queue_table.setAttribute('style', 'font:14px');

    // These css class definitions are from the DataTables default styling package
    // See: https://datatables.net/manual/styling/classes#display
    this.queue_table.classList.add('order-column', 'cell-border');
    this.node.appendChild(this.queue_table);

    // Add thead to queue_table, and define column names;
    // this is required for DataTable's AJAX functionality. 
    let tbl_head = document.createElement('thead');
    this.queue_table.appendChild(tbl_head);
    let head_row = tbl_head.insertRow(0);
    let cols = ['JOBID', 'PARTITION', 'NAME', 'USER', 'ST', 'TIME', 'NODES', 'NODELIST(REASON)'];
    for (let i = 0; i < cols.length; i++) {
      let h = document.createElement('th');
      let t = document.createTextNode(cols[i]);
      h.appendChild(t);
      head_row.appendChild(h);
    }

    // reference to this object for use in the jquery func below
    var self = this;

    // Render table using DataTable's API
    $(document).ready(function() {
      $('#queue').DataTable( {
        // in JupyterLabHub, this will automatically become /hub/squeue (I think)
        ajax: '/squeue',
        select: {
          style: 'os',
        },
        deferRender: true,        
        pageLength: 15,
        language: {
          search: 'User',
        },
        columns: [
        { name: 'JOBID', searchable: false },
        { name: 'PARTITION', searchable: false },
        { name: 'NAME', searchable: false },
        { name: 'USER', searchable: true },
        { name: 'ST', searchable: false },
        { name: 'TIME', searchable: false },
        { name: 'NODES', searchable: false },
        { name: 'NODELIST(REASON)', searchable: false },        
        ],
        columnDefs: [
          {
            className: 'dt-center', 
            targets: '_all'
          }
        ],
        // Set rowId to maintain selection after table reload 
        // (use primary key for rowId). 
        rowId: self.JOBID_IDX.toString(),
        autoWidth: true,
        scrollY: '400px',
        scrollX: true,
        scrollCollapse: true,
        // Element layout parameter
        dom: '<"toolbar"Bfr><t><lip>',//'<"top"Bf>lrt<"bottom"pi><"clear">',//'Bfrtip',
        buttons: { buttons: [
          {
            text: 'Reload',
            action: (e, dt, node, config) => {
              dt.ajax.reload(null, false);
            }
          },
          {
            extend: 'selected',
            text: 'Kill Selected Job(s)',
            action: (e, dt, node, config) => {
              self._run_on_selected('/scancel', 'DELETE', dt);
            }
          },
          {
            extend: 'selected',
            text: 'Hold Selected Job(s)',
            action: (e, dt, node, config) => {
              self._run_on_selected('/scontrol/hold', 'PATCH', dt);
            }  
          },
          {
            extend: 'selected',
            text: 'Release Selected Job(s)',
            action: (e, dt, node, config) => {
              self._run_on_selected('/scontrol/release', 'PATCH', dt);
            }  
          },
          {
            extend: 'selectNone'
          },
          {
            text: 'Submit Slurm Script via File Path',
            action:  (e, dt, node, config) => {
              var scriptPath = window.prompt('Enter a Slurm script file path');
              self._submit_batch_script_path(scriptPath, dt)
              alert(scriptPath);
            }
          },
          {
            text: 'Submit Slurm Script via File Contents',
            action: (e, dt, node, config) => {
              //var scriptContents = window.prompt('');
              self._submit_batch_script_contents(dt);
              //alert(scriptContents);
            }
          }
       
        ],
        // https://datatables.net/reference/option/buttons.dom.button
        // make it easier to identify/grab buttons to change their appearance
        dom: {
          button: {
            tag: 'button',
            className: 'button',
          }
        }  }
      });


      });
  }

  private _reload_data_table(dt: DataTables.Api) {
    // reload the data table
    dt.ajax.reload(null, false);
  }

  private _reload_queue_table() {
    this._reload_data_table($('#queue').DataTable());
    console.log('searchable');
  };

  private _set_headers(xhttp: XMLHttpRequest) {
    // add Jupyter authorization (XRSF) token
    xhttp.setRequestHeader('Authorization', 'token ' + PageConfig.getToken());
    // prevent it from enconding as plain-text UTF-8, which is the default and screws everything up
    xhttp.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  }

  private _add_job_completed_alert (xhttp: XMLHttpRequest) { 
    xhttp.onreadystatechange = () => {
      // alert the user of the job's number after submitting
      if (xhttp.readyState === xhttp.DONE) {
        alert("Submitted batch job "+ xhttp.responseText.toString());
      }
    };
  };

  private _submit_request(cmd: string, requestType: string, body: string, addJobAlert: boolean) {
    let xhttp = new XMLHttpRequest();
    if (addJobAlert === true) {
      this._add_job_completed_alert(xhttp); };
    xhttp.open(requestType, cmd, true);
    this._set_headers(xhttp);
    xhttp.send(body);
  }

  private _run_on_selected(cmd: string, requestType: string, dt: DataTables.Api) {
    let selected_data = dt.rows( { selected: true } ).data().toArray();
    for (let i = 0; i < selected_data.length; i++) {
       this._submit_request(cmd, requestType, 'jobID='+selected_data[i][this.JOBID_IDX], false);
    }
    this._reload_data_table(dt);
  };

  private _submit_batch_script_path(script: string, dt: DataTables.Api) {
    this._submit_request('sbatch?scriptIs=path', 'POST', 'script=' + encodeURIComponent(script), true);
    this._reload_data_table(dt);
  };

  private _submit_batch_script_contents(dt: DataTables.Api) {
    if ( $('#slurm_script').length == 0) {
     // at the end of the main queue table area, append a prompt message and a form submission area
    $('#queue_wrapper').append('<br><div id="submit_script"><span>'+
                               'Paste in the contents of a Slurm script file and submit them to be run </span><br><br>' +
                               '<textarea id="slurm_script" cols="50" rows="20"></textarea><br>');
    // after the form submission area, insert a submit button and then a cancel button
    $('#slurm_script').after('<div id="slurm_buttons">'+
                              '<button class="button slurm_button" id="submit_button"><span>Submit</span></button>' +
                              '<button class="button slurm_button" id="cancel_button"><span>Cancel</span></button>'+
                              '</div></div>');
    // message above textarea (form submission area), textarea itself, and the two buttons below
    var submitScript = $('#submit_script');
    // do the callback after clicking on the submit button
    $('#submit_button').click( () => {// grab contents of textarea, convert to string, then URI encode them
                                      var scriptContents = encodeURIComponent($('#slurm_script').val().toString()); 
                                      this._submit_request('sbatch?scriptIs=contents', 'POST', 'script='+scriptContents, true);
                                      this._reload_data_table(dt);
                                      // remove the submit script prompt area
                                      submitScript.remove();
                                      } );
    // remove the submit script prompt area after clicking the cancel button
    $('#cancel_button').unbind().click( () => {submitScript.remove();} );
    
  }
  };

  /**
  * Reloads the queue table by using DataTables
  * AJAX functionality, which reloads only the data that 
  * is needed. IMPORTANT: This method is called
  * when widget.update() is called, and . The false
  * param passed to ajax.reload(..) indicates that the table's
  * pagination will not be reset upon reload, which does 
  * require some overhead due to sorting, etc.
  */
  public onUpdateRequest(msg: Message) {
    // $('#queue').DataTable().ajax.reload(null, false);
    this._reload_queue_table();
  };

} // class SlurmWidget


/**
 * Activate the Slurm widget extension.
 */
function activate(app: JupyterLab, palette: ICommandPalette, restorer: ILayoutRestorer) {
  console.log('JupyterLab extension jupyterlab-slurm is activated!');

  // Declare a Slurm widget variable
  let widget: SlurmWidget; 

  // Add an application command
  const command: string = 'hpc:open';
  app.commands.addCommand(command, {
    label: 'Slurm Queue Manager',
    execute: () => {
      if (!widget) {
        // Instantiate a new widget if one does not exist
        widget = new SlurmWidget(); 
	widget.title.icon = 'jp-ImageIcon';
        // Reload table every 60 seconds
        // DEBUG: comment this out so output in Chrome developer tools not constantly changing
        //setInterval(() => widget.update(), 60000);
      }
      if (!tracker.has(widget)) {
        // Track the state of the widget for later restoration
        tracker.add(widget);
      }
      if (!widget.isAttached) {
        // Attach the widget to the main work area if it's not there
        app.shell.addToMainArea(widget);
      } else {
        // Refresh the widget's state
        widget.update();
    }
      // Activate the widget
      app.shell.activateById(widget.id);
    }
  });

  // Add the command to the palette.
  palette.addItem({command, category: 'HPC Tools'})

  // Track and restore the widget state
  let tracker = new InstanceTracker<Widget>({ namespace: 'hpc'});
  restorer.restore(tracker, {
    command,
    args: () => JSONExt.emptyObject,
    name: () => 'hpc'
  });

} // activate

/**
 * Initialization data for the jupyterlab-slurm extension.
 */
const extension: JupyterLabPlugin<void> = {
  id: 'jupyterlab-slurm',
  autoStart: true,
  requires: [ICommandPalette, ILayoutRestorer],
  activate: activate
};

export default extension;
