/** Fügt Klassennamen zusammen und ignoriert falsy-Werte. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
