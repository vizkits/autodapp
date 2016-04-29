var async = require("async");
var tmsp = require("js-tmsp");
var types = require("./types");
var crypto = require("./crypto");

var createKeyPair = function(seed) {
  var keys = crypto.deriveKeyPair(seed);
  return keys;
}

var input = function(user, info) {
  var input = new types.Input({
    pubKey:   user.pubKeyBytes,
    name: info.name,
    email: info.email
  });
  input._user = user;
  return input;
}

var tx = function(inputs) {
  var tx = new types.Tx({
     inputs: inputs
  });
  var signBytes = tx.encode().toBuffer();
  tx.inputs.forEach((input) => {
    input.signature = crypto.sign(input._user.privKeyBytes, signBytes);
  });
  return tx;
}

var setOption = function(cli, key, value, cb) {
  cli.setOption(key, value, ()=>{
    cb();});
  cli.flush();
}

var appendTx = function(cli, tx, code, cb) {
  cli.appendTx(tx.encode().toBuffer(), (res) => {
    if (res.code !== code) {
      console.log("tx got unexpected code! Wanted "+code+" but got "+res.code+". log: "+res.log);
    }
    cb();
  });
  cli.flush();
}

var checkTx = function(cli, tx, code, cb) {
  cli.checkTx(tx.encode().toBuffer(), (res) => {
    if (res.code !== code) {
      console.log("tx got unexpected code! Wanted "+code+" but got "+res.code+". log: "+res.log);
    }
    cb();
  });
  cli.flush();
}

var runTest = function(addr) {
  // init two users
  var seed1 = "1"; // use uuid to base64
  var seed2 = "2"; // use uuid to base64
  var status1 = {name:'alex', email:'alex@bbb.com'};
  var status2 = {name:'eric', email:'eric@ccc.com'};
  var user1 = createKeyPair(seed1);
  var user2 = createKeyPair(seed2);

  var cli = new tmsp.Client(addr || "tcp://127.0.0.1:46658");

  async.series([
  (cb)=>{ setOption(cli, "register", JSON.stringify({seed:seed1, status:status1}), cb); },
  (cb)=>{ setOption(cli, "register", JSON.stringify({seed:seed2, status:status2}), cb); },
  (cb)=>{ appendTx(cli, tx([input(user1, status1)]), tmsp.CodeType.OK, cb); },
  (cb)=>{ checkTx(cli, tx([input(user1, status1)]), tmsp.CodeType.OK, cb); },
  (cb)=>{ appendTx(cli, tx([input(user2, status2)]), tmsp.CodeType.OK, cb); },
  (cb)=>{ checkTx(cli, tx([input(user2, status2)]), tmsp.CodeType.OK, cb); },
  (cb)=>{
    // after all tests have run
    console.log("Init test done!");
    cli.close();
    cb();
  }]);
}

module.exports = {
  createKeyPair: createKeyPair,
  input: input,
  tx: tx,
  runTest: runTest,
};
