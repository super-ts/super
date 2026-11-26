/** Joins CSS classes, ignoring empty ones: `classes('super-button', variant && 'is-x', props.class)`. */
export const classes = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

let nextId = 0;
/** A unique id in the page, to link a field to its label or its error. */
export const uniqueId = (prefix: string) => `${prefix}-${++nextId}`;
