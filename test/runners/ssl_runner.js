var Runner = require('integra').Runner;

module.exports = function(configurations) {
  //
  //  SSL tests
  //
  //

  // Configure a Run of tests
  var ssl_server_runner = Runner
    // Add configurations to the test runner
    .configurations(configurations)
    .exeuteSerially(true)
    // First parameter is test suite name
    // Second parameter is the configuration used
    // Third parameter is the list of files to execute
    .add("ssl_tests",
      [
          '/test/tests/ssl/mongoclient_tests.js'
          , '/test/tests/ssl/ssl_validation_tests.js'
      ]
    );

   // Export runners
  return {
    runner: ssl_server_runner
  }    
}