import { html, SuperElement } from '@super-ts/dom';

type Props = { name: string };
type Emits = { closed: { reason: string } };

/** Un composant enfant écrit en .ts, utilisé depuis les fichiers .super. */
export class Greeting extends SuperElement<{ props: Props; emits: Emits }> {
  static tag = 'lang-greeting';

  render() {
    return html`<p>Bonjour ${this.props.name}</p>`;
  }
}
