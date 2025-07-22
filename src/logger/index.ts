import pino from 'pino';

// ----- Create a pino logger -----
const logger = pino({
    // customize pino options if needed
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        singleLine: true
      }
    }
});

export default logger;
