import React, { Component } from 'react';
import {
  Table,
  ButtonToolbar,
  Button,
  ButtonProps,
 } from 'react-bootstrap';
import { range } from 'lodash/fp';
// Local
import Select from './Select';
import Pager from './Pager';

namespace types {
  export type button = {
    name?: string;
    props?: ButtonProps;
    action: 'reload' | 'clear-selected' | ((rows: string[][]) => void);
  };

  export type Props = {
    getRows: () => Promise<string[][]>;
    availableColumns: string[];
    defaultColumns?: string[];
    buttons?: button[];
  };

  export type State = {
    rows: string[][];
    focusedRowIdx: number;
    selectedRowIdxs: number[];
    displayedColumns: string[];
    itemsPerPage: number;
    currentPage: number;
    filterQuery: '';
  };
}

export default class DataTable extends Component<types.Props, types.State> {
  constructor(props: types.Props) {
    super(props);
    this.state = {
      rows: [],
      focusedRowIdx: -1,
      selectedRowIdxs: [],
      displayedColumns: props.defaultColumns ? props.defaultColumns : props.availableColumns,
      itemsPerPage: 10, // make this prop dependent
      currentPage: 0,
      filterQuery: '',
    };
  }

  changeItemsPerPage(value: string) {
    this.setState({ itemsPerPage: parseInt(value) });
    this.clearSelectedRows();
  }

  changePage(value: number) {
    this.setState({ currentPage: value });
    this.clearSelectedRows();
  }

  clearSelectedRows() {
    this.setState({ focusedRowIdx: -1, selectedRowIdxs: [] });
  }

  selectRow(rowIdx: number, event: React.MouseEvent<HTMLTableRowElement, MouseEvent>) {
    event.stopPropagation();
    let { focusedRowIdx, selectedRowIdxs } = this.state;
    if (focusedRowIdx) {
      if (event.shiftKey) {
        const [start, end] = [focusedRowIdx, rowIdx].sort();
        selectedRowIdxs = range(start, end + 1);
      }
      else if (event.ctrlKey || event.metaKey) {
        const selectionIdx = selectedRowIdxs.indexOf(rowIdx);
        if (selectionIdx) { // The row was already selected
          let i = 1;
          while (selectedRowIdxs[selectionIdx - i] === rowIdx - i) {
            i++;
          }
          if (i === 1) { // The rowIdx is the beginning of a contiguous selection
            // Focus in-block, if possible
            if (selectedRowIdxs[selectionIdx + 1] === rowIdx + 1) {
              focusedRowIdx = rowIdx + 1;
            }
            else { // Focus the beginning of the previous block
              const prevBlockEndIdx = selectionIdx - 1;
              if (selectedRowIdxs[prevBlockEndIdx] === undefined) {
                focusedRowIdx = -1;
              }
              else {
                while (selectedRowIdxs[prevBlockEndIdx - i] === selectedRowIdxs[prevBlockEndIdx] - i) {
                  i++;
                }
                const candidateRow = selectedRowIdxs[prevBlockEndIdx] - i + 1;
                focusedRowIdx = candidateRow ? candidateRow : -1;
              }
            }
          }
          else { // Focus beginning of contiguous block containing rowIdx
            focusedRowIdx = rowIdx - i + 1;
          }
          selectedRowIdxs = selectedRowIdxs.filter(r => r !== rowIdx);
        }
        else { // The row was not selected
          focusedRowIdx = rowIdx;
          selectedRowIdxs = selectedRowIdxs.concat([rowIdx]).sort();
        }
      }
    }
    else {
      focusedRowIdx = rowIdx;
      selectedRowIdxs = [rowIdx];
    }
    this.setState({ focusedRowIdx, selectedRowIdxs });
  }

  async reload() {
    const { getRows } = this.props;
    const rows = await getRows();
    this.setState({ rows });
  }

  componentDidMount() {
    this.reload();
  }

  render() {
    const {
      rows,
      displayedColumns,
      itemsPerPage,
      currentPage,
      selectedRowIdxs,
      // filterQuery,
    } = this.state;
    const numPages = Math.ceil(rows.length / itemsPerPage);
    const currentSliceStart = (currentPage - 1) * itemsPerPage;
    const currentSliceEnd = currentSliceStart + itemsPerPage;
    const currentRows = rows.slice(currentSliceStart, currentSliceEnd);
    const selectedRows = selectedRowIdxs.map(r => rows[r]);
    const { buttons } = this.props;
    return (
      <div>
        {buttons && <ButtonToolbar>
          {(buttons).map(button => {
            switch(button.action) {
              case 'reload':
                return <Button {...button.props}
                         onClick={this.reload.bind(this)}>
                           {button.name ? button.name : 'Reload'}
                       </Button>
              case 'clear-selected':
                return <Button {...button.props}
                         disabled={!!selectedRowIdxs.length}
                         onClick={this.clearSelectedRows.bind(this)}>
                           {button.name ? button.name : 'Clear Selection'}
                       </Button>
              default:
                return <Button {...button.props}
                         disabled={!!selectedRowIdxs.length}
                         onClick={(e) => { (button.action as any)(selectedRows); }}>
                           {button.name}
                       </Button>
            }
          })}
        </ButtonToolbar>}
        <Table striped bordered hover>
          <thead>
            <tr>
              {displayedColumns.map(header =>
                <th key={header}>{header}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {currentRows.map((row, rowIdx) =>
              <tr onClick={this.selectRow.bind(this, rowIdx)} key={`${rowIdx}`}>
                {row.map((field, fieldIdx) =>
                  <td key={`${rowIdx}-${fieldIdx}`}>{field}</td>
                )}
              </tr>
            )}
          </tbody>
        </Table>
        <Select options={['10', '25', '50', '100']} onChange={this.changeItemsPerPage.bind(this)} />
        <Pager numPages={numPages} onChange={this.changePage.bind(this)}/>
      </div>
    );
  }
}
