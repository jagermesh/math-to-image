const md5 = require('md5');
const redis = require("redis");
const parseDuration = require('parse-duration');

function Cache(application, config) {

  const AppId = '13844a7e-deae-4f11-a291-59f3e1cb519b';

  var _this = this;

  _this.config = config;
  _this.cacheImpl = null;

  if (_this.config.redis) {
    _this.config.redis.lifespanSeconds = parseDuration(_this.config.redis.lifespan) / 1000;
    var redisClient = redis.createClient(_this.config.redis.connectString);
    redisClient.on('error', function(error) {
      application.consoleLogError('Redis error: ' + error.toString());
    });
    redisClient.on('connect', function(error) {
      // application.consoleLog('Redis connected');
      _this.cacheImpl = redisClient;
    });
    redisClient.on('reconnecting', function(error) {
      // application.consoleLogError('Redis is reconnecting');
      _this.cacheImpl = null;
    });
    redisClient.on('end', function(error) {
      // application.consoleLogError('Redis is disconnected');
      _this.cacheImpl = null;
    });
  }

  function getKey(name) {

    return AppId + ':' + md5(name);

  }

  _this.get = function(name, callback) {

    if (_this.cacheImpl) {
      try {
        _this.cacheImpl.get(getKey(name), function (error, value) {
          callback(value);
        });
      } catch (Error) {
        callback(null);
      }
    } else {
      callback(null);
    }

  };

  _this.set = function(name, value) {

    if (_this.cacheImpl) {
      _this.cacheImpl.set(getKey(name), value, 'EX', _this.config.redis.lifespanSeconds);
    }

  };

  _this.quit = function() {

    if (_this.cacheImpl) {
      _this.cacheImpl.quit();
    }

  };

}

module.exports = Cache;