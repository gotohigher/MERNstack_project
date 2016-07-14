"use strict";

var f = require('util').format;

/**
 * @ignore
 */
exports['Should connect to mongos proxies using connectiong string and options'] = {
  metadata: { requires: { topology: 'sharded' } },

  // The actual test we wish to run
  test: function(configuration, test) {
    var MongoClient = configuration.require.MongoClient;

    var url = f('mongodb://%s:%s,%s:%s/sharded_test_db?w=1&readPreference=secondaryPreferred&readPreferenceTags=sf%3A1&readPreferenceTags='
      , configuration.host, configuration.port
      , configuration.host, configuration.port + 1);
    MongoClient.connect(url, {
      mongos: {
        haInterval: 500
      }
    }, function(err, db) {
      test.equal(null, err);
      test.ok(db != null);
      test.equal(500, db.serverConfig.haInterval);

      db.collection("replicaset_mongo_client_collection").update({a:1}, {b:1}, {upsert:true}, function(err, result) {
        test.equal(null, err);
        test.equal(1, result.result.n);

        // Perform fetch of document
        db.collection("replicaset_mongo_client_collection").findOne(function(err, d) {
          test.equal(null, err);

          db.close();
          test.done();
        });
      });
    });
  }
}

/**
 * @ignore
 */
exports['Should correctly connect with a missing mongos'] = {
  metadata: { requires: { topology: 'sharded' } },

  // The actual test we wish to run
  test: function(configuration, test) {
    var MongoClient = configuration.require.MongoClient;

    var url = f('mongodb://%s:%s,%s:%s,localhost:50002/sharded_test_db?w=1'
      , configuration.host, configuration.port
      , configuration.host, configuration.port + 1);

    MongoClient.connect(url, {}, function(err, db) {
      setTimeout(function() {
        test.equal(null, err);
        test.ok(db != null);
        db.close();
        test.done();
      }, 2000)
    });
  }
}

/**
 * @ignore
 */
exports['Should correctly emit open and fullsetup to all db instances'] = {
  metadata: { requires: { topology: 'sharded' } },

  // The actual test we wish to run
  test: function(configuration, test) {
    var Mongos = configuration.require.Mongos
      , Server = configuration.require.Server
      , Db = configuration.require.Db;

    var db_conn = new Db('integration_test_', new Mongos([
      new Server(configuration.host, configuration.port),
      new Server(configuration.host, configuration.port + 1)]), {w:1});
    var db2 = db_conn.db('integration_test_2');

    var close_count = 0;
    var open_count = 0;
    var fullsetup_count = 0;

    db2.on('close', function() {
      close_count = close_count + 1;
    });

    db_conn.on('close', function() {
      close_count = close_count + 1;
    });

    db2.on('open', function(err, db) {
      test.equal('integration_test_2', db.databaseName);
      open_count = open_count + 1;
    });

    db_conn.on('open', function(err, db) {
      test.equal('integration_test_', db.databaseName);
      open_count = open_count + 1;
    });

    db2.on('fullsetup', function(err, db) {
      test.equal('integration_test_2', db.databaseName);
      fullsetup_count = fullsetup_count + 1;
    });

    db_conn.on('fullsetup', function(err, db) {
      test.equal('integration_test_', db.databaseName);
      fullsetup_count = fullsetup_count + 1;
    });

    db_conn.open(function (err) {
      if (err) throw err;
      var col1 = db_conn.collection('test');
      var col2 = db2.collection('test');

      var testData = { value : "something" };
      col1.insert(testData, function (err) {
        if (err) throw err;

        var testData = { value : "something" };
        col2.insert(testData, function (err) {
          if (err) throw err;
          db2.close(function() {
            setTimeout(function() {
              test.equal(2, close_count);
              test.equal(2, open_count);
              test.equal(2, fullsetup_count);
              test.done();
            }, 1000);
          });
        });
      });
    });
  }
}

/**
 * @ignore
 */
exports['Should exercise all options on mongos topology'] = {
  metadata: { requires: { topology: 'sharded' } },

  // The actual test we wish to run
  test: function(configuration, test) {
    var MongoClient = configuration.require.MongoClient;

    var url = f('mongodb://%s:%s,%s:%s/sharded_test_db?w=1&readPreference=secondaryPreferred&readPreferenceTags=sf%3A1&readPreferenceTags='
      , configuration.host, configuration.port
      , configuration.host, configuration.port + 1);
    MongoClient.connect(url, {
      mongos: {
        haInterval: 500
      }
    }, function(err, db) {
      test.equal(null, err);
      test.ok(db != null);
      test.equal(500, db.serverConfig.haInterval);
      test.ok(db.serverConfig.capabilities() != null);
      test.equal(true, db.serverConfig.isConnected());
      test.ok(db.serverConfig.lastIsMaster() != null);
      test.ok(db.serverConfig.connections() != null);
      test.ok(db.serverConfig.isMasterDoc != null);
      test.ok(db.serverConfig.bson != null);

      db.close();
      test.done();
    });
  }
}

/**
 * @ignore
 */
exports['Should correctly modify the server reconnectTries for all sharded proxy instances'] = {
  metadata: { requires: { topology: 'sharded' } },

  // The actual test we wish to run
  test: function(configuration, test) {
    var mongo = configuration.require
      , MongoClient = mongo.MongoClient
      , Db = configuration.require.Db
      , CoreServer = configuration.require.CoreServer
      , CoreConnection = configuration.require.CoreConnection;

    var url = f('mongodb://%s:%s,%s:%s/sharded_test_db?w=1&readPreference=secondaryPreferred&readPreferenceTags=sf%3A1&readPreferenceTags='
      , configuration.host, configuration.port
      , configuration.host, configuration.port + 1);

    MongoClient.connect(url, {
      reconnectTries: 10
    }, function(err, db) {
      test.equal(null, err);
      test.ok(db != null);

      var servers = db.serverConfig.s.mongos.connectedProxies;
      for (var i = 0; i < servers.length; i++) {
        test.equal(10, servers[i].s.pool.options.reconnectTries);
      }

      test.done();
    });
  }
}
