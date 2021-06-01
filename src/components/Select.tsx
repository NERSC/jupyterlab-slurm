// Note: React-bootstrap provices a similar component, consider dropping this
import React from 'react';

namespace types {
  export type Props = {
    options: string[];
    onChange?: (option: string) => void;
  };

  export type State = {
    value: string;
  };
}

export default class Select extends React.Component<types.Props, types.State> {
  constructor(props: types.Props) {
    super(props);
    this.state = { value: this.props.options[0] };
  }

  handleChange(event: React.ChangeEvent<HTMLSelectElement>): void {
    const value = event.currentTarget.value;
    this.setState({ value });
    if (this.props.onChange) {
      this.props.onChange(value);
    }
  }

  render(): React.ReactNode {
    return (
      <div>
        <select value={this.state.value} onChange={this.handleChange}>
          {this.props.options.map(o => (
            <option value={o} key={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }
}
