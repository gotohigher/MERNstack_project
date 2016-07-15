"use strict";

var fs = require('fs')
  , f = require('util').format;

var restartAndDone = function(configuration, test) {
  configuration.manager.restart(9, {waitMS:2000}).then(function() {
    test.done();
  });
}

// ../topology_test_descriptions/rs/discover_arbiters.json
exports['Discover arbiters'] = {
  metadata: { requires: { topology: "replicaset" } },

  test: function(configuration, test) {
    var Server = configuration.require.Server
      , Connection = require('../../../lib/connection/connection')
      , ReplSet = configuration.require.ReplSet
      , manager = configuration.manager;

    // Get the primary server
    manager.primary().then(function(manager) {
      // Enable connections accounting
      Connection.enableConnectionAccounting();
      // Attempt to connect
      var server = new ReplSet([{
          host: manager.host
        , port: manager.port
      }], {
        setName: configuration.setName
      });

      server.on('joined', function(_type, _server) {
        // console.log("======================= joined :: " + _type + " :: " + server.name)
        if(_type == 'arbiter') {
          server.destroy();

          setTimeout(function() {
            // console.log(Object.keys(Connection.connections()))
            test.equal(0, Object.keys(Connection.connections()).length);
            Connection.disableConnectionAccounting();
            test.done();
          }, 1000);
        }
      });

      // Start connection
      server.connect();
    });
  }
}

// ../topology_test_descriptions/rs/discover_passives.json
exports['Discover passives'] = {
  metadata: { requires: { topology: "replicaset" } },

  test: function(configuration, test) {
    var Server = configuration.require.Server
      , Connection = require('../../../lib/connection/connection')
      , ReplSet = configuration.require.ReplSet
      , manager = configuration.manager;

    // Get the primary server
    manager.primary().then(function(manager) {
      // Enable connections accounting
      Connection.enableConnectionAccounting();
      // Attempt to connect
      var server = new ReplSet([{
          host: manager.host
        , port: manager.port
      }], {
        setName: configuration.setName
      });

      server.on('joined', function(_type, _server) {
        // console.log("======================= joined :: " + _type + " :: " + server.name)
        // console.dir(_server.lastIsMaster())
        if(_type == 'secondary' && _server.lastIsMaster().passive) {
          // console.log("=== ")
          // console.dir(_server.lastIsMaster())
          server.destroy();

          setTimeout(function() {
            test.equal(0, Object.keys(Connection.connections()).length);
            Connection.disableConnectionAccounting();
            test.done();
          }, 1000);
          // restartAndDone(configuration, test);
        }
      });

      // Start connection
      server.connect();
    });
  }
}

// ../topology_test_descriptions/rs/discover_primary.json
exports['Discover primary'] = {
  metadata: { requires: { topology: "replicaset" } },

  test: function(configuration, test) {
    var Server = configuration.require.Server
      , Connection = require('../../../lib/connection/connection')
      , ReplSet = configuration.require.ReplSet
      , manager = configuration.manager;

    // Get the primary server
    manager.primary().then(function(manager) {
      // Enable connections accounting
      Connection.enableConnectionAccounting();
      // Attempt to connect
      var server = new ReplSet([{
          host: manager.host
        , port: manager.port
      }], {
        setName: configuration.setName
      });

      server.on('joined', function(_type, _server) {
        if(_type == 'primary') {
          server.destroy();

          setTimeout(function() {
            test.equal(0, Object.keys(Connection.connections()).length);
            Connection.disableConnectionAccounting();
            test.done();
          }, 1000);
          // restartAndDone(configuration, test);
        }
      });

      // Start connection
      server.connect();
    });
  }
}

// ../topology_test_descriptions/rs/discover_secondary.json
exports['Discover secondaries'] = {
  metadata: { requires: { topology: "replicaset" } },

  test: function(configuration, test) {
    var Server = configuration.require.Server
      , Connection = require('../../../lib/connection/connection')
      , ReplSet = configuration.require.ReplSet
      , manager = configuration.manager;

    // Get the primary server
    manager.primary().then(function(manager) {
      // Enable connections accounting
      Connection.enableConnectionAccounting();
      // Attempt to connect
      var server = new ReplSet([{
          host: manager.host
        , port: manager.port
      }], {
        setName: configuration.setName
      });

      var count = 0;
      server.on('joined', function(_type, _server) {
        if(_type == 'secondary') count = count + 1;
        if(count == 2) {
          server.destroy();

          setTimeout(function() {
            test.equal(0, Object.keys(Connection.connections()).length);
            Connection.disableConnectionAccounting();
            test.done();
          }, 1000);
          // restartAndDone(configuration, test);
        }
      });

      // Start connection
      server.connect();
    });
  }
}

// ../topology_test_descriptions/rs/discovery.json
exports['Replica set discovery'] = {
  metadata: { requires: { topology: "replicaset" } },

  test: function(configuration, test) {
    var Server = configuration.require.Server
      , Connection = require('../../../lib/connection/connection')
      , ReplSet = configuration.require.ReplSet
      , manager = configuration.manager;

    // State
    var state = {'primary':1, 'secondary': 2, 'arbiter': 1, 'passive': 1};
    // Get the primary server
    manager.primary().then(function(manager) {
      // Enable connections accounting
      Connection.enableConnectionAccounting();
      // Attempt to connect
      var server = new ReplSet([{
          host: manager.host
        , port: manager.port
      }], {
        setName: configuration.setName
      });

      server.on('joined', function(_type, _server) {
        if(_type == 'secondary' && _server.lastIsMaster().passive) {
          state['passive'] = state['passive'] - 1;
        } else {
          state[_type] = state[_type] - 1;
        }

        if(state.primary == 0
          && state.secondary == 0
          && state.arbiter == 0
          && state.passive == 0) {
          server.destroy();

          setTimeout(function() {
            test.equal(0, Object.keys(Connection.connections()).length);
            Connection.disableConnectionAccounting();
            test.done();
          }, 1000);
          // restartAndDone(configuration, test);
        }
      });

      // Start connection
      server.connect();
    });
  }
}

// ../topology_test_descriptions/rs/hosts_differ_from_seeds.json
exports['Host list differs from seeds'] = {
  metadata: {
    requires: {
      topology: "replicaset"
    }
  },

  test: function(configuration, test) {
    var Server = configuration.require.Server
      , Connection = require('../../../lib/connection/connection')
      , ReplSet = configuration.require.ReplSet
      , manager = configuration.manager;

    // State
    var state = {'primary':1, 'secondary': 2, 'arbiter': 1, 'passive': 1};
    // Get the primary server
    manager.primary().then(function(manager) {
      // console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! STARTING")
      Connection.enableConnectionAccounting();
      // Attempt to connect
      var server = new ReplSet([{
        host: manager.host, port: manager.port
      }, {
        host: 'localhost', port: 41000
      }], {
        setName: configuration.setName
      });

      server.on('joined', function(_type, _server) {
        // console.log("======= joined :: " + _type + " :: " + _server.name)
        if(_type == 'secondary' && _server.lastIsMaster().passive) {
          state['passive'] = state['passive'] - 1;
        } else {
          state[_type] = state[_type] - 1;
        }

        // console.dir(state)

        if(state.primary == 0
          && state.secondary == 0
          && state.arbiter == 0
          && state.passive == 0) {
          server.destroy();

          setTimeout(function() {
            test.equal(0, Object.keys(Connection.connections()).length);
            Connection.disableConnectionAccounting();
            test.done();
          // restartAndDone(configuration, test);
          }, 1000);
        }
      });

      // Start connection
      server.connect();
    });
  }
}

// ../topology_test_descriptions/rs/ghost_discovery.json
exports['Ghost discovered/Member brought up as standalone'] = {
  metadata: {
    requires: {
      topology: "replicaset"
    }
  },

  test: function(configuration, test) {
    var Server = configuration.require.Server
      , ServerManager = require('mongodb-topology-manager').Server
      , Connection = require('../../../lib/connection/connection')
      , ReplSet = configuration.require.ReplSet
      , manager = configuration.manager;

    // State
    var state = {'primary':1, 'secondary': 1, 'arbiter': 1, 'passive': 1};
    // console.log("------------------------ 0")
    // Get the primary server
    manager.primary().then(function(primaryManager) {
      // console.log("------------------------ 1")
      // Get the secondary server
      manager.secondaries().then(function(managers) {
        // console.log("------------------------ 2")
        var serverManager = managers[0];

        // Stop the secondary
        serverManager.stop().then(function() {
          // console.log("------------------------ 3")
          // Start a new server manager
          var nonReplSetMember = new ServerManager('mongod', {
            bind_ip: serverManager.host,
            port: serverManager.port,
            dbpath: serverManager.options.dbpath
          });

          // Start a non replset member
          nonReplSetMember.start().then(function() {
            // console.log("------------------------ 4")
            var config = [{
                host: primaryManager.host
              , port: primaryManager.port
            }];

            var options = {
              setName: configuration.setName
            };
            // console.log("------------------------ 4:1")

            // Wait for primary
            manager.waitForPrimary().then(function() {
              // console.log("------------------------ 5")

              // Enable connections accounting
              Connection.enableConnectionAccounting();
              // Attempt to connect
              var replset = new ReplSet(config, options);
              replset.on('joined', function(_type, _server) {
                // console.log("------------------------ 6")
                // console.log("======= joined :: " + _type + " :: " + _server.name)
                if(_type == 'secondary' && _server.lastIsMaster().passive) {
                  state['passive'] = state['passive'] - 1;
                } else {
                  state[_type] = state[_type] - 1;
                }
                // console.dir(state)

                if(state.primary == 0
                  && state.secondary == 0
                  && state.arbiter == 0
                  && state.passive == 0) {
                    // console.log("------------------------ 7")
                  replset.destroy();
                  // setTimeout(function() {
                    // console.log("=================== " + Object.keys(Connection.connections()).length)
                    // console.dir(Object.keys(Connection.connections()));
                  setTimeout(function() {
                    test.equal(0, Object.keys(Connection.connections()).length);
                    Connection.disableConnectionAccounting();
                  //   console.log("------------------------ 8")
                  //   // test.done();
                  //   restartAndDone(configuration, test);
                  // }, 1000)

                    // Stop the normal server
                    nonReplSetMember.stop().then(function() {
                      // console.log("------------------------ 8")
                      // Restart the secondary server
                      serverManager.start().then(function() {
                        // console.log("------------------------ 8")
                        restartAndDone(configuration, test);
                      });
                    });
                  }, 1000);
                }
              });

              // Start connection
              replset.connect();
            });
          });
        });
      });
    });
  }
}

// ../topology_test_descriptions/rs/member_reconfig.json
exports['Member removed by reconfig'] = {
  metadata: {
    requires: {
      topology: "replicaset"
    }
  },

  test: function(configuration, test) {
    var Server = configuration.require.Server
      , Connection = require('../../../lib/connection/connection')
      , ReplSet = configuration.require.ReplSet
      , manager = configuration.manager;

    // State
    var state = {'primary':[], 'secondary': [], 'arbiter': [], 'passive': []};
    // console.log("============================= 0")
    // Get the primary server
    manager.primary().then(function(primaryServerManager) {
      // console.log("============================= 1")
      // Get the secondary server
      manager.secondaries().then(function(managers) {
        // console.log("============================= 2")
        var secondaryServerManager = managers[0];

        var config = [{
            host: primaryServerManager.host
          , port: primaryServerManager.port
        }];

        var options = {
          setName: configuration.setName
        };

        // Contains the details for the removed server
        var removedServer = false;
        // console.log("============================= 3")
        // Enable connections accounting
        Connection.enableConnectionAccounting();
        // console.log("============================= 4")
        // Attempt to connect
        var server = new ReplSet(config, options);
        server.on('fullsetup', function(_server) {
          // console.log("------------------------------------------ 0")
          // Save number of secondaries
          var numberOfSecondaries = server.s.replicaSetState.secondaries.length;
          var numberOfArbiters = server.s.replicaSetState.arbiters.length;
          var numberOfPassives = server.s.replicaSetState.passives.length;

          // Let's listen to changes
          server.on('left', function(_t, _server) {
            // console.log("--------- left :: " + _t + " :: " + _server.name)
            if(_server.s.options.port == secondaryServerManager.options.port) {
              // console.log("server.state.primary = " + (server.s.replicaSetState.primary != null))
              // console.log("numberOfSecondaries = " + numberOfSecondaries)
              // console.log("server.state.secondaries.length = " + server.s.replicaSetState.secondaries.length)
              // console.log("server.state.arbiters.length = " + server.s.replicaSetState.arbiters.length)
              // console.log("server.state.passives.length = " + server.s.replicaSetState.passives.length)
                test.ok(server.s.replicaSetState.primary != null);
                test.ok(server.s.replicaSetState.secondaries.length < numberOfSecondaries);
                test.equal(1, server.s.replicaSetState.arbiters.length);
                server.destroy();

                setTimeout(function() {
                  // console.log("=================== 0")
                  // console.dir(Object.keys(Connection.connections()))
                  test.equal(0, Object.keys(Connection.connections()).length);
                  // console.log("=================== 1")
                  Connection.disableConnectionAccounting();
                  restartAndDone(configuration, test);
                }, 5000);
              //   test.equal(1, server.s.replicaSetState.passives.length);
            }
          });

          server.on('joined', function(_t, _server) {
          });

          // console.log("------------------------------------------ 1")
          // console.dir(secondaryServerManager.options)
          // Remove the secondary server
          manager.removeMember(secondaryServerManager, {
            returnImmediately: false, force: false, skipWait:true
          }).then(function() {
            // console.log("------------------------------------------ 2")

            // // Step down primary and block until we have a new primary
            // manager.stepDownPrimary(false, {stepDownSecs: 10}).then(function() {
              // console.log("------------------------------------------ 3")
            setTimeout(function() {
              removedServer = true;

            }, 15000)
            // });
          });
        });

        // console.log("============================= 5")
        // Start connection
        server.connect();
      });
    });
  }
}

// ../topology_test_descriptions/rs/discovery.json
exports['Should not leak any connections after hammering the replicaset with a mix of operations'] = {
  metadata: { requires: { topology: "replicaset" } },

  test: function(configuration, test) {
    var Server = configuration.require.Server
      , Connection = require('../../../lib/connection/connection')
      , ReplSet = configuration.require.ReplSet
      , ReadPreference = configuration.require.ReadPreference
      , manager = configuration.manager;

    // State
    var state = {'primary':1, 'secondary': 2, 'arbiter': 1, 'passive': 1};
    // Get the primary server
    manager.primary().then(function(manager) {
      // Enable connections accounting
      Connection.enableConnectionAccounting();
      Server.enableServerAccounting();
      // Attempt to connect
      var server = new ReplSet([{
          host: manager.host
        , port: manager.port
      }], {
        setName: configuration.setName
      });

      var donecount = 0;

      function done() {
        donecount = donecount + 1;

        if(donecount == 2) {
          // console.log("------------------------------------------------------------ state 0")
          // console.log("number of connections :: " + Object.keys(Connection.connections()).length)
          // console.log("number of servers :: " + Object.keys(Server.servers()).length)

          server.destroy();

          Connection.disableConnectionAccounting();
          Server.disableServerAccounting();

          setTimeout(function() {
            // console.log("------------------------------------------------------------ state 1")
            // console.log("number of connections :: " + Object.keys(Connection.connections()).length)
            // console.log("number of servers :: " + Object.keys(Server.servers()).length)
            test.equal(0, Object.keys(Connection.connections()).length);
            test.equal(0, Object.keys(Server.servers()).length);
            test.done();
          }, 5000)
        }
      }

      server.on('connect', function(_server) {
        var insertcount = 10000;
        var querycount = 10000;

        for(var i = 0; i < 10000; i++) {
          _server.insert(f("%s.inserts", configuration.db), [{a:1}], {
            writeConcern: {w:1}, ordered:true
          }, function(err, results) {
            insertcount = insertcount - 1;

            if(insertcount == 0) {
              done();
            }
          });
        }

        for(var i = 0; i < 10000; i++) {
          // Execute find
          var cursor = _server.cursor(f("%s.inserts1", configuration.db), {
              find: f("%s.inserts1", configuration.db)
            , query: {}
          }, {readPreference: ReadPreference.secondary})
          cursor.setCursorLimit(1);
          // Execute next
          cursor.next(function(err, d) {
            querycount = querycount - 1;

            if(querycount == 0) {
              done();
            }
          });

          // _server.cursor(f("%s.inserts", configuration.db), [{a:1}], {
          //   writeConcern: {w:1}, ordered:true
          // }, function(err, results) {
          //   insertcount = insertcount - 1;
          //
          //   if(insertcount == 0) {
          //     done();
          //   }
          // });
        }

        // if(_type == 'secondary' && _server.lastIsMaster().passive) {
        //   state['passive'] = state['passive'] - 1;
        // } else {
        //   state[_type] = state[_type] - 1;
        // }
        //
        // if(state.primary == 0
        //   && state.secondary == 0
        //   && state.arbiter == 0
        //   && state.passive == 0) {
        //   server.destroy();
        //
        //   setTimeout(function() {
        //     test.equal(0, Object.keys(Connection.connections()).length);
        //     Connection.disableConnectionAccounting();
        //     test.done();
        //   }, 1000);
        //   // restartAndDone(configuration, test);
        // }
      });

      // Start connection
      server.connect();
    });
  }
}
