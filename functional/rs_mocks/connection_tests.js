"use strict";
var assign = require('../../../../lib/utils').assign;

exports['Successful connection to replicaset of 1 primary, 1 secondary and 1 arbiter'] = {
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
    var arbiterServer = null;
    var running = true;
    var electionIds = [new ObjectId(), new ObjectId()];

    // Default message fields
    var defaultFields = {
      "setName": "rs", "setVersion": 1, "electionId": electionIds[0],
      "maxBsonObjectSize" : 16777216, "maxMessageSizeBytes" : 48000000,
      "maxWriteBatchSize" : 1000, "localTime" : new Date(), "maxWireVersion" : 4,
      "minWireVersion" : 0, "ok" : 1, "hosts": ["localhost:32000", "localhost:32001", "localhost:32002"], "arbiters": ["localhost:32002"]
    }

    // Primary server states
    var primary = [assign({}, defaultFields, {
      "ismaster":true, "secondary":false, "me": "localhost:32000", "primary": "localhost:32000", "tags" : { "loc" : "ny" }
    })];

    // Primary server states
    var firstSecondary = [assign({}, defaultFields, {
      "ismaster":false, "secondary":true, "me": "localhost:32001", "primary": "localhost:32000", "tags" : { "loc" : "sf" }
    })];

    // Primary server states
    var arbiter = [assign({}, defaultFields, {
      "ismaster":false, "secondary":false, "arbiterOnly": true, "me": "localhost:32002", "primary": "localhost:32000"
    })];

    // Boot the mock
    co(function*() {
      primaryServer = yield mockupdb.createServer(32000, 'localhost');
      firstSecondaryServer = yield mockupdb.createServer(32001, 'localhost');
      arbiterServer = yield mockupdb.createServer(32002, 'localhost');

      // Primary state machine
      co(function*() {
        while(running) {
          var request = yield primaryServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(primary[0]);
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
            request.reply(firstSecondary[0]);
          }
        }
      }).catch(function(err) {
        // console.log(err.stack);
      });

      // Second secondary state machine
      co(function*() {
        while(running) {
          var request = yield arbiterServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(arbiter[0]);
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

    server.on('joined', function(_type) {
      if(_type == 'arbiter' || _type == 'secondary' || _type == 'primary') {
        // console.log("!!!!!!!!!!!!!!!!! joined :: " + _type)
        // console.log("server.s.replicaSetState.secondaries = " + server.s.replicaSetState.secondaries.length)
        // console.log("server.s.replicaSetState.arbiters = " + server.s.replicaSetState.arbiters.length)

        if(server.s.replicaSetState.secondaries.length == 1
          && server.s.replicaSetState.arbiters.length == 1
          && server.s.replicaSetState.primary) {
            test.equal(1, server.s.replicaSetState.secondaries.length);
            test.equal('localhost:32001', server.s.replicaSetState.secondaries[0].name);

            test.equal(1, server.s.replicaSetState.arbiters.length);
            test.equal('localhost:32002', server.s.replicaSetState.arbiters[0].name);

            test.ok(server.s.replicaSetState.primary != null);
            test.equal('localhost:32000', server.s.replicaSetState.primary.name);

            primaryServer.destroy();
            firstSecondaryServer.destroy();
            arbiterServer.destroy();
            server.destroy();
            running = false;

            setTimeout(function() {
              test.equal(0, Object.keys(Connection.connections()).length);
              Connection.disableConnectionAccounting();
              test.done();
            }, 1000);
          }
      }
    });

    server.on('connect', function(e) {
      server.__connected = true;
    });

    // Gives proxies a chance to boot up
    setTimeout(function() {
      server.connect();
    }, 100)
  }
}

exports['Successful connection to replicaset of 1 primary, 1 secondary and 1 arbiter using arbiter as seed'] = {
  metadata: {
    requires: {
      generators: true,
      topology: "single"
    }
  },

  test: function(configuration, test) {
    var ReplSet = configuration.require.ReplSet,
      Connection = require('../../../../lib/connection/connection'),
      ObjectId = configuration.require.BSON.ObjectId,
      ReadPreference = configuration.require.ReadPreference,
      Long = configuration.require.BSON.Long,
      co = require('co'),
      mockupdb = require('../../../mock');

    // Contain mock server
    var primaryServer = null;
    var firstSecondaryServer = null;
    var arbiterServer = null;
    var running = true;
    var electionIds = [new ObjectId(), new ObjectId()];

    // Default message fields
    var defaultFields = {
      "setName": "rs", "setVersion": 1, "electionId": electionIds[0],
      "maxBsonObjectSize" : 16777216, "maxMessageSizeBytes" : 48000000,
      "maxWriteBatchSize" : 1000, "localTime" : new Date(), "maxWireVersion" : 4,
      "minWireVersion" : 0, "ok" : 1, "hosts": ["localhost:32000", "localhost:32001", "localhost:32002"], "arbiters": ["localhost:32002"]
    }

    // Primary server states
    var primary = [assign({}, defaultFields, {
      "ismaster":true, "secondary":false, "me": "localhost:32000", "primary": "localhost:32000", "tags" : { "loc" : "ny" }
    })];

    // Primary server states
    var firstSecondary = [assign({}, defaultFields, {
      "ismaster":false, "secondary":true, "me": "localhost:32001", "primary": "localhost:32000", "tags" : { "loc" : "sf" }
    })];

    // Primary server states
    var arbiter = [assign({}, defaultFields, {
      "ismaster":false, "secondary":false, "arbiterOnly": true, "me": "localhost:32002", "primary": "localhost:32000"
    })];

    // Boot the mock
    co(function*() {
      primaryServer = yield mockupdb.createServer(32000, 'localhost');
      firstSecondaryServer = yield mockupdb.createServer(32001, 'localhost');
      arbiterServer = yield mockupdb.createServer(32002, 'localhost');

      // Primary state machine
      co(function*() {
        while(running) {
          var request = yield primaryServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(primary[0]);
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
            request.reply(firstSecondary[0]);
          }
        }
      }).catch(function(err) {
        // console.log(err.stack);
      });

      // Second secondary state machine
      co(function*() {
        while(running) {
          var request = yield arbiterServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(arbiter[0]);
          }
        }
      }).catch(function(err) {
        // console.log(err.stack);
      });
    });

    Connection.enableConnectionAccounting();
    // Attempt to connect
    var server = new ReplSet([
      { host: 'localhost', port: 32002 }], {
        setName: 'rs',
        connectionTimeout: 3000,
        socketTimeout: 0,
        haInterval: 2000,
        size: 1
    });

    server.on('joined', function(_type) {
      if(_type == 'arbiter' || _type == 'secondary' || _type == 'primary') {
        // console.log("!!!!!!!!!!!!!!!!! joined :: " + _type)
        // console.log("server.s.replicaSetState.secondaries = " + server.s.replicaSetState.secondaries.length)
        // console.log("server.s.replicaSetState.arbiters = " + server.s.replicaSetState.arbiters.length)

        if(server.s.replicaSetState.secondaries.length == 1
          && server.s.replicaSetState.arbiters.length == 1
          && server.s.replicaSetState.primary) {
            test.equal(1, server.s.replicaSetState.secondaries.length);
            test.equal('localhost:32001', server.s.replicaSetState.secondaries[0].name);

            test.equal(1, server.s.replicaSetState.arbiters.length);
            test.equal('localhost:32002', server.s.replicaSetState.arbiters[0].name);

            test.ok(server.s.replicaSetState.primary != null);
            test.equal('localhost:32000', server.s.replicaSetState.primary.name);
        // console.log("DONE")

            primaryServer.destroy();
            firstSecondaryServer.destroy();
            arbiterServer.destroy();
            server.destroy();
            running = false;

            setTimeout(function() {
              test.equal(0, Object.keys(Connection.connections()).length);
              Connection.disableConnectionAccounting();
              test.done();
            }, 1000);
          }
      }
    });

    server.on('connect', function(e) {
      server.__connected = true;
    });

    // Gives proxies a chance to boot up
    setTimeout(function() {
      server.connect();
    }, 100)
  }
}

exports['Successful connection to replicaset of 1 primary, 1 secondary but missing arbiter'] = {
  metadata: {
    requires: {
      generators: true,
      topology: "single"
    }
  },

  test: function(configuration, test) {
    var ReplSet = configuration.require.ReplSet,
      ObjectId = configuration.require.BSON.ObjectId,
      ReadPreference = configuration.require.ReadPreference,
      Connection = require('../../../../lib/connection/connection'),
      Long = configuration.require.BSON.Long,
      co = require('co'),
      mockupdb = require('../../../mock');

    // Contain mock server
    var primaryServer = null;
    var firstSecondaryServer = null;
    var secondSecondaryServer = null;
    var running = true;
    var electionIds = [new ObjectId(), new ObjectId()];

    // Default message fields
    var defaultFields = {
      "setName": "rs", "setVersion": 1, "electionId": electionIds[0],
      "maxBsonObjectSize" : 16777216, "maxMessageSizeBytes" : 48000000,
      "maxWriteBatchSize" : 1000, "localTime" : new Date(), "maxWireVersion" : 4,
      "minWireVersion" : 0, "ok" : 1, "hosts": ["localhost:32000", "localhost:32001", "localhost:32002"], "arbiters": ["localhost:32002"]
    }

    // Primary server states
    var primary = [assign({}, defaultFields, {
      "ismaster":true, "secondary":false, "me": "localhost:32000", "primary": "localhost:32000", "tags" : { "loc" : "ny" }
    })];

    // Primary server states
    var firstSecondary = [assign({}, defaultFields, {
      "ismaster":false, "secondary":true, "me": "localhost:32001", "primary": "localhost:32000", "tags" : { "loc" : "sf" }
    })];

    // Boot the mock
    co(function*() {
      primaryServer = yield mockupdb.createServer(32000, 'localhost');
      firstSecondaryServer = yield mockupdb.createServer(32001, 'localhost');

      // Primary state machine
      co(function*() {
        while(running) {
          var request = yield primaryServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(primary[0]);
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
            request.reply(firstSecondary[0]);
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

    // Number of events
    var numberOfEvents = 0;

    // Validations
    function validations() {
      test.equal(1, server.s.replicaSetState.secondaries.length);
      test.equal('localhost:32001', server.s.replicaSetState.secondaries[0].name);

      test.equal(0, server.s.replicaSetState.arbiters.length);

      test.ok(server.s.replicaSetState.primary != null);
      test.equal('localhost:32000', server.s.replicaSetState.primary.name);

      primaryServer.destroy();
      firstSecondaryServer.destroy();
      server.destroy();

      setTimeout(function() {
        test.equal(0, Object.keys(Connection.connections()).length);
        Connection.disableConnectionAccounting();
        test.done();
      }, 1000);
    }

    // Joined
    server.on('joined', function(_type) {
      // console.log("== joined :: " + _type)
      numberOfEvents = numberOfEvents + 1;
      if(numberOfEvents == 3) validations();
    });

    server.on('failed', function(server) {
      // console.log("== failed :: " + server.name)
      numberOfEvents = numberOfEvents + 1;
      if(numberOfEvents == 3) validations();
    });

    // Gives proxies a chance to boot up
    setTimeout(function() {
      server.connect();
    }, 100)
  }
}

exports['Fail to connect due to missing primary'] = {
  metadata: {
    requires: {
      generators: true,
      topology: "single"
    }
  },

  test: function(configuration, test) {
    var ReplSet = configuration.require.ReplSet,
      ObjectId = configuration.require.BSON.ObjectId,
      ReadPreference = configuration.require.ReadPreference,
      Connection = require('../../../../lib/connection/connection'),
      Long = configuration.require.BSON.Long,
      co = require('co'),
      mockupdb = require('../../../mock');

    // Contain mock server
    var firstSecondaryServer = null;
    var running = true;
    var electionIds = [new ObjectId(), new ObjectId()];

    // Default message fields
    var defaultFields = {
      "setName": "rs", "setVersion": 1, "electionId": electionIds[0],
      "maxBsonObjectSize" : 16777216, "maxMessageSizeBytes" : 48000000,
      "maxWriteBatchSize" : 1000, "localTime" : new Date(), "maxWireVersion" : 4,
      "minWireVersion" : 0, "ok" : 1, "hosts": ["localhost:32000", "localhost:32001", "localhost:32002"], "arbiters": ["localhost:32002"]
    }

    // Primary server states
    var firstSecondary = [assign({}, defaultFields, {
      "ismaster":false, "secondary":true, "me": "localhost:32001", "primary": "localhost:32000", "tags" : { "loc" : "sf" }
    })];

    // Boot the mock
    co(function*() {
      firstSecondaryServer = yield mockupdb.createServer(32001, 'localhost');

      // First secondary state machine
      co(function*() {
        while(running) {
          var request = yield firstSecondaryServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(firstSecondary[0]);
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

    server.on('connect', function(error) {
      // console.log("--------------- connect")
    });

    server.on('error', function(error) {
      // console.log("--------------- error")
      server.destroy();
      firstSecondaryServer.destroy();
      running = false;

      setTimeout(function() {
        test.equal(0, Object.keys(Connection.connections()).length);
        Connection.disableConnectionAccounting();
        test.done();
      }, 1000);
    });

    // Gives proxies a chance to boot up
    setTimeout(function() {
      // console.log("--------------- connect 1")
      server.connect();
    }, 100)
  }
}

exports['Successful connection to replicaset of 0 primary, 1 secondary and 1 arbiter with secondaryOnlyConnectionAllowed'] = {
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
    var firstSecondaryServer = null;
    var arbiterServer = null;
    var running = true;
    var electionIds = [new ObjectId(), new ObjectId()];

    // Default message fields
    var defaultFields = {
      "setName": "rs", "setVersion": 1, "electionId": electionIds[0],
      "maxBsonObjectSize" : 16777216, "maxMessageSizeBytes" : 48000000,
      "maxWriteBatchSize" : 1000, "localTime" : new Date(), "maxWireVersion" : 4,
      "minWireVersion" : 0, "ok" : 1, "hosts": ["localhost:32000", "localhost:32001", "localhost:32002"], "arbiters": ["localhost:32002"]
    }

    // Primary server states
    var firstSecondary = [assign({}, defaultFields, {
      "ismaster":false, "secondary":true, "me": "localhost:32001", "primary": "localhost:32000", "tags" : { "loc" : "sf" }
    })];

    // Primary server states
    var arbiter = [assign({}, defaultFields, {
      "ismaster":false, "secondary":false, "arbiterOnly": true, "me": "localhost:32002", "primary": "localhost:32000"
    })];

    // Boot the mock
    co(function*() {
      firstSecondaryServer = yield mockupdb.createServer(32001, 'localhost');
      arbiterServer = yield mockupdb.createServer(32002, 'localhost');

      // First secondary state machine
      co(function*() {
        while(running) {
          var request = yield firstSecondaryServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(firstSecondary[0]);
          }
        }
      }).catch(function(err) {
        // console.log(err.stack);
      });

      // Second secondary state machine
      co(function*() {
        while(running) {
          var request = yield arbiterServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(arbiter[0]);
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
        size: 1,
        secondaryOnlyConnectionAllowed: true
    });

    server.on('joined', function(_type) {
      if(server.s.replicaSetState.secondaries.length == 1
        && server.s.replicaSetState.arbiters.length == 1) {
          test.equal(1, server.s.replicaSetState.secondaries.length);
          test.equal('localhost:32001', server.s.replicaSetState.secondaries[0].name);

          test.equal(1, server.s.replicaSetState.arbiters.length);
          test.equal('localhost:32002', server.s.replicaSetState.arbiters[0].name);

          test.ok(server.s.replicaSetState.primary == null);

          firstSecondaryServer.destroy();
          arbiterServer.destroy();
          server.destroy();
          running = false;

          setTimeout(function() {
            test.equal(0, Object.keys(Connection.connections()).length);
            Connection.disableConnectionAccounting();
            test.done();
          }, 1000);
        }
    });

    server.on('connect', function(e) {
      server.__connected = true;
    });

    // Gives proxies a chance to boot up
    setTimeout(function() {
      server.connect();
    }, 100)
  }
}

exports['Successful connection to replicaset of 1 primary, 1 secondary and 1 arbiter with secondaryOnlyConnectionAllowed'] = {
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
    var arbiterServer = null;
    var running = true;
    var electionIds = [new ObjectId(), new ObjectId()];

    // Default message fields
    var defaultFields = {
      "setName": "rs", "setVersion": 1, "electionId": electionIds[0],
      "maxBsonObjectSize" : 16777216, "maxMessageSizeBytes" : 48000000,
      "maxWriteBatchSize" : 1000, "localTime" : new Date(), "maxWireVersion" : 4,
      "minWireVersion" : 0, "ok" : 1, "hosts": ["localhost:32000", "localhost:32001", "localhost:32002"], "arbiters": ["localhost:32002"]
    }

    // Primary server states
    var primary = [assign({}, defaultFields, {
      "ismaster":true, "secondary":false, "me": "localhost:32000", "primary": "localhost:32000", "tags" : { "loc" : "ny" }
    })];

    // Primary server states
    var firstSecondary = [assign({}, defaultFields, {
      "ismaster":false, "secondary":true, "me": "localhost:32001", "primary": "localhost:32000", "tags" : { "loc" : "sf" }
    })];

    // Primary server states
    var arbiter = [assign({}, defaultFields, {
      "ismaster":false, "secondary":false, "arbiterOnly": true, "me": "localhost:32002", "primary": "localhost:32000"
    })];

    // Boot the mock
    co(function*() {
      primaryServer = yield mockupdb.createServer(32000, 'localhost');
      firstSecondaryServer = yield mockupdb.createServer(32001, 'localhost');
      arbiterServer = yield mockupdb.createServer(32002, 'localhost');

      // Primary state machine
      co(function*() {
        while(running) {
          var request = yield primaryServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(primary[0]);
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
            request.reply(firstSecondary[0]);
          }
        }
      }).catch(function(err) {
        // console.log(err.stack);
      });

      // Second secondary state machine
      co(function*() {
        while(running) {
          var request = yield arbiterServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(arbiter[0]);
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
        size: 1,
        secondaryOnlyConnectionAllowed: true
    });

    server.on('joined', function(_type) {
      if(_type == 'arbiter' || _type == 'secondary' || _type == 'primary') {
        // console.log("!!!!!!!!!!!!!!!!! joined :: " + _type)
        // console.log("server.s.replicaSetState.secondaries = " + server.s.replicaSetState.secondaries.length)
        // console.log("server.s.replicaSetState.arbiters = " + server.s.replicaSetState.arbiters.length)

        if(server.s.replicaSetState.secondaries.length == 1
          && server.s.replicaSetState.arbiters.length == 1
          && server.s.replicaSetState.primary) {
            test.equal(1, server.s.replicaSetState.secondaries.length);
            test.equal('localhost:32001', server.s.replicaSetState.secondaries[0].name);

            test.equal(1, server.s.replicaSetState.arbiters.length);
            test.equal('localhost:32002', server.s.replicaSetState.arbiters[0].name);

            test.ok(server.s.replicaSetState.primary != null);
            test.equal('localhost:32000', server.s.replicaSetState.primary.name);

            primaryServer.destroy();
            firstSecondaryServer.destroy();
            arbiterServer.destroy();
            server.destroy();
            running = false;

            setTimeout(function() {
              test.equal(0, Object.keys(Connection.connections()).length);
              Connection.disableConnectionAccounting();
              test.done();
            }, 1000);
          }
      }
    });

    server.on('connect', function(e) {
      server.__connected = true;
    });

    // Gives proxies a chance to boot up
    setTimeout(function() {
      server.connect();
    }, 100)
  }
}

exports['Should print socketTimeout warning due to socketTimeout < haInterval'] = {
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
    var arbiterServer = null;
    var running = true;
    var electionIds = [new ObjectId(), new ObjectId()];

    // Default message fields
    var defaultFields = {
      "setName": "rs", "setVersion": 1, "electionId": electionIds[0],
      "maxBsonObjectSize" : 16777216, "maxMessageSizeBytes" : 48000000,
      "maxWriteBatchSize" : 1000, "localTime" : new Date(), "maxWireVersion" : 4,
      "minWireVersion" : 0, "ok" : 1, "hosts": ["localhost:32000", "localhost:32001", "localhost:32002"], "arbiters": ["localhost:32002"]
    }

    // Primary server states
    var primary = [assign({}, defaultFields, {
      "ismaster":true, "secondary":false, "me": "localhost:32000", "primary": "localhost:32000", "tags" : { "loc" : "ny" }
    })];

    // Primary server states
    var firstSecondary = [assign({}, defaultFields, {
      "ismaster":false, "secondary":true, "me": "localhost:32001", "primary": "localhost:32000", "tags" : { "loc" : "sf" }
    })];

    // Primary server states
    var arbiter = [assign({}, defaultFields, {
      "ismaster":false, "secondary":false, "arbiterOnly": true, "me": "localhost:32002", "primary": "localhost:32000"
    })];

    // Boot the mock
    co(function*() {
      primaryServer = yield mockupdb.createServer(32000, 'localhost');
      firstSecondaryServer = yield mockupdb.createServer(32001, 'localhost');
      arbiterServer = yield mockupdb.createServer(32002, 'localhost');

      // Primary state machine
      co(function*() {
        while(running) {
          var request = yield primaryServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(primary[0]);
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
            request.reply(firstSecondary[0]);
          }
        }
      }).catch(function(err) {
        // console.log(err.stack);
      });

      // Second secondary state machine
      co(function*() {
        while(running) {
          var request = yield arbiterServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(arbiter[0]);
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
        socketTimeout: 2000,
        haInterval: 5000,
        size: 1
    });

    server.on('error', function() {
      primaryServer.destroy();
      firstSecondaryServer.destroy();
      arbiterServer.destroy();
      server.destroy();
      running = false;

      setTimeout(function() {
        test.equal(0, Object.keys(Connection.connections()).length);
        Connection.disableConnectionAccounting();
        test.done();
      }, 1000);
    });

    // Gives proxies a chance to boot up
    setTimeout(function() {
      server.connect();
    }, 100)
  }
}

exports['Should connect with a replicaset with a single primary and secondary'] = {
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
    var arbiterServer = null;
    var running = true;
    var electionIds = [new ObjectId(), new ObjectId()];

    // Default message fields
    var defaultFields = {
      "setName": "rs", "setVersion": 1, "electionId": electionIds[0],
      "maxBsonObjectSize" : 16777216, "maxMessageSizeBytes" : 48000000,
      "maxWriteBatchSize" : 1000, "localTime" : new Date(), "maxWireVersion" : 4,
      "minWireVersion" : 0, "ok" : 1, "hosts": ["localhost:32000", "localhost:32001", "localhost:32002"], "arbiters": ["localhost:32002"]
    }

    // Primary server states
    var primary = [assign({}, defaultFields, {
      "ismaster":true, "secondary":false, "me": "localhost:32000", "primary": "localhost:32000", "tags" : { "loc" : "ny" }
    })];

    // Primary server states
    var firstSecondary = [assign({}, defaultFields, {
      "ismaster":false, "secondary":true, "me": "localhost:32001", "primary": "localhost:32000", "tags" : { "loc" : "sf" }
    })];

    // Boot the mock
    co(function*() {
      primaryServer = yield mockupdb.createServer(32000, 'localhost');
      firstSecondaryServer = yield mockupdb.createServer(32001, 'localhost');

      // Primary state machine
      co(function*() {
        while(running) {
          var request = yield primaryServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(primary[0]);
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
            request.reply(firstSecondary[0]);
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
      { host: 'localhost', port: 32001 }], {
        setName: 'rs',
        connectionTimeout: 5000,
        socketTimeout: 10000,
        haInterval: 2000,
        size: 1
    });

    server.on('joined', function(_type, _server) {
      if( _type == 'secondary' || _type == 'primary') {
        if(server.s.replicaSetState.secondaries.length == 1
          && server.s.replicaSetState.primary) {
            test.ok(server.s.replicaSetState.primary);
            test.equal('localhost:32000', server.s.replicaSetState.primary.name);

            test.equal(1, server.s.replicaSetState.secondaries.length);
            test.equal('localhost:32001', server.s.replicaSetState.secondaries[0].name);

            primaryServer.destroy();
            firstSecondaryServer.destroy();
            server.destroy();
            running = false;

            setTimeout(function() {
              test.equal(0, Object.keys(Connection.connections()).length);
              Connection.disableConnectionAccounting();
              test.done();
            }, 1000);
          }
      }
    });

    server.on('connect', function(e) {
      server.__connected = true;
    });

    // Gives proxies a chance to boot up
    setTimeout(function() {
      server.connect();
    }, 100)
  }
}

exports['Successful connection to replicaset of 1 primary, 1 secondary and 1 arbiter with different seedlist names'] = {
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
    var arbiterServer = null;
    var running = true;
    var electionIds = [new ObjectId(), new ObjectId()];

    // Default message fields
    var defaultFields = {
      "setName": "rs", "setVersion": 1, "electionId": electionIds[0],
      "maxBsonObjectSize" : 16777216, "maxMessageSizeBytes" : 48000000,
      "maxWriteBatchSize" : 1000, "localTime" : new Date(), "maxWireVersion" : 4,
      "minWireVersion" : 0, "ok" : 1, "hosts": ["localhost:32000", "localhost:32001", "localhost:32002"], "arbiters": ["localhost:32002"]
    }

    // Primary server states
    var primary = [assign({}, defaultFields, {
      "ismaster":true, "secondary":false, "me": "localhost:32000", "primary": "localhost:32000", "tags" : { "loc" : "ny" }
    })];

    // Primary server states
    var firstSecondary = [assign({}, defaultFields, {
      "ismaster":false, "secondary":true, "me": "localhost:32001", "primary": "localhost:32000", "tags" : { "loc" : "sf" }
    })];

    // Primary server states
    var arbiter = [assign({}, defaultFields, {
      "ismaster":false, "secondary":false, "arbiterOnly": true, "me": "localhost:32002", "primary": "localhost:32000"
    })];

    // Boot the mock
    co(function*() {
      primaryServer = yield mockupdb.createServer(32000, 'localhost');
      firstSecondaryServer = yield mockupdb.createServer(32001, 'localhost');
      arbiterServer = yield mockupdb.createServer(32002, 'localhost');

      // Primary state machine
      co(function*() {
        while(running) {
          var request = yield primaryServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(primary[0]);
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
            request.reply(firstSecondary[0]);
          }
        }
      }).catch(function(err) {
        // console.log(err.stack);
      });

      // Second secondary state machine
      co(function*() {
        while(running) {
          var request = yield arbiterServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(arbiter[0]);
          }
        }
      }).catch(function(err) {
        // console.log(err.stack);
      });
    });

    Connection.enableConnectionAccounting();
    // Attempt to connect
    var server = new ReplSet([
      { host: '127.0.0.1', port: 32002 },
      { host: '127.0.0.1', port: 32001 }], {
        setName: 'rs',
        connectionTimeout: 3000,
        socketTimeout: 0,
        haInterval: 2000,
        size: 1
    });

    server.on('joined', function(_type) {
      if(_type == 'arbiter' || _type == 'secondary' || _type == 'primary') {
        // console.log("!!!!!!!!!!!!!!!!! joined :: " + _type)
        // console.log("server.s.replicaSetState.secondaries = " + server.s.replicaSetState.secondaries.length)
        // console.log("server.s.replicaSetState.arbiters = " + server.s.replicaSetState.arbiters.length)

        if(server.s.replicaSetState.secondaries.length == 1
          && server.s.replicaSetState.arbiters.length == 1
          && server.s.replicaSetState.primary) {
            test.equal(1, server.s.replicaSetState.secondaries.length);
            test.equal('localhost:32001', server.s.replicaSetState.secondaries[0].name);

            test.equal(1, server.s.replicaSetState.arbiters.length);
            test.equal('localhost:32002', server.s.replicaSetState.arbiters[0].name);

            test.ok(server.s.replicaSetState.primary != null);
            test.equal('localhost:32000', server.s.replicaSetState.primary.name);

            primaryServer.destroy();
            firstSecondaryServer.destroy();
            arbiterServer.destroy();
            server.destroy();
            running = false;

            setTimeout(function() {
              test.equal(0, Object.keys(Connection.connections()).length);
              Connection.disableConnectionAccounting();
              test.done();
            }, 1000);
          }
      }
    });

    server.on('connect', function(e) {
      console.log("!!!!!!!!!!!!!!!! connect")
      server.__connected = true;
    });

    // Gives proxies a chance to boot up
    setTimeout(function() {
      server.connect();
    }, 100)
  }
}

exports['Successful connection to replicaset of 1 primary, 0 secondary and 1 arbiter'] = {
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
    var arbiterServer = null;
    var running = true;
    var electionIds = [new ObjectId(), new ObjectId()];

    // Default message fields
    var defaultFields = {
      "setName": "rs", "setVersion": 1, "electionId": electionIds[0],
      "maxBsonObjectSize" : 16777216, "maxMessageSizeBytes" : 48000000,
      "maxWriteBatchSize" : 1000, "localTime" : new Date(), "maxWireVersion" : 4,
      "minWireVersion" : 0, "ok" : 1, "hosts": ["localhost:32000", "localhost:32001", "localhost:32002"], "arbiters": ["localhost:32002"]
    }

    // Primary server states
    var primary = [assign({}, defaultFields, {
      "ismaster":true, "secondary":false, "me": "localhost:32000", "primary": "localhost:32000", "tags" : { "loc" : "ny" }
    })];

    // Primary server states
    var firstSecondary = [assign({}, defaultFields, {
      "ismaster":false, "secondary":true, "me": "localhost:32001", "primary": "localhost:32000", "tags" : { "loc" : "sf" }
    })];

    // Primary server states
    var arbiter = [assign({}, defaultFields, {
      "ismaster":false, "secondary":false, "arbiterOnly": true, "me": "localhost:32002", "primary": "localhost:32000"
    })];

    // Boot the mock
    co(function*() {
      primaryServer = yield mockupdb.createServer(32000, 'localhost');
      // firstSecondaryServer = yield mockupdb.createServer(32001, 'localhost');
      arbiterServer = yield mockupdb.createServer(32002, 'localhost');

      // Primary state machine
      co(function*() {
        while(running) {
          var request = yield primaryServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(primary[0]);
          }
        }
      }).catch(function(err) {
        // console.log(err.stack);
      });

      // Second secondary state machine
      co(function*() {
        while(running) {
          var request = yield arbiterServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(arbiter[0]);
          }
        }
      }).catch(function(err) {
        // console.log(err.stack);
      });
    });

    Connection.enableConnectionAccounting();
    // Attempt to connect
    var server = new ReplSet([
      { host: 'localhost', port: 32000 }], {
        setName: 'rs',
        connectionTimeout: 3000,
        socketTimeout: 0,
        haInterval: 2000,
        size: 1
    });

    server.on('joined', function(_type) {
      if(_type == 'arbiter' || _type == 'secondary' || _type == 'primary') {
        // console.log("!!!!!!!!!!!!!!!!! joined :: " + _type)
        // console.log("server.s.replicaSetState.secondaries = " + server.s.replicaSetState.secondaries.length)
        // console.log("server.s.replicaSetState.arbiters = " + server.s.replicaSetState.arbiters.length)

        if(server.s.replicaSetState.arbiters.length == 1
          && server.s.replicaSetState.primary) {
            test.equal(1, server.s.replicaSetState.arbiters.length);
            test.equal('localhost:32002', server.s.replicaSetState.arbiters[0].name);

            test.ok(server.s.replicaSetState.primary != null);
            test.equal('localhost:32000', server.s.replicaSetState.primary.name);

            primaryServer.destroy();
            arbiterServer.destroy();
            server.destroy();
            running = false;

            setTimeout(function() {
              test.equal(0, Object.keys(Connection.connections()).length);
              Connection.disableConnectionAccounting();
              test.done();
            }, 1000);
          }
      }
    });

    server.on('connect', function(e) {
      // console.log("!!!!!!!!!!!!!!!! connect")
      server.__connected = true;
    });

    server.on('error', function(err) {
      // console.log("!!!!!!!!!!!!!!!! err")
      // console.dir(err)
    });

    // Gives proxies a chance to boot up
    setTimeout(function() {
      server.connect();
    }, 100)
  }
}

exports['Successful connection to replicaset of 1 primary, 1 secondary and 1 arbiter with single seed should emit fullsetup and all'] = {
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
    var arbiterServer = null;
    var running = true;
    var electionIds = [new ObjectId(), new ObjectId()];

    // Default message fields
    var defaultFields = {
      "setName": "rs", "setVersion": 1, "electionId": electionIds[0],
      "maxBsonObjectSize" : 16777216, "maxMessageSizeBytes" : 48000000,
      "maxWriteBatchSize" : 1000, "localTime" : new Date(), "maxWireVersion" : 4,
      "minWireVersion" : 0, "ok" : 1, "hosts": ["localhost:32000", "localhost:32001", "localhost:32002"], "arbiters": ["localhost:32002"]
    }

    // Primary server states
    var primary = [assign({}, defaultFields, {
      "ismaster":true, "secondary":false, "me": "localhost:32000", "primary": "localhost:32000", "tags" : { "loc" : "ny" }
    })];

    // Primary server states
    var firstSecondary = [assign({}, defaultFields, {
      "ismaster":false, "secondary":true, "me": "localhost:32001", "primary": "localhost:32000", "tags" : { "loc" : "sf" }
    })];

    // Primary server states
    var arbiter = [assign({}, defaultFields, {
      "ismaster":false, "secondary":false, "arbiterOnly": true, "me": "localhost:32002", "primary": "localhost:32000"
    })];

    // Boot the mock
    co(function*() {
      primaryServer = yield mockupdb.createServer(32000, 'localhost');
      firstSecondaryServer = yield mockupdb.createServer(32001, 'localhost');
      arbiterServer = yield mockupdb.createServer(32002, 'localhost');

      // Primary state machine
      co(function*() {
        while(running) {
          var request = yield primaryServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(primary[0]);
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
            request.reply(firstSecondary[0]);
          }
        }
      }).catch(function(err) {
        // console.log(err.stack);
      });

      // Second secondary state machine
      co(function*() {
        while(running) {
          var request = yield arbiterServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(arbiter[0]);
          }
        }
      }).catch(function(err) {
        // console.log(err.stack);
      });
    });

    Connection.enableConnectionAccounting();
    // Attempt to connect
    var server = new ReplSet([
      { host: 'localhost', port: 32000 }], {
        setName: 'rs',
        connectionTimeout: 3000,
        socketTimeout: 0,
        haInterval: 2000,
        size: 1
    });

    server.on('fullsetup', function(e) {
      // console.log("============= fullsetup")
      server.__fullsetup = true;
    });

    server.on('all', function(e) {
      // console.log("============= all")
      test.ok(server.__connected);
      test.ok(server.__fullsetup);

      primaryServer.destroy();
      firstSecondaryServer.destroy();
      arbiterServer.destroy();
      server.destroy();
      running = false;
      test.done();
      // server.__c = true;
    });

    server.on('connect', function(e) {
      // console.log("============= connect")
      server.__connected = true;
    });

    // Gives proxies a chance to boot up
    setTimeout(function() {
      server.connect();
    }, 100)
  }
}

exports['Correctly return lastIsMaster when connected to a secondary only for a replicaset connection'] = {
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
    var firstSecondaryServer = null;
    var arbiterServer = null;
    var running = true;
    var electionIds = [new ObjectId(), new ObjectId()];

    // Default message fields
    var defaultFields = {
      "setName": "rs", "setVersion": 1, "electionId": electionIds[0],
      "maxBsonObjectSize" : 16777216, "maxMessageSizeBytes" : 48000000,
      "maxWriteBatchSize" : 1000, "localTime" : new Date(), "maxWireVersion" : 4,
      "minWireVersion" : 0, "ok" : 1, "hosts": ["localhost:32000", "localhost:32001", "localhost:32002"], "arbiters": ["localhost:32002"]
    }

    // Primary server states
    var firstSecondary = [assign({}, defaultFields, {
      "ismaster":false, "secondary":true, "me": "localhost:32001", "primary": "localhost:32000", "tags" : { "loc" : "sf" }
    })];

    // Primary server states
    var arbiter = [assign({}, defaultFields, {
      "ismaster":false, "secondary":false, "arbiterOnly": true, "me": "localhost:32002", "primary": "localhost:32000"
    })];

    // Boot the mock
    co(function*() {
      firstSecondaryServer = yield mockupdb.createServer(32001, 'localhost');
      arbiterServer = yield mockupdb.createServer(32002, 'localhost');

      // First secondary state machine
      co(function*() {
        while(running) {
          var request = yield firstSecondaryServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(firstSecondary[0]);
          }
        }
      }).catch(function(err) {
        // console.log(err.stack);
      });

      // Second secondary state machine
      co(function*() {
        while(running) {
          var request = yield arbiterServer.receive();
          var doc = request.document;

          if(doc.ismaster) {
            request.reply(arbiter[0]);
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
        size: 1,
        secondaryOnlyConnectionAllowed: true
    });

    server.on('connect', function(e) {
      server.__connected = true;

      var result = server.lastIsMaster();
      test.ok(result);

      firstSecondaryServer.destroy();
      arbiterServer.destroy();
      server.destroy();
      running = false;
      test.done();
    });

    // Gives proxies a chance to boot up
    setTimeout(function() {
      server.connect();
    }, 100)
  }
}