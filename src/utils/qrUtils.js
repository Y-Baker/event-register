const QRCode = require('qrcode');

const generateQRCodeBuffer = async (data) => {
  return QRCode.toBuffer(data, { errorCorrectionLevel: 'H', type: 'png' });
};

const generateQRCode = async (data, outputPath) =>
  new Promise((resolve, reject) => {
    QRCode.toFile(outputPath, data, { errorCorrectionLevel: 'H' }, (err) => {
      if (err) reject(err);
      resolve(outputPath);
    });
  });

module.exports = {
  generateQRCode,
  generateQRCodeBuffer,
};
