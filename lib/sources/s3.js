const AWS = require('aws-sdk');

const { sample } = require('lodash');

const url = require('url');
const path = require('path');

class SourceS3 {
  constructor({ accessKeyId, secretAccessKey, bucket, filter }) {
    AWS.config.update({
      accessKeyId,
      secretAccessKey
    });
    this.bucket = bucket;
    this.filter = filter;
    this.s3 = new AWS.S3();
  }

  getVideoUrl(object, expires = 60) {
    const params = {
      Bucket: this.bucket,
      Key: object.Key,
      Expires: expires
    };
    return this.s3.getSignedUrl('getObject', params);
  }

  getVideoObjects() {
    var params = {
      Bucket: this.bucket
    };
    return new Promise((resolve, reject) => {
      this.s3.listObjects(params, function(err, data) {
        if (err) {
          reject(err);
          return;
        }
        if (data) {
          resolve(data.Contents);
        }
      });
    });
  }

  getOutput(videoUrl) {
    const { pathname } = url.parse(videoUrl);
    const { name } = path.parse(decodeURIComponent(pathname));
    return name;
  }

  async get() {
    const allVideos = await this.getVideoObjects();
    const videos = this.filter ? allVideos.filter(this.filter) : allVideos;
    const input = this.getVideoUrl(sample(videos));
    const output = this.getOutput(input);
    return {
      input,
      output
    };
  }
}

module.exports = SourceS3;
