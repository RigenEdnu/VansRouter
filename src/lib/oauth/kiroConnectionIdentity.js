/**
 * Helper to match Kiro connections by identity without comparing raw tokens.
 */

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

function folded(value) {
  return trimmed(value).toLowerCase();
}

function providerData(connection) {
  const value = connection?.providerSpecificData;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** True when the identity carries something that identifies the ACCOUNT (not the profile). */
function hasAccountIdentifier(identity) {
  return Boolean(folded(identity?.email) || trimmed(identity?.clientId));
}

/** True when a shared field is present on both sides and disagrees — different accounts. */
function contradictsAccount(connection, identity) {
  const email = folded(identity?.email);
  const existingEmail = folded(connection?.email);
  if (email && existingEmail && email !== existingEmail) return true;

  const clientId = trimmed(identity?.clientId);
  const existingClientId = trimmed(providerData(connection).clientId);
  if (clientId && existingClientId && clientId !== existingClientId) return true;

  return false;
}

/**
 * Find an existing Kiro account without comparing OAuth tokens or API keys.
 *
 * @param {Array<object>} connections
 * @param {object} identity
 * @returns {object | null}
 */
export function findKiroConnectionByIdentity(connections, identity) {
  if (!Array.isArray(connections)) return null;

  const authType = folded(identity?.authType);
  const candidates = authType
    ? connections.filter((connection) => folded(connection?.authType) === authType)
    : connections;

  const profileArn = trimmed(identity?.profileArn);
  if (profileArn) {
    const match = candidates.find(
      (connection) => trimmed(providerData(connection).profileArn) === profileArn
    );
    if (match && hasAccountIdentifier(identity) && !contradictsAccount(match, identity)) {
      return match;
    }
  }

  const clientId = trimmed(identity?.clientId);
  if (clientId) {
    const match = candidates.find(
      (connection) => trimmed(providerData(connection).clientId) === clientId
    );
    if (match) return match;
  }

  const email = folded(identity?.email);
  if (email) {
    const match = candidates.find((connection) => folded(connection?.email) === email);
    if (match) return match;
  }

  const name = folded(identity?.name);
  if (name) {
    const match = candidates.find((connection) => folded(connection?.name) === name);
    if (match) return match;
  }

  return null;
}
