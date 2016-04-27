var proto = require("protobufjs");
var protoPath = require("path").join(__dirname, "types.proto");
var builder = proto.loadProtoFile(protoPath);
var types = builder.build("types");

module.exports = types;
