import React, { Component, ReactNode } from 'react';
import { Pagination } from 'react-bootstrap';

namespace types {
  export type Props = {
    numPages: number;
    onChange?: (numPages: number) => void;
  };

  export type State = {
    currentPage: number;
  };
}

export default class Pager extends Component<types.Props, types.State> {
  constructor(props: types.Props) {
    super(props);
    this.state = {
      currentPage: 1
    };
  }

  handlePageChange(page: number): void {
    this.setState({ currentPage: page });
    if (this.props.onChange) {
      this.props.onChange(page);
    }
  }

  render(): ReactNode {
    const { numPages } = this.props;
    const { currentPage } = this.state;
    const startPage = Math.floor((currentPage - 1) / 5) * 5 + 1;
    const range = [
      startPage,
      startPage + 1,
      startPage + 2,
      startPage + 3,
      startPage + 4
    ].filter(page => page >= 1 && page <= numPages);
    const showFirstPageShortcut = range.indexOf(1) < 0;
    const showLastPageShortcut = range.indexOf(numPages) < 0;
    return (
      <Pagination>
        {numPages > 1 && (
          <Pagination.Prev
            onClick={this.handlePageChange.bind(this, currentPage - 1)}
          />
        )}
        {showFirstPageShortcut && (
          <Pagination.Item onClick={this.handlePageChange.bind(this, 1)}>
            {1}
          </Pagination.Item>
        )}
        {showFirstPageShortcut && <Pagination.Ellipsis />}
        {range.map((page, index) =>
          page === currentPage ? (
            <Pagination.Item active key={`page-${index}`}>
              {currentPage}
            </Pagination.Item>
          ) : (
            <Pagination.Item
              onClick={this.handlePageChange.bind(this, page)}
              key={`page-${index}`}
            >
              {page}
            </Pagination.Item>
          )
        )}
        {showLastPageShortcut && <Pagination.Ellipsis />}
        {showLastPageShortcut && (
          <Pagination.Item onClick={this.handlePageChange.bind(this, numPages)}>
            {numPages}
          </Pagination.Item>
        )}
        {numPages > 1 && (
          <Pagination.Next
            onClick={this.handlePageChange.bind(this, currentPage + 1)}
          />
        )}
      </Pagination>
    );
  }
}
