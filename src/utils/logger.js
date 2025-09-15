const fs = require('fs');
const path = require('path');

class Logger {
    constructor() {
        this.logDir = path.join(process.cwd(), 'logs');
        this.ensureLogDir();
    }

    ensureLogDir() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    getLogFileName() {
        const date = new Date().toISOString().split('T')[0];
        return path.join(this.logDir, `app-${date}.log`);
    }

    formatMessage(level, message, data = null) {
        const timestamp = new Date().toISOString();
        let logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        
        if (data) {
            logMessage += `\nData: ${JSON.stringify(data, null, 2)}`;
        }
        
        return logMessage + '\n';
    }

    writeToFile(message) {
        const logFile = this.getLogFileName();
        fs.appendFileSync(logFile, message);
    }

    info(message, data = null) {
        const formatted = this.formatMessage('info', message, data);
        console.log(formatted.trim());
        this.writeToFile(formatted);
    }

    error(message, data = null) {
        const formatted = this.formatMessage('error', message, data);
        console.error(formatted.trim());
        this.writeToFile(formatted);
    }

    warn(message, data = null) {
        const formatted = this.formatMessage('warn', message, data);
        console.warn(formatted.trim());
        this.writeToFile(formatted);
    }

    debug(message, data = null) {
        if (process.env.NODE_ENV === 'development') {
            const formatted = this.formatMessage('debug', message, data);
            console.log(formatted.trim());
            this.writeToFile(formatted);
        }
    }
}

module.exports = new Logger();