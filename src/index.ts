import {
  JupyterLab, JupyterLabPlugin
} from '@jupyterlab/application';

import {
  ICommandPalette
} from '@jupyterlab/apputils';

import {
  Widget
} from '@phosphor/widgets';

import '../style/index.css';


/**
 * Initialization data for the jupyterlab_hpc extension.
 */
 const extension: JupyterLabPlugin<void> = {
   id: 'jupyterlab_hpc',
   autoStart: true,
   requires: [ICommandPalette],
   activate: (app: JupyterLab, palette: ICommandPalette) => {
     console.log('JupyterLab extension jupyterlab_hpc is activated!');


    // Create a single widget
    let widget: Widget = new Widget();
    widget.id = 'nersc-hpc-jupyterlab';
    widget.title.label = 'SLURM Queue Monitor';
    widget.title.closable = true;
    widget.addClass('jp-queueWidget');

    // Add a table element to the panel
    let queue_table = document.createElement('table');
    // queue_table.classList.add('jp-queueTable', 'jp-qTableBorder');
    queue_table.className = 'jp-queueTable';
    widget.node.appendChild(queue_table);

    populate_queue_table(queue_table);

    // Refresh table at specified interval
    // setInterval(populate_queue_table, 2000, queue_table);

    // Add an application command
    const command: string = 'hpc:open';
    app.commands.addCommand(command, {
      label: 'SLURM Queue Monitor',
      execute: () => {
        if (!widget.isAttached) {
                // Attach the widget to the main work area if it's not there
                app.shell.addToMainArea(widget);
              }
            // Activate the widget
            app.shell.activateById(widget.id);
          }
        });
    // Add the command to the palette.
    palette.addItem({command, category: 'NERSC Tools'})
  }
};

// Pull queue data and populate html table
function populate_queue_table(queue_table: HTMLElement) {
  fetch('/shell/ps/aux').then(response => {
    return response.text();
  }).then(data => generate_table(queue_table, data))
}

function generate_table(queue_table: HTMLElement, data: string) {
  console.log("table refreshed!")
  let lines = data.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let row_values = lines[i].split(/[\s]+/)
    let row = document.createElement('tr');
    for (let j = 0; j < row_values.length; j++) {
      let cell = document.createElement('td');
      cell.className = 'jp-qTableBorder';
      let cellText = document.createTextNode(row_values[j]);
      // cell.style.fontSize = "12px";
      cell.appendChild(cellText);
      row.appendChild(cell);
    }
    queue_table.appendChild(row);
  }
}

  export default extension;
