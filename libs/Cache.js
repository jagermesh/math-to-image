import crypto from 'crypto';
import redis from 'redis';
import parseDuration from 'parse-duration';

export default class Cache {
  constructor(application, config) {
    this.APP_ID = '27af2f86-6d6c-4254-a6f1-694386ffc921';
    this.config = Object.assign({}, config);
    this.application = application;

    this.cacheImpl = null;

    if (this.config.redis) {
      this.config.redis.lifespanSeconds = parseDuration(this.config.redis.lifespan) / 1000;
      const redisClient = redis.createClient({
        url: this.config.redis.connectString,
      });
      redisClient.on('error', (error) => {
        this.application.consoleLogError(`Redis error: ${error.toString()}`);
      });
      redisClient.on('connect', () => {
        this.application.consoleLog(`Redis connected`);
        this.cacheImpl = redisClient;
      });
      redisClient.on('reconnecting', () => {
        this.cacheImpl = null;
      });
      redisClient.on('end', () => {
        this.cacheImpl = null;
      });
      redisClient.connect();
    }
  }

  getKey(name) {
    const hash = crypto.createHash('sha1').update(name, 'utf8').digest('hex');
    return `${this.APP_ID}:${hash}`;
  }

  get(name, callback) {
    if (this.cacheImpl) {
      this.application.consoleLogRequestInfo(name, 'Checking cache');
      try {
        this.cacheImpl.get(this.getKey(name)).then((value) => {
          this.application.consoleLogRequestInfo(name, 'Success');
          callback(value);
        }).catch((error) => {
          this.application.consoleLogRequestError(name, `Checking cache failed (1): ${error}`);
          callback(null);
        });
      } catch (error) {
        this.application.consoleLogRequestError(name, `Checking cache failed (2): ${error}`);
        callback(null);
      }
    } else {
      callback(null);
    }
  }

  set(name, value) {
    if (this.cacheImpl) {
      try {
        this.cacheImpl.set(this.getKey(name), value, {
          EX: this.config.redis.lifespanSeconds
        });
      } catch {
        //
      }
    }
  }
};
