const { execCmd } = require('./utils');
const getImageInfo = require('../utils/get-image-info');
const Image = require('../stills/image');

class FilterOverlay {
  constructor({
    overlayFile = null,
    gravity = 'center',
    size = null,
    sizePercentWidth = null,
    sizePercentHeight = null,
    geometry = null,
    compose = null,
    opacity = 100,
    isGrayscale = false,
    dither = 'None',
    gifColors = 64
  } = {}) {
    this.opacity = opacity;
    this.size = size;
    this.sizePercentWidth = sizePercentWidth;
    this.sizePercentHeight = sizePercentHeight;
    this.overlayFile = overlayFile;
    this.gravity = gravity;
    this.geometry = geometry;
    this.compose = compose;
    this.isGrayscale = isGrayscale;
    this.dither = dither;
    this.gifColors = gifColors;
  }

  get name() {
    return 'overlay';
  }

  static get name() {
    return 'overlay';
  }

  getWidth(input, desiredWidth, desiredHeight) {
    if (!desiredHeight) {
      return desiredWidth;
    }
    const { width, height } = getImageInfo(input);
    const newHeight = (desiredWidth / width) * height;
    return newHeight < desiredHeight
      ? Math.ceil(width / (height / desiredHeight))
      : desiredWidth;
  }

  getSize(width, height) {
    if (this.size) {
      return this.size;
    }
    if (this.sizePercentWidth) {
      return `${Math.round(width * this.sizePercentWidth)}x`;
    }
    if (this.sizePercentHeight) {
      return `x${Math.round(height * this.sizePercentHeight)}`;
    }
    return `${width}x${height}^`;
  }

  getOpacity() {
    if (this.opacity === 100) {
      return '';
    }
    return `-matte -channel A +level 0,${this.opacity}%`;
  }

  exec(file, overlayFile, width, height, numColors) {
    const opacity = this.getOpacity();
    const size = this.getSize(width, height);
    const geometry = this.geometry ? `-geometry ${this.geometry}` : '';
    const compose = this.compose ? `-compose ${this.compose}` : '';
    const modulate = this.isGrayscale ? '-modulate 100,0' : '';
    const colors = numColors ? `-colors ${numColors}` : '';
    execCmd(
      `convert "${file}" -coalesce null: \\( \\( "${overlayFile}" ${colors} \\) ${modulate} -resize ${size} ${opacity} \\) -gravity ${this.gravity} ${geometry} ${compose} -dither ${this.dither} -layers composite "${file}"`
    );
  }

  async setup() {
    if (this.overlayFile.match(/\.gif$/i)) {
      this.gif = new Image({ filename: this.overlayFile });
      await this.gif.prepare();
    }
  }

  async applyFrame(frame, { image, numFrame }) {
    const { file } = frame;
    const { width, height, numFrames } = image.getInfo();
    const numColors = numFrames > 1 ? this.gifColors : null;

    if (this.gif) {
      const frames = this.gif.getFrames();
      const index = numFrame % frames.length;
      const { file: overlayFile } = frames[index];
      this.exec(file, overlayFile, width, height, numColors);
    } else {
      this.exec(file, this.overlayFile, width, height, numColors);
    }
  }

  async teardown() {
    if (this.gif) {
      await this.gif.frames.delete();
    }
  }
}

module.exports = FilterOverlay;
