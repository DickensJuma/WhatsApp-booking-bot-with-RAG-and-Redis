/**
 * Environment variable validation for production
 * Validates all required environment variables on startup
 */

function validateEnvironment() {
  const errors = [];
  const warnings = [];

  // Required environment variables
  const required = {
    MONGODB_URI: process.env.MONGODB_URI,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    WHATSAPP_PROVIDER: process.env.WHATSAPP_PROVIDER || 'meta',
  };

  // Check required variables
  for (const [key, value] of Object.entries(required)) {
    if (!value || value.trim() === '') {
      errors.push(`Missing required environment variable: ${key}`);
    }
  }

  // Meta WhatsApp provider requires these
  if ((process.env.WHATSAPP_PROVIDER || 'meta').toLowerCase() === 'meta') {
    if (!process.env.WHATSAPP_ACCESS_TOKEN) {
      errors.push('Missing required environment variable: WHATSAPP_ACCESS_TOKEN');
    }
    if (!process.env.WHATSAPP_PHONE_NUMBER_ID) {
      errors.push('Missing required environment variable: WHATSAPP_PHONE_NUMBER_ID');
    }
    if (!process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
      errors.push('Missing required environment variable: WHATSAPP_WEBHOOK_VERIFY_TOKEN');
    }
  }

  // Twilio provider requires these
  if ((process.env.WHATSAPP_PROVIDER || '').toLowerCase() === 'twilio') {
    if (!process.env.TWILIO_ACCOUNT_SID) {
      errors.push('Missing required environment variable: TWILIO_ACCOUNT_SID');
    }
    if (!process.env.TWILIO_AUTH_TOKEN) {
      errors.push('Missing required environment variable: TWILIO_AUTH_TOKEN');
    }
    if (!process.env.TWILIO_WHATSAPP_FROM) {
      errors.push('Missing required environment variable: TWILIO_WHATSAPP_FROM');
    }
  }

  // Admin token warning for production
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.length < 32) {
      warnings.push('ADMIN_TOKEN should be at least 32 characters long in production');
    }
  }

  // MongoDB URI validation
  if (process.env.MONGODB_URI) {
    if (!process.env.MONGODB_URI.startsWith('mongodb://') && 
        !process.env.MONGODB_URI.startsWith('mongodb+srv://')) {
      errors.push('MONGODB_URI must start with mongodb:// or mongodb+srv://');
    }
    // Warn about localhost in production
    if (process.env.NODE_ENV === 'production' && process.env.MONGODB_URI.includes('localhost')) {
      warnings.push('Using localhost MongoDB in production is not recommended. Use MongoDB Atlas or a managed service.');
    }
  }

  // Redis URL validation (optional but if provided should be valid)
  if (process.env.REDIS_URL && process.env.REDIS_URL !== 'disabled') {
    if (!process.env.REDIS_URL.startsWith('redis://') && 
        !process.env.REDIS_URL.startsWith('rediss://')) {
      warnings.push('REDIS_URL should start with redis:// or rediss://');
    }
  }

  // Port validation
  const port = parseInt(process.env.PORT || '3000', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push('PORT must be a valid number between 1 and 65535');
  }

  // Log warnings
  if (warnings.length > 0) {
    console.warn('⚠️  Environment variable warnings:');
    warnings.forEach(warning => console.warn(`   - ${warning}`));
  }

  // Throw errors if any required variables are missing
  if (errors.length > 0) {
    console.error('❌ Environment variable validation failed:');
    errors.forEach(error => console.error(`   - ${error}`));
    console.error('\nPlease check your .env file and ensure all required variables are set.');
    throw new Error('Environment validation failed. See errors above.');
  }

  console.log('✅ Environment variables validated successfully');
}

module.exports = { validateEnvironment };

