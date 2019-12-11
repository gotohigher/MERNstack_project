'use strict';

const Promise = require('bluebird');
const loadSpecTests = require('../../spec').loadSpecTests;
const ConnectionPool = require('../../../lib/cmap/connection_pool').ConnectionPool;
const EventEmitter = require('events').EventEmitter;

const chai = require('chai');
chai.use(require('../../functional/spec-runner/matcher').default);
const expect = chai.expect;

class Connection {
  constructor(options) {
    options = options || {};
    this.generation = options.generation;
    this.id = options.id;
    this.maxIdleTimeMS = options.maxIdleTimeMS;
    this.poolId = options.poolId;
    this.address = options.address;
    this.readyToUse = false;
    this.lastMadeAvailable = undefined;
    this.callbacks = [];
  }

  get metadata() {
    return {
      id: this.id,
      generation: this.generation,
      poolId: this.poolId,
      address: this.adress
    };
  }

  timeIdle() {
    return this.readyToUse ? Date.now() - this.lastMadeAvailable : 0;
  }

  write(callback) {
    setTimeout(() => callback());
  }

  makeReadyToUse() {
    this.readyToUse = true;
    this.lastMadeAvailable = Date.now();
  }

  makeInUse() {
    this.readyToUse = false;
    this.lastMadeAvailable = undefined;
  }

  waitUntilConnect(callback) {
    if (this.readyToUse) {
      return callback(null, this);
    }

    this.callbacks.push(callback);
  }

  connect(callback) {
    this.callbacks.push(callback);
    setTimeout(() => {
      this.makeReadyToUse();
      this.callbacks.forEach(c => c(null, this));
      this.callbacks = [];
    });
  }

  destroy() {}
}

const ALL_POOL_EVENTS = new Set([
  'connectionPoolCreated',
  'connectionPoolClosed',
  'connectionCreated',
  'connectionReady',
  'connectionClosed',
  'connectionCheckOutStarted',
  'connectionCheckOutFailed',
  'connectionCheckedOut',
  'connectionCheckedIn',
  'connectionPoolCleared'
]);

const PROMISIFIED_POOL_FUNCTIONS = {
  checkOut: Promise.promisify(ConnectionPool.prototype.checkOut),
  checkIn: Promise.promisify(ConnectionPool.prototype.checkIn),
  clear: Promise.promisify(ConnectionPool.prototype.clear),
  close: Promise.promisify(ConnectionPool.prototype.close)
};

function destroyPool(pool) {
  return new Promise(resolve => {
    ALL_POOL_EVENTS.forEach(ev => pool.removeAllListeners(ev));
    pool.destroy(resolve);
    resolve();
  });
}

describe('Connection Pool', function() {
  describe('spec tests', function() {
    const threads = new Map();
    const connections = new Map();
    const poolEvents = [];
    const poolEventsEventEmitter = new EventEmitter();
    let pool = undefined;

    function createPool(options) {
      const address = 'localhost:27017';
      options = Object.assign({}, options, { Connection, address });

      pool = new ConnectionPool(options);
      ALL_POOL_EVENTS.forEach(ev => {
        pool.on(ev, x => {
          poolEvents.push(x);
          poolEventsEventEmitter.emit('poolEvent');
        });
      });
    }

    function getThread(name) {
      let thread = threads.get(name);
      if (!thread) {
        thread = new Thread();
        threads.set(name, thread);
      }

      return thread;
    }

    const OPERATION_FUNCTIONS = {
      checkOut: function(op) {
        return PROMISIFIED_POOL_FUNCTIONS.checkOut.call(pool).then(connection => {
          if (op.label != null) {
            connections.set(op.label, connection);
          }
        });
      },
      checkIn: function(op) {
        const connection = connections.get(op.connection);
        const force = op.force;

        if (!connection) {
          throw new Error(`Attempted to release non-existient connection ${op.connection}`);
        }

        return PROMISIFIED_POOL_FUNCTIONS.checkIn.call(pool, connection, force);
      },
      clear: function() {
        return PROMISIFIED_POOL_FUNCTIONS.clear.call(pool);
      },
      close: function() {
        return PROMISIFIED_POOL_FUNCTIONS.close.call(pool);
      },
      wait: function(options) {
        const ms = options.ms;
        return new Promise(r => setTimeout(r, ms));
      },
      start: function(options) {
        const target = options.target;
        const thread = getThread(target);
        thread.start();
      },
      waitForThread: function(options) {
        const name = options.name;
        const target = options.target;
        const suppressError = options.suppressError;

        const threadObj = threads.get(target);

        if (!threadObj) {
          throw new Error(`Attempted to run op ${name} on non-existent thread ${target}`);
        }

        return threadObj.finish().catch(e => {
          if (!suppressError) {
            throw e;
          }
        });
      },
      waitForEvent: function(options) {
        const event = options.event;
        const count = options.count;
        return new Promise(resolve => {
          function run() {
            if (poolEvents.filter(ev => ev.type === event).length >= count) {
              return resolve();
            }

            poolEventsEventEmitter.once('poolEvent', run);
          }
          run();
        });
      }
    };

    class Thread {
      constructor() {
        this._killed = false;
        this._error = undefined;
        this._promise = new Promise(resolve => {
          this.start = () => setTimeout(resolve);
        });
      }

      run(op) {
        if (this._killed || this._error) {
          return;
        }
        this._promise = this._promise
          .then(() => this._runOperation(op))
          .catch(e => (this._error = e));
      }

      _runOperation(op) {
        const operationFn = OPERATION_FUNCTIONS[op.name];
        if (!operationFn) {
          throw new Error(`Invalid command ${op.name}`);
        }

        return Promise.resolve()
          .then(() => operationFn(op, this))
          .then(() => new Promise(r => setTimeout(r)));
      }

      finish() {
        this._killed = true;
        return this._promise.then(() => {
          if (this._error) {
            throw this._error;
          }
        });
      }
    }

    afterEach(() => {
      const p = pool ? destroyPool(pool) : Promise.resolve();
      return p.then(() => {
        pool = undefined;
        threads.clear();
        connections.clear();
        poolEvents.length = 0;
        poolEventsEventEmitter.removeAllListeners();
      });
    });

    loadSpecTests('connection-monitoring-and-pooling').forEach(test => {
      it(test.description, function() {
        const operations = test.operations;
        const expectedEvents = test.events || [];
        const ignoreEvents = test.ignore || [];
        const expectedError = test.error;
        const poolOptions = test.poolOptions || {};

        let actualError;

        const MAIN_THREAD_KEY = Symbol('Main Thread');
        const mainThread = new Thread();
        threads.set(MAIN_THREAD_KEY, mainThread);
        mainThread.start();

        createPool(poolOptions);

        let basePromise = Promise.resolve();

        for (let idx in operations) {
          const op = operations[idx];

          const threadKey = op.thread || MAIN_THREAD_KEY;
          const thread = getThread(threadKey);

          basePromise = basePromise.then(() => {
            if (!thread) {
              throw new Error(`Invalid thread ${threadKey}`);
            }

            return Promise.resolve()
              .then(() => thread.run(op))
              .then(() => new Promise(r => setTimeout(r)));
          });
        }

        return basePromise
          .then(() => mainThread.finish())
          .catch(e => (actualError = e))
          .then(() => {
            const actualEvents = poolEvents.filter(ev => ignoreEvents.indexOf(ev.type) < 0);

            if (expectedError) {
              if (!actualError) {
                expect(actualError).to.matchMongoSpec(expectedError);
              } else {
                const ae = Object.assign({}, actualError, { message: actualError.message });
                expect(ae).to.matchMongoSpec(expectedError);
              }
            } else if (actualError) {
              throw actualError;
            }

            expectedEvents.forEach((expected, index) => {
              const actual = actualEvents[index];
              expect(actual).to.matchMongoSpec(expected);
            });
          });
      });
    });
  });
});
