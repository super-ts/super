import { html, SuperElement } from '@super-ts/dom';
import { hotReplace } from '@super-ts/dom/internal';
import { flush, mount } from '@super-ts/testing';
import { describe, expect, test, vi } from 'vitest';

/** Deux versions d'un même composant, comme après la modification de son module. */
function versions(tag: string) {
  class V1 extends SuperElement {
    static tag = tag;
    local = this.state({ clicks: 0 });
    render() {
      return html`<button @click=${() => this.local.set((s) => ({ clicks: s.clicks + 1 }))}>v1 ${this.local.get().clicks}</button>`;
    }
  }
  class V2 extends SuperElement {
    static tag = tag;
    local = this.state({ clicks: 0 });
    render() {
      return html`<button @click=${() => this.local.set((s) => ({ clicks: s.clicks + 10 }))}>v2 ${this.local.get().clicks}</button>`;
    }
  }
  return { V1, V2 };
}

describe('remplacement à chaud', () => {
  test('les nouvelles méthodes s’appliquent aux éléments affichés, qui gardent leur état', async () => {
    const { V1, V2 } = versions('hot-methods');
    const { container } = await mount(V1);
    container.querySelector('button')!.click();
    await flush();
    expect(container.textContent).toContain('v1 1');

    const reload = vi.fn();
    hotReplace([V2], { reload });
    await flush();
    expect(reload).not.toHaveBeenCalled();
    expect(container.textContent).toContain('v2 1'); // nouveau render, même état

    container.querySelector('button')!.click();
    await flush();
    expect(container.textContent).toContain('v2 11'); // nouveau gestionnaire
    expect(V2.create()).toBeInstanceOf(V2); // les créations suivantes utilisent la nouvelle version
    // Un parent non rechargé tient encore V1 : il obtient quand même la nouvelle version.
    expect(V1.create()).toBeInstanceOf(V2);
  });

  test('des champs changés : rechargement complet', async () => {
    const { V1 } = versions('hot-fields');
    class V2 extends SuperElement {
      static tag = 'hot-fields';
      local = this.state({ clicks: 0 });
      label = this.state({ text: 'nouveau champ' });
      render() {
        return html`<p>${this.label.get().text}</p>`;
      }
    }
    await mount(V1);
    const reload = vi.fn();
    hotReplace([V2], { reload });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('un handler en champ fléché modifié : rechargement complet', async () => {
    class V1 extends SuperElement {
      static tag = 'hot-arrow';
      onClick = () => 1;
      render() {
        return html`<p></p>`;
      }
    }
    class V2 extends SuperElement {
      static tag = 'hot-arrow';
      onClick = () => 2;
      render() {
        return html`<p></p>`;
      }
    }
    await mount(V1);
    const reload = vi.fn();
    hotReplace([V2], { reload });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('des champs #privés : rechargement complet', async () => {
    const { V1, V2 } = versions('hot-private');
    await mount(V1);
    const reload = vi.fn();
    hotReplace([V2], { privateFields: true, reload });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('hors remplacement à chaud, deux classes pour un même tag restent une erreur', () => {
    const { V1, V2 } = versions('hot-duplicate');
    V1.create();
    expect(() => V2.create()).toThrow('déjà utilisé par un autre composant');
  });
});
