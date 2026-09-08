const config = require('../config');

async function deleteFileByUrl(url) {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return { skipped: true, reason: 'invalid_url' };
  }

  try {
    const { URL } = require('node:url');
    const baseUrl = process.env.FILE_SERVICE_URL || config.fileService?.serviceUrl || 'http://localhost:5080';
    const targetUrl = new URL('/api/files/by-url', baseUrl);
    const httpLib = targetUrl.protocol === 'https:' ? require('node:https') : require('node:http');

    const payload = JSON.stringify({ url: url.trim() });

    const options = {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 5000,
    };

    return await new Promise((resolve) => {
      const req = httpLib.request(targetUrl, options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, statusCode: res.statusCode });
          } else {
            console.warn(`[FileClient] File service responded with ${res.statusCode}:`, responseData);
            resolve({ success: false, statusCode: res.statusCode, error: responseData });
          }
        });
      });

      req.on('error', (err) => {
        console.warn(`[FileClient] Request error deleting file: ${err.message}`);
        resolve({ success: false, error: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        console.warn('[FileClient] Timeout requesting file deletion');
        resolve({ success: false, error: 'timeout' });
      });

      req.write(payload);
      req.end();
    });
  } catch (err) {
    console.warn(`[FileClient] Error invoking file-service for deletion: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = {
  deleteFileByUrl,
};
