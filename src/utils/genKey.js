const crypto = require("crypto");

const generate_key = (n) => {
  if (n === undefined) {
    n = 256;
  }

  const numBytes = n / 8;
  if (!Number.isInteger(numBytes)) {
    throw new Error("n must be a multiple of 8");
  }

  return crypto.randomBytes(numBytes).toString("hex");
};

module.exports = {
  generate_key,
};

