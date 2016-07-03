// "use strict"

var inherits = require('util').inherits,
  f = require('util').format,
  EventEmitter = require('events').EventEmitter,
  BSON = require('bson').native().BSON,
  ReadPreference = require('./read_preference'),
  BasicCursor = require('../cursor'),
  Logger = require('../connection/logger'),
  debugOptions = require('../connection/utils').debugOptions,
  MongoError = require('../error'),
  Server = require('./server'),
  ReplSetState = require('./replset_state');

var MongoCR = require('../auth/mongocr')
  , X509 = require('../auth/x509')
  , Plain = require('../auth/plain')
  , GSSAPI = require('../auth/gssapi')
  , SSPI = require('../auth/sspi')
  , ScramSHA1 = require('../auth/scram');

//
// States
var DISCONNECTED = 'disconnected';
var CONNECTING = 'connecting';
var CONNECTED = 'connected';
var DESTROYED = 'destroyed';

function stateTransition(self, newState) {
  var legalTransitions = {
    'disconnected': [CONNECTING, DESTROYED, DISCONNECTED],
    'connecting': [CONNECTING, DESTROYED, CONNECTED, DISCONNECTED],
    'connected': [CONNECTED, DISCONNECTED, DESTROYED],
    'destroyed': [DESTROYED]
  }

  // Get current state
  var legalStates = legalTransitions[self.state];
  if(legalStates && legalStates.indexOf(newState) != -1) {
    self.state = newState;
  } else {
    self.logger.error(f('Pool with id [%s] failed attempted illegal state transition from [%s] to [%s] only following state allowed [%s]'
      , self.id, self.state, newState, legalStates));
  }
}

//
// ReplSet instance id
var id = 1;
var handlers = ['connect', 'close', 'error', 'timeout', 'parseError'];

/**
 * Creates a new Replset instance
 * @class
 * @param {array} seedlist A list of seeds for the replicaset
 * @param {boolean} options.setName The Replicaset set name
 * @param {boolean} [options.secondaryOnlyConnectionAllowed=false] Allow connection to a secondary only replicaset
 * @param {number} [options.haInterval=10000] The High availability period for replicaset inquiry
 * @param {boolean} [options.emitError=false] Server will emit errors events
 * @param {Cursor} [options.cursorFactory=Cursor] The cursor factory class used for all query cursors
 * @param {number} [options.size=5] Server connection pool size
 * @param {boolean} [options.keepAlive=true] TCP Connection keep alive enabled
 * @param {number} [options.keepAliveInitialDelay=0] Initial delay before TCP keep alive enabled
 * @param {boolean} [options.noDelay=true] TCP Connection no delay
 * @param {number} [options.connectionTimeout=10000] TCP Connection timeout setting
 * @param {number} [options.socketTimeout=0] TCP Socket timeout setting
 * @param {number} [options.monitoringSocketTimeout=30000] TCP Socket timeout setting for replicaset monitoring socket
 * @param {boolean} [options.singleBufferSerializtion=true] Serialize into single buffer, trade of peak memory for serialization speed
 * @param {boolean} [options.ssl=false] Use SSL for connection
 * @param {boolean|function} [options.checkServerIdentity=true] Ensure we check server identify during SSL, set to false to disable checking. Only works for Node 0.12.x or higher. You can pass in a boolean or your own checkServerIdentity override function.
 * @param {Buffer} [options.ca] SSL Certificate store binary buffer
 * @param {Buffer} [options.cert] SSL Certificate binary buffer
 * @param {Buffer} [options.key] SSL Key file binary buffer
 * @param {string} [options.passphrase] SSL Certificate pass phrase
 * @param {boolean} [options.rejectUnauthorized=true] Reject unauthorized server certificates
 * @param {boolean} [options.promoteLongs=true] Convert Long values from the db into Numbers if they fit into 53 bits
 * @param {number} [options.pingInterval=5000] Ping interval to check the response time to the different servers
 * @param {number} [options.acceptableLatency=250] Acceptable latency for selecting a server for reading (in milliseconds)
 * @return {ReplSet} A cursor instance
 * @fires ReplSet#connect
 * @fires ReplSet#ha
 * @fires ReplSet#joined
 * @fires ReplSet#left
 */
var ReplSet = function(seedlist, options) {
  var self = this;
  options = options || {};

  // Validate seedlist
  if(!Array.isArray(seedlist)) throw new MongoError("seedlist must be an array");
  // Validate list
  if(seedlist.length == 0) throw new MongoError("seedlist must contain at least one entry");
  // Validate entries
  seedlist.forEach(function(e) {
    if(typeof e.host != 'string' || typeof e.port != 'number')
      throw new MongoError("seedlist entry must contain a host and port");
  });

  // Add event listener
  EventEmitter.call(this);

  // Get replSet Id
  this.id = id++;

  // Internal state
  this.s = {
    options: Object.assign({}, options),
    // BSON instance
    bson: options.bson || new BSON(),
    // Factory overrides
    Cursor: options.cursorFactory || BasicCursor,
    // Logger instance
    logger: Logger('ReplSet', options),
    // Seedlist
    seedlist: seedlist,
    // Replicaset state
    replicaSetState: new ReplSetState({
      id: this.id, setName: options.setName
    }),
    // Current servers we are connecting to
    connectingServers: [],
    // Ha interval
    haInterval: options.haInterval ? options.haInterval : 10000,
    // Minimum heartbeat frequency used if we detect a server close
    minHeartbeatFrequencyMS: 500,
    // Disconnect handler
    disconnectHandler: options.disconnectHandler,
    // Server selection index
    index: 0,
    // Acceptable latency window for nearest reads
    acceptableLatency: options.acceptableLatency || 15,
    // Connect function options passed in
    connectOptions: {},
    // Are we running in debug mode
    debug: typeof options.debug == 'boolean' ? options.debug : false
  }

  // console.log("== create ReplSet :: " + this.s.id)

  // Add handler for topology change
  this.s.replicaSetState.on('topologyDescriptionChanged', function(r) { self.emit('topologyDescriptionChanged', r); });

  // All the authProviders
  this.authProviders = options.authProviders || {
      'mongocr': new MongoCR(this.s.bson), 'x509': new X509(this.s.bson)
    , 'plain': new Plain(this.s.bson), 'gssapi': new GSSAPI(this.s.bson)
    , 'sspi': new SSPI(this.s.bson), 'scram-sha-1': new ScramSHA1(this.s.bson)
  }

  // Add forwarding of events from state handler
  var types = ['joined', 'left'];
  types.forEach(function(x) {
    self.s.replicaSetState.on(x, function(t, s) {
      self.emit(x, t, s);
    });
  });

  // Disconnected state
  this.state = DISCONNECTED;
  this.haTimeoutId = null;
  // Are we authenticating
  this.authenticating = false;
}

inherits(ReplSet, EventEmitter);

Object.defineProperty(ReplSet.prototype, 'type', {
  enumerable:true, get: function() { return 'replset'; }
});

function attemptReconnect(self) {
  self.haTimeoutId = setTimeout(function() {
    // if(global.debug)console.log("---- attemptReconnect :: " + self.s.id)
    if(self.state == DESTROYED) return;
    // if(global.debug)console.log("---- attemptReconnect 1")
    // Get all known hosts
    var keys = Object.keys(self.s.replicaSetState.set);
    // console.log("===== REPLSET CREATE SERVER 0 :: " + self.s.id)
    var servers = keys.map(function(x) {
      return new Server(Object.assign({}, self.s.options, {
        host: x.split(':')[0], port: parseInt(x.split(':')[1], 10)
      }, {
        authProviders: self.authProviders, reconnect:false, monitoring: false, inTopology: true
      }));
    });
    // console.log("---- attemptReconnect 2 :: " + servers.length)

    // Create the list of servers
    self.s.connectingServers = servers.slice(0);

    // Handle all events coming from servers
    function _handleEvent(self, event) {
      return function(err) {
        // if(global.debug) console.log("== _handleEvent :: " + event + " :: " + this.name)
        // console.dir(err)
        // Destroy the instance
        if(self.state == DESTROYED) {
          return this.destroy();
        }

        // Check if we are done
        function done() {
          // Done with the reconnection attempt
          if(self.s.connectingServers.length == 0) {
            // console.log("---- attemptReconnect done")
            if(self.state == DESTROYED) return;

            // Do we have a primary
            if(self.s.replicaSetState.hasPrimary()) {
              // If we have a primary and a disconnect handler, execute
              // buffered operations
              if(self.s.replicaSetState.hasPrimaryAndSecondary() && self.s.disconnectHandler) {
                self.s.disconnectHandler.execute();
              }

              // Connect any missing servers
              connectNewServers(self, self.s.replicaSetState.unknownServers, function(err, cb) {
                // Go back to normal topology monitoring
                topologyMonitor(self);
              });
            } else {
              attemptReconnect(self);
            }
          }
        }
        // console.log("---- attemptReconnect :: _handleEvent :: " + event)
        // console.dir(err)

        // Remove the server from our list
        for(var i = 0; i < self.s.connectingServers.length; i++) {
          if(self.s.connectingServers[i].equals(this)) {
            self.s.connectingServers.splice(i, 1);
          }
        }

        // Keep reference to server
        var _self = this;

        // Connect and not authenticating
        if(event == 'connect' && !self.authenticating) {
          // applyCredentials(this, 0, self.credentials, function(err) {
            if(self.state == DESTROYED) {
              return _self.destroy();
            }

            // Update the replicaset state
            if(self.s.replicaSetState.update(_self)) {
              // Remove the handlers
              for(var i = 0; i < handlers.length; i++) {
                _self.removeAllListeners(handlers[i]);
              }

              // Add stable state handlers
              _self.on('error', handleEvent(self, 'error'));
              _self.on('close', handleEvent(self, 'close'));
              _self.on('timeout', handleEvent(self, 'timeout'));
              _self.on('parseError', handleEvent(self, 'parseError'));
            } else {
              _self.destroy();
            }

            done();
          // });
        } else if(event == 'connect' && self.authenticating) {
          this.destroy();
          // console.log("============ add to nonAuthenticatedServers 1")
          // Add to non authenticated servers
          // self.nonAuthenticatedServers.push(this);
        }

        done();
      }
    }

    // Index used to interleaf the server connects, avoiding
    // runtime issues on io constrained vm's
    var timeoutInterval = 0;

    function connect(server, timeoutInterval) {
      setTimeout(function() {
        server.once('connect', _handleEvent(self, 'connect'));
        server.once('close', _handleEvent(self, 'close'));
        server.once('timeout', _handleEvent(self, 'timeout'));
        server.once('error', _handleEvent(self, 'error'));
        server.once('parseError', _handleEvent(self, 'parseError'));

        // SDAM Monitoring events
        server.on('serverOpening', function(e) { self.emit('serverOpening', e); });
        server.on('serverDescriptionChanged', function(e) { self.emit('serverDescriptionChanged', e); });
        server.on('serverClosed', function(e) { self.emit('serverClosed', e); });

        // console.log("-------- connect 3 :: 0")
        server.connect(self.s.connectOptions);
      }, timeoutInterval);
    }

    // Connect all servers
    while(servers.length > 0) {
      connect(servers.shift(), timeoutInterval++);
    }
  }, self.s.minHeartbeatFrequencyMS);
}

function connectNewServers(self, servers, callback) {
  // Count lefts
  var count = servers.length;
  // console.log("=============== connectNewServers :: " + count)

  // Handle events
  var _handleEvent = function(self, event) {
    return function(err, r) {
      // if(global.debug)console.log("===== _handleEvent :: " + event + " :: " + this.id)
      // console.dir(err)
      var _self = this;
      // console.log("=============== connectNewServers :: _handleEvent :: " + this.name)
      count = count - 1;

      // Destroyed
      if(self.state == DESTROYED) {
        return this.destroy();
      }

      if(event == 'connect' && !self.authenticating) {
        // Destroyed
        if(self.state == DESTROYED) {
          return _self.destroy();
        }

        var result = self.s.replicaSetState.update(_self);
        // Update the state with the new server
        if(result) {
          // Remove the handlers
          for(var i = 0; i < handlers.length; i++) {
            _self.removeAllListeners(handlers[i]);
          }

          // Add stable state handlers
          _self.on('error', handleEvent(self, 'error'));
          _self.on('close', handleEvent(self, 'close'));
          _self.on('timeout', handleEvent(self, 'timeout'));
          _self.on('parseError', handleEvent(self, 'parseError'));
        } else {
          _self.destroy();
        }
      } else if(event == 'connect' && self.authenticating) {
        this.destroy();
      }

      // Are we done finish up callback
      if(count == 0) { callback(); }
    }
  }

  // No new servers
  if(count == 0) return callback();

  // Execute method
  function execute(_server, i) {
    setTimeout(function() {
      // console.log("===== REPLSET CREATE SERVER 1 :: " + self.s.id)
      // Destroyed
      if(self.state == DESTROYED) {
        return;
      }

      // Create a new server instance
      var server = new Server(Object.assign({}, self.s.options, {
        host: _server.split(':')[0],
        port: parseInt(_server.split(':')[1], 10)
      }, {
        authProviders: self.authProviders, reconnect:false, monitoring: false, inTopology: true
      }));
      // console.log("=============== connectNewServers - 2")
      // Add temp handlers
      server.once('connect', _handleEvent(self, 'connect'));
      server.once('close', _handleEvent(self, 'close'));
      server.once('timeout', _handleEvent(self, 'timeout'));
      server.once('error', _handleEvent(self, 'error'));
      server.once('parseError', _handleEvent(self, 'parseError'));

      // SDAM Monitoring events
      server.on('serverOpening', function(e) { self.emit('serverOpening', e); });
      server.on('serverDescriptionChanged', function(e) { self.emit('serverDescriptionChanged', e); });
      server.on('serverClosed', function(e) { self.emit('serverClosed', e); });
      // console.log("-------- connect 1 :: 0")
      server.connect(self.s.connectOptions);
    }, i);
  }

  // Create new instances
  for(var i = 0; i < servers.length; i++) {
    // console.log("=============== connectNewServers - 0")
    // console.log("===== CREATE CREARE SERVER 1")
    execute(servers[i], i);
    // console.log("-------- connect 1 :: 1")
  }
}

function topologyMonitor(self, options) {
  // console.log("===================== topologyMonitor :: 1 ")
  options = options || {};

  // Set momitoring timeout
  self.haTimeoutId = setTimeout(function() {
    // console.log("===================== topologyMonitor :: 0 :: " + self.id)
    // if(global.debug)console.log("===================== topologyMonitor")
    // console.dir(self.state)
    // console.log("+ topologyMonitor 0")
    if(self.state == DESTROYED) return;
    // console.log("===================== topologyMonitor ::  1 :: " + self.id)

    // If we have a primary and a disconnect handler, execute
    // buffered operations
    if(self.s.replicaSetState.hasPrimaryAndSecondary() && self.s.disconnectHandler) {
      self.s.disconnectHandler.execute();
    }

    // console.log("===================== topologyMonitor ::  2 :: " + self.id)

    // Get the connectingServers
    var connectingServers = self.s.replicaSetState.allServers();
    // console.log(connectingServers.map(function(x) {
    //   return x.name;
    // }));
    // console.log(self.s.replicaSetState.unknownServers.map(function(x) {
    //   return x;
    // }));
    // Get the count
    var count = connectingServers.length;
    // If we have no servers connected
    if(count == 0 && !options.haInterval) {
      // console.log("===================== topologyMonitor :: " + count)
      return attemptReconnect(self);
    } else if(count == 0 && options.haInterval){
      // console.log("===================== topologyMonitor :: " + count)
      self.destroy();
      return self.emit('error', new MongoError('no valid replicaset members found'));
    }

    // console.log("===================== topologyMonitor ::  3 :: " + self.id)
    // console.dir(count)
    // console.dir(options)

    // If the count is zero schedule a new fast
    // console.log("+ topologyMonitor 1 :: count :: " + count)
    function pingServer(_self, _server, cb) {
      // console.log("================ pingServer 0 :: " + _server.name)
      // Measure running time
      var start = new Date().getTime();

      // server.on('serverHeartbeatStarted', function(e) { self.emit('serverHeartbeatStarted', e); });
      // server.on('serverHeartbeatSucceeded', function(e) { self.emit('serverHeartbeatSucceeded', e); });
      // server.on('serverHearbeatFailed', function(e) { self.emit('serverHearbeatFailed', e); });

      // Emit the server heartbeat start
      emitSDAMEvent(self, 'serverHeartbeatStarted', { connectionId: _server.name });

      // Execute ismaster
      _server.command('admin.$cmd', {ismaster:true}, {monitoring: true}, function(err, r) {
        // if(err) console.dir(err)
        // console.log("================ pingServer 1 :: " + _server.name)
        // console.dir(err)
        if(self.state == DESTROYED) {
          _server.destroy();
          return cb(err, r);
        }

        // Calculate latency
        var latencyMS = new Date().getTime() - start;

        // We had an error, remove it from the state
        if(err) {
          // Emit the server heartbeat failure
          emitSDAMEvent(self, 'serverHearbeatFailed', { durationMS: latencyMS, failure: err, connectionId: _server.name });
          // Remove the server from the state
          _self.s.replicaSetState.remove(_server);
        } else {
          // Update the server ismaster
          _server.ismaster = r.result;
          _server.lastIsMasterMS = latencyMS;
          // console.log("============= got ismaster from " + _server.name)
          // console.dir(_server.ismaster)
          // console.dir(r.result)
          _self.s.replicaSetState.update(_server);

          // Server heart beat event
          emitSDAMEvent(self, 'serverHeartbeatSucceeded', { durationMS: latencyMS, reply: r.result, connectionId: _server.name });
        }
        // console.log("================ pingServer 2 :: " + _server.name)
        // console.dir(err)

        cb(err, r);
      });
    }

    // Ping all servers
    for(var i = 0; i < connectingServers.length; i++) {
      // console.log("+++++++++ schedule server")
      pingServer(self, connectingServers[i], function(err, r) {
        count = count - 1;

        if(count == 0) {
          // console.log("++++++++++++++++++++++++++++++ 1")
          // console.log(self.s.replicaSetState.unknownServers.map(function(x) {
          //   return x;
          // }));

          if(self.state == DESTROYED) return;
          // console.log("=== self.s.replicaSetState.unknownServers = " + self.s.replicaSetState.unknownServers.length)
          // Attempt to connect to any unknown servers
          connectNewServers(self, self.s.replicaSetState.unknownServers, function(err, cb) {
            if(self.state == DESTROYED) return;
            // console.log("111 connectNewServers")
            // Check if we have an options.haInterval (meaning it was triggered from connect)
            if(options.haInterval) {
              // Do we have a primary and secondary
              if(self.state == CONNECTING
                && self.s.replicaSetState.hasPrimaryAndSecondary()) {
                  // console.log("========================== 0 :: " + self.s.id)
                  // Transition to connected
                  stateTransition(self, CONNECTED);
                  // Emit connected sign
                  process.nextTick(function() {
                    self.emit('connect', self);
                    self.emit('fullsetup', self);
                    self.emit('all', self);
                  });
              } else if(self.state == CONNECTING
                && self.s.replicaSetState.hasSecondary()
                && self.s.options.secondaryOnlyConnectionAllowed) {
                  // console.log("========================== 1 :: " + self.s.id)
                  // Transition to connected
                  stateTransition(self, CONNECTED);
                  // Emit connected sign
                  process.nextTick(function() {
                    self.emit('connect', self);
                  });
              } else if(self.state == CONNECTING) {
                console.dir(self.s.replicaSetState.set)
                  // console.log("========================== 2 :: " + self.s.id)
                  self.emit('error', new MongoError('no primary found in replicaset'));
                // Destroy the topology
                return self.destroy();
              }
            }

            // console.log("========================== 3 :: " + self.s.id)
            // console.log("!!!!!!!!!!!!!!!!!! topologyMonitor")
            topologyMonitor(self);
          });
        }
      });
    }
  }, options.haInterval || self.s.haInterval)
}

function handleEvent(self, event) {
  return function(err) {
    // console.log("===== handleEvent :: " + event + " :: " + this.name)
    // if(global.debug)console.log("$$$$ handleEvent :: " + event + " :: " + self.s.id + " :: " + this.name)
    if(self.state == DESTROYED) return;
    self.s.replicaSetState.remove(this);
  }
}

function handleInitialConnectEvent(self, event) {
  return function(err) {
    // console.log("========= handleInitialConnectEvent :: " + event + " :: " + this.name)
    // console.dir(err)
    // Destroy the instance
    if(self.state == DESTROYED) {
      return this.destroy();
    }

    // Check the type of server
    if(event == 'connect') {
      // Update the state
      var result = self.s.replicaSetState.update(this);
      if(result) {
        // Remove the handlers
        for(var i = 0; i < handlers.length; i++) {
          this.removeAllListeners(handlers[i]);
        }

        // Add stable state handlers
        this.on('error', handleEvent(self, 'error'));
        this.on('close', handleEvent(self, 'close'));
        this.on('timeout', handleEvent(self, 'timeout'));
        this.on('parseError', handleEvent(self, 'parseError'));
      } else {
        this.destroy();
      }
    } else {
      // Emit failure to connect
      self.emit('failed', this);
      // Remove from the state
      self.s.replicaSetState.remove(this);
    }

    // Remove from the list from connectingServers
    for(var i = 0; i < self.s.connectingServers.length; i++) {
      if(self.s.connectingServers[i].equals(this)) {
        self.s.connectingServers.splice(i, 1);
      }
    }

    // Trigger topologyMonitor
    if(self.s.connectingServers.length == 0) {
      topologyMonitor(self, {haInterval: 1});
    }
  };
}

function connectServers(self, servers) {
  // Update connectingServers
  self.s.connectingServers = self.s.connectingServers.concat(servers);

  // Index used to interleaf the server connects, avoiding
  // runtime issues on io constrained vm's
  var timeoutInterval = 0;

  function connect(server, timeoutInterval) {
    setTimeout(function() {
      // Add the server to the state
      self.s.replicaSetState.update(server);
      // Add event handlers
      server.once('close', handleInitialConnectEvent(self, 'close'));
      server.once('timeout', handleInitialConnectEvent(self, 'timeout'));
      server.once('parseError', handleInitialConnectEvent(self, 'parseError'));
      server.once('error', handleInitialConnectEvent(self, 'error'));
      server.once('connect', handleInitialConnectEvent(self, 'connect'));
      // SDAM Monitoring events
      server.on('serverOpening', function(e) { self.emit('serverOpening', e); });
      server.on('serverDescriptionChanged', function(e) { self.emit('serverDescriptionChanged', e); });
      server.on('serverClosed', function(e) { self.emit('serverClosed', e); });
      // console.log("-------- connect 2 :: 0")
      // Start connection
      server.connect(self.s.connectOptions);
    }, timeoutInterval);
  }

  // Start all the servers
  while(servers.length > 0) {
    connect(servers.shift(), timeoutInterval++);
  }
}

/**
 * Emit event if it exists
 * @method
 */
function emitSDAMEvent(self, event, description) {
  if(self.listeners(event).length > 0) {
    self.emit(event, description);
  }
}

ReplSet.prototype.connect = function(options) {
  // console.log("=== connect")
  var self = this;
  // Add any connect level options to the internal state
  this.s.connectOptions = options || {};
  // Set connecting state
  stateTransition(this, CONNECTING);
  // console.log("=== Replset.connect")
  // console.log("===== REPLSET CREATE ::connect " + this.s.id)
  // Create server instances
  var servers = this.s.seedlist.map(function(x) {
    return new Server(Object.assign({}, self.s.options, x, {
      authProviders: self.authProviders, reconnect:false, monitoring:false, inTopology: true
    }));
  });

  // Emit the topology opening event
  emitSDAMEvent(this, 'topologyOpening', { topologyId: this.id });

  // Start all server connections
  connectServers(self, servers);
}

ReplSet.prototype.destroy = function() {
  // console.log("=== ReplSet :: destroy :: " + this.s.id)
  // Transition state
  stateTransition(this, DESTROYED);
  // Clear out any monitoring process
  if(this.haTimeoutId) clearTimeout(this.haTimeoutId);
  // Destroy the replicaset
  this.s.replicaSetState.destroy();

  // Destroy all connecting servers
  this.s.connectingServers.forEach(function(x) {
    x.destroy();
  });

  // Emit toplogy closing event
  emitSDAMEvent(this, 'topologyClosed', { topologyId: this.id });
}

ReplSet.prototype.unref = function() {
  // Transition state
  stateTransition(this, DISCONNECTED);
  // console.log("------------------ 0")
  this.s.replicaSetState.allServers().forEach(function(x) {
    x.unref();
  });

  // console.log("------------------ 1")
  clearTimeout(this.haTimeoutId);
  // console.log("------------------ 2")
}

ReplSet.prototype.lastIsMaster = function() {
  // console.log("=== lastIsMaster")
  return this.s.replicaSetState.primary
    ? this.s.replicaSetState.primary.lastIsMaster() : null;
}

ReplSet.prototype.connections = function() {
  var servers = this.s.replicaSetState.allServers();
  var connections = [];
  for(var i = 0; i < servers.length; i++) {
    connections = connections.concat(servers[i].connections());
  }

  return connections;
}

ReplSet.prototype.isConnected = function(options) {
  // console.log("=== isConnected")
  options = options || {};

  // If we are authenticating signal not connected
  // To avoid interleaving of operations
  if(this.authenticating) return false;

  // If we specified a read preference check if we are connected to something
  // than can satisfy this
  if(options.readPreference
    && options.readPreference.equals(ReadPreference.secondary)) {
    return this.s.replicaSetState.hasSecondary();
  }

  if(options.readPreference
    && options.readPreference.equals(ReadPreference.primary)) {
    return this.s.replicaSetState.hasPrimary();
  }

  if(options.readPreference
    && options.readPreference.equals(ReadPreference.primaryPreferred)) {
    return this.s.replicaSetState.hasSecondary() || this.s.replicaSetState.hasPrimary();
  }

  if(options.readPreference
    && options.readPreference.equals(ReadPreference.secondaryPreferred)) {
    return this.s.replicaSetState.hasSecondary() || this.s.replicaSetState.hasPrimary();
  }

  if(this.s.secondaryOnlyConnectionAllowed
    && this.s.replicaSetState.hasSecondary()) {
      return true;
  }

  return this.s.replicaSetState.hasPrimary();
}

ReplSet.prototype.isDestroyed = function() {
  // console.log("=== isDestroyed :: " + this.state == DESTROYED)
  return this.state == DESTROYED;
}

ReplSet.prototype.getServer = function(options) {
  // console.log("=== getServer")
  // Ensure we have no options
  options = options || {};
  // Pick the right server baspickServerd on readPreference
  var server = pickServer(this, this.s, options.readPreference);
  if(this.s.debug) this.emit('pickedServer', options.readPreference, server);
  return server;
}

ReplSet.prototype.getServers = function() {
  return this.s.replicaSetState.allServers();
}

function basicReadPreferenceValidation(self, options) {
  if(options.readPreference && !(options.readPreference instanceof ReadPreference)) {
    throw new Error("readPreference must be an instance of ReadPreference");
  }
}

//
// Execute write operation
var executeWriteOperation = function(self, op, ns, ops, options, callback) {
  // console.log("== executeWriteOperation 0")
  if(typeof options == 'function') callback = options, options = {}, options = options || {};
  // Ensure we have no options
  options = options || {};

  // No server returned we had an error
  if(self.s.replicaSetState.primary == null) {
    return callback(new MongoError("no primary server found"));
  }

  // Execute the command
  self.s.replicaSetState.primary[op](ns, ops, options, callback);
}

/**
 * Insert one or more documents
 * @method
 * @param {string} ns The MongoDB fully qualified namespace (ex: db1.collection1)
 * @param {array} ops An array of documents to insert
 * @param {boolean} [options.ordered=true] Execute in order or out of order
 * @param {object} [options.writeConcern={}] Write concern for the operation
 * @param {Boolean} [options.serializeFunctions=false] Specify if functions on an object should be serialized.
 * @param {Boolean} [options.ignoreUndefined=false] Specify if the BSON serializer should ignore undefined fields.
 * @param {opResultCallback} callback A callback function
 */
ReplSet.prototype.insert = function(ns, ops, options, callback) {
  // console.log("--------- insert")
  if(typeof options == 'function') callback = options, options = {}, options = options || {};
  if(this.state == DESTROYED) return callback(new MongoError(f('topology was destroyed')));

  // Not connected but we have a disconnecthandler
  if(!this.s.replicaSetState.hasPrimary() && this.s.disconnectHandler != null) {
    return this.s.disconnectHandler.add('insert', ns, ops, options, callback);
  }

  // Execute write operation
  executeWriteOperation(this, 'insert', ns, ops, options, callback);
}

// function clearCredentials(state, ns) {
//
// }

/**
 * Perform one or more update operations
 * @method
 * @param {string} ns The MongoDB fully qualified namespace (ex: db1.collection1)
 * @param {array} ops An array of updates
 * @param {boolean} [options.ordered=true] Execute in order or out of order
 * @param {object} [options.writeConcern={}] Write concern for the operation
 * @param {Boolean} [options.serializeFunctions=false] Specify if functions on an object should be serialized.
 * @param {Boolean} [options.ignoreUndefined=false] Specify if the BSON serializer should ignore undefined fields.
 * @param {opResultCallback} callback A callback function
 */
ReplSet.prototype.update = function(ns, ops, options, callback) {
  // console.log("--------- update")
  if(typeof options == 'function') callback = options, options = {}, options = options || {};
  if(this.state == DESTROYED) return callback(new MongoError(f('topology was destroyed')));

  // Not connected but we have a disconnecthandler
  if(!this.s.replicaSetState.hasPrimary() && this.s.disconnectHandler != null) {
    return this.s.disconnectHandler.add('insert', ns, ops, options, callback);
  }

  // Execute write operation
  executeWriteOperation(this, 'update', ns, ops, options, callback);
}

/**
 * Perform one or more remove operations
 * @method
 * @param {string} ns The MongoDB fully qualified namespace (ex: db1.collection1)
 * @param {array} ops An array of removes
 * @param {boolean} [options.ordered=true] Execute in order or out of order
 * @param {object} [options.writeConcern={}] Write concern for the operation
 * @param {Boolean} [options.serializeFunctions=false] Specify if functions on an object should be serialized.
 * @param {Boolean} [options.ignoreUndefined=false] Specify if the BSON serializer should ignore undefined fields.
 * @param {opResultCallback} callback A callback function
 */
ReplSet.prototype.remove = function(ns, ops, options, callback) {
  // console.log("--------- remove")
  if(typeof options == 'function') callback = options, options = {}, options = options || {};
  if(this.state == DESTROYED) return callback(new MongoError(f('topology was destroyed')));

  // Not connected but we have a disconnecthandler
  if(!this.s.replicaSetState.hasPrimary() && this.s.disconnectHandler != null) {
    return this.s.disconnectHandler.add('insert', ns, ops, options, callback);
  }

  // Execute write operation
  executeWriteOperation(this, 'remove', ns, ops, options, callback);
}

//
// Filter serves by tags
var filterByTags = function(readPreference, servers) {
  if(readPreference.tags == null) return servers;
  var filteredServers = [];
  var tagsArray = Array.isArray(readPreference.tags) ? readPreference.tags : [readPreference.tags];

  // Iterate over the tags
  for(var j = 0; j < tagsArray.length; j++) {
    var tags = tagsArray[j];

    // Iterate over all the servers
    for(var i = 0; i < servers.length; i++) {
      var serverTag = servers[i].lastIsMaster().tags || {};
      // console.log("==== filter server :: " + servers[i].name)
      // console.dir(serverTag)
      // Did we find the a matching server
      var found = true;
      // Check if the server is valid
      for(var name in tags) {
        // console.log("== compare :: " + name)
        // console.log("serverTag[name] == " + serverTag[name])
        // console.log("tags[name] == " + tags[name])
        if(serverTag[name] != tags[name]) found = false;
      }
      // console.dir(found)

      // Add to candidate list
      if(found) {
        filteredServers.push(servers[i]);
      }
    }

    // We found servers by the highest priority
    if(found) break;
  }

  // Returned filtered servers
  return filteredServers;
}

function pickNearest(self, set, readPreference) {
  // Only get primary and secondaries as seeds
  var seeds = {};
  var servers = [];
  if(set.primary) {
    servers.push(set.primary);
  }
  // console.log("!!!!!!!!!!!!!!!!!!! pickNearest 0")

  for(var i = 0; i < set.secondaries.length; i++) {
    servers.push(set.secondaries[i]);
  }

  // console.log("!!!!!!!!!!!!!!!!!!! pickNearest 1")
  // console.dir(readPreference)

  // Filter by tags
  servers = filterByTags(readPreference, servers);

  // // Transform the list
  // var serverList = [];
  // // for(var name in seeds) {
  // for(var i = 0; i < servers.length; i++) {
  //   // serverList.push({name: servers[i].name, time: self.s.pings[servers[i].name] || 0});
  // }
  // console.log("!!!!!!!!!!!!!!!!!!! pickNearest 2")

  // Sort by time
  servers.sort(function(a, b) {
    // return a.time > b.time;
    return a.lastIsMasterMS > b.lastIsMasterMS
  });

  // console.log("!!!!!!!!!!!!!!!!!!! pickNearest 3")

  // Locate lowest time (picked servers are lowest time + acceptable Latency margin)
  var lowest = servers.length > 0 ? servers[0].lastIsMasterMS : 0;

  // console.log("!!!!!!!!!!!!!!!!!!! pickNearest 4 :: " + servers.length + " :: " + lowest)

  // Filter by latency
  servers = servers.filter(function(s) {
    // console.dir(self.s)
    // console.log("==== filter")
    // console.log("  s.lastIsMasterMS = " + s.lastIsMasterMS)
    // console.log("  lowest + self.s.acceptableLatency = " + (lowest + self.s.acceptableLatency))
    return s.lastIsMasterMS <= lowest + self.s.acceptableLatency;
  });
  // console.log("!!!!!!!!!!!!!!!!!!! pickNearest 5 :: " + servers.length)

  // No servers, default to primary
  if(servers.length == 0 && set.primary) {
    // if(self.s.logger.isInfo()) self.s.logger.info(f('picked primary server [%s]', set.primary.name));
    return set.primary;
  } else if(servers.length == 0) {
    return null
  }
  // console.log("!!!!!!!!!!!!!!!!!!! pickNearest 6")

  // // We picked first server
  // if(self.s.logger.isInfo()) self.s.logger.info(f('picked server [%s] with ping latency [%s]', serverList[0].name, serverList[0].time));

  // Add to the index
  self.s.index = self.s.index + 1;
  // Select the index
  self.s.index = self.s.index % servers.length;
  // console.log("!!!!!!!!!!!!!!!!!!! pickNearest 7")
  // console.log(servers.map(function(x) { return x.name}))

  // Return the first server of the sorted and filtered list
  return servers[self.s.index];
}

//
// Pick a server based on readPreference
function pickServer(self, s, readPreference) {
  // console.log("============== pickServer")
  // console.dir(readPreference)
  // console.log("self.s.replicaSetState.primary = " + self.s.replicaSetState.primary != null);
  // console.log("self.s.replicaSetState.secondaries = " + self.s.replicaSetState.secondaries.length);
  // console.log("self.s.replicaSetState.arbiters = " + self.s.replicaSetState.arbiters.length);
  // If no read Preference set to primary by default
  readPreference = readPreference || ReadPreference.primary;

  // Do we have a custom readPreference strategy, use it
  // if(s.readPreferenceStrategies != null && s.readPreferenceStrategies[readPreference.preference] != null) {
    // if(s.readPreferenceStrategies[readPreference.preference] == null) throw new MongoError(f("cannot locate read preference handler for %s", readPreference.preference));
    // var server = s.readPreferenceStrategies[readPreference.preference].pickServer(s.replicaSetState, readPreference);
    // if(s.debug) self.emit('pickedServer', readPreference, server);
  //   return server;
  // }

  // Do we have the nearest readPreference
  if(readPreference.preference == 'nearest') {
    // console.log("============ nearest")
    return pickNearest(self, s.replicaSetState, readPreference);
  }

  // Get all the secondaries
  var secondaries = s.replicaSetState.secondaries;

  // Check if we can satisfy and of the basic read Preferences
  if(readPreference.equals(ReadPreference.secondary)
    && secondaries.length == 0) {
      return new MongoError("no secondary server available");
    }

  if(readPreference.equals(ReadPreference.secondaryPreferred)
    && secondaries.length == 0
    && s.replicaSetState.primary == null) {
      return new MongoError("no secondary or primary server available");
    }

  if(readPreference.equals(ReadPreference.primary)
    && s.replicaSetState.primary == null) {
      return new MongoError("no primary server available");
    }

  // Secondary preferred or just secondaries
  if(readPreference.equals(ReadPreference.secondaryPreferred)
    || readPreference.equals(ReadPreference.secondary)) {
    if(secondaries.length > 0) {
      // console.log("==================== secondaries :: " + secondaries.length)
      // Apply tags if present
      var servers = filterByTags(readPreference, secondaries);
      // console.log("==================== servers :: " + servers.length)
      // If have a matching server pick one otherwise fall through to primary
      if(servers.length > 0) {
        s.index = (s.index + 1) % servers.length;
        // console.log("==================== servers :: " + s.index)
        return servers[s.index];
      }
    }

    return readPreference.equals(ReadPreference.secondaryPreferred) ? s.replicaSetState.primary : null;
  }

  // Primary preferred
  if(readPreference.equals(ReadPreference.primaryPreferred)) {
    if(s.replicaSetState.primary) return s.replicaSetState.primary;

    if(secondaries.length > 0) {
      // Apply tags if present
      var servers = filterByTags(readPreference, secondaries);
      // If have a matching server pick one otherwise fall through to primary
      if(servers.length > 0) {
        s.index = (s.index + 1) % servers.length;
        return servers[s.index];
      }

      // Throw error a we have not valid secondary or primary servers
      return new MongoError("no secondary or primary server available");
    }
  }

  // Return the primary
  return s.replicaSetState.primary;
}

/**
 * Execute a command
 * @method
 * @param {string} ns The MongoDB fully qualified namespace (ex: db1.collection1)
 * @param {object} cmd The command hash
 * @param {ReadPreference} [options.readPreference] Specify read preference if command supports it
 * @param {Connection} [options.connection] Specify connection object to execute command against
 * @param {Boolean} [options.serializeFunctions=false] Specify if functions on an object should be serialized.
 * @param {Boolean} [options.ignoreUndefined=false] Specify if the BSON serializer should ignore undefined fields.
 * @param {opResultCallback} callback A callback function
 */
ReplSet.prototype.command = function(ns, cmd, options, callback) {
  // console.log("--------- command")
  if(typeof options == 'function') callback = options, options = {}, options = options || {};
  if(this.state == DESTROYED) return callback(new MongoError(f('topology was destroyed')));
  var self = this;

  // Establish readPreference
  var readPreference = options.readPreference ? options.readPreference : ReadPreference.primary;
  // console.log("!!! repflset command 0")
  // Pick a server
  var server = pickServer(self, self.s, readPreference);
  if(!(server instanceof Server)) return callback(server);
  if(self.s.debug) self.emit('pickedServer', ReadPreference.primary, server);
  // console.log("!!! replset command 1")

  // Topology is not connected, save the call in the provided store to be
  // Executed at some point when the handler deems it's reconnected
  if(!server && this.s.disconnectHandler != null) {
    return this.s.disconnectHandler.add('command', ns, cmd, options, callback);
  }

  // console.log("!!! replset command 2")

  // No server returned we had an error
  if(server == null) {
    return callback(new MongoError(f("no server found that matches the provided readPreference %s", readPreference)));
  }

  // console.log("!!! replset command 3")

  // Execute the command
  server.command(ns, cmd, options, callback);
}

/**
 * Authenticate using a specified mechanism
 * @method
 * @param {string} mechanism The Auth mechanism we are invoking
 * @param {string} db The db we are invoking the mechanism against
 * @param {...object} param Parameters for the specific mechanism
 * @param {authResultCallback} callback A callback function
 */
ReplSet.prototype.auth = function(mechanism, db) {
  // console.log("^^^ ReplSet.prototype.auth 0")
  var allArgs = Array.prototype.slice.call(arguments, 0).slice(0);
  var self = this;
  var args = Array.prototype.slice.call(arguments, 2);
  var callback = args.pop();

  // If we don't have the mechanism fail
  if(this.authProviders[mechanism] == null && mechanism != 'default') {
    throw new MongoError(f("auth provider %s does not exist", mechanism));
  }

  // Are we already authenticating, throw
  if(this.authenticating) {
    throw new MongoError('authentication or logout allready in process');
  }

  // Topology is not connected, save the call in the provided store to be
  // Executed at some point when the handler deems it's reconnected
  if(!self.s.replicaSetState.hasPrimary() && self.s.disconnectHandler != null) {
    return self.s.disconnectHandler.add('auth', db, allArgs, {}, callback);
  }

  // Set to authenticating
  this.authenticating = true;
  // All errors
  var errors = [];

  // Get all the servers
  var servers = this.s.replicaSetState.allServers();
  // No servers return
  if(servers.length == 0) {
    this.authenticating = false;
    callback(null, true);
  }

  // Authenticate
  function auth(server) {
    // Arguments without a callback
    var argsWithoutCallback = [mechanism, db].concat(args.slice(0));
    // Create arguments
    var finalArguments = argsWithoutCallback.concat([function(err, r) {
      count = count - 1;
      // Save all the errors
      if(err) errors.push({name: server.name, err: err});
      // We are done
      if(count == 0) {
        // console.log("^^^ ReplSet.prototype.auth 1")
        // Auth is done
        self.authenticating = false;

        // // Any missing servers
        // applyCredentialsToNonAuthenticatedServers(self, function() {
          // Return the auth error
          if(errors.length) return callback(MongoError.create({
            message: 'authentication fail', errors: errors
          }), false);

          // Successfully authenticated session
          callback(null, self);
        // });
      }
    }]);

    // Execute the auth only against non arbiter servers
    if(!server.lastIsMaster().arbiterOnly) {
      // console.log("+++++++++++++++++++++++++++++++++++++++++ auth")
      // console.dir(finalArguments)
      server.auth.apply(server, finalArguments);
      // console.log("+++++++++++++++++++++++++++++++++++++++++ auth 1")
    }
  }

  // Get total count
  var count = servers.length;
  // Authenticate against all servers
  while(servers.length > 0) {
    auth(servers.shift());
  }
}

/**
 * Logout from a database
 * @method
 * @param {string} db The db we are logging out from
 * @param {authResultCallback} callback A callback function
 */
ReplSet.prototype.logout = function(dbName, callback) {
  var self = this;
  // Are we authenticating or logging out, throw
  if(this.authenticating) {
    throw new MongoError('authentication or logout allready in process');
  }

  // Ensure no new members are processed while logging out
  this.authenticating = true;

  // console.log("==== logout 0")
  // Remove from all auth providers (avoid any reaplication of the auth details)
  var providers = Object.keys(this.authProviders);
  for(var i = 0; i < providers.length; i++) {
    this.authProviders[providers[i]].logout(dbName);
  }
  // console.log("==== logout 1")

  // Now logout all the servers
  var servers = this.s.replicaSetState.allServers();
  var count = servers.length;
  if(count == 0) return callback();
  var errors = [];
  // console.log("==== logout 2")

  // Execute logout on all server instances
  for(var i = 0; i < servers.length; i++) {
    servers[i].logout(dbName, function(err) {
      count = count - 1;
      if(err) errors.push({name: server.name, err: err});

      if(count == 0) {
        // console.log("==== logout 3")
        // Do not block new operations
        self.authenticating = false;
        // If we have one or more errors
        if(errors.length) return callback(MongoError.create({
          message: f('logout failed against db %s', dbName), errors: errors
        }), false);

        // No errors
        callback();
      }
    });
  }
}

/**
 * Perform one or more remove operations
 * @method
 * @param {string} ns The MongoDB fully qualified namespace (ex: db1.collection1)
 * @param {{object}|{Long}} cmd Can be either a command returning a cursor or a cursorId
 * @param {object} [options.batchSize=0] Batchsize for the operation
 * @param {array} [options.documents=[]] Initial documents list for cursor
 * @param {ReadPreference} [options.readPreference] Specify read preference if command supports it
 * @param {Boolean} [options.serializeFunctions=false] Specify if functions on an object should be serialized.
 * @param {Boolean} [options.ignoreUndefined=false] Specify if the BSON serializer should ignore undefined fields.
 * @param {opResultCallback} callback A callback function
 */
ReplSet.prototype.cursor = function(ns, cmd, cursorOptions) {
  cursorOptions = cursorOptions || {};
  var FinalCursor = cursorOptions.cursorFactory || this.s.Cursor;
  return new FinalCursor(this.s.bson, ns, cmd, cursorOptions, this, this.s.options);
}

module.exports = ReplSet;
