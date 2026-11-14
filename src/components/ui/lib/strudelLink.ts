/** Kodiert Text als Base64 (UTF-8-sicher, ohne Stack-Overflow bei langem Code). */
export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Link, der den Code direkt in der Strudel-REPL öffnet. */
export function strudelUrl(code: string): string {
  return `https://strudel.cc/#${encodeURIComponent(base64Utf8(code))}`;
}
