var nacl_factory = require('js-nacl');
var nacl = nacl_factory.instantiate();
var crypto = require("crypto");

function verify(pubKeyBytes, msgBytes, sigBytes) {
  return nacl.crypto_sign_verify_detached(sigBytes, msgBytes, pubKeyBytes);
}

function sign(privKeyBytes, msgBytes) {
  return nacl.crypto_sign_detached(msgBytes, privKeyBytes);
}

function genKeyPair() {
  var keypair = nacl.crypto_sign_keypair();
  var privKeyBytes = keypair.signSk;
  var pubKeyBytes = keypair.signPk;
  return {privKeyBytes:privKeyBytes, pubKeyBytes:pubKeyBytes};
}

function deriveKeyPair(seed) {
  if (!seed || 0 === seed.length) {
    return null;
  }
  var seedSha256 = crypto.createHash("sha256").update(seed, "utf8").digest();
  var keypair = nacl.crypto_sign_keypair_from_seed(seedSha256);
  var privKeyBytes = keypair.signSk;
  var pubKeyBytes = keypair.signPk;
  return {privKeyBytes:privKeyBytes, pubKeyBytes:pubKeyBytes};
}

module.exports = {
  verify: verify,
  sign: sign,
  genKeyPair: genKeyPair,
  deriveKeyPair: deriveKeyPair,
};

