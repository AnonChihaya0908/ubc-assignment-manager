const crypto = require('node:crypto');

function authorizedNativeRequest(expectedToken, suppliedToken) {
  if (!expectedToken) return true;
  if (typeof suppliedToken !== 'string') return false;
  const expected = Buffer.from(expectedToken);
  const supplied = Buffer.from(suppliedToken);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

module.exports = { authorizedNativeRequest };
