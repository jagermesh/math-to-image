const path   = require('path');
const colors = require('colors');
const http = require('http');
const url = require('url');
const mathjax = require('mathjax');
const crypto = require('crypto');
const redis = require("redis");
const fs = require('fs');
const moment = require('moment');
const querystring = require('querystring');
const sharp = require('sharp');
const parseDuration = require('parse-duration');

class Cache {

  constructor(application, config) {
    const _this = this;

    _this.APP_ID = '13844a7e-deae-4f11-a291-59f3e1cb519b';
    _this.config = Object.assign({ }, config);

    _this.cacheImpl = null;

    if (_this.config.redis) {
      _this.config.redis.lifespanSeconds = parseDuration(_this.config.redis.lifespan) / 1000;
      const redisClient = redis.createClient(_this.config.redis.connectString);
      redisClient.on('error', function(error) {
        application.consoleLogError(`Redis error: ${error.toString()}`);
      });
      redisClient.on('connect', function(error) {
        _this.cacheImpl = redisClient;
      });
      redisClient.on('reconnecting', function(error) {
        _this.cacheImpl = null;
      });
      redisClient.on('end', function(error) {
        _this.cacheImpl = null;
      });
    }
  }

  getKey(name) {
    const _this = this;

    const hash = crypto.createHash('sha1').update(name, 'utf8').digest('hex');
    return `${_this.APP_ID}:${hash}`;
  }

  get(name, callback) {
    const _this = this;

    if (_this.cacheImpl) {
      try {
        _this.cacheImpl.get(_this.getKey(name), function (error, value) {
          callback(value);
        });
      } catch (error) {
        callback(null);
      }
    } else {
      callback(null);
    }
  }

  set(name, value) {
    const _this = this;

    if (_this.cacheImpl) {
      _this.cacheImpl.set(_this.getKey(name), value, 'EX', _this.config.redis.lifespanSeconds);
    }
  }

}

class MathToImage {

  constructor(config) {
    const _this = this;

    _this.API_KEY = 'fb499ad3-db31-430b-98ad-49db456b26a6';
    _this.config = Object.assign({ port: 8000 }, config);
    _this.cache = new Cache(_this, _this.config);
  }

  consoleLog(message) {
    const _this = this;

    if (message) {
      console.log(`${colors.yellow(moment().format())} ${message.replace(/[\n\r]/g, '')}`);
    } else {
      console.log('');
    }
  }

  consoleLogError(message) {
    const _this = this;

    _this.consoleLog(`${colors.red('[ERROR]')} ${message}`);
  }

  consoleLogRequestInfo(cacheKey, message) {
    const _this = this;

    _this.consoleLog(colors.green(`[${cacheKey}] `) + message);
  }

  consoleLogRequestError(cacheKey, message) {
    const _this = this;

    _this.consoleLog(colors.green(`[${cacheKey}] `) + colors.red('[ERROR] ') + message);
  }

  returnError(response, message, cacheKey, contentType = 'text/plain') {
    const _this = this;

    response.writeHead(406, { 'Content-Type': contentType });
    response.write(message);
    response.end();

    _this.consoleLogRequestError(cacheKey, message);
  }

  returnImage(response, responseBody, cacheKey, imageFormat) {
    const _this = this;

    if (imageFormat == 'png') {
      response.writeHead(200, { 'Content-Type': 'image/png' });
      response.write(responseBody, 'binary');
    } else {
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      response.write(responseBody);
    }
    response.end();

    _this.consoleLogRequestInfo(cacheKey, 'Request processed');
  }

  renderEquation(response, equationFormat, equation, cacheKey, imageFormat, width, height) {
    const _this = this;

    let normalizedEquation = equation.trim();
    try {
      let svgDom;
      switch (equationFormat) {
        case  'TeX':
          svgDom = _this.MathJax.tex2svg(normalizedEquation);
          break;
        case 'MathML':
          svgDom = _this.MathJax.mathml2svg(normalizedEquation);
          break;
      }
      let svg = _this.MathJax.startup.adaptor.innerHTML(svgDom);
      svg = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE svg PUBLIC '-//W3C//DTD SVG 1.1//EN' 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd'>${svg}`;
      _this.consoleLogRequestInfo(cacheKey, 'Rendered');
      if (imageFormat == 'png') {
        sharp(Buffer.from(svg)).toFormat('png').toBuffer(function(error, png) {
          if (error) {
            _this.consoleLogRequestError(cacheKey, `${error} (${equationFormat}: ${normalizedEquation})`);
            returnError(response, `${equationFormat}: ${normalizedEquation}: ${error}`, cacheKey);
          } else {
            _this.cache.set(cacheKey, png);
            _this.returnImage(response, png, cacheKey, imageFormat);
          }
        });
      } else {
        _this.cache.set(cacheKey, svg);
        _this.returnImage(response, svg, cacheKey, imageFormat);
      }
    } catch (error) {
      _this.consoleLogRequestError(cacheKey, `${error} (${equationFormat}: ${normalizedEquation})`);
      _this.returnError(response, `${equationFormat}: ${normalizedEquation}: ${error}`, cacheKey);
    }
  }

  cleanUpHtmlCharacters(html) {
    const _this = this;

    const result = html.replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'");
    return result;
  }

  cleanUpMathML(mathml) {
    const _this = this;

    if (!/mstyle mathsize/i.test(mathml)) {
      mathml = mathml.replace(/(<math[^>]*?>)/, '$1<mstyle mathsize="16px">');
      mathml = mathml.replace('</math>', '</mstyle></math>');
    }
    return mathml;
  }

  cleanUpLatex(html) {
    const _this = this;

    // not supported
    let result = html.replace(/\\textcolor\{transparent\}\{\}/g, '\\\\')
      .replace(/\\textcolor\{transparent\}/g, '\\\\')
      .replace(/\\fra\{/g, '\\frac{')
      .replace(/\\pir[^]/g, '\\pi r^')
      .replace(/\\timesr[^]/g, '\\times r^')
      .replace(/\\timess[^]/g, '\\times s^')
      .replace(/\^\{ \}/g, '')
      .replace(/([0-9])\^$/g, '$1^?')
      .replace(/#/g, '\\#');
    while(/_\{_\{_\{_\{_\{/.test(result)) {
      result = result.replace(/_\{_\{_\{_\{_\{/g, '_{_{');
    }
    while(/\}\}\}\}\}/.test(result)) {
      result = result.replace(/\}\}\}\}\}/g, '}}');
    }
    return result;
  }

  handleRequest(request, response, requestUrl, query) {
    const _this = this;

    const equationFormat = (query.format ? query.format : (query.latex ? 'TeX' : 'MathML'));
    const refid = (query.refid ? query.refid : '');
    const imageFormat = (query.imageFormat ? query.imageFormat : '');
    const width = (query.width ? query.width : null);
    const height = (query.height ? query.height : null);
    const equation = (query.equation ? query.equation : (query.latex || query.mathml));

    if (equation) {
      let hash = crypto.createHash('sha1').update(equation, 'utf8').digest('hex');
      let cacheKey = `${equationFormat}:${hash}:${refid}:${imageFormat}`;

      _this.consoleLogRequestInfo(cacheKey, `${request.method}: ${requestUrl}`);
      _this.consoleLogRequestInfo(cacheKey, `${equationFormat}, original: ${equation}`);

      _this.cache.get(cacheKey, function (currentValue) {
        if (currentValue) {
          _this.consoleLogRequestInfo(cacheKey, 'Equation found in cache');
          _this.returnImage(response, currentValue, cacheKey, imageFormat);
        } else {
          let normalizedEquation = equation;

          switch (equationFormat) {
            case  'TeX':
              normalizedEquation = _this.cleanUpHtmlCharacters(normalizedEquation);
              normalizedEquation = _this.cleanUpLatex(normalizedEquation);
              break;
            case 'MathML':
              normalizedEquation = _this.cleanUpMathML(normalizedEquation);
              break;
          }
          _this.consoleLogRequestInfo(cacheKey, `${equationFormat}, cleanup: ${normalizedEquation}`);
          if (/includegraphics/.test(normalizedEquation)) {
            _this.returnError(response, 'TeX parse error: Undefined control sequence \\includegraphics', cacheKey);
          } else {
            _this.renderEquation(response, equationFormat, normalizedEquation, cacheKey, imageFormat, width, height);
          }
        }
      });
    } else {
      if ((request.url.toString().length > 0) && (request.url.toString() != '/favicon.ico') && (request.url.toString() != '/')) {
        _this.consoleLogError(`Missing "equation" parameter (${request.url.toString()})`);
      }
      _this.returnError(response, 'Missing "equation" parameter', 'emptyequation');
    }
  }

  async start() {
    const _this = this;

    _this.MathJax = await require('mathjax').init({
      loader: {
        load: ['input/tex', 'input/mml', 'output/svg'],
      },
    });

    _this.server = http.createServer();

    _this.server.on('request', function(request, response) {
      if (request.method == 'POST') {
        let body = '';
        request.on('data', function(chunk) {
          body += chunk.toString();
        });
        request.on('end', function() {
          let query = querystring.parse(body);
          _this.handleRequest(request, response, body, query);
        });
      } else {
        let query = url.parse(request.url, true);
        _this.handleRequest(request, response, request.url.toString(), query.query);
      }
    });

    _this.server.on('clientError', (err, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });

    _this.server.listen(_this.config.port);

    _this.consoleLog(`Listening on port ${_this.config.port}`);
    _this.consoleLog();
  }

}

module.exports = MathToImage;