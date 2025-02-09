const { existsSync } = require('fs');
const { first, range, compact } = require('lodash');
const { exec } = require('shelljs');
const { execCmd, parseImageMagickMetrics } = require('./utils');
const getScenes = require('../../lib/utils/get-scenes');
const isUppercasy = require('../utils/is-uppercasy');

class FilterCaptions {
  constructor({
    font = './fonts/arial.ttf',
    background,
    glyphs = false,
    shadowOffset = 1,
    lineHeight = 0,
    color = 'white'
  } = {}) {
    this.font = font;
    this.background = background;
    this.shadowOffset = shadowOffset;
    this.glyphs = glyphs;
    this.lineHeight = lineHeight;
    this.color = color;
    if (this.font && !existsSync(this.font)) {
      console.log(`🐞 Yo, this font does not exist: ${this.font}`);
    }
  }

  get name() {
    return 'captions';
  }

  wrapCaption(fullCaption) {
    const caption = fullCaption.replace(/\n/g, ' ');
    const split = fullCaption.split(' ');

    if (split.length <= 2) {
      return fullCaption;
    }

    const splitIndex = split.reduce(
      (memo, word) =>
        memo <= caption.length / 2 ? memo + word.length + 1 : memo,
      0
    );
    return splitIndex === 0
      ? caption
      : `${caption.slice(0, splitIndex).trim()}\n${caption
          .slice(splitIndex)
          .trim()}`;
  }

  getFontMetrics(caption, width) {
    const cmdText = this.getCmdText({
      caption,
      width
    });
    const cmd = `convert -debug annotate -log "%e" ${cmdText} 2>&1 | grep -i Metrics:`;
    const output = execCmd(cmd);
    return parseImageMagickMetrics(output);
  }

  // Captions that wrap over more lines than expected get formatted into prettier centered captions
  getSmartWrappedCaption(caption, width) {
    const numExpectedLines = caption.match(/\n/) ? 2 : 1;
    const metrics = this.getFontMetrics(caption, width);
    if (metrics.length <= numExpectedLines) {
      return caption;
    }
    console.log(
      `🤔 Was expecting ${numExpectedLines} lines, but got ${metrics.length}. Wrapping.`
    );
    const wrappedCaption = this.wrapCaption(caption);
    const wrappedCaptionMetrics = this.getFontMetrics(wrappedCaption, width);
    if (wrappedCaptionMetrics.length > 2) {
      console.log(
        `🤔 Wrapped lines exceed 2 (${wrappedCaptionMetrics.length}). Giving up.`
      );
      console.log(wrappedCaptionMetrics);
      // At this point we kinda just give up and let Imagemagick wrap as it best sees fit
      return caption.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ');
    }
    return wrappedCaption;
  }

  getCmdText({
    caption,
    width,
    color = 'black',
    background = 'none',
    offset = 0
  }) {
    const cleanCaption = (caption || '').replace(/(["-])/g, '\\$1');
    const boxWidth = width * 0.8;
    const fontSize = isUppercasy(caption) ? width / 22 : width / 20;
    const padding = fontSize;
    const fontCmd = this.font ? `-font "${this.font}"` : '';
    const offsetX = offset;
    const offsetY = padding - offset;
    const lineHeightCmd = this.lineHeight
      ? `-interline-spacing ${this.lineHeight}`
      : '';
    return `-pointsize ${fontSize} ${fontCmd} -size ${boxWidth}x -gravity South -fill "${color}" ${lineHeightCmd} -background none -undercolor '${background}' caption:"${cleanCaption}" -geometry +${offsetX}+${offsetY}`;
  }

  getStillCmd(file, fullCaption, width) {
    const background = this.background;
    const caption = this.getSmartWrappedCaption(fullCaption, width);

    if (background) {
      const cmdText = this.getCmdText({
        caption,
        width,
        color: this.color,
        background
      });
      return `convert "${file}" ${cmdText} -composite "${file}"`;
    } else {
      const cmdBlackText = this.getCmdText({
        caption,
        width,
        color: 'black',
        offset: this.shadowOffset
      });
      const cmdWhiteText = this.getCmdText({
        caption,
        width,
        color: this.color
      });
      return `convert "${file}" ${cmdBlackText} -composite ${cmdWhiteText} -composite -dither None "${file}"`;
    }
  }

  getGifFrameIntervals(scenes, numCaptions, numFrames) {
    const midpoint = scenes.midpoint || Math.floor(numFrames / 2);

    if (numCaptions === 1) {
      return [[0, numFrames]];
    }

    if (numCaptions === 2) {
      return [
        [0, midpoint - 1],
        [midpoint, numFrames - 1]
      ];
    }

    const incr = Math.floor(numFrames / numCaptions);
    return range(0, numCaptions).map((i) => [i * incr, (i + 1) * incr]);
  }

  getGifCmd(file, scenes, captions, width, numFrames) {
    const background = this.background;

    const intervals = this.getGifFrameIntervals(
      scenes,
      captions.length,
      numFrames
    );

    const cmdRanges = captions
      .filter((caption) => caption.trim().length > 0)
      .map((fullCaption, i) => {
        const caption = this.getSmartWrappedCaption(fullCaption, width);
        const startFrame = intervals[i][0];
        const endFrame = intervals[i][1];

        if (background) {
          const cmdText = this.getCmdText({
            caption,
            width,
            color: this.color,
            background
          });
          return `\\( -clone ${startFrame}-${endFrame} -coalesce null: ${cmdText} -layers composite \\)`;
        } else {
          const cmdBlackText = this.getCmdText({
            caption,
            width,
            color: 'black',
            offset: this.shadowOffset
          });
          const cmdWhiteText = this.getCmdText({
            caption,
            width,
            color: this.color
          });
          return `\\( -clone ${startFrame}-${endFrame} -coalesce null: ${cmdBlackText} -layers composite -coalesce null: ${cmdWhiteText} -layers composite \\)`;
        }
      })
      .join(' ');

    if (cmdRanges.trim().length === 0) {
      return;
    }

    return `convert "${file}" ${cmdRanges} -delete 0-${
      numFrames - 1
    } -dither None "${file}"`;
  }

  async applyFrames(frames, { numImage, result }) {
    const file = frames.file;

    let rawCaptions = (result.captions || {})[numImage] || [];

    if (compact(rawCaptions).length === 0) {
      return;
    }

    const scenes = rawCaptions.length > 1 ? await getScenes(file) : {};
    const { numFrames, width } = frames.getInfo(file);

    const captions = rawCaptions.map((c) =>
      c.replace(/\*/g, '').replace(/‐/g, '-')
    );

    const cmd =
      numFrames > 1
        ? this.getGifCmd(file, scenes, captions, width, numFrames)
        : this.getStillCmd(file, first(captions), width);

    if (cmd) {
      const execResult = exec(cmd, { silent: true });
      if (execResult.code !== 0) {
        console.log(`🐞 Oops: ${execResult.stderr}\n> ${cmd}`);
      }
    }

    if (this.glyphs && numImage === result.captions.length - 1) {
      return {
        newCaptions: result.captions.map((d) =>
          d.map((c) => c.replace(/[^\s.\[\],-]/g, '?'))
        )
      };
    }

    return captions;
  }
}

module.exports = FilterCaptions;
