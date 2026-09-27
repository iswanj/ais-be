export function parseDatabaseUrl(value: string | undefined): string {
  const urlValue = value?.trim();
  if (!urlValue) throw new Error('DATABASE_URL is required');

  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }
  return urlValue;
}
