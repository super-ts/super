// Le moteur de template (lit-html) est un détail d'implémentation : seuls ces symboles sont publics.
export { nothing } from 'lit-html';
export { repeat } from 'lit-html/directives/repeat.js';
export type { ChildOptions, ErrorDetail, ErrorPhase, LocalState } from './component';
export { html } from './component';
export type { App, AppOptions, ErrorInfo } from './context';
export { CONTEXT_REQUEST, createApp } from './context';
export type {
  AppRouterView,
  AppRoutes,
  Children,
  ContractView,
  ElementClass,
  ElementRef,
  ElementSelectors,
  ElementTypes,
  EmitsIn,
  EventsOf,
  PropsIn,
  PropsOf,
  RouteIn,
  RouterView,
  RouteSelection,
  Screen,
  Selected,
  Selection,
  SelectorValue,
  StoreContractName,
  Unselected,
  ViewOf,
} from './element';
export { SuperElement } from './element';
export type {
  FieldCheck,
  FieldName,
  FieldOption,
  FieldRule,
  FormFailures,
  FormHandle,
  FormList,
  FormListItem,
  FormOptions,
  FormRules,
  ListName,
} from './form';
export type { Page, TitleOptions, TitleValue } from './page';
export type {
  CurrentRoute,
  ErrorScreen,
  GuardResult,
  GuardsFor,
  GuardTools,
  HrefArgs,
  NavigateTargetOf,
  ParamsDescription,
  ParamsOf,
  ParamsSpec,
  PathParams,
  QueryDescription,
  QueryOf,
  QueryParams,
  QuerySpec,
  Redirect,
  RouteAt,
  RouteDeclaration,
  RouteInput,
  RouterCommands,
  RouterDefinition,
  RouterEvents,
  RouterHandle,
  RouterOptions,
  RouteState,
  RouteTable,
  RouteValue,
  ScreenRoutes,
  ScreensDeclaration,
  ScreensFor,
} from './router';
export { createRouter, defineRouter, params, query, RouterOutlet, redirect } from './router';
export type { AppRouteNames, AppRouterContract, AppRouterContractOf, RouteOfTag } from './router-contract';
