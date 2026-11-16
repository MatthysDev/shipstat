/** Series colors are CSS variables, so charts follow the light or dark theme. */
export const color = (i: number) => `var(--s${i % 6})`;
