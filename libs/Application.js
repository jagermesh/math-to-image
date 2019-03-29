const path   = require('path');
const colors = require('colors');
const http = require('http');
const https = require('https');
const url = require('url');
const mathjax = require('mathjax-node');
const md5 = require('md5');
const redis = require("redis");
const parseDuration = require('parse-duration');
const commander = require('commander');
const fs = require('fs');
const moment = require('moment');
const querystring = require('querystring');

const Cache = require('./../libs/Cache.js');

function Application(configFile) {

  const API_KEY = 'fb499ad3-db31-430b-98ad-49db456b26a6';

  var _this = this;

  _this.configFile = configFile;

  _this.config = require(__dirname + '/../config/' + _this.configFile);

  _this.cache = new Cache(_this, _this.config);

  _this.consoleLog = function(message) {

    if (message) {
      console.log(colors.yellow(moment().format()) + ' ' + message.replace(/[\n\r]/g, ''));
    } else {
      console.log('');
    }

  };

  _this.consoleLogError = function(message) {

    _this.consoleLog(colors.red('[ERROR]') + ' ' + message);

  };

  _this.run = function() {

    mathjax.config({
      MathJax: {
        MathML: {
          extensions: ['mml3.js']
        }
      }
    });
    mathjax.start();

    const server = http.createServer();

    function consoleLogError(message, cacheKey) {

      consoleLog(colors.red('[ERROR] ') + message);

    }

    function consoleLogRequestInfo(cacheKey, message) {

      consoleLog(colors.green('[' + cacheKey + '] ') + message);

    }

    function consoleLogRequestError(cacheKey, message) {

      consoleLog(colors.green('[' + cacheKey + '] ') + colors.red('[ERROR] ') + message);

    }

    function consoleLog(message) {

      if (message) {
        console.log(colors.yellow(moment().format()) + ' ' + message.replace(/[\n\r]/g, ''));
      } else {
        console.log('');
      }

    }

    function returnError(response, message, cacheKey, contentType = 'text/plain') {

      response.writeHead(400, { 'Content-Type': contentType });
      response.write(message);
      response.end();

      consoleLogRequestError(cacheKey, message);
    }

    function returnImage(response, responseBody, cacheKey, imageFormat) {

      if (imageFormat == 'png') {
        response.writeHead(200, { 'Content-Type': 'image/png' });
        response.write(Buffer.from(responseBody, 'base64'), 'binary');
      } else {
        response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        response.write(responseBody);
      }
      response.end();

      consoleLogRequestInfo(cacheKey, 'Request processed');

    }

    function convertSvgToPng(data, renderSettings) {

      const svg2png = require('svg2png');

      var sourceBuffer = new Buffer.from(data.svg, 'utf-8');
      var returnBuffer = svg2png.sync(sourceBuffer);
      data.png = returnBuffer.toString('base64');

      return data;

    }

    function renderEquation(response, equationFormat, equation, cacheKey, imageFormat, width, height) {

      var renderSettings = {
        math: equation
      , format: equationFormat
      , svg: true
      , linebreaks: true
      // , timeout: 5
      };
      mathjax.typeset(renderSettings, function (data) {
        if (data.errors) {
          consoleLogRequestError(cacheKey, data.errors.join('; ') + ' (' + equationFormat + ': ' + equation + ')');
          returnError(response, equationFormat + ': ' + equation + ': ' + data.errors.join('; '), cacheKey);
          response.end();
        } else {
          consoleLogRequestInfo(cacheKey, 'Rendered');
          if (width !== null) {
            data.svg = data.svg.replace(/(<svg[^>]+width=")[^"]+/, '$1' + width + 'px');
          }
          if (height !== null) {
            data.svg = data.svg.replace(/(<svg[^>]+height=")[^"]+/, '$1' + height + 'px');
          }
          if (imageFormat == 'png') {
            data = convertSvgToPng(data, renderSettings);
            _this.cache.set(cacheKey, data.png);
            returnImage(response, data.png, cacheKey, imageFormat);
          } else {
            _this.cache.set(cacheKey, data.svg);
            returnImage(response, data.svg, cacheKey, imageFormat);
          }
        }
      });

    }

    function cleanUpHtmlCharacters(html) {

      var result = html.replace(/&gt;/g, '>')
                       .replace(/&lt;/g, '<')
                       .replace(/&amp;/g, '&')
                       .replace(/&quot;/g, '"')
                       .replace(/&#039;/g, "'");
      return result;

    }

    function cleanUpMathML(mathml) {

      if (!/mstyle mathsize/i.test(mathml)) {
        mathml = mathml.replace(/(<math[^>]*?>)/, '$1<mstyle mathsize="16px">');
        mathml = mathml.replace('</math>', '</mstyle></math>');
      }

      return mathml;

    }

    function cleanUpLatex(html) {

      // not supported

      var result = html.replace(/\\textcolor\{transparent\}\{\}/g, '\\\\')
                       .replace(/\\textcolor\{transparent\}/g, '\\\\')
                       .replace(/\\fra\{/g, '\\frac{')
                       .replace(/\^\{ \}/g, '')
                       .replace(/([0-9])\^$/g, '$1^?')
                       .replace(/#/g, '\\#');

      // while(/_\{_\{_\{_\{_\{/.test(result)) {
      //   result = result.replace(/_\{_\{_\{_\{_\{/g, '_{_{');
      // }
      // while(/\}\}\}\}\}/.test(result)) {
      //   result = result.replace(/\}\}\}\}\}/g, '}}');
      // }

      return result;

    }

    function handleRequest(request, response, requestUrl, query) {

      var equationFormat = query.latex ? 'TeX' : 'MathML';
      var equation       = query.latex || query.mathml;
      var refid          = query.refid ? query.refid : '';
      var imageFormat    = query.imageFormat ? query.imageFormat : '';
      var width          = query.width ? query.width : null;
      var height         = query.height ? query.height : null;

      // equation = 'so\\ i\\ did\\ _{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{_{=-----------------------------------------------------------------------------------------------------------------------------------}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}9315';
      // equation = 'so';

      if (equation) {
        var cacheKey = equationFormat + ':' + md5(equation);
        if (refid) {
          cacheKey += ':' + refid;
        }
        if (imageFormat) {
          cacheKey += ':' + imageFormat;
        }
        // cacheKey += '.7';
        // cacheKey += Math.random();

        consoleLogRequestInfo(cacheKey, request.method + ': ' + requestUrl);
        consoleLogRequestInfo(cacheKey, equationFormat + ', original: ' + equation);

        _this.cache.get(cacheKey, function (currentValue) {
          if (currentValue) {
            consoleLogRequestInfo(cacheKey, 'Equation found in cache');
            returnImage(response, currentValue, cacheKey, imageFormat);
          } else {
            switch (equationFormat) {
              case  'TeX':
                equation = cleanUpHtmlCharacters(equation);
                consoleLogRequestInfo(cacheKey, equationFormat + ', cleanup1: ' + equation);
                equation = cleanUpLatex(equation);
                consoleLogRequestInfo(cacheKey, equationFormat + ', cleanup2: ' + equation);
                break;
              case 'MathML':
                equation = cleanUpMathML(equation);
                consoleLogRequestInfo(cacheKey, equationFormat + ', cleanup1: ' + equation);
                break;
            }
            if (/includegraphics/.test(equation)) {
              returnError(response, 'TeX parse error: Undefined control sequence \\includegraphics', cacheKey);
            } else {
              renderEquation(response, equationFormat, equation, cacheKey, imageFormat, width, height);
            }
          }
        });
      } else {
        if ((request.url.toString().length > 0) && (request.url.toString() != '/favicon.ico') && (request.url.toString() != '/')) {
          consoleLogError('Missing equation parameter' + ' (' + request.url.toString() + ')');
        }
        returnError(response, 'Missing equation parameter', 'emptyequation');
      }

    }

    server.on('request', function(request, response) {

      if (request.method == 'POST') {
        var body = '';
        request.on('data', function(chunk) {
          body += chunk.toString();
        });
        request.on('end', function() {
          var query = querystring.parse(body);
          handleRequest(request, response, body, query);
        });
      } else {
        var query = url.parse(request.url, true);
        handleRequest(request, response, request.url.toString(), query.query);
      }

    });

    // server.on('error', function(e) {
    //   console.error(`Got error: ${e.message}`);
    // });

    server.on('clientError', (err, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });

    server.listen(_this.config.port);

    consoleLog('Listening on port ' + _this.config.port);
    consoleLog();

  };

}

module.exports = Application;