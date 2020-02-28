'use strict';
const test = require('./shared').assert,
  setupDatabase = require('./shared').setupDatabase,
  expect = require('chai').expect;

describe('MongoClient Options', function() {
  before(function() {
    return setupDatabase(this.configuration);
  });

  /**
   * @ignore
   */
  it('should error on unexpected options', {
    metadata: { requires: { topology: 'single' } },

    // The actual test we wish to run
    test: function(done) {
      var configuration = this.configuration;
      var connect = configuration.require;

      connect(
        configuration.url(),
        {
          autoReconnect: true,
          poolSize: 4,
          notlegal: {},
          validateOptions: true
        },
        function(err, client) {
          test.ok(err.message.indexOf('option notlegal is not supported') !== -1);
          expect(client).to.not.exist;
          done();
        }
      );
    }
  });

  /**
   * @ignore
   */
  function connectionTester(configuration, testName, callback) {
    return function(err, client) {
      test.equal(err, null);
      var db = client.db(configuration.db);

      db.collection(testName, function(err, collection) {
        test.equal(err, null);

        collection.insert({ foo: 123 }, { w: 1 }, function(err) {
          test.equal(err, null);
          db.dropDatabase(function(err, dropped) {
            test.equal(err, null);
            test.ok(dropped);
            if (callback) return callback(client);
          });
        });
      });
    };
  }
});
