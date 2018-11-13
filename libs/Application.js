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

    function returnImage(response, formulaResponseBody, cacheKey) {

      response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      response.write(formulaResponseBody);
      response.end();

      consoleLogRequestInfo(cacheKey, 'Request processed');

    }

    const maxIterations = 25;

    function download(url, cacheKey, callback, error, iteration = 1) {

      if (iteration < maxIterations) {
        consoleLogRequestInfo(cacheKey, 'Downloading: ' + url + ', iteration ' + iteration);
        var formulaRequest = https.request(url, function(response) {
          var responseBody = '';
          response.setEncoding('utf8');
          response.on('data', function(chunk) {
            responseBody += chunk;
          });
          response.on('end', function() {
            responseBody = responseBody.trim();
            if (response.statusCode == 200) {
              callback(responseBody);
            } else
            if (response.statusCode == 403) {
              callback(false, responseBody);
            } else
            if (response.statusCode == 404) {
              callback(false, responseBody);
            } else {
              consoleLogRequestError(cacheKey, response.statusCode + ' ' + responseBody + ' (' + url + ')');
              setTimeout(function() {
                download(url, cacheKey, callback, responseBody, iteration + 1);
              }, 1000);
            }
          });
        });
        formulaRequest.on('error', function(error) {
          consoleLogRequestError(cacheKey, error.toString() + ' (' + url + ')');
          setTimeout(function() {
            download(url, cacheKey, callback, error.toString(), iteration + 1);
          }, 1000);
        });
        formulaRequest.end();
      } else {
        callback(false, error.toString());
      }

    }

    function renderSvg(response, formulaFormat, formula, cacheKey) {

      mathjax.typeset({
        math: formula
      , format: formulaFormat
      , svg: true
      , linebreaks: true
      , timeout: 1000
      }, function (data) {
        if (data.errors) {
          consoleLogRequestError(cacheKey, data.errors.join('; ') + ' (' + formulaFormat + ': ' + formula + ')');
          returnError(response, formulaFormat + ': ' + formula + ': ' + data.errors.join('; '));
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

    function cleanUpLatext(html) {

      // not supported
      var result = html.replace(/\\textcolor{transparent}{}/g, '\\\\')
                       .replace(/\\textcolor{transparent}/g, '\\\\')
                       .replace(/#/g, '\\#');

      return result;

    }

    server.on('request', function(request, response) {

      var query   = url.parse(request.url, true);
      var formula = query.query.latex || query.query.mathml || query.query.formula;

      if (formula) {
        var formulaFormat = query.query.latex ? 'TeX' : 'MathML';
        var cacheKey = formulaFormat + ':' + md5(formula);

        consoleLogRequestInfo(cacheKey, request.url.toString());
        consoleLogRequestInfo(cacheKey, formulaFormat + ': ' + formula);

        _this.cache.get(cacheKey, function (currentValue) {
          if (currentValue) {
            consoleLogRequestInfo(cacheKey, 'Found in cache');
            returnImage(response, currentValue, cacheKey);
          } else {
            if (query.query.formula) {
              var formulaUrl = 'https://secure.edoctrina.org/uploads/wiris/formulas/' + formula.replace('.ini', '').replace('.png', '') + '.ini';
              try {
                download(formulaUrl, cacheKey, function(formulaResponseBody, error) {
                  if (formulaResponseBody) {
                    var parsedData = formulaResponseBody.match(/mml=(.+)/s);
                    if (parsedData) {
                      consoleLogRequestInfo(cacheKey, formulaFormat + ': ' + parsedData[1]);
                      renderSvg(response, formulaFormat, parsedData[1], cacheKey);
                    } else {
                      consoleLogRequestError(cacheKey, 'Can not find formula' + ' (' + formulaResponseBody + ')');
                      returnError(response, 'Can not find formula');
                    }
                  } else {
                    consoleLogRequestError(cacheKey, error.toString() + ' (' + formulaUrl + ')');
                    returnError(response, error.toString());
                  }
                });
              } catch (error) {
                consoleLogRequestError(cacheKey, error.toString() + ' (' + formulaUrl + ')');
                returnError(response, error.toString());
              }
            } else {
              formula = cleanUpHtmlCharacters(formula);
              formula = cleanUpLatext(formula);
              renderSvg(response, formulaFormat, formula, cacheKey);
            }
          }
        });
      } else {
        if ((request.url.toString().length > 0) && (request.url.toString() != '/favicon.ico') && (request.url.toString() != '/')) {
          consoleLogError('Missing formula parameter' + ' (' + request.url.toString() + ')');
        }
        returnError(response, 'Missing formula parameter');
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