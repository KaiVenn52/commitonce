/**
 * Error types the CLI reports differently.
 *
 * The distinction matters for how a failure is presented. A `ConfigError` is the user's
 * setup being incomplete; it deserves the message and nothing else. A `DemoFailure` is the
 * chain disagreeing with what the demo claims; it deserves the evidence and a non-zero exit.
 * Anything else is a genuine bug, and gets a stack trace.
 */

/** The run could not start: something in the environment is missing or malformed. */
export class ConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConfigError';
    }
}

/** The run started, and the chain did not behave as the demo claims it does. */
export class DemoFailure extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DemoFailure';
    }
}
