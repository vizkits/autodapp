var async = require("async");
var wire = require("js-wire");
var tmsp = require("js-tmsp");
var merkle = require("js-merkleeyes");
var types = require("./types");
var crypto = require("./crypto");

var express = require('express');
var bodyParser = require('body-parser');

var version = "0.0.1";

var AutoDapp = function(merkleClient) {
  this.merkleClient = merkleClient;
};

AutoDapp.prototype.info = function(req, cb) {
  return cb({data: "Auto Identity Dapp v" + version});
};

AutoDapp.prototype.setOption = function(req, cb) {
  console.log('autodapp: set option');
  if (req.key === "register") {
    var opts = JSON.parse(req.value);
    var seed = opts.seed;
    var name = opts.status.name;
    var email = opts.status.email;
    var pair = crypto.deriveKeyPair(seed);
    this.merkleClient.set(
      pair.pubKeyBytes,
      new types.User({name:name, email:email}).encode().toBuffer(),
      (res) => {
        var logMsg = "User " + seed + " name = " + name + ", email = " + email;
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

  this._loadUsers(getAllPubKeys(tx), (userMap) => {
    // execute transaction
    var users = [];
    if (!executeTx(tx, userMap, users, cb)) {
      return;
    }
    // save result
    this._storeUsers(users);
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
    console.log('autodapp: check tx: invalid');
    return;
  }

  // workaround to add new legit users before tm rpc is available
  //this._addNewUser(tx);

  return cb({code:tmsp.CodeType_OK});
};

AutoDapp.prototype.commit = function(req, cb) {
  this.merkleClient.commit((hash) => {
    console.log('autodapp: commit hash ' + hash.toString('hex'));
    cb({data: hash});
  });
};

AutoDapp.prototype.query = function(req, cb) {
  var queryBytes = req.data.toBuffer();
  this.merkleClient.get(queryBytes, (userBytes)=>{
    var user = types.User.decode(userBytes);
    return cb({data: JSON.stringify(user)});
  });
};

AutoDapp.prototype._addNewUser = function(tx) {
  // check and add new legit user
  for (var i = 0; i < tx.inputs.length; i++) {
    var input = tx.inputs[i];
    this.merkleClient.get(input.pubKey.toBuffer(), (userBytes) => {
      if (userBytes.length === 0) {
        this.merkleClient.set(
          input.pubKey.toBuffer(),
          new types.User({name:input.name, email:input.email}).encode().toBuffer(),
          (res) => {
            var logMsg = "New user name = " + input.name + ", email = " + input.email;
            console.log(logMsg);
          }
        );
      }
    });
  }
};

AutoDapp.prototype._loadUsers = function(pubKeys, loadUsersCb) {
  // load users in batch from merkleClient
  async.map(pubKeys, function(pubKeyBytes, cb) {
    this.merkleClient.get(pubKeyBytes, (userBytes) => {
      if (userBytes.length === 0) {
        cb(null, null);
      } else {
        var user = types.User.decode(userBytes);
        user._pubKey = pubKeyBytes;
        cb(null, user);
      };
    });
  }, function(err, users) {
    if (!!err) {
      throw "This shouldn't happen";
    }
    // create a map out of them
    var usersMap = users.reduce((m,user) => {
      if (!user) {return m;}
      m[user._pubKey.toString("binary")] = user;
      return m;
    }, {});
    loadUsersCb(usersMap);
  });
};

AutoDapp.prototype._storeUsers = function(users) {
  // write in deterministic order
  for (var i = 0; i < users.length; i++) {
    var user = users[i];
    this.merkleClient.set(user._pubKey, user.encode().toBuffer()); 
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

  var validateEmail = function(email) {
    var re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(email);
  };

  if (validateEmail(input.email) === false) {
    cb({code:tmsp.CodeType.EncodingError, log:"Input email is invalid"});
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

var executeTx = function(tx, userMap, users, cb) {
  for (var i = 0; i < tx.inputs.length; i++) {
    var input = tx.inputs[i];
    var user = userMap[input.pubKey.toBinary()];
    if (!user) {
      cb({code:tmsp.CodeType.UnknownAccount, log:"Input user does not exist"});
      return false;
    }
    // update user info
    user.name = input.name;
    user.email = input.email;
    users.push(user);
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
app.get('/users', function(req, res) {
   res.send('not implemented yet');
});

app.get('/users/:id', function(req, res) {
  var pair = crypto.deriveKeyPair(req.params.id);
  if (pair) {
    myApp.merkleClient.get(pair.pubKeyBytes, (userBytes)=> {
      if (userBytes.toString().length !== 0) {
        var user = types.User.decode(userBytes);
        res.json(user);
      } else {
        res.json({'error':'user not found'});
      }
    });
  } else {
    res.json({'error':'user not found'});
  }
});

app.listen(3001); // use 3001 for mintnet only

// run init test
//require("./helper").runTest(program.addr);

console.log("autodapp: running");





