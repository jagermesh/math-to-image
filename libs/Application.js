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
         extensions: ["mml3.js"]
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

    function returnError(response, message, contentType = 'text/plain') {

      response.writeHead(400, { 'Content-Type': contentType });
      response.write(message);
      response.end();

    }

    function returnImage(response, responseBody, cacheKey) {

      response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      response.write(responseBody);
      response.end();

      consoleLogRequestInfo(cacheKey, 'Request processed');

    }

    function renderSvg(response, equationFormat, equation, cacheKey) {

      mathjax.typeset({
        math: equation
      , format: equationFormat
      , svg: true
      , linebreaks: true
      }, function (data) {
        if (data.errors) {
          consoleLogRequestError(cacheKey, data.errors.join('; ') + ' (' + equationFormat + ': ' + equation + ')');
          returnError(response, equationFormat + ': ' + equation + ': ' + data.errors.join('; '));
          response.end();
        } else {
          consoleLogRequestInfo(cacheKey, 'Rendered');
          _this.cache.set(cacheKey, data.svg);
          returnImage(response, data.svg, cacheKey);
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

    function cleanUpLatex(html) {

      // not supported

      var result = html.replace(/\\textcolor\{transparent\}\{\}/g, '\\\\')
                       .replace(/\\textcolor\{transparent\}/g, '\\\\')
                       .replace(/\\fra\{/g, '\\frac{')
                       .replace(/\^\{ \}/g, '')
                       .replace(/#/g, '\\#');

      return result;

    }

    function handleRequest(request, requestUrl, response, equationFormat, equation) {

      if (equation) {
        var cacheKey = equationFormat + ':' + md5(equation);

        consoleLogRequestInfo(cacheKey, request.method + ': ' + requestUrl);
        consoleLogRequestInfo(cacheKey, equationFormat + ', original: ' + equation);

        _this.cache.get(cacheKey, function (currentValue) {
          if (currentValue) {
            consoleLogRequestInfo(cacheKey, 'Equation found in cache');
            returnImage(response, currentValue, cacheKey);
          } else {
            if (equationFormat == 'TeX') {
              equation = cleanUpHtmlCharacters(equation);
              consoleLogRequestInfo(cacheKey, equationFormat + ', cleanup1: ' + equation);
              equation = cleanUpLatex(equation);
              consoleLogRequestInfo(cacheKey, equationFormat + ', cleanup2: ' + equation);
            }
            renderSvg(response, equationFormat, equation, cacheKey);
          }
        });
      } else {
        if ((request.url.toString().length > 0) && (request.url.toString() != '/favicon.ico') && (request.url.toString() != '/')) {
          consoleLogError('Missing equation parameter' + ' (' + request.url.toString() + ')');
        }
        returnError(response, 'Missing equation parameter');
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
          var equationFormat = query.latex ? 'TeX' : 'MathML';
          var equation = query.latex || query.mathml;
          handleRequest(request, body, response, equationFormat, equation);
        });
      } else {
        var query = url.parse(request.url, true);
        var equationFormat = query.query.latex ? 'TeX' : 'MathML';
        var equation = query.query.latex || query.query.mathml;
        handleRequest(request, request.url.toString(), response, equationFormat, equation);
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