// import {  ServerConnection } from '@jupyterlab/services';

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
// import 'datatables.net-dt';
import 'datatables.net-buttons';
import 'datatables.net-select';
import 'datatables.net-dt/css/jquery.dataTables.css';
// import 'datatables.net/1.10.19/css/jquery.dataTables.css';

import '../style/index.css';

class SlurmWidget extends Widget {
  /**
  * The table element containing SLURM queue data. */ 
  private queue_table: HTMLElement;
  // The column index of job ID
  readonly JOBID_IDX = 0;

  /* Construct a new SLURM widget. */
  constructor() {
    super();
    console.log('constructor called');
    this.id = 'nersc-hpc-jupyterlab';
    this.title.label = 'SLURM Queue Manager';
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
        ajax: '/squeue',
        select: {
          style: 'multi',
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
            text: 'Submit SLURM Script via File Path',
            action:  (e, dt, node, config) => {
              var scriptPath = window.prompt('Enter a SLURM script file path on Cori');
              self._submit_batch_script_path(scriptPath, dt)
              alert(scriptPath);
            }
          },
          {
            text: 'Submit SLURM Script via File Contents',
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



  private _reload_queue_table() {
    $('#queue').DataTable().ajax.reload(null, false);
    console.log('searchable');
    // console.log(<any>$("#selector").selectedIndex);
  };

  private _run_on_selected(cmd: string, requestType: string, dt: DataTables.Api) {
    let selected_data = dt.rows( { selected: true } ).data().toArray();
    for (let i = 0; i < selected_data.length; i++) {
       let xhttp = new XMLHttpRequest();
       xhttp.open(requestType, cmd, true);
       xhttp.setRequestHeader('Authorization', 'token ' + PageConfig.getToken());
       xhttp.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
       xhttp.send('jobID='+selected_data[i][this.JOBID_IDX]);

      //const settings = ServerConnection.makeSettings();
      //const url = cmd + '/' + selected_data[i][this.JOBID_IDX];
      //const init = {}; // fetch settings (see: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)
      //ServerConnection.makeRequest(url, init, settings).then(response => { console.log('got', response);});
      //console.log(selected_data[i][1]);
    }
    dt.ajax.reload(null, false);
  };

  private _submit_batch_script_path(script: string, dt: DataTables.Api) {
    let xhttp = new XMLHttpRequest();
    xhttp.open('POST', 'sbatch?scriptIs=path', true);
    xhttp.setRequestHeader('Authorization', 'token ' + PageConfig.getToken());
    xhttp.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhttp.send('script=' + encodeURIComponent(script));

    dt.ajax.reload(null, false);
  };

  private _submit_batch_script_contents(dt: DataTables.Api) {
    if ( $('#slurm_script').length == 0) {
    // shamelessly ripped off from http://jsfiddle.net/Xtreu/297/
    $('#queue_wrapper').append('<br><div id="submit_script"><span>'+
                               'Paste in the contents of a SLURM script file and submit them to Cori </span><br><br>' +
                               '<textarea id="slurm_script" cols="50" rows="20"></textarea><br>');
    $('#slurm_script').after('<div id="slurm_buttons">'+
                              '<button class="button slurm_button" id="submit_button"><span>Submit</span></button>' +
                              '<button class="button slurm_button" id="cancel_button"><span>Cancel</span></button>'+
                              '</div></div>');
    var submitScript = $('#submit_script');
    $('#submit_button').click( () => {// grab contents of text area, convert to string, then URI encode them
                                      var scriptContents = encodeURIComponent($('#slurm_script').val().toString()); 
                                      let xhttp = new XMLHttpRequest();

                                      xhttp.onreadystatechange = () => {
                                        if (xhttp.readyState === xhttp.DONE) {
                                        alert("xhttp.response: "+ xhttp.response.toString());
                                        alert("xhttp.responseText: "+ xhttp.responseText.toString());
                                        alert("xhttp.responseType: "+ xhttp.responseType.toString());
                                        }
                                      }

                                      xhttp.open('POST', 'sbatch?scriptIs=contents', true);
                                      xhttp.setRequestHeader('Authorization', 'token ' + PageConfig.getToken());
                                      xhttp.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
                                      xhttp.send('script='+scriptContents);
                                      alert(scriptContents);
                                      
                                      dt.ajax.reload(null, false);
                                      submitScript.remove();
                                      } );
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
 * Activate the SLURM widget extension.
 */
function activate(app: JupyterLab, palette: ICommandPalette, restorer: ILayoutRestorer) {
  console.log('JupyterLab extension jupyterlab_hpc is activated!');

  // Declare a SLURM widget variable
  let widget: SlurmWidget; 

  // Add an application command
  const command: string = 'hpc:open';
  app.commands.addCommand(command, {
    label: 'SLURM Queue Manager',
    execute: () => {
      if (!widget) {
        // Instantiate a new widget if one does not exist
        widget = new SlurmWidget(); 
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
 * Initialization data for the jupyterlab_hpc extension.
 */
const extension: JupyterLabPlugin<void> = {
  id: 'jupyterlab_slurm_ext',
  autoStart: true,
  requires: [ICommandPalette, ILayoutRestorer],
  activate: activate
};

export default extension;
