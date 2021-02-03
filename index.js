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
const axios = require('axios');

class Cache {

  constructor(application, config) {
    const _this = this;

    _this.APP_ID = '27af2f86-6d6c-4254-a6f1-694386ffc921';
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

  cleanUpHtmlCharacters(html) {
    const _this = this;

    const result = html.replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'");
    return result;
  }

  async cleanUpMathML(mathml, additionalImages, cacheKey) {
    const _this = this;

    if (!/mstyle mathsize/i.test(mathml)) {
      mathml = mathml.replace(/(<math[^>]*?>)/i, '$1<mstyle mathsize="16px">');
      mathml = mathml.replace('</math>', '</mstyle></math>');
    }
    if (!/<math[^>]*?><mstyle[^>]*?><mtable[^>]*?>/i.test(mathml)) {
      if (/<math[^>]*?><mstyle[^>]*?>[ \n]*<mrow[^>]*?>/i.test(mathml) && /<[/]mrow><[/]mstyle><[/]math>/i.test(mathml)) {
        mathml = mathml.replace(/(<math[^>]*?><mstyle[^>]*?>)/i, '$1<mtable>');
        mathml = mathml.replace('</mstyle></math>', '</mtable></mstyle></math>');
      } else {
        mathml = mathml.replace(/(<math[^>]*?><mstyle[^>]*?>)/i, '$1<mtable><mrow>');
        mathml = mathml.replace('</mstyle></math>', '</mrow></mtable></mstyle></math>');
      }
      mathml = mathml.replace(/<mspace[ ]+linebreak="newline"[^>]*?>.*?<\/mspace>/ig, '</mrow><mrow>');
      mathml = mathml.replace(/<mspace[ ]+linebreak="newline"[^>]*?\/>/ig, '</mrow><mrow>');
    }

    if (additionalImages) {
      const dpi = 20;
      for(let i = 0; i < additionalImages.length; i++) {
        try {
          let additionalImage = additionalImages[i];
          let imageBuffer =  Buffer.from(additionalImage.base64, 'base64');
          let metadata = await sharp(imageBuffer).metadata();
          let width = metadata.width/dpi;
          let height = metadata.height/dpi;
          // mathml = mathml.replace('<mo>&#x2318;</mo>', `<mglyph width="${width}" height="${height}" src="data:image/${additionalImage.format};base64,${additionalImage.base64}"></mglyph>`);
          mathml = mathml.replace('<mtext>&#x2318;</mtext>', `</mrow><mrow><mglyph width="${width}" height="${height}" src="data:image/${additionalImage.format};base64,${additionalImage.base64}"></mglyph></mrow><mrow>`);
        } catch (err) {
          _this.consoleLogRequestError(cacheKey, `${err}`);
        }
      }
    }

    return mathml;
  }

  cleanUpLatex(html) {
    const _this = this;

    // not supported
    let result = html.replace(/\\textcolor\{transparent\}\{\}/g, '\\\\')
      .replace(/\\textcolor\{transparent\}/g, '\\\\')
      .replace(/\\includegraphics\{.*?\}/g, '⌘')
      // .replace(/\\includegraphics\{.*?\}/g, 'Y')
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

  downloadImage(url) {
    const _this = this;

    return new Promise(function(resolve, reject) {
      axios.get(url, { responseType: 'arraybuffer' }).then(function(response) {
        if (response.status != 200) {
          return reject('Can not download image');
        }
        return resolve(Buffer.from(response.data, 'binary').toString('base64'));
      }).catch(function(err) {
        reject(err);
      });
    });
  }

  downloadImages(mathml, cacheKey) {
    const _this = this;

    return new Promise(async function(resolve, reject) {
      let urls = [...mathml.matchAll(/<mglyph.+?src="(http[^"]+)"/g)].map(function(match) {
        return match[1];
      });
      for(let i = 0; i < urls.length; i++) {
        try {
          let data = await _this.downloadImage(urls[i]);
          mathml = mathml.replace(`src="${urls[i]}"`, `src="data:image/png;base64,${data}"`);
        } catch (err) {
          _this.consoleLogRequestError(cacheKey, `${err}`);
        }
      }
      resolve(mathml);
    });
  }

  extractImages(html) {
    const _this = this;

    let result = [];
    let matches = [...html.matchAll(/\\includegraphics\{.*?data:image\/(.+?);base64,(.+?)\}/g)];
    matches.map(function(match) {
      result.push({ format: match[1], base64: match[2] });
    });

    return result;
  }

  returnImage(response, responseBody, cacheKey, imageFormat) {
    const _this = this;

    if (imageFormat == 'png') {
      response.writeHead(200, { 'Content-Type': 'image/png' });
      response.write(responseBody);
    } else {
      // _this.consoleLogRequestInfo(cacheKey, `SVG: ${responseBody.substring(0, 512)}`);
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      response.write(responseBody);
    }
    response.end();

    _this.consoleLogRequestInfo(cacheKey, 'Request processed');
  }

  returnMathML(response, responseBody, cacheKey, imageFormat) {
    const _this = this;

    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.write(responseBody);
    response.end();

    _this.consoleLogRequestInfo(cacheKey, 'Request processed');
  }

  renderEquation(response, equationFormat, equation, cacheKey, imageFormat) {
    const _this = this;

    let normalizedEquation = equation.trim();
    try {
      let svgDom = _this.MathJax.mathml2svg(normalizedEquation);
      let svg = _this.MathJax.startup.adaptor.innerHTML(svgDom);
      svg = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE svg PUBLIC '-//W3C//DTD SVG 1.1//EN' 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd'>${svg}`;
      svg = svg.replace(/ href="data[:]image/g, ' xlink:href="data:image');
      _this.consoleLogRequestInfo(cacheKey, 'Rendered');
      if (imageFormat == 'png') {
        sharp(Buffer.from(svg)).toFormat('png').toBuffer(function(error, png) {
          if (error) {
            _this.consoleLogRequestError(cacheKey, `${error} (${equationFormat}: ${normalizedEquation})`);
            returnError(response, `${equationFormat}: ${normalizedEquation}: ${error}`, cacheKey);
          } else {
            _this.consoleLogRequestInfo(cacheKey, 'Saving result to cache');
            _this.cache.set(cacheKey, png.toString('base64'));
            _this.returnImage(response, png, cacheKey, imageFormat);
          }
        });
      } else {
        _this.consoleLogRequestInfo(cacheKey, 'Saving result to cache');
        _this.cache.set(cacheKey, Buffer.from(svg).toString('base64'));
        _this.returnImage(response, svg, cacheKey, imageFormat);
      }
    } catch (error) {
      _this.consoleLogRequestError(cacheKey, `${error} (${equationFormat}: ${normalizedEquation})`);
      _this.returnError(response, `${equationFormat}: ${normalizedEquation}: ${error}`, cacheKey);
    }
  }

  handleRequest(request, response, requestUrl, query) {
    const _this = this;

    const equationFormat = (query.format ? query.format : 'MathML');
    const refid = (query.refid ? query.refid : '');
    const outputFormat = (query.outputFormat ? query.outputFormat : (query.imageFormat ? query.imageFormat : 'svg'));
    const equation = query.equation ? query.equation : '';

    if (equation && equation.length > 0) {
      let hash = crypto.createHash('sha1').update(equation, 'utf8').digest('hex');
      let cacheKey = `${equationFormat}:${hash}:${refid}:${outputFormat}`;

      _this.consoleLogRequestInfo(cacheKey, `${request.method}: ${requestUrl.substring(0, 512)}`);
      _this.consoleLogRequestInfo(cacheKey, `${equationFormat}, original: ${equation.substring(0, 512)}`);

      _this.cache.get(cacheKey, function (currentValue) {
        if (currentValue) {
          _this.consoleLogRequestInfo(cacheKey, 'Equation found in cache');
          const image = new Buffer(currentValue, 'base64');
          _this.returnImage(response, image, cacheKey, outputFormat);
        } else {
          let normalizedEquation = equation;
          let additionalImages = [];
          if (equationFormat == 'TeX') {
            additionalImages   = _this.extractImages(normalizedEquation);
            normalizedEquation = _this.cleanUpHtmlCharacters(normalizedEquation);
            normalizedEquation = _this.cleanUpLatex(normalizedEquation);
            _this.consoleLogRequestInfo(cacheKey, `ORIGINAL: ${normalizedEquation}`);
            // normalizedEquation
            normalizedEquation = _this.MathJax.tex2mml(normalizedEquation);
            normalizedEquation = normalizedEquation.replace(/<mrow>.*?<mo>&#x2318;<[/]mo>.*?<[/]mrow>/gs, '<mtext>&#x2318;</mtext>');
          }
          _this.downloadImages(normalizedEquation, cacheKey).then(function(normalizedEquation) {
            _this.cleanUpMathML(normalizedEquation, additionalImages, cacheKey).then(function(normalizedEquation) {
              normalizedEquation = normalizedEquation.trim();
              _this.consoleLogRequestInfo(cacheKey, `NORMALIZED: ${normalizedEquation}`);
              _this.consoleLogRequestInfo(cacheKey, `MathML: ${normalizedEquation.substring(0, 512)}`);
              if (outputFormat == 'MathML') {
                _this.returnMathML(response, normalizedEquation);
              } else {
                _this.renderEquation(response, equationFormat, normalizedEquation, cacheKey, outputFormat);
              }
            });
          });
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
      svg: {
        minScale: 1,
      }
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