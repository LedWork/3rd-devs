import chalk from 'chalk';

type LogLevel = 'debug' | 'info' | 'success' | 'warning' | 'error' | 'url';

export const logger = {
    debug: (message: string, ...args: any[]) => {
        console.log(chalk.dim(`[DEBUG] ${message}`), ...args);
    },

    info: (message: string, ...args: any[]) => {
        console.log(chalk.cyan(`[INFO] ${message}`), ...args);
    },

    success: (message: string, ...args: any[]) => {
        console.log(chalk.green(`[SUCCESS] ${message}`), ...args);
    },

    warning: (message: string, ...args: any[]) => {
        console.log(chalk.yellow(`[WARNING] ${message}`), ...args);
    },

    error: (message: string, ...args: any[]) => {
        console.error(chalk.red(`[ERROR] ${message}`), ...args);
    },

    url: (message: string, ...args: any[]) => {
        console.log(chalk.blue(`[URL] ${message}`), ...args);
    },

    processing: (message: string, ...args: any[]) => {
        console.log(chalk.yellow(`\n[Processing] ${message}`), ...args);
    }
}; 