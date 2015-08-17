"use strict";

var f = require('util').format,
  fs = require('fs');

exports['Correctly receive the APM events for an insert'] = {
  metadata: { requires: { topology: ['single'] } },

  // The actual test we wish to run
  test: function(configuration, test) {
    var started = [];
    var succeeded = [];
    var failed = [];
    var callbackTriggered = false;

    var listener = require('../..').instrument(function(err, instrumentations) {
      callbackTriggered = true;
    });

    listener.on('started', function(event) {
      if(event.commandName == 'insert')
        started.push(event);
    });

    listener.on('succeeded', function(event) {
      if(event.commandName == 'insert')
        succeeded.push(event);
    });

    var db = configuration.newDbInstance({w:1}, {poolSize:1, auto_reconnect:false});
    db.open(function(err, db) {
      test.equal(null, err);

      db.collection('apm_test').insertOne({a:1}).then(function(r) {
        test.equal(1, r.insertedCount);
        test.equal(1, started.length);
        test.equal(1, succeeded.length);
        test.ok(callbackTriggered);
        listener.uninstrument();

        db.close();
        test.done();
      });
    });
  }
}

exports['Correctly receive the APM events for an insert using custom operationId and time generator'] = {
  metadata: { requires: { topology: ['single'] } },

  // The actual test we wish to run
  test: function(configuration, test) {
    var started = [];
    var succeeded = [];
    var failed = [];
    var callbackTriggered = false;

    var listener = require('../..').instrument({
      operationIdGenerator: {
        next: function() {
          return 10000;
        }
      }, 
      timestampGenerator: {
        current: function() {
          return 1;
        },
        duration: function(start, end) {
          return end - start;
        }
      }
    }, function(err, instrumentations) {
      callbackTriggered = true;
    });

    listener.on('started', function(event) {
      if(event.commandName == 'insert')
        started.push(event);
    });

    listener.on('succeeded', function(event) {
      if(event.commandName == 'insert')
        succeeded.push(event);
    });

    var db = configuration.newDbInstance({w:1}, {poolSize:1, auto_reconnect:false});
    db.open(function(err, db) {
      db.collection('apm_test_1').insertOne({a:1}).then(function(r) {
        test.equal(1, started.length);
        test.equal(1, succeeded.length);
        test.equal(10000, started[0].operationId);
        test.equal(0, succeeded[0].duration);
        test.ok(callbackTriggered);
        listener.uninstrument();

        db.close();
        test.done();
      });
    });
  }
}

var validateExpecations = function(test, expectation, results) {
  if(expectation.command_started_event) {
    // Get the command
    var obj = expectation.command_started_event;
    // Unpack the expectation
    var command = obj.command;
    var databaseName = obj.database_name;
    var commandName = obj.command_name;

    // Get the result
    var result = results.starts.shift();

    // Validate the test
    test.equal(commandName, result.commandName)
  } else if(expectation.command_succeeded_event) {
    var obj = expectation.command_succeeded_event;
    // Unpack the expectation
    var reply = obj.reply;
    var databaseName = obj.database_name;
    var commandName = obj.command_name;

    // Get the result
    var result = results.successes.shift();

    // Validate the test
    test.equal(commandName, result.commandName);
    // test.deepEqual(reply[0], result.reply.result);
  } else if(expectation.command_failed_event) {
    var obj = expectation.command_failed_event;
    // Unpack the expectation
    var reply = obj.reply;
    var databaseName = obj.database_name;
    var commandName = obj.command_name;
    // Get the result
    var result = results.failures.shift();
    // Validate the test
    test.equal(commandName, result.commandName);
  }
}

var executeOperation = function(assert, client, listener, scenario, test, callback) {
  var successes = [];
  var failures = [];
  var starts = [];

  // Get the operation
  var operation = test.operation;
  // Get the command name
  var commandName = operation.name;
  // Get the arguments
  var args = operation.arguments || {};
  // Get the database instance
  var db = client.db(scenario.database_name);
  // Get the collection
  var collection = db.collection(scenario.collection_name);
  // Parameters
  var params = [];
  // Get the data
  var data = scenario.data;

  // Drop the collection
  collection.drop(function(err) {
    // Insert the data
    collection.insertMany(data, function(err, r) {
      assert.equal(null, err);
      assert.equal(data.length, r.insertedCount);

      // Set up the listeners
      listener.on('started', function(event) {
        starts.push(event);
      });

      listener.on('succeeded', function(event) {
        successes.push(event);
      });

      listener.on('failed', function(event) {
        failures.push(event);
      });

      // Cleanup the listeners
      var cleanUpListeners = function(_listener) {
        _listener.removeAllListeners('started');
        _listener.removeAllListeners('succeeded');
        _listener.removeAllListeners('failed');
      }

      // Unpack the operation
      if(args.filter) {
        params.push(args.filter);
      }

      if(args.deletes) {
        params.push(args.deletes);
      } 

      if(args.document) {
        params.push(args.document);
      } 

      if(args.documents) {
        params.push(args.documents);
      } 

      if(args.update) {
        params.push(args.update);
      }

      if(args.requests) {
        params.push(args.requests);
      }

      // Find command is special needs to executed using toArray
      if(operation.name == 'find') {
        var cursor = collection[commandName]();

        if(args.filter) {
          cursor = cursor.filter(args.filter);
        }

        if(args.batchSize) {
          cursor = cursor.batchSize(args.batchSize);
        }

        if(args.limit) {
          cursor = cursor.limit(args.limit);
        }

        // Execute find
        cursor.toArray(function(err, r) {
          // Validate the expectations
          test.expectations.forEach(function(x, index) {
            validateExpecations(assert, x, {
              successes: successes, failures: failures, starts: starts
            });
          });

          // Cleanup listeners
          cleanUpListeners(listener);

          // Finish the operation
          callback();
        });
      } else {
        params.push(function(err, result) {
          // Validate the expectations
          test.expectations.forEach(function(x, index) {
            validateExpecations(assert, x, {
              successes: successes, failures: failures, starts: starts
            });
          });

          // Cleanup listeners
          cleanUpListeners(listener);

          // Finish the operation
          callback();
        });

        // Execute the operation
        collection[commandName].apply(collection, params);
      }
    });
  });
}

var executeTests = function(assert, client, listener, scenario, tests, callback) {
  if(tests.length == 0) return callback();
  // Get the scenario
  var test = tests.shift();
  // Execute the test
  console.log(f('execute test [%s]', test.description));

  // Setup and execute the operation
  executeOperation(assert, client, listener, scenario, test, function() {
    
    // Execute the next test
    executeTests(assert, client, listener, scenario, tests, callback);
  });
}

var executeSuite = function(assert, client, listener, scenarios, callback) {
  if(scenarios.length == 0) return callback();
  // Get the scenario
  var scenario = scenarios.shift();
  // Get the data
  var data = scenario.data;
  // Get the database
  var db = client.db(scenario.database_name);
  // Insert into the db
  var collection = db.collection(scenario.collection_name);    
  // Execute the tests
  executeTests(assert, client, listener, scenario, scenario.tests.slice(0), function() {
    // Execute the next suite
    executeSuite(assert, client, listener, scenarios, callback);
  });    
}

exports['Correctly run all JSON APM Tests'] = {
  metadata: { requires: { topology: ['single'] } },

  // The actual test we wish to run
  test: function(configuration, test) {
    // Read all the json files for the APM spec
    var scenarios = fs.readdirSync(__dirname + '/apm').filter(function(x) {
      return x.indexOf('.json') != -1;
    }).map(function(x) {
      return JSON.parse(fs.readFileSync(__dirname + '/apm/' + x));
    });

    // Get the methods
    var MongoClient = require('../..');
    var listener = require('../../').instrument();

    // Connect to the db
    MongoClient.connect(configuration.url(), function(err, client) {
      test.equal(null, err);

      // Execute each group of tests
      executeSuite(test, client, listener, scenarios.slice(0), function(err) {
        test.equal(null, err);

        listener.uninstrument();
        client.close();
        test.done();      
      });
    });
  }
}

exports['Correctly receive the APM events for a find with getmore and killcursor'] = {
  metadata: { requires: { topology: ['single'] } },

  // The actual test we wish to run
  test: function(configuration, test) {
    var ReadPreference = configuration.require.ReadPreference;
    var started = [];
    var succeeded = [];
    var failed = [];

    var listener = require('../..').instrument();
    listener.on('started', function(event) {
      if(event.commandName == 'find' || event.commandName == 'getMore' || event.commandName == 'killCursors')
        started.push(event);
    });

    listener.on('succeeded', function(event) {
      if(event.commandName == 'find' || event.commandName == 'getMore' || event.commandName == 'killCursors')
        succeeded.push(event);
    });

    listener.on('failed', function(event) {
      if(event.commandName == 'find' || event.commandName == 'getMore' || event.commandName == 'killCursors')
        failed.push(event);
    });

    var db = configuration.newDbInstance({w:1}, {poolSize:1, auto_reconnect:false});
    db.open(function(err, db) {
      test.equal(null, err);

      // Drop the collection
      db.collection('apm_test_2').drop(function(err, r) {

        // Insert test documents
        db.collection('apm_test_2').insertMany([{a:1}, {a:1}, {a:1}, {a:1}, {a:1}, {a:1}], {w:1}).then(function(r) {
          test.equal(6, r.insertedCount);

          db.collection('apm_test_2').find({a:1})
            .project({_id: 1, a:1})
            .hint({'_id':1})
            .skip(1)
            .limit(100)
            .batchSize(2)
            .comment('some comment')
            .maxScan(1000)
            .maxTimeMS(5000)
            .setReadPreference(ReadPreference.PRIMARY)
            .addCursorFlag('noCursorTimeout', true)
            .toArray().then(function(docs) {
              // Assert basic documents
              test.equal(5, docs.length);
              test.equal(3, started.length);
              test.equal(3, succeeded.length);
              test.equal(0, failed.length);

              // Success messages
              test.equal(2, succeeded[0].reply.length);
              test.equal(succeeded[0].operationId, succeeded[1].operationId);
              test.equal(succeeded[0].operationId, succeeded[2].operationId);
              test.equal(2, succeeded[1].reply.length);
              test.equal(1, succeeded[2].reply.length);

              // Started
              test.equal(started[0].operationId, started[1].operationId);
              test.equal(started[0].operationId, started[2].operationId);

              listener.uninstrument();
              db.close();
              test.done();
          }).catch(function(err) {
            console.log(err.stack)
          });
        }).catch(function(e) {
          console.log(err.stack)
        });
      });
    });
  }
}

exports['Correctly receive the APM failure event for find'] = {
  metadata: { requires: { topology: ['single'], mongodb: ">=2.6.0" } },

  // The actual test we wish to run
  test: function(configuration, test) {
    var ReadPreference = configuration.require.ReadPreference;
    var started = [];
    var succeeded = [];
    var failed = [];

    var listener = require('../..').instrument();
    listener.on('started', function(event) {
      if(event.commandName == 'find' || event.commandName == 'getMore' || event.commandName == 'killCursors')
        started.push(event);
    });

    listener.on('succeeded', function(event) {
      if(event.commandName == 'find' || event.commandName == 'getMore' || event.commandName == 'killCursors')
        succeeded.push(event);
    });

    listener.on('failed', function(event) {
      if(event.commandName == 'find' || event.commandName == 'getMore' || event.commandName == 'killCursors')
        failed.push(event);
    });

    var db = configuration.newDbInstance({w:1}, {poolSize:1, auto_reconnect:false});
    db.open(function(err, db) {
      test.equal(null, err);

      // Drop the collection
      db.collection('apm_test_2').drop(function(err, r) {

        // Insert test documents
        db.collection('apm_test_2').insertMany([{a:1}, {a:1}, {a:1}, {a:1}, {a:1}, {a:1}]).then(function(r) {
          test.equal(6, r.insertedCount);

          db.collection('apm_test_2').find({$illegalfield:1})
            .project({_id: 1, a:1})
            .hint({'_id':1})
            .skip(1)
            .limit(100)
            .batchSize(2)
            .comment('some comment')
            .maxScan(1000)
            .maxTimeMS(5000)
            .setReadPreference(ReadPreference.PRIMARY)
            .addCursorFlag('noCursorTimeout', true)
            .toArray().then(function(docs) {
          }).catch(function(err) {
            test.equal(1, failed.length);

            listener.uninstrument();
            db.close();
            test.done();
          });
        }).catch(function(e) {
          console.dir(e)
        });
      });
    });
  }
}

var cleanup = function(overrides) {
  overrides.forEach(function(x) {
    x.obj[x.method] = x.func;
  });
}

exports['Correctly receive the APM events for a bulk operation'] = {
  metadata: { requires: { topology: ['single'] } },

  // The actual test we wish to run
  test: function(configuration, test) {
    var started = [];
    var succeeded = [];
    var failed = [];

    var listener = require('../..').instrument();
    listener.on('started', function(event) {
      if(event.commandName == 'insert' || event.commandName == 'update' || event.commandName == 'delete')
        started.push(event);
    });

    listener.on('succeeded', function(event) {
      if(event.commandName == 'insert' || event.commandName == 'update' || event.commandName == 'delete')
        succeeded.push(event);
    });

    var db = configuration.newDbInstance({w:1}, {poolSize:1, auto_reconnect:false});
    db.open(function(err, db) {
      db.collection('apm_test_3').bulkWrite([
            { insertOne: { a: 1 } }
          , { updateOne: { q: {a:2}, u: {$set: {a:2}}, upsert:true } }
          , { deleteOne: { q: {c:1} } }
        ], {ordered:true}).then(function(r) {
        test.equal(3, started.length);
        test.equal(3, succeeded.length);
        test.equal(started[0].operationId, started[1].operationId);
        test.equal(started[0].operationId, started[2].operationId);
        test.equal(succeeded[0].operationId, succeeded[1].operationId);
        test.equal(succeeded[0].operationId, succeeded[2].operationId);

        listener.uninstrument();
        db.close();
        test.done();
      }).catch(function(err) {
        console.dir(err)
      });
    });
  }
}

exports['Correctly receive the APM explain command'] = {
  metadata: { requires: { topology: ['single'] } },

  // The actual test we wish to run
  test: function(configuration, test) {
    var ReadPreference = configuration.require.ReadPreference;
    var started = [];
    var succeeded = [];
    var failed = [];

    var listener = require('../..').instrument();
    listener.on('started', function(event) {
      if(event.commandName == 'find' || event.commandName == 'getMore' || event.commandName == 'killCursors' || event.commandName == 'explain')
        started.push(event);
    });

    listener.on('succeeded', function(event) {
      if(event.commandName == 'find' || event.commandName == 'getMore' || event.commandName == 'killCursors' || event.commandName == 'explain')
        succeeded.push(event);
    });

    listener.on('failed', function(event) {
      if(event.commandName == 'find' || event.commandName == 'getMore' || event.commandName == 'killCursors' || event.commandName == 'explain')
        failed.push(event);
    });

    var db = configuration.newDbInstance({w:1}, {poolSize:1, auto_reconnect:false});
    db.open(function(err, db) {
      test.equal(null, err);

      // Drop the collection
      db.collection('apm_test_2').drop(function(err, r) {

        // Insert test documents
        db.collection('apm_test_2').insertMany([{a:1}, {a:1}, {a:1}, {a:1}, {a:1}, {a:1}], {w:1}).then(function(r) {
          test.equal(6, r.insertedCount);

          db.collection('apm_test_2').find({a:1})
            .explain().then(function(explain) {
              test.ok(explain != null);

              test.equal(1, started.length);
              test.equal('explain', started[0].commandName);
              test.equal('apm_test_2', started[0].command.explain.find);
              test.equal(1, succeeded.length);
              test.equal('explain', succeeded[0].commandName);

              // Started
              test.equal(started[0].operationId, succeeded[0].operationId);

              // Remove instrumentation
              listener.uninstrument();
              db.close();
              test.done();
          }).catch(function(err) {
            console.log(err.stack)
          });
        }).catch(function(e) {
          console.log(err.stack)
        });
      });
    });
  }
}
