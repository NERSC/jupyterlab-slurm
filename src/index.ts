import {
  JupyterLab, JupyterLabPlugin
} from '@jupyterlab/application';

import '../style/index.css';


/**
 * Initialization data for the jupyterlab_hpc extension.
 */
const extension: JupyterLabPlugin<void> = {
  id: 'jupyterlab_hpc',
  autoStart: true,
  activate: (app: JupyterLab) => {
    console.log('JupyterLab extension jupyterlab_hpc is activated!');
  }
};

export default extension;
