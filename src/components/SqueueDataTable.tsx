import React, { Component, ReactNode } from 'react';
import {
  Badge,
  Button,
  ButtonToolbar,
  Col,
  Row,
  ToggleButton,
  InputGroup,
  FormControl
} from 'react-bootstrap';
import {
  BsArrowRepeat,
  BsTrashFill,
  BsPauseFill,
  BsPlayFill,
  BsArrowCounterclockwise
} from 'react-icons/bs';
import DataTable from 'react-data-table-component';
import RotateLoader from 'react-spinners/RotateLoader';

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
    theme: string;
    processJobAction: (
      action: JobAction,
      rows: Record<string, unknown>[]
    ) => void;
  };

  export type State = {
    rows: string[][];
    selectedRows: Record<string, unknown>[];
    clearSelected: boolean;
    displayedColumns: string[];
    itemsPerPage: number;
    filterQuery: '';
    lastSqueueFetch: Date;
    autoReload: boolean;
    reloadRate: number;
    reloadLimit: number;
    userOnly: boolean;
    loading: boolean;
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

    this.state = {
      rows: [],
      selectedRows: [],
      clearSelected: false,
      displayedColumns: props.defaultColumns
        ? props.defaultColumns
        : props.availableColumns,
      itemsPerPage: this.props.itemsPerPage, // make this prop dependent
      filterQuery: '',
      lastSqueueFetch: new Date(),
      autoReload: props.autoReload,
      reloadRate: reloadRate,
      reloadLimit: 5000,
      userOnly: props.userOnly,
      loading: false
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
    console.log('onSelectedRows() : ', rowState);

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

    this.setState({ loading: true, lastSqueueFetch: new Date() });

    return await requestAPI<any>('squeue', squeueParams)
      .then(data => {
        console.log('SqueueDataTable getData() squeue', squeueParams, data);
        this.setState({ rows: data.data });
        this.setState({ loading: false });
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
    const maxIDLength = String(
      rows
        .map(r => {
          return Number(r[0]);
        })
        .sort()[-1]
    ).length;
    const sortedRows: Record<string, unknown>[] = rows.map(r => {
      const jobID = String(r[this.props.availableColumns[0]]).padStart(
        maxIDLength,
        '0'
      );
      const row: Record<string, unknown> = {};

      let k;
      for (k in r) {
        row[k] = r[k];
      }

      row[this.props.availableColumns[0]] = jobID;
      return row;
    });
    // console.log('sortedRows', sortedRows);

    const finalRows = sortedRows.map(r => {
      r[this.props.availableColumns[0]] = String(
        Number(r[this.props.availableColumns[0]])
      );
      return r;
    });

    // console.log('finalRows', finalRows);
    return finalRows;
  }

  async onReloadButtonClick(): Promise<void> {
    await this.reload();
    const currentDT = new Date();
    const delta = Number(currentDT) - Number(this.state.lastSqueueFetch);
    if (delta >= this.state.reloadLimit) {
      console.log('onReloadButtonClick() calling reload()');
      await this.getData();
    }
  }

  async reload(): Promise<void> {
    this.setState({
      displayedColumns: this.props.defaultColumns
        ? this.props.defaultColumns
        : this.props.availableColumns,
      filterQuery: '',
      clearSelected: false
    });
  }

  async componentWillMount(): Promise<void> {
    console.log('componentWillMount()');
    await this.getData().then(async () => {
      await this.reload();
    });
  }

  async componentDidMount(): Promise<void> {
    console.log(
      'componentDidMount() this.props.reloadQueue ',
      this.props.reloadQueue
    );

    // after a user submits a series of job actions (submit, cancel, hold, release), reload the squeue table view
    // we need to limit the frequency of squeue requests
    if (this.props.reloadQueue) {
      this.getData(this.state.reloadLimit);
    }

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
  }

  async handleFilter(event: any): Promise<void> {
    this.setState({ filterQuery: event.target.value });
  }

  render(): ReactNode {
    const clearSelected = this.state.clearSelected;
    const selectedRows = this.state.selectedRows;
    const userOnly = this.state.userOnly;

    // id, partition, name, user, status, state, time, nodes, nodelist

    let data: Record<string, unknown>[] = [];
    if (this.state.rows.length > 0) {
      data = this.state.rows
        .filter(row => {
          const filterQuery = this.state.filterQuery;
          if (filterQuery === '') {
            return true;
          }

          for (const el of row) {
            if (el.includes(filterQuery) && !Number.isNaN(el)) {
              return true;
            }
          }
          return false;
        })
        .map(x => {
          const item: Record<string, unknown> = {
            // REPLACE WITH BETTER FUNCTION
            id: Number(
              x[0]
                .replace('_', '0')
                .replace('-', '0')
                .replace('[', '0')
                .replace(']', '0')
            )
          };

          let i, col, colValue;
          for (
            i = 0, col = 0;
            col < this.state.displayedColumns.length;
            i++, col++
          ) {
            colValue = this.state.displayedColumns[col];
            item[colValue] = x[i];
          }

          return item;
        });
    }

    const columns = this.state.displayedColumns.map(x => {
      return { name: x, selector: x, sortable: true, maxWidth: '200px' };
    });

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
        {this.state.loading && (
          <div id="squeue-loading" className={'justify-content-center'}>
            <RotateLoader color={'#DF772E'} speedMultiplier={0.5} />
          </div>
        )}

        <Row className={'justify-content-start jp-SlurmWidget-row'}>
          <ButtonToolbar>
            <Col md>
              <Button
                className="jp-SlurmWidget-table-button"
                variant="outline-secondary"
                onClick={this.onReloadButtonClick.bind(this)}
              >
                <BsArrowRepeat />
                Update Queue
              </Button>
            </Col>
            <Col md>
              <Button
                className="jp-SlurmWidget-table-button"
                disabled={selectedRows.length === 0}
                variant={'outline-secondary'}
                onClick={this.clearSelectedRows.bind(this)}
              >
                <BsArrowCounterclockwise />
                Clear Selections
                {selectedRows.length > 0 && (
                  <Badge
                    variant="light"
                    pill={true}
                    className={'jp-SlurmWidget-table-button-badge'}
                  >
                    {selectedRows.length}
                  </Badge>
                )}
              </Button>
            </Col>
            <Col md>
              <Button
                className="jp-SlurmWidget-table-button"
                disabled={selectedRows.length === 0}
                variant={'outline-danger'}
                onClick={() => {
                  this.handleJobAction('kill');
                }}
              >
                <BsTrashFill />
                Kill Job(s)
                {selectedRows.length > 0 && (
                  <Badge
                    variant="light"
                    pill={true}
                    className={'jp-SlurmWidget-table-button-badge'}
                  >
                    {selectedRows.length}
                  </Badge>
                )}
              </Button>
            </Col>
            <Col md>
              <Button
                className="jp-SlurmWidget-table-button"
                disabled={selectedRows.length === 0}
                variant={'outline-danger'}
                onClick={() => {
                  this.handleJobAction('hold');
                }}
              >
                <BsPauseFill />
                Hold Job(s)
                {selectedRows.length > 0 && (
                  <Badge
                    variant="light"
                    pill={true}
                    className={'jp-SlurmWidget-table-button-badge'}
                  >
                    {selectedRows.length}
                  </Badge>
                )}
              </Button>
            </Col>
            <Col md>
              <Button
                className="jp-SlurmWidget-table-button"
                disabled={selectedRows.length === 0}
                variant={'outline-danger'}
                onClick={() => {
                  this.handleJobAction('release');
                }}
              >
                <BsPlayFill />
                Release Job(s)
                {selectedRows.length > 0 && (
                  <Badge
                    variant="light"
                    pill={true}
                    className={'jp-SlurmWidget-table-button-badge'}
                  >
                    {selectedRows.length}
                  </Badge>
                )}
              </Button>
            </Col>
          </ButtonToolbar>
        </Row>
        <Row xs={2} className={'justify-content-start jp-SlurmWidget-row'}>
          <ButtonToolbar id="button-toolbar">
            <Col md>
              <InputGroup id="filter-input-group">
                <InputGroup.Prepend>
                  <InputGroup.Text>Filter:</InputGroup.Text>
                </InputGroup.Prepend>
                <FormControl
                  id="filter-input"
                  value={this.state.filterQuery}
                  onChange={this.handleFilter.bind(this)}
                />
              </InputGroup>
            </Col>
            <Col>
              <ToggleButton
                type="checkbox"
                id="user-only-checkbox"
                variant="outline-light"
                onChange={this.toggleUserOnly.bind(this)}
                checked={userOnly}
                value="1"
              >
                Display my jobs only
              </ToggleButton>
            </Col>
          </ButtonToolbar>
        </Row>
        <Row className={'justify-content-center jp-SlurmWidget-row'}>
          <DataTable
            data={data}
            columns={columns}
            defaultSortField={this.props.availableColumns[0]}
            defaultSortAsc={false}
            // sortFunction={this.sortRows}
            striped
            highlightOnHover
            pagination
            selectableRows
            clearSelectedRows={clearSelected}
            onSelectedRowsChange={this.onSelectedRows.bind(this)}
            noDataComponent={'No jobs currently queued.'}
            paginationPerPage={this.state.itemsPerPage}
            paginationRowsPerPageOptions={this.props.itemsPerPageOptions}
            theme={this.props.theme}
            noHeader={true}
            className={'jp-SlurmWidget-table'}
          />
        </Row>
      </>
    );
  }
}
