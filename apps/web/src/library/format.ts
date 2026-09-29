const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/** An ISO-8601 timestamp of the API as a short date in the user's locale. */
export function formatDate(timestamp: string): string {
  return DATE_FORMAT.format(new Date(timestamp));
}
