var mongodb = process.env['TEST_NATIVE'] != null ? require('../../lib/mongodb').native() : require('../../lib/mongodb').pure();

var testCase = require('../../deps/nodeunit').testCase,
  debug = require('util').debug,
  inspect = require('util').inspect,
  Buffer = require('buffer').Buffer,
  gleak = require('../../tools/gleak'),
  fs = require('fs'),
  ConnectionPool = require('../../lib/mongodb/connection/connection_pool').ConnectionPool;

var tests = testCase({
  setUp: function(callback) {
    callback();        
  },
  
  tearDown: function(callback) {
    callback();        
  },

  'Should Correctly create a pool instance with the expected values' : function(test) {
    var connectionPool = new ConnectionPool('localhost', 2000, 1, {timeout:100, noDelay:true});
    test.equal(100, connectionPool.socketOptions.timeout);
    test.equal(true, connectionPool.socketOptions.noDelay);
    test.equal(null, connectionPool.socketOptions.encoding);
    test.equal(0, connectionPool.socketOptions.bufferSize);    
    test.done();
  },
  
  'Should correctly fail due to no server' : function(test) {
    var connectionPool = new ConnectionPool('localhost', 2000, 4, {timeout:100, noDelay:true});
  
    // // Add event handler that will fire once the pool is ready
    connectionPool.on("poolReady", function(err, result) {      
    })
  
    // Add event handler that will fire when it fails
    connectionPool.on("error", function(err, connection) {
      // console.log("--------------------------------------------- FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")
      // console.dir(connectionPool.waitingToOpen)
      // console.dir(connectionPool.connectionsWithErrors)
      // console.dir(connectionPool.openConnections)
      
      test.equal(0, Object.keys(connectionPool.waitingToOpen).length);
      test.equal(4, Object.keys(connectionPool.connectionsWithErrors).length);
      test.equal(0, Object.keys(connectionPool.openConnections).length);      
      test.done();
    });
    
    // Start the pool
    connectionPool.start();    
  },
  
  'Should Correctly create a pool of connections and receive an ok when all connections are active' : function(test) {
    var connectionPool = new ConnectionPool('localhost', 27017, 4, {timeout:100, noDelay:true});
  
    // Add event handler that will fire once the pool is ready
    connectionPool.on("poolReady", function() {
      test.done();
    })
    
    // Start the pool
    connectionPool.start();    
  },
  
  // 'Should Correctly '
  
  noGlobalsLeaked : function(test) {
    var leaks = gleak.detectNew();
    test.equal(0, leaks.length, "global var leak detected: " + leaks.join(', '));
    test.done();
  }  
});

// Assign out tests
module.exports = tests;