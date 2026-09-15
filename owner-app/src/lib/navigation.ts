// Full-page navigation to another site, for example the platform login that
// Postiz returns. Kept in one place so screens can be tested without a browser.
export function openExternal(url: string): void {
  location.assign(url);
}
