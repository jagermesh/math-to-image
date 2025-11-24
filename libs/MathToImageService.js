import colors from 'colors';
import crypto from 'crypto';
import http from 'http';
import url from 'url';
import moment from 'moment';
import querystring from 'querystring';
import sharp from 'sharp';
import axios from 'axios';
import mathjax from 'mathjax';

import Cache from './Cache.js';

export default class MathToImageService {
  constructor(config) {
    this.config = Object.assign({
      port: 8000,
    }, config);
    this.cache = new Cache(this, this.config);
  }

  consoleLog(message) {
    if (message) {
      console.log(`${colors.yellow(moment().format())} ${message.replace(/[\n\r]/g, '')}`);
    } else {
      console.log('');
    }
  }

  consoleLogError(message) {
    this.consoleLog(`${colors.red('[ERROR]')} ${message}`);
  }

  consoleLogRequestInfo(cacheKey, message) {
    this.consoleLog(colors.green(`[${cacheKey}] `) + message);
  }

  consoleLogRequestError(cacheKey, message) {
    this.consoleLog(colors.green(`[${cacheKey}] `) + colors.red('[ERROR] ') + message);
  }

  returnError(response, message, cacheKey, contentType = 'text/plain') {
    response.writeHead(406, {
      'Content-Type': contentType,
    });
    response.write(message);
    response.end();

    this.consoleLogRequestError(cacheKey, message);
  }

  cleanUpHtmlCharacters(html) {
    const result = html.replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, '\'');
    return result;
  }

  async cleanUpMathML(mathml, additionalImages, cacheKey) {
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
      for (let i = 0; i < additionalImages.length; i++) {
        try {
          let additionalImage = additionalImages[i];
          let imageBuffer = Buffer.from(additionalImage.base64, 'base64');
          let metadata = await sharp(imageBuffer).metadata();
          let width = metadata.width / dpi;
          let height = metadata.height / dpi;
          mathml = mathml.replace(
            '<mtext>&#x2318;</mtext>',
            `</mrow><mrow><mglyph width="${width}" height="${height}" src="data:image/${additionalImage.format};base64,${additionalImage.base64}"></mglyph></mrow><mrow>`
          );
        } catch (err) {
          this.consoleLogRequestError(cacheKey, `${err}`);
        }
      }
    }

    return mathml;
  }

  cleanUpLatex(html) {
    // not supported
    let result = html.replace(/\\textcolor\{transparent\}\{\}/g, '\\\\')
      .replace(/\\textcolor\{transparent\}/g, '\\\\')
      .replace(/\\includegraphics\{.*?\}/g, '⌘')
      .replace(/\\fra\{/g, '\\frac{')
      .replace(/\\pir[^]/g, '\\pi r^')
      .replace(/\\timesr[^]/g, '\\times r^')
      .replace(/\\timess[^]/g, '\\times s^')
      .replace(/\^\{ \}/g, '')
      .replace(/([0-9])\^$/g, '$1^?')
      .replace(/#/g, '\\#');
    while (/_\{_\{_\{_\{_\{/.test(result)) {
      result = result.replace(/_\{_\{_\{_\{_\{/g, '_{_{');
    }
    while (/\}\}\}\}\}/.test(result)) {
      result = result.replace(/\}\}\}\}\}/g, '}}');
    }
    return result;
  }

  downloadImage(url) {
    return new Promise(function(resolve, reject) {
      axios.get(url, {
        responseType: 'arraybuffer',
      }).then(function(response) {
        if (response.status != 200) {
          return reject('Can not download image');
        }
        return resolve(Buffer.from(response.data, 'binary').toString('base64'));
      }).catch(function(err) {
        reject(err);
      });
    });
  }

  async downloadImages(mathml, cacheKey) {
    const urls = [...mathml.matchAll(/<mglyph.+?src="(http[^"]+)"/g)]
      .map((match) => match[1]);

    for (let i = 0; i < urls.length; i++) {
      try {
        const data = await this.downloadImage(urls[i]);
        mathml = mathml.replace(
          `src="${urls[i]}"`,
          `src="data:image/png;base64,${data}"`,
        );
      } catch (err) {
        this.consoleLogRequestError(cacheKey, String(err));
      }
    }

    return mathml;
  }

  extractImages(html) {
    let result = [];
    let matches = [...html.matchAll(/\\includegraphics\{.*?data:image\/(.+?);base64,(.+?)\}/g)];
    matches.map(function(match) {
      result.push({
        format: match[1],
        base64: match[2],
      });
    });

    return result;
  }

  returnImage(response, responseBody, cacheKey, imageFormat) {
    if (imageFormat == 'png') {
      response.writeHead(200, {
        'Content-Type': 'image/png',
      });
      response.write(responseBody);
    } else {
      response.writeHead(200, {
        'Content-Type': 'image/svg+xml',
      });
      response.write(responseBody);
    }
    response.end();

    this.consoleLogRequestInfo(cacheKey, 'Request processed');
  }

  returnMathML(response, responseBody, cacheKey) {
    response.writeHead(200, {
      'Content-Type': 'text/plain',
    });
    response.write(responseBody);
    response.end();

    this.consoleLogRequestInfo(cacheKey, 'Request processed');
  }

  mmlToSingleSvg(mml) {
    const adaptor = this.mathjax.startup.adaptor;

    const container = this.mathjax.mathml2svg(mml);

    const children = adaptor.childNodes(container);
    const svgNodes = children.filter((n) => adaptor.kind(n) === 'svg');

    if (svgNodes.length === 0) {
      throw new Error('No <svg> nodes found in MathJax output');
    }

    if (svgNodes.length === 1) {
      return adaptor.outerHTML(svgNodes[0]);
    }

    const root = adaptor.node('svg', {
      xmlns: 'http://www.w3.org/2000/svg',
      'xmlns:xlink': 'http://www.w3.org/1999/xlink',
    });

    let xOffset = 0;
    let maxHeight = 0;

    const rootDefs = adaptor.node('defs', {});
    let hasDefs = false;

    for (const svg of svgNodes) {
      const viewBox = adaptor.getAttribute(svg, 'viewBox') || '';
      let width = 0;
      let height = 0;

      if (viewBox) {
        const parts = viewBox.split(/\s+/).map(parseFloat);
        width = parts[2] || 0;
        height = parts[3] || 0;
      } else {
        width = parseFloat(adaptor.getAttribute(svg, 'width') || '0');
        height = parseFloat(adaptor.getAttribute(svg, 'height') || '0');
      }

      if (height > maxHeight) {
        maxHeight = height;
      }

      const inner = adaptor.childNodes(svg);
      for (const child of inner) {
        if (adaptor.kind(child) === 'defs') {
          adaptor.append(rootDefs, child);
          hasDefs = true;
        }
      }

      const g = adaptor.node('g', {
        transform: `translate(${xOffset}, 0)`,
      });

      for (const child of inner) {
        if (adaptor.kind(child) === 'defs') {
          continue;
        }
        adaptor.append(g, child);
      }

      adaptor.append(root, g);

      xOffset += width;
    }

    if (hasDefs) {
      adaptor.append(root, rootDefs);
    }

    adaptor.setAttribute(root, 'viewBox', `0 0 ${xOffset} ${maxHeight}`);
    adaptor.setAttribute(root, 'width', `${xOffset}`);
    adaptor.setAttribute(root, 'height', `${maxHeight}`);

    let svgText = adaptor.outerHTML(root);

    svgText =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<!DOCTYPE svg PUBLIC '-//W3C//DTD SVG 1.1//EN' 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd'>` +
      svgText;

    svgText = svgText.replace(/ href="data[:]image/g, ' xlink:href="data:image');

    return svgText;
  }

  renderEquation(response, equationFormat, equation, cacheKey, imageFormat) {
    let normalizedEquation = equation.trim();
    try {
      const svgDocument = this.mathjax.mathml2svg(normalizedEquation);
      const adaptor = this.mathjax.startup.adaptor;

      let svg = adaptor.innerHTML(svgDocument);

      svg = `
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE svg PUBLIC '-//W3C//DTD SVG 1.1//EN' 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd'>
        ${svg}
      `
      .trim()
      .replace(/ href="data[:]image/g, ' xlink:href="data:image');

      this.consoleLogRequestInfo(cacheKey, 'Rendered');
      if (imageFormat == 'png') {
        sharp(Buffer.from(svg)).toFormat('png').toBuffer((error, png) => {
          if (error) {
            this.consoleLogRequestError(cacheKey, `${error} (${equationFormat}: ${normalizedEquation})`);
            this.returnError(response, `${equationFormat}: ${normalizedEquation}: ${error}`, cacheKey);
          } else {
            this.consoleLogRequestInfo(cacheKey, 'Saving result to cache');
            this.cache.set(cacheKey, png.toString('base64'));
            this.returnImage(response, png, cacheKey, imageFormat);
          }
        });
      } else {
        this.consoleLogRequestInfo(cacheKey, 'Saving result to cache');
        this.cache.set(cacheKey, Buffer.from(svg).toString('base64'));
        this.returnImage(response, svg, cacheKey, imageFormat);
      }
    } catch (error) {
      this.consoleLogRequestError(cacheKey, `${error} (${equationFormat}: ${normalizedEquation})`);
      this.returnError(response, `${equationFormat}: ${normalizedEquation}: ${error}`, cacheKey);
    }
  }

  handleRequest(request, response, requestUrl, query) {
    const equationFormat = (query.format ? query.format : 'MathML');
    const refid = (query.refid ? query.refid : '');
    const outputFormat = (query.outputFormat ? query.outputFormat : (query.imageFormat ? query.imageFormat : 'svg'));
    const equation = query.equation ? query.equation : '';

    if (equation && equation.length > 0) {
      let hash = crypto.createHash('sha1').update(equation, 'utf8').digest('hex');
      let cacheKey = `${equationFormat}:${hash}:${refid}:${outputFormat}`;

      this.consoleLogRequestInfo(cacheKey, `${request.method}: ${requestUrl.substring(0, 512)}`);
      this.consoleLogRequestInfo(cacheKey, `${equationFormat}, original: ${equation.substring(0, 512)}`);

      this.cache.get(cacheKey, (currentValue) => {
        if (currentValue) {
          this.consoleLogRequestInfo(cacheKey, 'Equation found in cache');
          const image = new Buffer(currentValue, 'base64');
          this.returnImage(response, image, cacheKey, outputFormat);
        } else {
          let normalizedEquation = equation;
          let additionalImages = [];
          if (equationFormat == 'TeX') {
            additionalImages = this.extractImages(normalizedEquation);
            normalizedEquation = this.cleanUpHtmlCharacters(normalizedEquation);
            normalizedEquation = this.cleanUpLatex(normalizedEquation);
            this.consoleLogRequestInfo(cacheKey, `ORIGINAL: ${normalizedEquation}`);
            // normalizedEquation
            normalizedEquation = this.mathjax.tex2mml(normalizedEquation);
            normalizedEquation = normalizedEquation.replace(/<mrow>.*?<mo>&#x2318;<[/]mo>.*?<[/]mrow>/gs, '<mtext>&#x2318;</mtext>');
          }
          this.downloadImages(normalizedEquation, cacheKey).then((normalizedEquation) => {
            this.cleanUpMathML(normalizedEquation, additionalImages, cacheKey).then((normalizedEquation) => {
              normalizedEquation = normalizedEquation.trim();
              this.consoleLogRequestInfo(cacheKey, `NORMALIZED: ${normalizedEquation}`);
              this.consoleLogRequestInfo(cacheKey, `MathML: ${normalizedEquation.substring(0, 512)}`);
              if (outputFormat == 'MathML') {
                this.returnMathML(response, normalizedEquation);
              } else {
                this.renderEquation(response, equationFormat, normalizedEquation, cacheKey, outputFormat);
              }
            });
          });
        }
      });
    } else {
      if ((request.url.toString().length > 0) && (request.url.toString() != '/favicon.ico') && (request.url.toString() != '/')) {
        this.consoleLogError(`Missing "equation" parameter (${request.url.toString()})`);
      }
      this.returnError(response, 'Missing "equation" parameter', 'emptyequation');
    }
  }

  async start() {
    this.mathjax = await mathjax.init({
      loader: {
        load: ['input/tex', 'input/mml', 'output/svg'],
      },
      svg: {
        minScale: 1,
        fontCache: 'local',
        linebreaks: {
          inline: false,
        },
      },
    });

    this.server = http.createServer();
    this.server.on('request', (request, response) => {
      if (request.method == 'POST') {
        let body = '';
        request.on('data', (chunk) => {
          body += chunk.toString();
        });
        request.on('end', () => {
          let query = querystring.parse(body);
          this.handleRequest(request, response, body, query);
        });
      } else {
        let query = url.parse(request.url, true);
        this.handleRequest(request, response, request.url.toString(), query.query);
      }
    });
    this.server.on('clientError', (err, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });
    this.server.on('error', (err) => {
      this.consoleLogError(err);
    });

    this.server.listen(this.config.port);

    this.consoleLog(`Listening on port ${this.config.port}`);
    this.consoleLog();
  }
};
