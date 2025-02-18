// import config from './appConfig.js';
import { SourceMapConsumer } from 'source-map-js';
import fs from 'fs';
import path from 'path';

class ErrorMapper {

    static _sourceMap = { source: null };

    /**
     * Initializes the source map for the frontend build if a valid file path is provided.
     * It reads the specified directory to find the source map file matching the pattern "main.*.js.map",
     * loads its contents, and assigns the parsed JSON data to the `_sourceMap.source` property.
     * Logs an error if reading the source mapping file fails.
     *
     * @param {Object} options - The initialization options.
     * @param {string} options.filePath - The path to the directory containing the source map file.
     * @returns {Promise<void>} - Resolves with no return value; logs an error if any issues occur.
     */
    static async init({ filePath }) {
        if (!fs.existsSync(filePath)) {
            throw new Error("Script files are not available for loading the source map in the frontend build.");
        }
        try {
            const files = await fs.promises.readdir(filePath);
            const matchingFile = files.find(file => /^main\.\w+\.js\.map$/.test(file));
    
            if (!matchingFile) {
                throw new Error("No valid source map file found in the directory.");
            }
    
            const fileData = await fs.promises.readFile(path.join(filePath, matchingFile), 'utf-8');
            this._sourceMap.source = JSON.parse(fileData);
        } catch (error) {
            throw new Error(`Error while reading the source mapping file: ${error.message}`);
        }
    }
    

    /**
     * Remaps a stack trace using source maps to provide original file names, line numbers, 
     * and column numbers from the source code. This function uses SourceMapConsumer to 
     * convert transpiled stack traces back to their original source locations, making debugging easier.
     *
     * @param {string} stack - The error stack trace from the frontend, typically from a minified build.
     * @param {string} file - The filename or key associated with the source map.
     * @returns {string} - The remapped stack trace with source code locations.
     */
    static reMapStackWithSourceCode(stack, file) {
        if (!this._sourceMap[file]) {
            return stack;
        }

        let consumer;
        try {
            consumer = new SourceMapConsumer(this._sourceMap[file]);
            return stack.split('\n').map(line => {
                const match = line.match(/at\s+([^(]+)\((.*):(\d+):(\d+)\)/);
                if (!match) return line;

                const [, , , lineNum, columnNum] = match;
                const pos = consumer.originalPositionFor({
                    line: parseInt(lineNum, 10),
                    column: parseInt(columnNum, 10),
                });

                return pos.source
                    ? `${pos.source}:${pos.line}:${pos.column}${pos.name ? ' at ' + pos.name : ''}`
                    : line;
            }).join('\n');
        } catch {
            return stack;
        } finally {
            if (consumer?.destroy) {
                consumer.destroy();
            }
        }
    }

    /**
 * Handles client-side error logging and response in case of frontend build errors.
 * - Extracts app name and error stack from request body, query, or parameters.
 * - Uses source map to remap stack trace for improved traceability.
 * - Logs client error details using an external logging service or locally.
 * - Sends a confirmation response to the client after logging.
 *
 * @param {Object} req - HTTP request object containing frontend error details.
 * @param {Object} res - HTTP response object for sending confirmation.
 * @param {Object} logger - Logger instance for handling logs.
 * @returns {boolean} - Returns true if error logging succeeds.
 */
    static async execute(req, res, logger) {
        if (!logger) {
            throw new Error("Logger instance is required.");
        }

        // Extract relevant data
        const { appName = '', stack, rawUrl } = { ...req.body, ...req.query, ...req.params };
        const remappedStack = this.reMapStackWithSourceCode(stack, 'source');

        // Prepare log data
        const logData = {
            req: { ...req, headers: req.headers, body: {} },
            err: { stack: remappedStack },
            machineName: appName.toLowerCase(),
            rawUrl
        };

        // Log error
        if (logger.clienterror) {
            logger.clienterror({ err: { stack: remappedStack } }, "Client-side error: An issue occurred while processing the request.");
        } else {
            req.log?.error(logData);
            res.status(200).send('Mail Sent');
        }
        return true;
    }
}


export default ErrorMapper;