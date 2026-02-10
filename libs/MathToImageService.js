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
    this.consoleLogRequestError(cacheKey, message);

    response.writeHead(406, {
      'Content-Type': contentType,
    });
    response.write(message);
    response.end();
  }

  cleanUpHtmlCharacters(html) {
    if (typeof html !== 'string') {
      return html;
    }

    return html
      // нормализуем неразрывные пробелы
      .replace(/\u00A0/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, '\'');
  }

  async cleanUpMathML(mathml, additionalImages, cacheKey) {
    if (typeof mathml !== 'string') {
      return mathml;
    }

    if (!/mstyle mathsize/i.test(mathml)) {
      mathml = mathml
        .replace(/(<math[^>]*?>)/i, '$1<mstyle mathsize="16px">')
        .replace('</math>', '</mstyle></math>');
    }

    if (!/<math[^>]*?><mstyle[^>]*?><mtable[^>]*?>/i.test(mathml)) {
      if (/<math[^>]*?><mstyle[^>]*?>[ \n]*<mrow[^>]*?>/i.test(mathml) && /<[/]mrow><[/]mstyle><[/]math>/i.test(mathml)) {
        mathml = mathml
          .replace(/(<math[^>]*?><mstyle[^>]*?>)/i, '$1<mtable>')
          .replace('</mstyle></math>', '</mtable></mstyle></math>');
      } else {
        mathml = mathml
          .replace(/(<math[^>]*?><mstyle[^>]*?>)/i, '$1<mtable><mrow>')
          .replace('</mstyle></math>', '</mrow></mtable></mstyle></math>');
      }
      mathml = mathml
        .replace(/<mspace[ ]+linebreak="newline"[^>]*?>.*?<\/mspace>/ig, '</mrow><mrow>')
        .replace(/<mspace[ ]+linebreak="newline"[^>]*?\/>/ig, '</mrow><mrow>');
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

  wordWrapText(text, match) {
    // Разбиваем очень длинный текст на несколько строк
    // чтобы SVG не растягивался в бесконечную ширину
    const MAX_LINE_LENGTH = 80;
    if (!text || text.length <= MAX_LINE_LENGTH) {
      return match;
    }

    // Разбиваем текст на строки по словам
    const words = text.split(/(\s+)/);
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      const trimmedWord = word.trim();
      if (!trimmedWord) {
        currentLine += word;
        continue;
      }

      if (currentLine.length + trimmedWord.length > MAX_LINE_LENGTH && currentLine.trim()) {
        lines.push(currentLine.trim());
        currentLine = word;
      } else {
        currentLine += word;
      }
    }

    if (currentLine.trim()) {
      lines.push(currentLine.trim());
    }

    if (lines.length <= 1) {
      return match;
    }

    console.log(lines);

    // Разбиваем на несколько <mtext> элементов, разделенных <mo linebreak="newline">
    // Это должно работать лучше, чем <mspace>
    return lines.map((line, idx) => {
      if (idx === 0) {
        return `<mtext>${line}</mtext>`;
      }
      return `<mo linebreak="newline"></mo><mtext>${line}</mtext>`;
    }).join('');
  }

  sanitizeMathML(mathml) {
    if (typeof mathml !== 'string') {
      return mathml;
    }

    // Сначала извлекаем только содержимое между <math>...</math>
    // Все что после </math> - это мусор, который нужно удалить
    const mathOpenMatch = mathml.match(/<math([^>]*)>/i);
    const mathCloseMatch = mathml.match(/<math[^>]*>([\s\S]*?)<\/math>/i);
    if (mathOpenMatch && mathCloseMatch) {
      const mathAttrs = mathOpenMatch[1] || '';
      const mathContent = mathCloseMatch[1];
      mathml = `<math${mathAttrs}>${mathContent}</math>`;
    } else if (!mathml.includes('<math')) {
      // Если нет тега <math>, возвращаем как есть (может быть уже обработан)
      return mathml;
    }

    return mathml
      // нормализуем неразрывные пробелы
      .replace(/\u00A0/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      // Убираем все HTML элементы, которые не являются частью MathML
      .replace(/<p[^>]*>/gi, '')
      .replace(/<\/p>/gi, ' ')
      .replace(/<hr\s*\/?[^>]*>/gi, ' ')
      // Убираем все <span> элементы рекурсивно (включая вложенные)
      // и заменяем их содержимым
      .replace(/<\/?span\b[^>]*>/gi, '')
      .replace(/<\/?font\b[^>]*>/gi, '')
      // Убираем HTML-теги (div, p, span и т.д.). table/tr/td — отдельно, чтобы не резать mtable/mtr/mtd
      .replace(/<\/?(div|p|br|span|b|i|u|strong|em|a|img)\b[^>]*>/gi, '')
      // HTML-таблицы: удаляем только <table>, <tr>, <td>, <th>, не трогая MathML <mtable>, <mtr>, <mtd>
      .replace(/<(?!m)(table|thead|tbody|tfoot|tr|td|th)\b[^>]*>/gi, '')
      .replace(/<\/(?<!m)(table|thead|tbody|tfoot|tr|td|th)>/gi, '')
      // Убираем пустые <mrow> элементы, которые могли остаться после обработки
      .replace(/<mrow[^>]*>\s*<\/mrow>/gi, '')
      .replace(/<mtr\b[^>]*>\s*<mtd\b[^>]*>\s*<mrow[^>]*>\s*<mi>\s*<\/mi>\s*<\/mrow>\s*<\/mtd>\s*<\/mtr>/gi, '')
      .replace(/<mtr\b[^>]*>\s*<mtd\b[^>]*>\s*<mrow[^>]*>\s*<mspace[^>]*>\s*<\/mspace>\s*<\/mrow>\s*<\/mtd>\s*<\/mtr>/gi, '')
      .replace(/<mtr\b[^>]*>\s*<mtd\b[^>]*>\s*<\/mtd>\s*<\/mtr>/gi, '')
      // Убираем пустые <mi></mi>, <mo></mo>, <mn></mn> — они ломают дерево MathJax (children)
      .replace(/<mi[^>]*>\s*<\/mi>/gi, '')
      .replace(/<mo[^>]*>\s*<\/mo>/gi, '')
      .replace(/<mn[^>]*>\s*<\/mn>/gi, '')
      // Убираем пустые <mrow></mrow> элементы
      .replace(/<mrow[^>]*>\s*<\/mrow>/gi, '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<mspace[^>]><\/mspace>/gi, ' ')
      // Убираем все атрибуты style из элементов MathML
      .replace(/\s+style="[^"]*"/gi, '')
      .replace(/\s+style='[^']*'/gi, '')
      // <mi> должен содержать только текст; если внутри один <mtext>, сплющиваем
      .replace(/<mi([^>]*)>\s*<mtext>([\s\S]*?)<\/mtext>\s*<\/mi>/gi, (m, attrs, text) => `<mi${attrs}>${text}</mi>`)
      // чтобы не ломать структуру MathML (делаем это до разбиения длинного текста)
      // <mtr ...><mtd ...><mrow ...><mi></mi></mrow></mtd></mtr>
      .replace(/(<mtd\b[^>]*>)(\s*[^<\s][^<]*?)(?=<)/gi, (match, openTag, text) => {
        const trimmed = text.trim();
        if (!trimmed) {
          return match;
        }
        return `${openTag}<mtext>${trimmed}</mtext>`;
      })
      .replace(/(<mspace\b[^>]*\/>)(\s*[^<\s][^<]*?)(?=<)/gi, (match, tag, text) => {
        const trimmed = text.trim();
        if (!trimmed) {
          return match;
        }
        return `${tag}<mtext>${trimmed}</mtext>`;
      })
      .replace(/<mtext>([\s\S]*?)<\/mtext>/gi, (match, text) => {
        return this.wordWrapText(text, match);
      }).replace(/<mi>([\s\S]*?)<\/mi>/gi, (match, text) => {
        return this.wordWrapText(text, match);
      })
      ;
  }

  cleanUpLatex(html) {
    if (typeof html !== 'string') {
      return html;
    }

    let result = html
      .replace(/\\textcolor\{transparent\}\{\}/g, '\\\\')
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
    return new Promise((resolve, reject) => {
      axios.get(url, {
        responseType: 'arraybuffer',
      }).then((response) => {
        if (response.status !== 200) {
          return reject('Can not download image');
        }
        return resolve(Buffer.from(response.data).toString('base64'));
      }).catch((err) => {
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
    matches.map((match) => {
      result.push({
        format: match[1],
        base64: match[2],
      });
    });

    return result;
  }

  returnImage(response, responseBody, cacheKey, imageFormat) {
    if (imageFormat === 'png') {
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

  async renderEquation(response, equationFormat, equation, cacheKey, imageFormat) {
    let normalizedEquation = equation.trim();

    try {
      let svgDocument;
      try {
        svgDocument = await this.mathjax.mathml2svgPromise(normalizedEquation);
      } catch {
        normalizedEquation = this.sanitizeMathML(normalizedEquation);
        this.consoleLogRequestInfo(cacheKey, `SANITIZED: ${normalizedEquation}`);
        svgDocument = await this.mathjax.mathml2svgPromise(normalizedEquation);
      }

      const adaptor = this.mathjax.startup.adaptor;

      let svg = adaptor.innerHTML(svgDocument);

      svg = `
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE svg PUBLIC '-//W3C//DTD SVG 1.1//EN' 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd'>
        ${svg}
      `
        .trim()
        .replace(/ href="data:image/g, ' xlink:href="data:image');

      this.consoleLogRequestInfo(cacheKey, 'Rendered');

      if (imageFormat === 'png') {
        sharp(Buffer.from(svg))
          .toFormat('png')
          .toBuffer((error, png) => {
            if (error) {
              this.returnError(
                response,
                `${equationFormat}: ${normalizedEquation}: ${error}`,
                cacheKey,
              );
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

      this.cache.get(cacheKey, async (currentValue) => {
        try {
          if (currentValue) {
            this.consoleLogRequestInfo(cacheKey, 'Equation found in cache');
            const image = Buffer.from(currentValue, 'base64');
            this.returnImage(response, image, cacheKey, outputFormat);
          } else {
            if (!this.mathjax) {
              this.returnError(response, 'Service not initialized', cacheKey);
              return;
            }

            let normalizedEquation = equation;
            let additionalImages = [];

            if (equationFormat === 'TeX') {
              additionalImages = this.extractImages(normalizedEquation);
              normalizedEquation = this.cleanUpHtmlCharacters(normalizedEquation);
              normalizedEquation = this.cleanUpLatex(normalizedEquation);
              this.consoleLogRequestInfo(cacheKey, `ORIGINAL: ${normalizedEquation}`);

              normalizedEquation = await this.mathjax.tex2mmlPromise(normalizedEquation);

              normalizedEquation = normalizedEquation.replace(
                /<mrow>.*?<mo>&#x2318;<[/]mo>.*?<[/]mrow>/gs,
                '<mtext>&#x2318;</mtext>',
              );
            }

            normalizedEquation = await this.downloadImages(normalizedEquation, cacheKey);
            normalizedEquation = await this.cleanUpMathML(normalizedEquation, additionalImages, cacheKey);

            normalizedEquation = normalizedEquation.trim();

            this.consoleLogRequestInfo(cacheKey, `NORMALIZED: ${normalizedEquation}`);
            this.consoleLogRequestInfo(cacheKey, `MathML: ${normalizedEquation.substring(0, 512)}`);

            if (outputFormat === 'MathML') {
              this.returnMathML(response, normalizedEquation, cacheKey);
            } else {
              await this.renderEquation(response, equationFormat, normalizedEquation, cacheKey, outputFormat);
            }
          }
        } catch (error) {
          this.returnError(response, `Unexpected error: ${error}`, cacheKey);
        }
      });
    } else {
      if (
        (request.url.toString().length > 0) &&
        (request.url.toString() !== '/favicon.ico') &&
        (request.url.toString() !== '/')
      ) {
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
      if (request.method === 'POST') {
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
