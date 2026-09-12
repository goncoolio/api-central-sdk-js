// =============================================================================
// Lecture des jetons JWT émis par l'API
// =============================================================================

/**
 * Lit l'identifiant utilisateur (claim `user_id`) d'un jeton utilisateur API
 * Central.
 *
 * La signature n'est pas vérifiée : le serveur reste seul juge de la validité
 * du jeton, le SDK ne fait que savoir « qui » il représente. Renvoie `null`
 * pour un jeton d'application (sans `user_id`) ou illisible.
 */
export function readUserIdFromToken(token: string): string | null {
  const userId = decodeJwtPayload(token)?.['user_id'];
  return typeof userId === 'string' && userId.length > 0 ? userId : null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segment = token.split('.')[1];
  if (!segment) return null;

  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : null;
  } catch {
    // Jeton illisible : ce n'est pas un jeton utilisateur exploitable.
    return null;
  }
}
