// TODO: Add Refresh button (defualt refresh every one minute)
// 

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


import '../style/index.css';

class SlurmWidget extends Widget {
  /**
  * The table element containing SLURM queue data.
  */ 
  private queue_table: HTMLElement;

  /**
  * Construct a new SLURM widget.
  */
  constructor() {
    super();

    this.id = 'nersc-hpc-jupyterlab';
    this.title.label = 'SLURM Queue Monitor';
    this.title.closable = true;
    this.addClass('jp-queueWidget');

    this.queue_table = document.createElement('table');
    this.queue_table.className = 'jp-queueTable';
    this.node.appendChild(this.queue_table);

  }

  public onUpdateRequest(msg: Message) {
    console.log("update request called!")
    this._update_queue_table();
  }

  // Pull queue data and populate queue_table
  private _update_queue_table() {
    fetch('/shell/ps/aux').then(response => {
      return response.text();
    }).then(data => this._populate_queue_table(data));
  }

  // Generate HTML table and populate with queue_data
  private _populate_queue_table(data: string) {
    console.log("table refreshed!")


    // Clear table content
    while (this.queue_table.hasChildNodes()) {
      this.queue_table.removeChild(this.queue_table.lastChild);
    }

    

    
    // TODO: fix this bad logic of clearing/not clearing the table...
    // as of now the new data gets appended to the end of the existing 
    // table! No good!
    // this.queue_table = document.createElement('table');
    let lines = data.split('\n');
    // for (let i = 0; i < lines.length; i++) {
    for (let i = 0; i < 10; i++) {      
      let row_values = lines[i].split(/[\s]+/)
      let row = document.createElement('tr');
      // for (let j = 0; j < row_values.length; j++) {
      for (let j = 0; j < 5; j++) {

        let cell = document.createElement('td');
        cell.className = 'jp-queueTable';
        let cellText = document.createTextNode(row_values[j]);
        cell.appendChild(cellText);
        row.appendChild(cell);
      } // for (inner)
      this.queue_table.appendChild(row);
    } // for (outer)
  } // _populate_queue_table
} // class SlurmWidget


/**
 * Activate the SLURM widget extension.
 */
function activate(app: JupyterLab, palette: ICommandPalette, restorer: ILayoutRestorer) {
  console.log('JupyterLab extension jupyterlab_hpc is activated!');

  // Declare a SLURM widget variable
  let widget: SlurmWidget; //= new SlurmWidget();

  // Add an application command
  const command: string = 'hpc:open';
  app.commands.addCommand(command, {
    label: 'SLURM Queue Monitor',
    execute: () => {
      console.log("execute function entered!")
      // So this function funs ONLY when the 'SLURM Queue Monitor' button
      // is pushed!
      if (!widget) {
        console.log("no widget region entered!")
        // Instantiate a new widget if one does not exist
        widget = new SlurmWidget();
        // widget.update() calls the onUpdateRequest method
        widget.update();
        // Refresh table every 60 seconds by default
        setInterval(() => widget.update(), 60000);
      }
      if (!tracker.has(widget)) {
        // Track the state of the widget for later restoration
        tracker.add(widget);
      }
      if (!widget.isAttached) {
        // Attach the widget to the main work area if it's not there
        app.shell.addToMainArea(widget);
        // set interval here?
      } else {
        // Refresh the widget's state
        widget.update();
        // setInterval(() => widget.update(), 60000);
    }
      // Activate the widget
      app.shell.activateById(widget.id);
    }
  });

  // Add the command to the palette.
  palette.addItem({command, category: 'HPC Tools'})

  // Track and resotre the widget state
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
  id: 'jupyterlab_hpc',
  autoStart: true,
  requires: [ICommandPalette, ILayoutRestorer],
  activate: activate
};

  export default extension;
