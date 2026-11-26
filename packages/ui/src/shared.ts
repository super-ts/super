/** Joint des classes CSS, en ignorant les vides : `classes('super-button', variant && 'is-x', props.class)`. */
export const classes = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

let nextId = 0;
/** Un identifiant unique dans la page, pour relier un champ à son libellé ou à son erreur. */
export const uniqueId = (prefix: string) => `${prefix}-${++nextId}`;
