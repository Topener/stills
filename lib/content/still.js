const { getVideoLength, getRandomTimestamp, shell } = require('./utils');

class ContentStill {
  generate(input, output) {
    console.log(`📷 Processing ${output}`);

    const length = getVideoLength(input);
    const sec = getRandomTimestamp(length);
    const outputFile = `${output} @ ${sec.toFixed(0)}s.png`;

    console.log(`🥚 Generating image ${outputFile}`);

    shell(
      `ffmpeg -ss ${sec} -i "${input}" -vframes 1 -vf scale=iw*sar:ih -y "${outputFile}"`
    );

    return outputFile;
  }
}

module.exports = ContentStill;
