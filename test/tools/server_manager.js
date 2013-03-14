var debug = require('util').debug,
  inspect = require('util').inspect,
  path = require('path'),
  fs = require('fs'),
  exec = require('child_process').exec,
  spawn = require('child_process').spawn,
  Connection = require('../../lib/mongodb').Connection,
  Db = require('../../lib/mongodb').Db,
  Server = require('../../lib/mongodb').Server;

var ensureUp = function(host, port, number_of_retries, callback) {
  var db = new Db('test', new Server(host, port, {socketOptions:{connectTimeoutMS: 1000}}), {w:1});
  db.open(function(err, result) {
    if(err) {
      number_of_retries = number_of_retries - 1;
      if(number_of_retries == 0) return callback(new Error("Failed to connect to db"));
      
      setTimeout(function() {
        return ensureUp(host, port, number_of_retries, callback);
      }, 500);
    } else {
      return callback(null, null);
    }
  });
}

var ServerManager = exports.ServerManager = function(options) {
  options = options == null ? {} : options;
  // Basic unpack values
  this.path = path.resolve("data");
  this.port = options["start_port"] != null ? options["start_port"] : 27017;
  this.host = options["host"] != null ? options["host"] : "localhost";
  this.db_path = getPath(this, "data-" + this.port);
  this.log_path = getPath(this, "log-" + this.port);
  this.journal = options["journal"] != null ? options["journal"] : false;
  this.auth = options['auth'] != null ? options['auth'] : false;
  this.ssl = options['ssl'] != null ? options['ssl'] : false;
  this.ssl_server_pem = options['ssl_server_pem'] != null ? options['ssl_server_pem'] : null;
  this.ssl_server_pem_pass = options['ssl_server_pem_pass'] != null ? options['ssl_server_pem_pass'] : null;
  this.ssl_weak_certificate_validation = options['ssl_weak_certificate_validation'] != null ? options['ssl_weak_certificate_validation'] : null;
  // Ca settings for ssl
  this.ssl_ca = options['ssl_ca'] != null ? options['ssl_ca'] : null;
  this.ssl_crl = options['ssl_crl'] != null ? options['ssl_crl'] : null;

  this.purgedirectories = options['purgedirectories'] != null ? options['purgedirectories'] : true;
  this.configServer = options['configserver'] != null ? options['configserver'] : false;

  // Server status values
  this.up = false;
  this.pid = null;
}

// Start up the server instance
ServerManager.prototype.start = function(killall, callback) {
  var self = this;
  // Unpack callback and variables
  var args = Array.prototype.slice.call(arguments, 0);
  callback = args.pop();
  killall = args.length ? args.shift() : true;
  // Create start command
  var startCmd = generateStartCmd(this, {configserver:self.configServer, log_path: self.log_path,
    db_path: self.db_path, port: self.port, journal: self.journal, auth:self.auth, ssl:self.ssl});

  exec(killall ? 'killall -9 mongod' : '', function(err, stdout, stderr) {
    if(self.purgedirectories) {
      // Remove directory
      exec("rm -rf " + self.db_path, function(err, stdout, stderr) {
        if(err != null) return callback(err, null);
        // Create directory
        exec("mkdir -p " + self.db_path, function(err, stdout, stderr) {
          if(err != null) return callback(err, null);
          // Start up mongod process
          var mongodb = exec(startCmd,
            function (error, stdout, stderr) {
              // console.log('stdout: ' + stdout);
              // console.log('stderr: ' + stderr);
              if (error != null) {
                console.log('exec error: ' + error);
              }
          });

          // Wait for a half a second then save the pids
          ensureUp(self.host, self.port, 100, function(err, result) {
            if(err) throw err;
            // Mark server as running
            self.up = true;
            self.pid = fs.readFileSync(path.join(self.db_path, "mongod.lock"), 'ascii').trim();
            // Callback
            callback();
          });
        });
      });
    } else {
      // Ensure we remove the lock file as we are not purging the directory
      fs.unlinkSync(path.join(self.db_path, "mongod.lock"));

      // Start up mongod process
      var mongodb = exec(startCmd,
        function (error, stdout, stderr) {
          if (error != null) {
            console.log('exec error: ' + error);
          }
      });

      // Wait for a half a second then save the pids
      ensureUp(self.host, self.port, 100, function(err, result) {
        if(err) throw err;
        // Mark server as running
        self.up = true;
        self.pid = fs.readFileSync(path.join(self.db_path, "mongod.lock"), 'ascii').trim();
        // Callback
        callback();
      });
    }
  });
}

ServerManager.prototype.stop = function(signal, callback) {
  var self = this;
  // Unpack callback and variables
  var args = Array.prototype.slice.call(arguments, 0);
  callback = args.pop();
  signal = args.length ? args.shift() : 2;
  // Stop the server
  var command = "kill -" + signal + " " + self.pid;
  // Kill process
  exec(command,
    function (error, stdout, stderr) {
      // console.log('stdout: ' + stdout);
      // console.log('stderr: ' + stderr);
      if (error !== null) {
        console.log('exec error: ' + error);
      }

      self.up = false;
      // Wait for a second
      setTimeout(callback, 1000);
  });
}

ServerManager.prototype.killAll = function(callback) {
  exec('killall -9 mongod', function(err, stdout, stderr) {
    if(typeof callback == 'function') callback(null, null);
  });
}

// Get absolute path
var getPath = function(self, name) {
  return path.join(self.path, name);
}

// Generate start command
var generateStartCmd = function(self, options) {  
  // Create boot command
  var startCmd = "mongod --noprealloc --smallfiles --logpath '" + options['log_path'] + "' " +
      " --dbpath " + options['db_path'] + " --port " + options['port'] + " --fork";
  startCmd = options['journal'] ? startCmd + " --journal" : startCmd;
  startCmd = options['auth'] ? startCmd + " --auth" : startCmd;
  startCmd = options['configserver'] ? startCmd + " --configsvr" : startCmd;
  // If we have ssl defined set up with test certificate
  if(options['ssl']) {
    var path = getPath(self, self.ssl_server_pem);
    startCmd = startCmd + " --sslOnNormalPorts --sslPEMKeyFile=" + path;

    if(self.ssl_server_pem_pass) {
      startCmd = startCmd + " --sslPEMKeyPassword=" + self.ssl_server_pem_pass;
    }

    if(self.ssl_ca) {
      startCmd = startCmd + " --sslCAFile=" + getPath(self, self.ssl_ca);
    }

    if(self.ssl_crl) {
      startCmd = startCmd + " --sslCRLFile=" + getPath(self, self.ssl_crl);
    }

    if(self.ssl_weak_certificate_validation) {
      startCmd = startCmd + " --sslWeakCertificateValidation"
    }
  }
  // console.log(startCmd)

  // Return start command
  return startCmd;
}
