var async = require("async");
var tmsp = require("js-tmsp");
var types = require("./types");
var crypto = require("./crypto");

var createKeyPair = function(seed) {
  var keys = crypto.deriveKeyPair(seed);
  return keys;
}

var input = function(device, info) {
  var input = new types.Input({
    pubKey:   device.pubKeyBytes,
    latitude: info.latitude,
    longitude: info.longitude,
    temperature: info.temperature
  });
  input._user = device;
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
  // register two devices
  var seed1 = "1"; // use uuid to base64
  var seed2 = "2"; // use uuid to base64
  var status1a = {latitude:37.7938462, longitude:-122.394837, temperature:65};
  var status1b = {latitude:37.7938462, longitude:-122.394837, temperature:70};
  var status2a = {latitude:45.500618, longitude:-73.56778, temperature:65};
  var status2b = {latitude:45.500618, longitude:-73.56778, temperature:70};
  var device1 = createKeyPair(seed1);
  var device2 = createKeyPair(seed2);

  var cli = new tmsp.Client(addr || "tcp://127.0.0.1:46658");

  async.series([
  (cb)=>{ setOption(cli, "register", JSON.stringify({seed:seed1, status:status1a}), cb); },
  (cb)=>{ setOption(cli, "register", JSON.stringify({seed:seed2, status:status2a}), cb); },
  (cb)=>{ appendTx(cli, tx([input(device1, status1b)]), tmsp.CodeType.OK, cb); },
  (cb)=>{ checkTx(cli, tx([input(device1, status1b)]), tmsp.CodeType.OK, cb); },
  (cb)=>{ appendTx(cli, tx([input(device2, status2b)]), tmsp.CodeType.OK, cb); },
  (cb)=>{ checkTx(cli, tx([input(device2, status2b)]), tmsp.CodeType.OK, cb); },
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
