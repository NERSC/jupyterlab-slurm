import {PageConfig, URLExt} from '@jupyterlab/coreutils';

import * as config from './slurm-config/config.json';

import {modal} from './modal'
import { SlurmWidget } from './slurmWidget';
import {reload, kill, hold, release, submit} from './buttons';
import {pathOnClick, scriptOnClick} from './onClick';

import * as $ from 'jquery';

// The base URL that prepends commands -- necessary for hub functionality
var baseUrl = PageConfig.getOption('baseUrl');

// The ajax request URL for calling squeue; changes depending on whether
// we are in user view (default), or global view, as determined by the
// toggleSwitch, defined below.

// URL for calling squeue -u, used for user view
var userViewURL = URLExt.join(baseUrl, config['squeueURL'] + '?userOnly=true');
// URL for calling squeue, used for global view
var globalViewURL = URLExt.join(baseUrl, config['squeueURL'] + '?userOnly=false');

  /**
  * This is triggered when the table is fully initialized.
  * Waits for username request to finish, and then defines functionality
  * for switching between user and global view. The switch function is
  * called immediately after it is defined, which makes it so user view
  * is the default. */
function initComplete(userRequest: any, self: SlurmWidget) {

    var table = $('#queue').DataTable();
    $.when(userRequest).done(function () {
      $("#toggleSwitch").change(function () {
        if ((this as HTMLInputElement).checked) {
          // Global -> User view switch
          table.ajax.url(userViewURL);
          self.dataCache = table.rows().data();
          table.clear();
          let filteredData = self.dataCache
              .filter(function(value, index) {
                return value[self.USER_IDX] == self.user;
              });
          table.rows.add(filteredData.toArray());
          table.draw();
        }
        else {
          // User -> Global view switch
          table.ajax.url(globalViewURL);
          let userData = table.data();
          table.clear();
          let filteredData = self.dataCache
              .filter(function(value, index) {
                return value[self.USER_IDX] != self.user;
              })
          table.rows.add(filteredData.toArray());
          table.rows.add(userData.toArray());
      	  table.draw();
        }
      });
      $("#toggleSwitch").change();
    });
}

function tableSettings(self: SlurmWidget, userRequest: any) {
  return (
    {
      ajax: globalViewURL,
      initComplete: (settings, json) => {initComplete(userRequest, self);},
      select: {
        style: "os" as "os",
      },
      deferRender: true,
      pageLength: 15,
      columnDefs: [
        {
          className: 'dt-center',
          searchable: true,
          targets: '_all',
          render: columnRenderer()
        }
      ],
      // Set rowId to maintain selection after table reload
      // (use the queue's primary key (JOBID) for rowId).
      rowId: self.JOBID_IDX.toString(),
      autoWidth: true,
      scrollY: '400px',
      scrollX: true,
      scrollCollapse: true,
      // Element layout parameter
      dom: '<"toolbar"Bfr><t><lip>',
      buttons: {
        buttons: [reload(self), kill(self), hold(self), release(self), submit, {extend: 'selectNone'}],
        // https://datatables.net/reference/option/buttons.dom.button
        // make it easier to identify/grab buttons to change their appearance
        dom: {button: {tag: 'button', className: 'button',}}
      }
    }
  );
}

export function renderTable(self: SlurmWidget, userRequest) {

    // Render table using the DataTables API
    $(document).ready(() => {
      var table = $('#queue').DataTable(tableSettings(self, userRequest));

      // Disable the ability to select rows that correspond to a pending request
      table.on('user-select', function (e, dt, type, cell, originalEvent) {
        if ($(originalEvent.target).parent().hasClass("pending")) {
          e.preventDefault();
        }
      });

      // Add a switch that toggles between global and user view (user by default)
      let toggleContainer = document.createElement("div");
      toggleContainer.classList.add("custom-control", "custom-switch", "toggle-switch");

      let toggleSwitch = document.createElement("input");
      toggleSwitch.classList.add("custom-control-input");
      toggleSwitch.setAttribute("type", "checkbox");
      toggleSwitch.setAttribute("id", "toggleSwitch");
      toggleSwitch.setAttribute("checked", "true");

      let toggleLabel = document.createElement("label");
      toggleLabel.classList.add("custom-control-label");
      toggleLabel.setAttribute("for", "toggleSwitch");
      toggleLabel.textContent = "Show my jobs only";

      toggleContainer.appendChild(toggleSwitch);
      toggleContainer.appendChild(toggleLabel);
      $('#jupyterlab-slurm').append(toggleContainer);

      // Set up and append the alert container -- an area for displaying request response
      // messages as color coded, dismissable, alerts
      let alertContainer = document.createElement('div');
      alertContainer.setAttribute("id", "alertContainer");
      alertContainer.classList.add('container', 'alert-container');
      $('#jupyterlab-slurm').append(alertContainer);
      
      let modalContainer = document.createElement('div');
      modalContainer.innerHTML = modal;
      $('#jupyterlab-slurm').append(modalContainer);

      // The path submission click function
      $('#submitPath').click(pathOnClick(self));
      // The script submission click function
      $('#submitScript').click(scriptOnClick(self));

    });
}

  /**
  * This method is adapted from the DataTables Ellipses plug-in:
  * https://datatables.net/plug-ins/dataRender/ellipsis#Examples
  * Truncates table content longer than config.cutoff -- if so,
  * the full content will be displayed in a tool-tip. Also handles
  * HTML escapes, and truncates at word boundaries. */
 function columnRenderer() {
  var esc = function ( t ) {
    return t
    .replace( /&/g, '&amp;' )
    .replace( /</g, '&lt;' )
    .replace( />/g, '&gt;' )
    .replace( /"/g, '&quot;' );
  };

  return function ( d, type, row ) {
    // Order, search and type get the original data
    if ( type !== 'display' ) {
      return d;
    }

    if ( typeof d !== 'number' && typeof d !== 'string' ) {
      return d;
    }

    d = d.toString(); // cast numbers

    if ( d.length < config["cutoff"] ) {
      return d;
    }

    var shortened = d.substr(0, config["cutoff"]-1);

    // Find the last white space character in the string
    if ( config["wordbreak"] ) {
      shortened = shortened.replace(/\s([^\s]*)$/, '');
    }

    // Protect against uncontrolled HTML input
    if ( config["escapeHtml"] ) {
      shortened = shortened
      .replace( /&/g, '&amp;' )
      .replace( /</g, '&lt;' )
      .replace( />/g, '&gt;' )
      .replace( /"/g, '&quot;' );
    }

    return '<span class="ellipsis" title="'+esc(d)+'">'+shortened+'&#8230;</span>';
  };
};
