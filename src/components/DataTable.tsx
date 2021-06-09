import React, { Component, ReactNode } from 'react';
import { Button, ButtonProps, ButtonToolbar, Table } from 'react-bootstrap';
import { range } from 'lodash/fp';
// Local
import Pager from './Pager';
import Select from './Select';
import { requestAPI } from '../handler';

namespace types {
  export type button = {
    name?: string;
    id: string;
    props?: ButtonProps;
    action: 'reload' | 'clear-selected' | ((rows: string[][]) => void);
  };

  export type Props = {
    availableColumns: string[];
    defaultColumns?: string[];
    buttons?: button[];
    userOnly: boolean;
    processing: boolean;
    reloading: boolean;
    userSubmit: boolean;
  };

  export type State = {
    rows: string[][];
    focusedRowIdx: number;
    selectedRowIdxs: number[];
    displayedColumns: string[];
    itemsPerPage: number;
    currentPage: number;
    filterQuery: '';
    userSubmit: boolean;
  };
}

export default class DataTable extends Component<types.Props, types.State> {
  constructor(props: types.Props) {
    super(props);
    this.state = {
      rows: [],
      focusedRowIdx: -1,
      selectedRowIdxs: [],
      displayedColumns: props.defaultColumns
        ? props.defaultColumns
        : props.availableColumns,
      itemsPerPage: 10, // make this prop dependent
      currentPage: 1,
      filterQuery: '',
      userSubmit: props.userSubmit
    };
  }

  changeItemsPerPage(value: string): void {
    console.log('changeItemsPerPage: ', value);
    this.setState({ currentPage: 1, itemsPerPage: parseInt(value) });
    //this.clearSelectedRows();
  }

  changePage(value: number): void {
    this.setState({ currentPage: value });
    //this.clearSelectedRows();
  }

  clearSelectedRows(): void {
    this.setState({ focusedRowIdx: -1, selectedRowIdxs: [] });
  }

  selectRow(
    rowIdx: number,
    event: React.MouseEvent<HTMLTableRowElement, MouseEvent>
  ): void {
    event.stopPropagation();

    console.log('selectRow() : ', rowIdx);

    if (this.props.processing) {
      return;
    }
    let focusedRowIdx = this.state.focusedRowIdx;
    let selectedRowIdxs = this.state.selectedRowIdxs;

    console.log('selectRow(): this.state ', focusedRowIdx, selectedRowIdxs);

    console.log(focusedRowIdx !== -1);
    if (focusedRowIdx === -1) {
      // first row selected or previously cleared
      focusedRowIdx = rowIdx;
      selectedRowIdxs = [rowIdx];
    } else {
      console.log('selectRow(): event ', event);
      if (event.shiftKey) {
        // shift adds contiguous selected rows
        console.log('event shift key');

        const [start, end] = [focusedRowIdx, rowIdx].sort();
        selectedRowIdxs = range(start, end + 1).reverse();
      } else if (event.ctrlKey || event.metaKey) {
        // ctrl or meta (cmd for mac) deselect rows
        console.log('event ctrl or meta', event.ctrlKey, event.metaKey);
        const selectionIdx = selectedRowIdxs.indexOf(rowIdx);
        if (selectionIdx) {
          // The row was already selected
          let i = 1;
          while (selectedRowIdxs[selectionIdx - i] === rowIdx - i) {
            i++;
          }
          if (i === 1) {
            // The rowIdx is the beginning of a contiguous selection
            // Focus in-block, if possible
            if (selectedRowIdxs[selectionIdx + 1] === rowIdx + 1) {
              focusedRowIdx = rowIdx + 1;
            } else {
              // Focus the beginning of the previous block
              const prevBlockEndIdx = selectionIdx - 1;
              if (selectedRowIdxs[prevBlockEndIdx] === undefined) {
                focusedRowIdx = -1;
              } else {
                while (
                  selectedRowIdxs[prevBlockEndIdx - i] ===
                  selectedRowIdxs[prevBlockEndIdx] - i
                ) {
                  i++;
                }
                const candidateRow = selectedRowIdxs[prevBlockEndIdx] - i + 1;
                focusedRowIdx = candidateRow ? candidateRow : -1;
              }
            }
          } else {
            // Focus beginning of contiguous block containing rowIdx
            focusedRowIdx = rowIdx - i + 1;
          }
          selectedRowIdxs = selectedRowIdxs.filter(r => r !== rowIdx);
        } else {
          // The row was not selected
          focusedRowIdx = rowIdx;
          selectedRowIdxs = selectedRowIdxs.concat([rowIdx]).sort().reverse();
        }
      } else {
        // click event - select if not already selected, otherwise deselect
        focusedRowIdx = rowIdx;

        const found = selectedRowIdxs.indexOf(rowIdx);
        console.log(
          'found, selectedRowIdxs.length',
          found,
          selectedRowIdxs.length
        );
        if (found > -1) {
          // deselect, remove row
          if (selectedRowIdxs.length > 1) {
            if (found === 0) {
              selectedRowIdxs = selectedRowIdxs.slice(
                1,
                selectedRowIdxs.length
              );
            } else if (found === selectedRowIdxs.length - 1) {
              selectedRowIdxs = selectedRowIdxs.slice(
                0,
                selectedRowIdxs.length - 1
              );
            } else {
              const left = selectedRowIdxs.slice(0, found);
              const right = selectedRowIdxs.slice(
                found + 1,
                selectedRowIdxs.length
              );
              selectedRowIdxs = left.concat(right);
              console.log('cutting row from middle', left, right);
            }
          } else {
            // last row, reset selections
            focusedRowIdx = -1;
            selectedRowIdxs = [];
          }
        } else {
          // new select, add row
          selectedRowIdxs.push(rowIdx);
          selectedRowIdxs = selectedRowIdxs.sort().reverse();
        }
      }
    }

    console.log(
      'focusedRowIdx, selectedRowIdx',
      focusedRowIdx,
      selectedRowIdxs
    );
    this.setState({
      focusedRowIdx: focusedRowIdx,
      selectedRowIdxs: selectedRowIdxs
    });
  }

  async getData(): Promise<string[][]> {
    const { userOnly } = this.props;
    const squeueParams = new URLSearchParams(`userOnly=${userOnly}`);

    return await requestAPI<any>('squeue', squeueParams)
      .then(data => {
        console.log('DataTable getData() squeue', squeueParams, data);
        return data.data;
      })
      .catch(error => {
        console.error('DataTable getData() error', error);
        return null;
      });
  }

  async reload(): Promise<void> {
    const rows = await this.getData();
    console.log('reload()', rows);

    this.setState({
      currentPage: 1,
      displayedColumns: [],
      filterQuery: '',
      itemsPerPage: 10,
      rows: rows || [],
      focusedRowIdx: -1,
      selectedRowIdxs: [],
      userSubmit: false
    });
  }

  componentWillMount(): void {
    this.reload();
  }

  async componentDidUpdate(prevProps: types.Props): Promise<void> {
    console.log(
      'componentDidUpdate()',
      prevProps.userSubmit,
      this.props.userSubmit,
      this.state.userSubmit
    );
    // whenever a user submits a job action (submit, cancel, hold, release), reload the squeue table view
    if (prevProps.userSubmit !== this.props.userSubmit) {
      if (this.state.userSubmit !== this.props.userSubmit) {
        this.setState({ userSubmit: this.props.userSubmit }, () => {
          if (this.state.userSubmit) {
            console.log('componentDidUpdate() reloading...');
            this.reload();
          }
        });
      }
    }
  }

  render(): ReactNode {
    const numPages = Math.ceil(
      this.state.rows.length / this.state.itemsPerPage
    );
    const currentSliceStart =
      (this.state.currentPage - 1) * this.state.itemsPerPage;
    const currentSliceEnd = currentSliceStart + this.state.itemsPerPage;
    const currentRows = this.state.rows.slice(
      currentSliceStart,
      currentSliceEnd
    );
    const selectedRows = this.state.selectedRowIdxs.map(
      r => this.state.rows[r]
    );
    const { buttons } = this.props;
    console.log({
      rows: this.state.rows,
      rows_length: this.state.rows.length,
      numPages: numPages,
      currentSliceStart: currentSliceStart,
      currentSliceEnd: currentSliceEnd,
      currentPage: this.state.currentPage,
      itemsPerPage: this.state.itemsPerPage,
      selectedRowIdxs: this.state.selectedRowIdxs,
      currentRows: currentRows,
      selectedRows: selectedRows
    });
    return (
      <div>
        {buttons && (
          <ButtonToolbar>
            {buttons.map((button, idx) => {
              switch (button.id) {
                case 'reload':
                  return (
                    <Button
                      {...button.props}
                      onClick={this.reload.bind(this)}
                      key={idx}
                    >
                      {button.name ? button.name : 'Reload'}
                    </Button>
                  );
                case 'clear-selected':
                  return (
                    <Button
                      {...button.props}
                      disabled={this.state.selectedRowIdxs.length === 0}
                      onClick={this.clearSelectedRows.bind(this)}
                      key={idx}
                    >
                      {button.name ? button.name : 'Clear Selection'}
                    </Button>
                  );
                case 'submit-job':
                  return (
                    <Button
                      {...button.props}
                      onClick={() => (button.action as any)(selectedRows)}
                      key={idx}
                    >
                      {button.name ? button.name : 'Submit Job'}
                    </Button>
                  );
                default:
                  return (
                    <Button
                      {...button.props}
                      disabled={this.state.selectedRowIdxs.length === 0}
                      onClick={e => {
                        (button.action as any)(selectedRows);
                      }}
                      key={idx}
                    >
                      {button.name}
                    </Button>
                  );
              }
            })}
          </ButtonToolbar>
        )}
        {this.state.rows && this.state.rows.length > 0 && (
          <div>
            <Table striped bordered hover className="dataTable">
              <thead>
                <tr>
                  {this.state.displayedColumns.map(header => (
                    <th key={header}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentRows.map((row, rowIdx) => {
                  let selectedComposition = '';
                  let selected = false;
                  if (this.state.selectedRowIdxs.length) {
                    selectedComposition = this.state.selectedRowIdxs.includes(
                      rowIdx
                    )
                      ? 'selected'
                      : 'unselected';
                    selected = this.state.selectedRowIdxs.includes(rowIdx);
                  } else {
                    selectedComposition =
                      this.state.focusedRowIdx === rowIdx ? 'selected' : '';
                    selected = this.state.focusedRowIdx === rowIdx;
                  }
                  if (selected && this.props.processing) {
                    selectedComposition += ' processing';
                  }
                  return (
                    <tr
                      onClick={this.selectRow.bind(this, rowIdx)}
                      key={`${rowIdx}`}
                      className={selectedComposition}
                    >
                      {row.map((field, fieldIdx) => (
                        <td key={`${rowIdx}-${fieldIdx}`}>{field}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Select
              options={['10', '25', '50', '100']}
              onChange={this.changeItemsPerPage.bind(this)}
            />
            <Pager numPages={numPages} onChange={this.changePage.bind(this)} />
          </div>
        )}
        {!this.state.rows ||
          (this.state.rows.length === 0 && <h1>No currently running jobs.</h1>)}
      </div>
    );
  }
}
