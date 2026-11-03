const refusal =
  'Fixture loading requires a plain postgres:// or postgresql:// URL with ' +
  'hostname localhost or 127.0.0.1, without query parameters or a fragment.'

/**
 * Fixture loading deliberately accepts a narrower URL form than postgres.js.
 * Its query options can override startup user/database values, and its
 * multihost parser does not share all of WHATWG URL's authority semantics.
 * Reject those forms before constructing a client. A loopback endpoint can
 * still contain valuable data: the caller must choose a disposable database.
 */
export function assertLocalFixtureTarget(connectionString) {
  try {
    if (
      typeof connectionString !== 'string' ||
      !/^postgres(?:ql)?:\/\//i.test(connectionString) ||
      /[\u0000-\u0020\u007f?#]/.test(connectionString)
    ) {
      throw new Error(refusal)
    }

    const target = new URL(connectionString)
    if (
      !['postgres:', 'postgresql:'].includes(target.protocol) ||
      !['localhost', '127.0.0.1'].includes(target.hostname.toLowerCase()) ||
      (target.port && Number(target.port) === 0)
    ) {
      throw new Error(refusal)
    }

    const authority = connectionString.split('://')[1].split('/')[0]
    if ((authority.match(/@/g) ?? []).length > 1) {
      throw new Error(refusal)
    }

    // postgres.js decodes credentials itself. Reject malformed escapes here,
    // so its parser cannot throw an error containing the original URL later.
    decodeURIComponent(target.username)
    decodeURIComponent(target.password)
    decodeURIComponent(target.pathname)
  } catch {
    // Never include the URL or a parser exception: either can expose secrets.
    throw new Error(refusal)
  }

  return connectionString
}
