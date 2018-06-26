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

    // Add a table element to the panel
    let queue_table = document.createElement('table');
    widget.node.appendChild(queue_table);

    setInterval(populate_queue_table, 1000, queue_table);

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


function populate_queue_table(queue_table: HTMLElement) {
    fetch('/shell/ps/aux').then(response => {
        return response.text();
    }).then(data => generate_table(data))
}

function generate_table(data: string) {
    let lines = data.split('\n');
    for (var i = 0; i < lines.length; i++) {
        console.log(lines[i].split(/[\s]+/))
        console.log(lines[i].split(/[\s]+/).length)
}

export default extension;
