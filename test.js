var async = require("async");
var tmsp = require("js-tmsp");
var types = require("./types");
var crypto = require("./crypto");

function getDevice(seed) {
  var device = crypto.deriveKeyPair(seed);
  device.sequence = 0;
  return device;
}

function input(device, info) {
  var input = new types.Input({
    pubKey:   device.pubKeyBytes,
    sequence: device.sequence,
    latitude: info.latitude,
    longitude: info.longitude,
    temperature: info.temperature
  });
  input._user = device;
  return input;
}

function tx(inputs) {
  var tx = new types.Tx({
     inputs: inputs
  });
  var signBytes = tx.encode().toBuffer();
  //console.log(">>", signBytes);
  tx.inputs.forEach((input) => {
    input.signature = crypto.sign(input._user.privKeyBytes, signBytes);
  });
  return tx;
}

function setOption(cli, key, value, cb) {
  cli.setOption(key, value, ()=>{
    cb();});
  cli.flush();
}

function appendTx(cli, tx, code, cb) {
  cli.appendTx(tx.encode().toBuffer(), (res) => {
    if (res.code !== code) {
      console.log("tx got unexpected code! Wanted "+code+" but got "+res.code+". log: "+res.log);
    }
    if (res.code === tmsp.CodeType.OK) {
      tx.inputs.forEach((input) => {
        input._user.sequence++;
      });
    }
    cb();
  });
  cli.flush();
}

function checkTx(cli, tx, code, cb) {
  cli.checkTx(tx.encode().toBuffer(), (res) => {
    if (res.code !== code) {
      console.log("tx got unexpected code! Wanted "+code+" but got "+res.code+". log: "+res.log);
    }
    cb();
  });
  cli.flush();
}

var program = require('commander');
program
  .option('-a, --addr [tcp://host:port|unix://path]', 'Listen address (default tcp://127.0.0.1:46658)')
  .parse(process.argv);

var cli = new tmsp.Client(program.addr || "tcp://127.0.0.1:46658");

// actual tests here
var seed1 = "1"; // use uuid to base64
var seed2 = "2"; // use uuid to base64
var status1a = {latitude:37.7938462, longitude:-122.394837, temperature:65};
var status1b = {latitude:37.7938462, longitude:-122.394837, temperature:70};
var status2a = {latitude:45.500618, longitude:-73.56778, temperature:65};
var status2b = {latitude:45.500618, longitude:-73.56778, temperature:70};
var device1 = getDevice(seed1);
var device2 = getDevice(seed2);

async.series([
(cb)=>{ setOption(cli, "init", JSON.stringify({seed:seed1, status:status1a}), cb); },
(cb)=>{ setOption(cli, "init", JSON.stringify({seed:seed2, status:status2a}), cb); },
(cb)=>{ appendTx(cli, tx([input(device1, status1b)]), tmsp.CodeType.OK, cb); },
(cb)=>{ checkTx(cli, tx([input(device1, status1b)]), tmsp.CodeType.OK, cb); },
(cb)=>{ appendTx(cli, tx([input(device2, status2b)]), tmsp.CodeType.OK, cb); },
(cb)=>{
  // after all tests have run
  console.log("Test done!");
  cli.close();
  cb();
}]);
