"use strict";
var assign = require('../../../../lib/utils').assign;

exports['Should correctly timeout socket operation and then correctly re-execute'] = {
  metadata: {
    requires: {
      generators: true,
      topology: "single"
    }
  },

  test: function(configuration, test) {
    var Server = configuration.require.Server,
      ObjectId = configuration.require.BSON.ObjectId,
      co = require('co'),
      mockupdb = require('../../../mock');

    // Contain mock server
    var server = null;
    var running = true;
    // Current index for the ismaster
    var currentStep = 0;
    // Primary stop responding
    var stopRespondingPrimary = false;

    // Default message fields
    var defaultFields = {
      "ismaster" : true,
      "maxBsonObjectSize" : 16777216,
      "maxMessageSizeBytes" : 48000000,
      "maxWriteBatchSize" : 1000,
      "localTime" : new Date(),
      "maxWireVersion" : 3,
      "minWireVersion" : 0,
      "ok" : 1
    }

    // Primary server states
    var serverIsMaster = [assign({}, defaultFields)];
    var timeoutPromise = function(timeout) {
      return new Promise(function(resolve, reject) {
        setTimeout(function() {
          resolve();
        }, timeout);
      });
    }

    // Boot the mock
    co(function*() {
      server = yield mockupdb.createServer(37019, 'localhost');

      // Primary state machine
      co(function*() {
        while(running) {
          var request = yield server.receive();

          // Get the document
          var doc = request.document;
          if(doc.ismaster && currentStep == 0) {
            request.reply(serverIsMaster[0]);
            currentStep += 1;
          } else if(doc.insert && currentStep == 1) {
            // Stop responding to any calls (emulate dropping packets on the floor)
            if(stopRespondingPrimary) {
              yield timeoutPromise(3000);
              continue;
            }

            currentStep += 1;
          } else if(doc.ismaster && currentStep == 2) {
            request.reply(serverIsMaster[0]);
          } else if(doc.insert && currentStep == 2) {
            request.reply({ok:1, n:doc.documents, lastOp: new Date()});
          }
        }
      });

      // Start dropping the packets
      setTimeout(function() {
        stopRespondingPrimary = true;
      }, 5000);
    });

    // Attempt to connect
    var replset = new Server({
      host: 'localhost',
      port: '37019',
      connectionTimeout: 5000,
      socketTimeout: 1000,
      size: 1
    });

    // Not done
    var done = false;
    // console.log("--------- -1")

    // Add event listeners
    replset.once('connect', function(_server) {
      // console.log("--------- 0")
      _server.insert('test.test', [{created:new Date()}], function(err, r) {
        // console.log("--------- 1")
        test.ok(err != null);
        // console.dir(err)

        function wait() {
          setTimeout(function() {
            _server.insert('test.test', [{created:new Date()}], function(err, r) {
              if(r && !done) {
                done = true;
                test.equal(37019, r.connection.port);
                replset.destroy({force:true});
                running = false;
                test.done();
              } else {
                wait();
              }
            });
          }, 500);
        }

        wait();
      });
    });

    replset.on('error', function(){});
    setTimeout(function() { replset.connect(); }, 100);
  }
}

exports['Should correctly recover from an immediate shutdown mid insert'] = {
  metadata: {
    requires: {
      generators: true,
      topology: "single"
    }
  },

  test: function(configuration, test) {
    var Server = configuration.require.Server,
      ObjectId = configuration.require.BSON.ObjectId,
      co = require('co'),
      mockupdb = require('../../../mock');

    // Contain mock server
    var server = null;
    var running = true;
    // Current index for the ismaster
    var currentStep = 0;
    // Should fail due to broken pipe
    var brokenPipe = false;

    // Default message fields
    var defaultFields = {
      "ismaster" : true,
      "maxBsonObjectSize" : 16777216,
      "maxMessageSizeBytes" : 48000000,
      "maxWriteBatchSize" : 1000,
      "localTime" : new Date(),
      "maxWireVersion" : 3,
      "minWireVersion" : 0,
      "ok" : 1
    }

    // Primary server states
    var serverIsMaster = [assign({}, defaultFields)];

    var timeoutPromise = function(timeout) {
      return new Promise(function(resolve, reject) {
        setTimeout(function() {
          resolve();
        }, timeout);
      });
    }

    // Boot the mock
    var __server;
    co(function*() {
      __server = yield mockupdb.createServer(37017, 'localhost', {
        onRead: function(server, connection, buffer, bytesRead) {
          // Force EPIPE error
          if(currentStep == 1)  {
            // Destroy connection mid write
            connection.destroy();
            // Reset the mock to accept ismasters
            setTimeout(function() {
              currentStep += 1;
            }, 10);
            // Return connection was destroyed
            return true;
          }
        }
      });

      // Primary state machine
      co(function*() {
        while(running) {
          var request = yield __server.receive();
          // Get the document
          var doc = request.document;
          if(doc.ismaster && currentStep == 0) {
            currentStep += 1;
            request.reply(serverIsMaster[0]);
          } else if(doc.insert && currentStep == 2) {
            currentStep += 1;
            request.reply({ok:1, n:doc.documents, lastOp: new Date()});
          } else if(doc.ismaster) {
            request.reply(serverIsMaster[0]);
          }
        }
      });
    });

    // Attempt to connect
    var server = new Server({
      host: 'localhost',
      port: '37017',
      connectionTimeout: 3000,
      socketTimeout: 2000,
      size: 1
    });

    // console.log("!!!! server connect")
    var docs = [];
    // Create big insert message
    for(var i = 0; i < 1000; i++) {
      docs.push({
        a:i,
        string: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string1: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string2: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string3: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string4: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string5: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string6: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string7: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string8: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string9: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string10: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string11: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string12: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string13: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string14: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string15: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string16: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string17: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string18: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string19: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string20: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string21: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string22: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string23: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string24: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string25: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string26: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string27: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
        string28: 'hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world',
      });
    }

    // Add event listeners
    server.once('connect', function(_server) {
      // console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! 0")
      _server.insert('test.test', docs, function(err, r) {
        // console.log("!!!! insert")
        test.ok(err != null);
        brokenPipe = true;
      });
    });

    // console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! 1")

    server.once('reconnect', function(_server) {
      _server.insert('test.test', [{created:new Date()}], function(err, r) {
        test.ok(brokenPipe);
        _server.destroy();
        running = false;
        __server.destroy();
        test.done();
      });
    });

    server.on('error', function(){});
    setTimeout(function() { server.connect(); }, 100);
  }
}

// exports['Should not start double reconnect timeouts due to socket timeout during attemptReconnect'] = {
//   metadata: {
//     requires: {
//       generators: true,
//       topology: "single"
//     }
//   },
//
//   test: function(configuration, test) {
//     var Server = configuration.require.Server,
//       ObjectId = configuration.require.BSON.ObjectId,
//       co = require('co'),
//       mockupdb = require('../../../mock');
//
//     // Contain mock server
//     var server = null;
//     var running = true;
//     // Current index for the ismaster
//     var currentStep = 0;
//     // Primary stop responding
//     var stopRespondingPrimary = false;
//
//     // Default message fields
//     var defaultFields = {
//       "ismaster" : true,
//       "maxBsonObjectSize" : 16777216,
//       "maxMessageSizeBytes" : 48000000,
//       "maxWriteBatchSize" : 1000,
//       "localTime" : new Date(),
//       "maxWireVersion" : 3,
//       "minWireVersion" : 0,
//       "ok" : 1
//     }
//
//     // Primary server states
//     var serverIsMaster = [assign({}, defaultFields)];
//     var timeoutPromise = function(timeout) {
//       return new Promise(function(resolve, reject) {
//         setTimeout(function() {
//           resolve();
//         }, timeout);
//       });
//     }
//
//     // Boot the mock
//     co(function*() {
//       server = yield mockupdb.createServer(37019, 'localhost');
//
//       // Primary state machine
//       co(function*() {
//         while(running) {
//           if(currentStep == 1) {
//             console.log("--- timeout 0")
//             yield timeoutPromise(5000);
//             console.log("--- timeout 1")
//             continue;
//           }
//
//           var request = yield server.receive();
//
//           // Get the document
//           var doc = request.document;
//           if(doc.ismaster && currentStep == 0) {
//             request.reply(serverIsMaster[0]);
//             currentStep += 1;
//           }
//         }
//       });
//
//       // // Start dropping the packets
//       // setTimeout(function() {
//       //   stopRespondingPrimary = true;
//       // }, 5000);
//     });
//
//     // Attempt to connect
//     var server = new Server({
//       host: 'localhost',
//       port: 37019,
//       connectionTimeout: 2000,
//       socketTimeout: 1000,
//       size: 1
//     });
//
//     // Not done
//     var done = false;
//
//     // Add event listeners
//     server.once('connect', function(_server) {
//       console.log("=============== connect")
//       // _server.insert('test.test', [{created:new Date()}], function(err, r) {
//       //   test.ok(err != null);
//       //   // console.dir(err)
//       //
//       //   function wait() {
//       //     setTimeout(function() {
//       //       _server.insert('test.test', [{created:new Date()}], function(err, r) {
//       //         if(r && !done) {
//       //           done = true;
//       //           test.equal(37019, r.connection.port);
//       //           replset.destroy();
//       //           running = false;
//       //           test.done();
//       //         } else {
//       //           wait();
//       //         }
//       //       });
//       //     }, 500);
//       //   }
//       //
//       //   wait();
//       // });
//     });
//
//     server.on('error', function(){});
//     server.connect();
//   }
// }
