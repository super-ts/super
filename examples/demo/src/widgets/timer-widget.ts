import { createApp } from '@super-ts/dom';
import { TimerWidget } from '@components/widget/timer-widget';
import { TimerStore } from '@core/timer/store';

/**
 * User-land: mounts the timer in its own application, with its own store, on the given element.
 * Returns what is needed to release everything: the application (which empties the element) and the store.
 * The nearest application answers components: the timer finds its store here.
 */
export function mountTimerWidget(root: HTMLElement): () => void {
  const timer = TimerStore.create();
  const app = createApp({ root, stores: [timer] });
  app.mount(TimerWidget.create());
  return () => {
    app.dispose();
    timer.dispose();
  };
}
