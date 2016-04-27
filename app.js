var async = require("async");
var util = require("util");
var wire = require("js-wire");
var tmsp = require("js-tmsp");
var merkle = require("js-merkleeyes");
var types = require("./types");
var crypto = require("./crypto");
var test = require("./test");

var express = require('express');
var bodyParser = require('body-parser');

var version = "0.0.1";

var AutoDapp = function(merkleClient) {
  this.merkleClient = merkleClient;
};

AutoDapp.prototype.info = function(req, cb) {
  return cb({data: "Auto Dapp v" + version});
};

AutoDapp.prototype.setOption = function(req, cb) {
  console.log('autodapp: set option');
  if (req.key === "init") {
    var opts = JSON.parse(req.value);
    var seed = opts.seed;
    var lat = opts.status.latitude;
    var lng = opts.status.longitude;
    var temp = opts.status.temperature;
    var pair = crypto.deriveKeyPair(seed);
    this.merkleClient.set(
      pair.pubKeyBytes,
      new types.Device({latitude:lat, longitude:lng, temperature:temp}).encode().toBuffer(),
      (res) => {
        var logMsg = "Device " + seed + " gps coordinate = ("+ lat + ", " + lng + "), temperature = " + temp;
        console.log(logMsg);
        cb({log:logMsg});
      }
    );
  } else {
    return cb({log:"Unrecognized option key "+req.key});
  }
};

AutoDapp.prototype.appendTx = function(req, cb) {
  console.log('autodapp: append tx');
  var tx;
  try {
    tx = types.Tx.decode(req.data);
  } catch(err) {
    return cb({code:tmsp.CodeType.EncodingError, log:''+err});
  }

  this.loadDevices(getAllPubKeys(tx), (devMap) => {
    // execute transaction
    var devices = [];
    if (!executeTx(tx, devMap, devices, cb)) {
      return;
    }
    // save result
    this.storeDevices(devices);
    return cb({code:tmsp.CodeType.OK});
  });
};

AutoDapp.prototype.checkTx = function(req, cb) {
  console.log('autodapp: check tx');
  var tx;
  try {
    tx = types.Tx.decode(req.data);
  } catch(err) {
    return cb({code:tmsp.CodeType.EncodingError, log:''+err});
  }

  if (!validateTx(tx, cb)) {
    return;
  }

  console.log('autodapp: check tx: OK');

  return cb({code:tmsp.CodeType_OK});
};

AutoDapp.prototype.commit = function(req, cb) {
  this.merkleClient.commit((hash) => {
    console.log('autodapp: commit hash ' + hash);
    cb({data: hash});
  });
};

AutoDapp.prototype.query = function(req, cb) {
  var queryBytes = req.data.toBuffer();
  this.merkleClient.get(queryBytes, (devBytes)=>{
    var dev = types.Device.decode(devBytes);
    return cb({data: JSON.stringify(dev)});
  });
};

AutoDapp.prototype.loadDevices = function(pubKeys, loadDevicesCb) {
  // load devices in batch from merkleClient
  async.map(pubKeys, function(pubKeyBytes, cb) {
    merkleClient.get(pubKeyBytes, (devBytes) => {
      if (devBytes.length === 0) {
        cb(null, null);
      } else {
        var dev = types.Device.decode(devBytes);
        dev._pubKey = pubKeyBytes;
        cb(null, dev);
      };
    });
  }, function(err, devices) {
    if (!!err) {
      throw "This shouldn't happen";
    }
    // create a map out of them
    var devicesMap = devices.reduce((m,dev) => {
      if (!dev) {return m;}
      m[dev._pubKey.toString("binary")] = dev;
      return m;
    }, {});
    loadDevicesCb(devicesMap);
  });
  
  // TODO: flush once if merkleClient does not auto-flush
};

AutoDapp.prototype.storeDevices = function(devices) {
  // write in deterministic order
  for (var i = 0; i < devices.length; i++) {
    var dev = devices[i];
    this.merkleClient.set(dev._pubKey, dev.encode().toBuffer()); 
  }
};

var validateTx = function(tx, cb) {
  if (tx.inputs.length === 0) {
    cb({code:tmsp.CodeType.EncodingError, log:"Tx.inputs.length cannot be 0"});
    return false;
  }
  var seenPubKeys = {};
  var signBytes = txSignBytes(tx);
  for (var i = 0; i < tx.inputs.length; i++) {
    var input = tx.inputs[i];
    if (!validateInput(input, signBytes, cb)) {
      return false;
    }
    var pubKeyBin = input.pubKey.toBinary();
    if (seenPubKeys[pubKeyBin]) {
      cb({code:tmsp.CodeType.EncodingError, log:"Duplicate input pubKey"});
      return false;
    }
    seenPubKeys[pubKeyBin] = true;
  }
  return true;
};

var txSignBytes = function(tx) {
  var txCopy = new types.Tx(tx.toRaw());
  txCopy.inputs.forEach((input) => {
    input.signature = new Buffer(0);
  });
  return txCopy.encode().toBuffer();
};

var validateInput = function(input, signBytes, cb) {
  var len = function(bb) {
    return bb.limit - bb.offset;
  };

  if (Math.abs(input.latitude) > 90) {
    cb({code:tmsp.CodeType.EncodingError, log:"Input latitude is invalid"});
    return false;
  }
  if (Math.abs(input.longitude) > 180) {
    cb({code:tmsp.CodeType.EncodingError, log:"Input longitude is invalid"});
    return false;
  }
  if (len(input.pubKey) !== 32) {
    cb({code:tmsp.CodeType.EncodingError, log:"Input pubKey must be 32 bytes long"});
    return false;
  }
  if (len(input.signature) !== 64) {
    cb({code:tmsp.CodeType.EncodingError, log:"Input signature must be 64 bytes long"});
    return false;
  }
  if (!crypto.verify(
        input.pubKey.toBuffer(),
        signBytes,
        input.signature.toBuffer())) {
    cb({code:tmsp.CodeType.Unauthorized, log:"Invalid signature"});
    return false;
  }
  return true;
};

var getAllPubKeys = function(tx) {
  var inputKeys = tx.inputs.map((input) => {return input.pubKey.toBuffer();});
  return inputKeys;
}

var executeTx = function(tx, devMap, devices, cb) {
  // execute transaction, while filling in devices
  // with updated data in order of appearance in tx.
  for (var i = 0; i < tx.inputs.length; i++) {
    var input = tx.inputs[i];
    var dev = devMap[input.pubKey.toBinary()];
    if (!dev) {
      cb({code:tmsp.CodeType.UnknownAccount, log:"Input device does not exist"});
      return false;
    }
    if (dev.sequence !== input.sequence) {
      cb({code:tmsp.CodeType.BadNonce, log:"Invalid sequence"});
      console.log("Invalid sequence");
      return false;
    }

    dev.sequence++;
    dev.latitude = input.latitude;
    dev.longitude = input.longitude;
    dev.temperature = input.temperature;
    devices.push(dev);
  }

  return true;
}

var program = require('commander');
program
  .option('-a, --addr [tcp://host:port|unix://path]', 'Listen address (default tcp://127.0.0.1:46658)')
  .option('-e, --eyes [tcp://host:port|unix://path]', 'MerkleEyes address (default tcp://127.0.0.1:46659)')
  .parse(process.argv);
var merkleClient = new merkle.Client(program.eyes || "tcp://127.0.0.1:46659");
var addr = tmsp.ParseAddr(program.addr || "tcp://127.0.0.1:46658");

var myApp = new AutoDapp(merkleClient);
var appServer = new tmsp.Server(myApp);
appServer.server.listen(addr);

var app = express();
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

// expose app rpc
app.get('/devices', function(req, res) {
   res.send('not implemented yet');
});

app.get('/devices/:id', function(req, res) {
  var pair = crypto.deriveKeyPair(req.params.id);
  if (pair) {
    myApp.merkleClient.get(pair.pubKeyBytes, (devBytes)=> {
      if (devBytes.toString().length !== 0) {
        var dev = types.Device.decode(devBytes);
        res.json(dev);
      } else {
        res.json({'error':'device not found'});
      }
    });
  } else {
    res.json({'error':'device not found'});
  }
});

app.listen(3001);

// run test
test.run(program.addr);

console.log("autodapp: running");





