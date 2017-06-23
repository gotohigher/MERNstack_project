"use strict"

exports['Should correctly print warning when non mongos proxy passed in seed list'] = {
  metadata: {
    requires: {
      generators: true,
      topology: "single"
    }
  },

  test: function(configuration, test) {
    var Mongos = configuration.require.Mongos,
      ObjectId = configuration.require.BSON.ObjectId,
      Logger = configuration.require.Logger,
      co = require('co'),
      mockupdb = require('../../../mock');

    // Contain mock server
    var mongos1 = null;
    var mongos2 = null;
    var running = true;
    // Current index for the ismaster
    var currentStep = 0;
    // Primary stop responding
    var stopRespondingPrimary = false;
    var port = null;

    // Extend the object
    var extend = function(template, fields) {
      for(var name in template) fields[name] = template[name];
      return fields;
    }

    // Default message fields
    var defaultFields = {
      "ismaster" : true,
      "msg" : "isdbgrid",
      "maxBsonObjectSize" : 16777216,
      "maxMessageSizeBytes" : 48000000,
      "maxWriteBatchSize" : 1000,
      "localTime" : new Date(),
      "maxWireVersion" : 3,
      "minWireVersion" : 0,
      "ok" : 1
    }

    // Default message fields
    var defaultRSFields = {
      "setName": "rs", "setVersion": 1, "electionId": new ObjectId(),
      "maxBsonObjectSize" : 16777216, "maxMessageSizeBytes" : 48000000,
      "maxWriteBatchSize" : 1000, "localTime" : new Date(), "maxWireVersion" : 4,
      "minWireVersion" : 0, "ok" : 1, "hosts": ["localhost:32000", "localhost:32001", "localhost:32002"], "arbiters": ["localhost:32002"]
    }

    // Primary server states
    var serverIsMaster = [extend(defaultFields, {}), extend(defaultRSFields, {})];

    // Boot the mock
    co(function*() {
      mongos1 = yield mockupdb.createServer(52005, 'localhost');
      mongos2 = yield mockupdb.createServer(52006, 'localhost');

      // Mongos
      co(function*() {
        while(running) {
          var request = yield mongos1.receive();

          // Get the document
          var doc = request.document;
          if(doc.ismaster) {
            request.reply(serverIsMaster[0]);
          } else if(doc.insert) {
            request.reply({ok:1, n:doc.documents, lastOp: new Date()});
          }
        }
      }).catch(function(err) {
      });

      // Mongos
      co(function*() {
        while(running) {
          var request = yield mongos2.receive();

          // Get the document
          var doc = request.document;
          if(doc.ismaster) {
            request.reply(serverIsMaster[1]);
          } else if(doc.insert) {
            request.reply({ok:1, n:doc.documents, lastOp: new Date()});
          }
        }
      }).catch(function(err) {
      });

      // Attempt to connect
      var server = new Mongos([
          { host: 'localhost', port: 52005 },
          { host: 'localhost', port: 52006 },
        ], {
        connectionTimeout: 3000,
        socketTimeout: 1000,
        haInterval: 1000,
        localThresholdMS: 500,
        size: 1
      });

      var logger = Logger.currentLogger();
      Logger.setCurrentLogger(function(msg, state) {
        test.equal('warn', state.type);
        test.equal('expected mongos proxy, but found replicaset member mongod for server localhost:52006', state.message);
      });

      // Add event listeners
      server.once('connect', function(_server) {
        Logger.setCurrentLogger(logger);

        running = false;
        server.destroy();
        mongos1.destroy();
        mongos2.destroy();
        test.done();
      });

      server.on('error', function(){});
      setTimeout(function() { server.connect(); }, 100);
    });
  }
}

exports['Should correctly print warning and error when no mongos proxies in seed list'] = {
  metadata: {
    requires: {
      generators: true,
      topology: "single"
    }
  },

  test: function(configuration, test) {
    var Mongos = configuration.require.Mongos,
      Logger = configuration.require.Logger,
      ObjectId = configuration.require.BSON.ObjectId,
      co = require('co'),
      mockupdb = require('../../../mock');

    // Contain mock server
    var mongos1 = null;
    var mongos2 = null;
    var running = true;
    // Current index for the ismaster
    var currentStep = 0;
    // Primary stop responding
    var stopRespondingPrimary = false;
    var port = null;

    // Extend the object
    var extend = function(template, fields) {
      for(var name in template) fields[name] = template[name];
      return fields;
    }

    // Default message fields
    var defaultRSFields = {
      "setName": "rs", "setVersion": 1, "electionId": new ObjectId(),
      "maxBsonObjectSize" : 16777216, "maxMessageSizeBytes" : 48000000,
      "maxWriteBatchSize" : 1000, "localTime" : new Date(), "maxWireVersion" : 4,
      "minWireVersion" : 0, "ok" : 1, "hosts": ["localhost:32000", "localhost:32001", "localhost:32002"], "arbiters": ["localhost:32002"]
    }

    // Primary server states
    var serverIsMaster = [extend(defaultRSFields, {}), extend(defaultRSFields, {})];

    // Boot the mock
    co(function*() {
      mongos1 = yield mockupdb.createServer(52002, 'localhost');
      mongos2 = yield mockupdb.createServer(52003, 'localhost');

      // Mongos
      co(function*() {
        while(running) {
          var request = yield mongos1.receive();

          // Get the document
          var doc = request.document;
          if(doc.ismaster) {
            request.reply(serverIsMaster[0]);
          } else if(doc.insert) {
            request.reply({ok:1, n:doc.documents, lastOp: new Date()});
          }
        }
      }).catch(function(err) {
      });

      // Mongos
      co(function*() {
        while(running) {
          var request = yield mongos2.receive();

          // Get the document
          var doc = request.document;
          if(doc.ismaster) {
            request.reply(serverIsMaster[1]);
          } else if(doc.insert) {
            request.reply({ok:1, n:doc.documents, lastOp: new Date()});
          }
        }
      }).catch(function(err) {
      });

      // Attempt to connect
      var server = new Mongos([
          { host: 'localhost', port: 52002 },
          { host: 'localhost', port: 52003 },
        ], {
        connectionTimeout: 3000,
        socketTimeout: 1000,
        haInterval: 1000,
        localThresholdMS: 500,
        size: 1
      });

      // Add event listeners
      server.once('connect', function(_server) {
      });

      var warnings = [];

      var logger = Logger.currentLogger();
      Logger.setCurrentLogger(function(msg, state) {
        test.equal('warn', state.type);
        warnings.push(state);
      });

      server.on('error', function(){
        Logger.setCurrentLogger(logger);

        var errors = ['expected mongos proxy, but found replicaset member mongod for server localhost:52002'
          , 'expected mongos proxy, but found replicaset member mongod for server localhost:52003'
          , 'no mongos proxies found in seed list, did you mean to connect to a replicaset'];

        test.ok(errors.indexOf(warnings[0].message) != -1);
        test.ok(errors.indexOf(warnings[1].message) != -1);
        test.ok(errors.indexOf(warnings[2].message) != -1);

        running = false;
        server.destroy();
        mongos1.destroy();
        mongos2.destroy();
        test.done();
      });

      setTimeout(function() { server.connect(); }, 100);
    }).catch(function(err) {        
    });
  }
}
