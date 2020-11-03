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

const Cache = require(`${__dirname}/Cache.js`);

function Application(configFile) {

  const _this = this;

  const API_KEY = 'fb499ad3-db31-430b-98ad-49db456b26a6';

  _this.configFile = configFile;

  _this.config = require(_this.configFile);

  _this.cache = new Cache(_this, _this.config);

  _this.consoleLog = function(message) {
    if (message) {
      console.log(`${colors.yellow(moment().format())} ${message.replace(/[\n\r]/g, '')}`);
    } else {
      console.log('');
    }
  };

  _this.consoleLogError = function(message) {
    _this.consoleLog(`${colors.red('[ERROR]')} ${message}`);
  };

  _this.consoleLogRequestInfo = function(cacheKey, message) {
    _this.consoleLog(colors.green(`[${cacheKey}] `) + message);
  };

  _this.consoleLogRequestError = function(cacheKey, message) {
    _this.consoleLog(colors.green(`[${cacheKey}] `) + colors.red('[ERROR] ') + message);
  };

  _this.returnError = function(response, message, cacheKey, contentType = 'text/plain') {
    response.writeHead(406, { 'Content-Type': contentType });
    response.write(message);
    response.end();

    _this.consoleLogRequestError(cacheKey, message);
  };

  _this.returnImage = function(response, responseBody, cacheKey, imageFormat) {
    if (imageFormat == 'png') {
      response.writeHead(200, { 'Content-Type': 'image/png' });
      response.write(responseBody, 'binary');
    } else {
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      response.write(responseBody);
    }
    response.end();

    _this.consoleLogRequestInfo(cacheKey, 'Request processed');
  };

  _this.renderEquation = function(response, equationFormat, equation, cacheKey, imageFormat, width, height) {
    let normalizedEquation = equation.trim();
    try {
      let svgDom;
      switch (equationFormat) {
        case  'TeX':
          svgDom = MathJax.tex2svg(normalizedEquation);
          break;
        case 'MathML':
          svgDom = MathJax.mathml2svg(normalizedEquation);
          break;
      }
      let svg = MathJax.startup.adaptor.innerHTML(svgDom);
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
  };

  _this.cleanUpHtmlCharacters = function(html) {
    const result = html.replace(/&gt;/g, '>')
                       .replace(/&lt;/g, '<')
                       .replace(/&amp;/g, '&')
                       .replace(/&quot;/g, '"')
                       .replace(/&#039;/g, "'");
    return result;
  };

  _this.cleanUpMathML = function(mathml) {
    if (!/mstyle mathsize/i.test(mathml)) {
      mathml = mathml.replace(/(<math[^>]*?>)/, '$1<mstyle mathsize="16px">');
      mathml = mathml.replace('</math>', '</mstyle></math>');
    }
    return mathml;
  };

  _this.cleanUpLatex = function(html) {
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
  };

  _this.handleRequest = function(request, response, requestUrl, query) {
    const equationFormat = (query.format ? query.format : (query.latex ? 'TeX' : 'MathML'));
    const refid = (query.refid ? query.refid : '');
    const imageFormat = (query.imageFormat ? query.imageFormat : '');
    const width = (query.width ? query.width : null);
    const height = (query.height ? query.height : null);
    const equation = (query.equation ? query.equation : (query.latex || query.mathml));

    // equationFormat = 'TeX';
    // equation = 'so\\ i\\ did\\ _{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{=-----------------------------------------------------------------------------------------------------------------------------------}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}9315';
    // equation = 'so\\ i\\ did\\ _{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{=-----------------------------------------------------------------------------------------------------------------------------------}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}9315\\div3\\ aand\\ i\\ got\\ 3105\\ \\ so\\ in\\ one\\ month\\ they\\ eat\\ 3105';
    // equation = 'so';

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
  };

  _this.run = async function() {
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
  };

}

module.exports = Application;