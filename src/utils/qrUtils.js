const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");

const generateQRCode = async (data, outputPath) =>
  new Promise((resolve, reject) => {
    QRCode.toFile(outputPath, data, { errorCorrectionLevel: "H" }, (err) => {
      if (err) reject(err);
      resolve(outputPath);
    });
  });

module.exports = {
  generateQRCode,
};
