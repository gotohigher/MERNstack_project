/**
 * @ignore
 */
exports['Should correctly recover when bufferMaxEntries: -1 and restart'] = {
  metadata: { requires: { topology: ['single', 'replicaset'] }, ignore: { travis:true } },

  // The actual test we wish to run
  test: function(configuration, test) {
    var MongoClient = configuration.require.MongoClient
      , f = require('util').format;

    var done = false;

    MongoClient.connect(configuration.url(), {}, function(err, db) {
      test.equal(null, err);

      configuration.manager.stop(9).then(function() {
        db.collection('disconnect_handler_tests').update({a:1}, {$set: {b:1}}, function(err, r) {
          test.equal(null, err);
          test.equal(0, r.result.n);

          db.close();
          test.done();
        });

        setTimeout(function() {
          configuration.manager.restart(9, {waitMS: 5000}).then(function() {
          });
        }, 5000)
      });
    });
  }
}
