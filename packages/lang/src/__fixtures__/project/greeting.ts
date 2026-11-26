import { html, SuperElement } from '@super-ts/dom';

type Props = { name: string };
type Emits = { closed: { reason: string } };

/** A child component written in .ts, used from the .super files. */
export class Greeting extends SuperElement<{ props: Props; emits: Emits }> {
  static tag = 'lang-greeting';

  render() {
    return html`<p>Hello ${this.props.name}</p>`;
  }
}
