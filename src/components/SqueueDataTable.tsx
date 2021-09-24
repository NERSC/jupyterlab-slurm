import React, { Component, ReactNode } from 'react';
import {
  Badge,
  Button,
  ButtonGroup,
  ButtonToolbar,
  Col,
  Row,
  ToggleButton,
  InputGroup,
  FormControl,
  Spinner
} from 'react-bootstrap';
import {
  BsArrowCounterclockwise,
  BsArrowRepeat,
  BsPauseFill,
  BsPlayFill,
  BsFilter,
  BsTrashFill
} from 'react-icons/bs';
import DataTable, { IDataTableColumn } from 'react-data-table-component';

// Local
import { requestAPI } from '../handler';
import { JobAction } from '../types';

namespace types {
  export type Props = {
    availableColumns: string[];
    defaultColumns?: string[];
    itemsPerPage: number;
    itemsPerPageOptions: Array<number>;
    userOnly: boolean;
    processing: boolean;
    reloadQueue: boolean;
    autoReload: boolean;
    reloadRate: number;
    processJobAction: (
      action: JobAction,
      rows: Record<string, unknown>[]
    ) => void;
  };

  export type State = {
    rows: string[][];
    selectedRows: Record<string, unknown>[];
    displayRows: Record<string, unknown>[];
    clearSelected: boolean;
    columns: string[];
    displayColumns: IDataTableColumn<Record<string, unknown>>[];
    itemsPerPage: number;
    filterQuery: string;
    lastSqueueFetch: Date;
    autoReload: boolean;
    reloadRate: number;
    reloadLimit: number;
    userOnly: boolean;
    loading: boolean;
    theme: string;
    observer: MutationObserver;
  };
}

export default class SqueueDataTable extends Component<
  types.Props,
  types.State
> {
  constructor(props: types.Props) {
    super(props);

    this.sortRows = this.sortRows.bind(this);

    let reloadRate = this.props.reloadRate;
    if (this.props.reloadRate < 5000) {
      console.log(
        'jupyterlab-slurm has a floor for reloadRate of 5 seconds, you passed ' +
          this.props.reloadRate
      );
      reloadRate = 5000;
    }

    const columns = props.defaultColumns
      ? props.defaultColumns
      : props.availableColumns;

    const body = document.getElementsByTagName('body')[0];
    const observer = new MutationObserver(mutationRecords => {
      if (mutationRecords[0].oldValue === 'true') {
        this.setState({ theme: 'dark' });
      } else {
        this.setState({ theme: 'default' });
      }
    });
    observer.observe(body, {
      attributes: true,
      attributeFilter: ['data-jp-theme-light'],
      attributeOldValue: true
    });

    this.state = {
      rows: [],
      displayRows: [],
      selectedRows: [],
      clearSelected: false,
      columns: columns,
      displayColumns: columns.map(x => {
        return { name: x, selector: x, sortable: true, maxWidth: '200px' };
      }),
      itemsPerPage: this.props.itemsPerPage, // make this prop dependent
      filterQuery: '',
      lastSqueueFetch: new Date(),
      autoReload: props.autoReload,
      reloadRate: reloadRate,
      reloadLimit: 5000,
      userOnly: props.userOnly,
      loading: false,
      theme: 'default',
      observer: observer
    };
  }

  clearSelectedRows(): void {
    this.setState({ selectedRows: [], clearSelected: true });
  }

  private toggleUserOnly() {
    const { userOnly } = this.state;
    this.setState({ userOnly: !userOnly });
  }

  onSelectedRows(rowState: {
    allSelected: boolean;
    selectedCount: number;
    selectedRows: Record<string, unknown>[];
  }): void {
    this.setState({
      selectedRows: rowState.selectedRows,
      clearSelected: false
    });
  }

  handleJobAction(action: JobAction): void {
    this.props.processJobAction(action, this.state.selectedRows);

    if (action === 'kill') {
      this.clearSelectedRows();
    }
  }

  async getData(rateLimit = 0): Promise<string[][]> {
    const { userOnly } = this.state;
    const squeueParams = new URLSearchParams(`userOnly=${userOnly}`);

    if (rateLimit > 0) {
      const currentDT = new Date();
      const delta = Number(currentDT) - Number(this.state.lastSqueueFetch);
      if (delta < rateLimit) {
        return;
      }
    }

    if (this.state.loading) {
      return;
    }

    this.setState({ loading: true });

    return await requestAPI<any>('squeue', squeueParams)
      .then(data => {
        console.log('SqueueDataTable getData() squeue', squeueParams, data);

        this.setState(
          {
            lastSqueueFetch: new Date(),
            rows: data.data,
            loading: false
          },
          () => {
            this.updateDisplayRows();
            console.log('loading finished');
          }
        );
      })
      .catch(error => {
        console.error('SqueueDataTable getData() error', error);
        return null;
      });
  }

  private sortRows(
    rows: Record<string, unknown>[],
    field: string,
    direction: string
  ): Record<string, unknown>[] {
    function getSortValue(
      a: Record<string, unknown>,
      b: Record<string, unknown>
    ): number {
      // by default use the standard string comparison for field values
      let val_a = a[field];
      let val_b = b[field];

      // If the field value is a number, convert to number and use that for comparison
      if (!isNaN(Number(a[field])) && !isNaN(Number(b[field]))) {
        val_a = Number(a[field]);
        val_b = Number(b[field]);
      } else if (field === 'JOBID') {
        // Requires a special sorting for job array strings where it can't be converted to a number
        const jobIDSpecials = /[0-9][-_[\]]/g;
        const parts_a = String(a[field])
          .split(jobIDSpecials)
          .map(x => Number(x));
        const parts_b = String(b[field])
          .split(jobIDSpecials)
          .map(x => Number(x));
        let tot_a = 0;
        let tot_b = 0;
        let i;

        for (i = 0; i < parts_a.length; i++) {
          tot_a += parts_a[i];
        }
        for (i = 0; i < parts_b.length; i++) {
          tot_b += parts_b[i];
        }

        val_a = tot_a;
        val_b = tot_b;
      }

      const greater = val_a > val_b;
      if (direction === 'desc') {
        if (greater) {
          return 1;
        } else {
          return -1;
        }
      } else {
        if (greater) {
          return -1;
        } else {
          return 1;
        }
      }
    }

    const sorted_rows = rows.slice(0);
    sorted_rows.sort(getSortValue);
    return sorted_rows;
  }

  private updateDisplayRows() {
    const displayRows = this.state.rows
      .filter((row: string[]) => {
        const filterQuery = this.state.filterQuery.toLowerCase();

        for (const el of row) {
          if (el.toLowerCase().includes(filterQuery)) {
            // console.log(`true for ${row}`);
            return true;
          }
        }
        return false;
      })
      .map((x: string[]) => {
        const item: Record<string, unknown> = { id: x[0] };
        let i, col, colValue;
        for (i = 0, col = 0; col < this.state.columns.length; i++, col++) {
          colValue = this.state.columns[col];
          item[colValue] = x[i];
        }

        return item;
      });
    this.setState({ displayRows: displayRows });
  }

  async onReloadButtonClick(): Promise<void> {
    await this.reload();
    const currentDT = new Date();
    const delta = Number(currentDT) - Number(this.state.lastSqueueFetch);
    if (delta >= this.state.reloadLimit) {
      await this.getData();
    }
  }

  async reload(): Promise<void> {
    this.setState({
      clearSelected: false
    });
  }

  async componentDidMount(): Promise<void> {
    await this.getData().then(async () => {
      await this.reload();
    });

    // if (this.state.autoReload) {
    //   useEffect(() => {
    //     const interval = setInterval(async () => {
    //       await this.getData(this.state.reloadRate);
    //     }, this.state.reloadRate);
    //     return () => clearInterval(interval);
    //   }, []);
    // }
    if (this.state.autoReload) {
      const reload = async () => {
        this.setState({ loading: true });
        await this.getData(this.state.reloadRate);
        this.setState({ loading: false });

        setTimeout(reload, this.state.reloadRate);
      };
      reload();
    }
  }

  async componentDidUpdate(
    prevProps: Readonly<types.Props>,
    prevState: Readonly<types.State>
  ): Promise<void> {
    // reset the clear state to re-enable selections
    if (this.state.clearSelected) {
      this.setState({ clearSelected: false });
    }

    // after a user submits a series of job actions (submit, cancel, hold, release), reload the squeue table view
    // we need to limit the frequency of squeue requests
    if (this.props.reloadQueue) {
      this.getData(this.state.reloadLimit);
    }

    // make sure a last attempt is made to reload when all job actions have completed
    if (prevProps.reloadQueue && !this.props.reloadQueue) {
      this.getData();
    }
  }

  componentWillUnmount(): void {
    this.state.observer.disconnect();
  }

  async handleFilter(filter: string): Promise<void> {
    this.setState({ filterQuery: filter }, this.updateDisplayRows);
  }

  render(): ReactNode {
    /*
    console.log({
      rows: this.state.rows,
      columns: columns,
      data: data,
      rows_length: this.state.rows.length,
      itemsPerPage: this.state.itemsPerPage,
      selectedRows: selectedRows,
      displayedColumns: this.state.displayedColumns
    });
    */

    return (
      <>
        <Row className={'mt-4 justify-content-start jp-SlurmWidget-row'}>
          <ButtonToolbar>
            <ButtonGroup size="sm" className={'ml-3 mr-2'}>
              <Button
                className="jp-SlurmWidget-table-button"
                variant="outline-secondary"
                onClick={this.onReloadButtonClick.bind(this)}
              >
                <BsArrowRepeat />
                Update Queue
              </Button>
              <Button
                className="jp-SlurmWidget-table-button"
                disabled={this.state.selectedRows.length === 0}
                variant="outline-secondary"
                onClick={this.clearSelectedRows.bind(this)}
              >
                <BsArrowCounterclockwise />
                Clear Selected
                {this.state.selectedRows.length > 0 && (
                  <Badge
                    variant="light"
                    pill={true}
                    className={'jp-SlurmWidget-table-button-badge'}
                  >
                    {this.state.selectedRows.length}
                  </Badge>
                )}
              </Button>
            </ButtonGroup>
            <ButtonGroup size="sm">
              <Button
                className="jp-SlurmWidget-table-button"
                disabled={this.state.selectedRows.length === 0}
                variant={'outline-danger'}
                onClick={() => {
                  this.handleJobAction('kill');
                }}
              >
                <BsTrashFill />
                Kill Job(s)
                {this.state.selectedRows.length > 0 && (
                  <Badge
                    variant="light"
                    pill={true}
                    className={'jp-SlurmWidget-table-button-badge'}
                  >
                    {this.state.selectedRows.length}
                  </Badge>
                )}
              </Button>
              <Button
                className="jp-SlurmWidget-table-button"
                disabled={this.state.selectedRows.length === 0}
                variant={'outline-danger'}
                onClick={() => {
                  this.handleJobAction('hold');
                }}
              >
                <BsPauseFill />
                Hold Job(s)
                {this.state.selectedRows.length > 0 && (
                  <Badge
                    variant="light"
                    pill={true}
                    className={'jp-SlurmWidget-table-button-badge'}
                  >
                    {this.state.selectedRows.length}
                  </Badge>
                )}
              </Button>
              <Button
                className="jp-SlurmWidget-table-button"
                disabled={this.state.selectedRows.length === 0}
                variant={'outline-danger'}
                onClick={() => {
                  this.handleJobAction('release');
                }}
              >
                <BsPlayFill />
                Release Job(s)
                {this.state.selectedRows.length > 0 && (
                  <Badge
                    variant="light"
                    pill={true}
                    className={'jp-SlurmWidget-table-button-badge'}
                  >
                    {this.state.selectedRows.length}
                  </Badge>
                )}
              </Button>
            </ButtonGroup>
          </ButtonToolbar>
        </Row>
        <Row className={'justify-content-start jp-SlurmWidget-row'}>
          <ButtonToolbar>
            <Col lg>
              <InputGroup
                size="sm"
                className="jp-SlurmWidget-table-filter-input-group"
              >
                <InputGroup.Prepend>
                  <InputGroup.Text className="jp-SlurmWidget-table-filter-label">
                    <BsFilter />
                    Filter
                  </InputGroup.Text>
                </InputGroup.Prepend>
                <FormControl
                  className="jp-SlurmWidget-table-filter-input"
                  value={this.state.filterQuery}
                  onChange={e => {
                    this.handleFilter(e.target.value);
                  }}
                />
              </InputGroup>
            </Col>
            <Col>
              <ToggleButton
                type="checkbox"
                className="jp-SlurmWidget-user-only-checkbox"
                variant="outline-light"
                size="sm"
                onChange={this.toggleUserOnly.bind(this)}
                checked={this.state.userOnly}
                value="1"
              >
                Display my jobs only
              </ToggleButton>
            </Col>
          </ButtonToolbar>
          <Col>
            Last updated: {this.state.lastSqueueFetch.toLocaleDateString()}{' '}
            {this.state.lastSqueueFetch.toLocaleTimeString()}
          </Col>
        </Row>
        {this.state.loading && (
          <Row className={'justify-content-center jp-SlurmWidget-row'}>
            <div
              className={'justify-content-center jp-SlurmWidget-squeue-loading'}
            >
              <Spinner
                animation="grow"
                className={'jp-SlurmWidget-squeue-loader'}
              />
            </div>
          </Row>
        )}
        <Row
          className={
            'justify-content-center jp-SlurmWidget-row jp-SlurmWidget-table-row'
          }
        >
          <DataTable
            data={this.state.displayRows}
            columns={this.state.displayColumns}
            defaultSortField={this.props.availableColumns[0]}
            defaultSortAsc={false}
            sortFunction={this.sortRows}
            striped
            highlightOnHover
            pagination
            selectableRows
            clearSelectedRows={this.state.clearSelected}
            onSelectedRowsChange={this.onSelectedRows.bind(this)}
            noDataComponent={'No jobs currently queued.'}
            paginationPerPage={this.state.itemsPerPage}
            paginationRowsPerPageOptions={this.props.itemsPerPageOptions}
            theme={this.state.theme}
            noHeader={true}
            className={'jp-SlurmWidget-table'}
          />
        </Row>
      </>
    );
  }
}
