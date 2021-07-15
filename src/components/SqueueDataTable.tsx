import React, { Component, ReactNode, useEffect } from 'react';
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
    theme: string;
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

    this.state = {
      rows: [],
      displayRows: [],
      selectedRows: [],
      clearSelected: false,
      columns: columns,
      displayColumns: columns.map(x => {
        return { name: x, selector: x, sortable: true };
      }),
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

    this.setState({ loading: true });
    console.log('loading...');

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
      let val_a = a[field];
      let val_b = b[field];

      if (!isNaN(Number(a[field]))) {
        val_a = Number(a[field]);
        val_b = Number(b[field]);
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
        const item: Record<string, unknown> = { id: Number(x[0]) };
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
      console.log('onReloadButtonClick() calling reload()');
      await this.getData();
    }
  }

  async reload(): Promise<void> {
    this.setState({
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

    if (this.state.autoReload) {
      useEffect(() => {
        const interval = setInterval(async () => {
          await this.getData(this.state.reloadRate);
        }, this.state.reloadRate);
        return () => clearInterval(interval);
      }, []);
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

  handleFilter(filter: string): void {
    console.log(filter);
    this.setState({ filterQuery: filter }, this.updateDisplayRows);
    console.log(this.state.filterQuery);
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
        <Row className={'justify-content-start jp-SlurmWidget-row'}>
          <ButtonToolbar>
            <Col md>
              <ToggleButton
                type="checkbox"
                className="jp-SlurmWidget-user-only-checkbox"
                // to fix styling edit this
                variant="outline-light"
                onChange={this.toggleUserOnly.bind(this)}
                checked={this.state.userOnly}
                value="1"
              >
                Display my jobs only
              </ToggleButton>
            </Col>
          </ButtonToolbar>
        </Row>
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
                disabled={this.state.selectedRows.length === 0}
                variant={'outline-secondary'}
                onClick={this.clearSelectedRows.bind(this)}
              >
                <BsArrowCounterclockwise />
                Clear Selections
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
            </Col>
            <Col md>
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
            </Col>
            <Col md>
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
            </Col>
            <Col md>
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
            </Col>
          </ButtonToolbar>
        </Row>
        <Row
          className={
            'justify-content-start jp-SlurmWidget-row jp-SlurmWidget-table-filter-row'
          }
        >
          <ButtonToolbar>
            <Col lg>
              <InputGroup className="jp-SlurmWidget-table-filter-input-group">
                <InputGroup.Prepend>
                  <InputGroup.Text className="jp-SlurmWidget-table-filter-label">
                    <BsFilter />
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
          </ButtonToolbar>
        </Row>
        {this.state.loading && (
          <Row className={'justify-content-center jp-SlurmWidget-row'}>
            <p className={'jp-SlurmWidget-squeue-loading'}>Loading...</p>
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
            sortFunction={this.sortRows}
            striped
            highlightOnHover
            pagination
            selectableRows
            clearSelectedRows={this.state.clearSelected}
            onSelectedRowsChange={this.onSelectedRows.bind(this)}
            noDataComponent={'No jobs currently queued.'}
            paginationPerPage={this.props.itemsPerPage}
            paginationRowsPerPageOptions={this.props.itemsPerPageOptions}
            theme={this.props.theme}
            className={'jp-SlurmWidget-table'}
          />
        </Row>
      </>
    );
  }
}
