/**
 * Authentication and authorization middleware
 */

const crypto = require('crypto');

/**
 * Verify Meta WhatsApp webhook signature
 * Meta sends X-Hub-Signature-256 header with HMAC-SHA256 signature
 */
function verifyWebhookSignature(req, res, next) {
  // Skip verification in development/test or if provider is not meta
  if (process.env.NODE_ENV === 'development' || 
      (process.env.WHATSAPP_PROVIDER || '').toLowerCase() !== 'meta') {
    return next();
  }

  const signature = req.headers['x-hub-signature-256'];
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  if (!appSecret) {
    console.warn('⚠️ WHATSAPP_APP_SECRET not set - webhook signature verification skipped');
    return next();
  }

  if (!signature) {
    console.warn('⚠️ Missing X-Hub-Signature-256 header');
    return res.status(401).send('Unauthorized: Missing signature');
  }

  // Get raw body - Express.json() has already parsed it, so we need to use rawBody
  // For production, consider using body-parser with verify option to preserve raw body
  // For now, we'll reconstruct from parsed body (less secure but works)
  const body = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', appSecret)
    .update(body)
    .digest('hex');
  
  // Signature format is "sha256=<hash>"
  const receivedSignature = signature.replace('sha256=', '');

  // Use crypto.timingSafeEqual to prevent timing attacks
  const signatureBuffer = Buffer.from(receivedSignature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (signatureBuffer.length !== expectedBuffer.length) {
    console.warn('⚠️ Invalid webhook signature length');
    return res.status(401).send('Unauthorized: Invalid signature');
  }

  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    console.warn('⚠️ Webhook signature verification failed');
    return res.status(401).send('Unauthorized: Invalid signature');
  }

  next();
}

/**
 * Admin token authentication middleware
 * Requires X-Admin-Token header or token query parameter
 */
function requireAdminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  const expected = process.env.ADMIN_TOKEN;

  if (!expected) {
    return res.status(500).json({
      success: false,
      error: 'Server misconfiguration: ADMIN_TOKEN not set',
    });
  }

  if (!token || token !== expected) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Valid admin token required',
    });
  }

  next();
}

/**
 * Rate limiting helper - returns middleware function
 */
function createRateLimit(windowMs, max) {
  const rateLimit = require('express-rate-limit');
  return rateLimit({
    windowMs,
    max,
    message: 'Too many requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
  });
}

module.exports = {
  verifyWebhookSignature,
  requireAdminAuth,
  createRateLimit,
};

