/**
 * The `--name value` / `--name=value` reader shared by the CLI scripts.
 *
 * Accepts both forms: `--email a@b.com` and `--email=a@b.com` return the same thing. Returns
 * `undefined` when the flag is absent or has no value after it.
 *
 * NOTE — this is the reader `createUser.ts` and `setPassword.ts` both carried verbatim. Two other
 * scripts have their own, deliberately NOT folded in here because they are stricter and one guards
 * a destructive operation:
 *   - `setUsername.ts` accepts only the `--name value` form.
 *   - `resetBusinessData.ts` accepts only `--name=value`, and its whole safety model is that you
 *     must type `--confirm=<database name>` exactly. Loosening its parser is a change to a
 *     production guard and is left for a separate, deliberate decision.
 */
export function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  const inline = process.argv.find((a) => a.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]
  return undefined
}
