import * as vscode from 'vscode';

/**
 * Log levels for the logger
 */
export enum LogLevel {
    TRACE = 0,
    DEBUG = 1,
    INFO = 2,
    WARN = 3,
    ERROR = 4,
    FATAL = 5
}

/**
 * Interface for structured log data
 */
interface LogData {
    [key: string]: any;
}

/**
 * Enhanced logger for VS Code extension with dual-channel output
 * - User channel: Shows INFO+ levels for end users
 * - Debug channel: Shows all levels for debugging
 */
export class Logger {
    private static instance: Logger;
    private userChannel: vscode.OutputChannel;
    private debugChannel: vscode.OutputChannel;
    private performanceTimers: Map<string, number> = new Map();

    private constructor() {
        this.userChannel = vscode.window.createOutputChannel("Verse Auto Imports");
        this.debugChannel = vscode.window.createOutputChannel("Verse Auto Imports - Debug");
    }

    /**
     * Get the singleton logger instance
     */
    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * Initialize the logger and register channels with the extension context
     */
    public initialize(context: vscode.ExtensionContext): void {
        context.subscriptions.push(this.userChannel);
        context.subscriptions.push(this.debugChannel);
    }

    /**
     * Log a TRACE level message (most detailed)
     */
    public trace(module: string, message: string, data?: LogData): void {
        this.log(LogLevel.TRACE, module, message, data);
    }

    /**
     * Log a DEBUG level message
     */
    public debug(module: string, message: string, data?: LogData): void {
        this.log(LogLevel.DEBUG, module, message, data);
    }

    /**
     * Log an INFO level message
     */
    public info(module: string, message: string, data?: LogData): void {
        this.log(LogLevel.INFO, module, message, data);
    }

    /**
     * Log a WARN level message
     */
    public warn(module: string, message: string, data?: LogData): void {
        this.log(LogLevel.WARN, module, message, data);
    }

    /**
     * Log an ERROR level message with optional error object
     */
    public error(module: string, message: string, error?: Error | unknown, data?: LogData): void {
        const logData = { ...data };

        if (error) {
            if (error instanceof Error) {
                logData.errorMessage = error.message;
                logData.errorStack = error.stack;
            } else {
                logData.error = String(error);
            }
        }

        this.log(LogLevel.ERROR, module, message, logData);
    }

    /**
     * Log a FATAL level message with optional error object
     */
    public fatal(module: string, message: string, error?: Error | unknown, data?: LogData): void {
        const logData = { ...data };

        if (error) {
            if (error instanceof Error) {
                logData.errorMessage = error.message;
                logData.errorStack = error.stack;
            } else {
                logData.error = String(error);
            }
        }

        this.log(LogLevel.FATAL, module, message, logData);
    }

    /**
     * Start a performance timer
     */
    public startTimer(operationId: string): void {
        this.performanceTimers.set(operationId, Date.now());
    }

    /**
     * End a performance timer and log the duration
     */
    public endTimer(operationId: string, module: string, message: string): number {
        const startTime = this.performanceTimers.get(operationId);
        if (!startTime) {
            this.warn(module, `Timer '${operationId}' was not started`);
            return 0;
        }

        const duration = Date.now() - startTime;
        this.performanceTimers.delete(operationId);

        const logLevel = duration > 1000 ? LogLevel.WARN : LogLevel.DEBUG;
        this.log(logLevel, module, `${message} (${duration}ms)`, { duration, operationId });

        return duration;
    }

    /**
     * Show the user output channel
     */
    public showUserChannel(): void {
        this.userChannel.show();
    }

    /**
     * Show the debug output channel
     */
    public showDebugChannel(): void {
        this.debugChannel.show();
    }

    /**
     * Clear both output channels
     */
    public clearChannels(): void {
        this.userChannel.clear();
        this.debugChannel.clear();
    }

    /**
     * Get the user output channel (for backward compatibility)
     */
    public getUserChannel(): vscode.OutputChannel {
        return this.userChannel;
    }

    /**
     * Core logging method
     */
    private log(level: LogLevel, module: string, message: string, data?: LogData): void {
        const timestamp = new Date();
        const levelName = LogLevel[level];

        // Format for user channel (INFO+ levels only)
        if (level >= LogLevel.INFO) {
            const userFormat = this.formatUserMessage(timestamp, levelName, message);
            this.userChannel.appendLine(userFormat);
        }

        // Format for debug channel (all levels)
        const debugFormat = this.formatDebugMessage(timestamp, levelName, module, message, data);
        this.debugChannel.appendLine(debugFormat);
    }

    /**
     * Format message for user channel (simpler format)
     */
    private formatUserMessage(timestamp: Date, level: string, message: string): string {
        const time = timestamp.toTimeString().substring(0, 8);
        return `[${time}] [${level}] ${message}`;
    }

    /**
     * Format message for debug channel (detailed format)
     */
    private formatDebugMessage(
        timestamp: Date,
        level: string,
        module: string,
        message: string,
        data?: LogData
    ): string {
        const time = timestamp.toISOString().substring(11, 23);
        let formatted = `[${time}] [${level}] [${module}] ${message}`;

        if (data && Object.keys(data).length > 0) {
            // Format data object, handling special cases
            const dataStr = this.formatLogData(data);
            if (dataStr) {
                formatted += ` ${dataStr}`;
            }
        }

        return formatted;
    }

    /**
     * Format log data for output
     */
    private formatLogData(data: LogData): string {
        const parts: string[] = [];

        for (const [key, value] of Object.entries(data)) {
            if (key === 'errorStack' && value) {
                // Handle stack traces specially
                parts.push(`\n  Stack trace:\n    ${value.replace(/\n/g, '\n    ')}`);
            } else if (value !== undefined && value !== null) {
                // Handle other values
                let valueStr: string;
                if (typeof value === 'string') {
                    valueStr = value;
                } else if (typeof value === 'object') {
                    try {
                        valueStr = JSON.stringify(value, null, 2);
                    } catch {
                        valueStr = String(value);
                    }
                } else {
                    valueStr = String(value);
                }
                parts.push(`${key}=${valueStr}`);
            }
        }

        return parts.length > 0 ? `{ ${parts.join(', ')} }` : '';
    }

    /**
     * Legacy support: Simple log function for backward compatibility
     */
    public logSimple(message: string): void {
        this.info("Legacy", message);
    }
}

// Export singleton instance for convenience
export const logger = Logger.getInstance();

// Legacy support function for backward compatibility
export function log(channel: vscode.OutputChannel, message: string): void {
    logger.logSimple(message);
}