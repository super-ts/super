import { createApp } from '@super-ts/dom';
import { TimerWidget } from '@components/widget/timer-widget';
import { TimerStore } from '@core/timer/store';

/**
 * User-land : monte le minuteur dans sa propre application, avec son propre store, sur l'élément
 * donné. Retourne de quoi tout libérer : l'application (qui vide l'élément) et le store.
 * L'application la plus proche répond aux composants : le minuteur trouve son store ici.
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
