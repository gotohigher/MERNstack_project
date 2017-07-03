"use strict";
var assign = require('../../../../lib/utils').assign;

exports['Successfully detect server in maintanance mode'] = {
  metadata: {
    requires: {
      generators: true,
      topology: "single"
    }
  },

  test: function(configuration, test) {
    var ReplSet = configuration.require.ReplSet,
      ObjectId = configuration.require.BSON.ObjectId,
      Connection = require('../../../../lib/connection/connection'),
      ReadPreference = configuration.require.ReadPreference,
      Long = configuration.require.BSON.Long,
      co = require('co'),
      mockupdb = require('../../../mock');

    // Contain mock server
    var primaryServer = null;
    var firstSecondaryServer = null;
    var secondSecondaryServer = null;
    var arbiterServer = null;
    var running = true;
    var currentIsMasterIndex = 0;

    // Default message fields
    var defaultFields = {
      "setName": "rs", "setVersion": 1, "electionId": new ObjectId(),
      "maxBsonObjectSize" : 16777216, "maxMessageSizeBytes" : 48000000,
      "maxWriteBatchSize" : 1000, "localTime" : new Date(), "maxWireVersion" : 4,
      "minWireVersion" : 0, "ok" : 1, "hosts": ["localhost:32000", "localhost:32001", "localhost:32002", "localhost:32003"], "arbiters": ["localhost:32002"]
    }

    // Primary server states
    var primary = [assign({}, defaultFields, {
      "ismaster":true, "secondary":false, "me": "localhost:32000", "primary": "localhost:32000", "tags" : { "loc" : "ny" }
    }), assign({}, defaultFields, {
      "ismaster":true, "secondary":false, "me": "localhost:32000", "primary": "localhost:32000", "tags" : { "loc" : "ny" }
    })];

    // Primary server states
    var firstSecondary = [assign({}, defaultFields, {
      "ismaster":false, "secondary":true, "me": "localhost:32001", "primary": "localhost:32000", "tags" : { "loc" : "sf" }
    }), assign({}, defaultFields, {
      "ismaster":false, "secondary":true, "me": "localhost:32001", "primary": "localhost:32000", "tags" : { "loc" : "sf" }
    })];

    // Primary server states
    var secondSecondary = [assign({}, defaultFields, {
      "ismaster":false, "secondary":true, "me": "localhost:32003", "primary": "localhost:32000", "tags" : { "loc" : "sf" }
    }), { "ismaster" : true,
      "ismaster":false, "secondary":false, "arbiterOnly": false, "me": "localhost:32003", "primary": "localhost:32000", "tags" : { "loc" : "sf" }
    }];

    // Primary server states
    var arbiter = [assign({}, defaultFields, {
      "ismaster":false, "secondary":false, "arbiterOnly": true, "me": "localhost:32002", "primary": "localhost:32000"
    }),assign({}, defaultFields, {
      "ismaster":false, "secondary":false, "arbiterOnly": true, "me": "localhost:32002", "primary": "localhost:32000"
    })];

    // Boot the mock
    co(function*() {
      primaryServer = yield mockupdb.createServer(32000, 'localhost');
      firstSecondaryServer = yield mockupdb.createServer(32001, 'localhost');
      secondSecondaryServer = yield mockupdb.createServer(32003, 'localhost');
      arbiterServer = yield mockupdb.createServer(32002, 'localhost');

      // Primary state machine
      co(function*() {
        while(running) {
          var request = yield primaryServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(primary[currentIsMasterIndex]);
          }
        }
      }).catch(function(err) {
        // console.log(err.stack);
      });

      // First secondary state machine
      co(function*() {
        while(running) {
          var request = yield firstSecondaryServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(firstSecondary[currentIsMasterIndex]);
          }
        }
      }).catch(function(err) {
        // console.log(err.stack);
      });

      // Second secondary state machine
      co(function*() {
        while(running) {
          var request = yield secondSecondaryServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(secondSecondary[currentIsMasterIndex]);
          }
        }
      }).catch(function(err) {
        // console.log(err.stack);
      });

      // Arbiter state machine
      co(function*() {
        while(running) {
          var request = yield arbiterServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(arbiter[currentIsMasterIndex]);
          }
        }
      }).catch(function(err) {
        // console.log(err.stack);
      });
    });

    Connection.enableConnectionAccounting();
    // Attempt to connect
    var server = new ReplSet([
      { host: 'localhost', port: 32000 },
      { host: 'localhost', port: 32001 },
      { host: 'localhost', port: 32002 }], {
        setName: 'rs',
        connectionTimeout: 3000,
        socketTimeout: 0,
        haInterval: 2000,
        size: 1
    });

    // Joined
    var joined = 0;

    server.on('joined', function(_type, _server) {
      // console.log("----- joined :: " + _type + " :: " + _server.name)
      joined = joined + 1;

      // primary, secondary and arbiter have joined
      if(joined == 4) {
        // console.log("TEST 0")
        test.equal(2, server.s.replicaSetState.secondaries.length);
        // console.log("TEST 1")
        test.equal('localhost:32001', server.s.replicaSetState.secondaries[0].name);
        test.equal('localhost:32003', server.s.replicaSetState.secondaries[1].name);
        // console.log("TEST 2")

        test.equal(1, server.s.replicaSetState.arbiters.length);
        test.equal('localhost:32002', server.s.replicaSetState.arbiters[0].name);
        // console.log("TEST 3")

        test.ok(server.s.replicaSetState.primary != null);
        // console.log("TEST 4")
        test.equal('localhost:32000', server.s.replicaSetState.primary.name);
        // console.log("TEST 5")
        // console.log("+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++")
        // global.debug=true
        // Flip the ismaster message
        currentIsMasterIndex = currentIsMasterIndex + 1;
      }
    });

    server.on('left', function(_type, _server) {
      // console.log("----- left :: " + _type + " :: " + _server.name)
      if(_type == 'secondary' && _server.name == 'localhost:32003') {
        primaryServer.destroy();
        firstSecondaryServer.destroy();
        secondSecondaryServer.destroy();
        arbiterServer.destroy();
        server.destroy();
        running = false;

        setTimeout(function() {
          test.equal(0, Object.keys(Connection.connections()).length);
          Connection.disableConnectionAccounting();
          test.done();
        }, 2000);
      }
      // if(_type == 'secondary' && _server.name == 'localhost:32003') {
      //   // test.equal(true, server.__connected);
      //
      //   // console.log("-------------------------------------------- done")
      //   // console.log(server.connections().map(function(x) { return x.port; }))
      //
      //   test.equal(1, server.s.replicaSetState.secondaries.length);
      //   test.equal('localhost:32001', server.s.replicaSetState.secondaries[0].name);
      //
      //   test.equal(1, server.s.replicaSetState.arbiters.length);
      //   test.equal('localhost:32002', server.s.replicaSetState.arbiters[0].name);
      //
      //   test.ok(server.s.replicaSetState.primary != null);
      //   test.equal('localhost:32000', server.s.replicaSetState.primary.name);
      //
      //   // console.log("!!!!!!!!!!!!!!!!!!!!!!!!!! FINISHED TEST")
      //   primaryServer.destroy();
      //   firstSecondaryServer.destroy();
      //   secondSecondaryServer.destroy();
      //   arbiterServer.destroy();
      //   server.destroy();
      //   running = false;
      //
      //   setTimeout(function() {
      //     test.equal(0, Object.keys(Connection.connections()).length);
      //     Connection.disableConnectionAccounting();
      //     test.done();
      //   }, 2000);
      // }
    });

    server.on('error', function(){});

    server.on('connect', function(e) {
      server.__connected = true;
    });

    // Add event listeners
    server.on('fullsetup', function(_server) {});
    // Gives proxies a chance to boot up
    setTimeout(function() {
      server.connect();
    }, 100)
  }
}
