var request = require('request');
var helper = require("./helper");

var seed = "1"; // use uuid to base64
var status1 = {latitude:37.7938462, longitude:-122.394837, temperature:105};
var status2 = {latitude:45.500618, longitude:-73.56778, temperature:65};
var device = helper.getDevice(seed);

var url = 'http://localhost:46657/broadcast_tx_async';
var tx = helper.tx([helper.input(device, status1)]);
var hexString = tx.encode().toBuffer().toString('hex');

request.post(
    url,
    {form: {tx: '\"' + hexString + '\"'}},
    function (error, response, body) {
        if (!error && response.statusCode == 200) {
            console.log(body);
        }
    }
);

