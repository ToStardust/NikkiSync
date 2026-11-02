// Match encoded key bodies, not explanatory markers or deliberately invalid
// startup-error fixtures. Escaped PEM in source/JSON is equally sensitive.
export function containsSourceSecret(text) {
  const pemText = text.replace(/\\r\\n|\\n|\\r/g, '\n');
  const privateKey = /-----BEGIN ((?:[A-Z0-9]+ )?PRIVATE KEY)-----[\r\n]+[A-Za-z0-9+/=\r\n]{32,}-----END \1-----/;
  return privateKey.test(pemText)
    || /\bgh[pousr]_[A-Za-z0-9]{25,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/.test(text);
}
