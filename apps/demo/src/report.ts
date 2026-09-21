/**
 * Terminal output helpers.
 *
 * Kept deliberately dumb: the demo's job is to make one difference impossible to miss, so
 * the formatting code holds no domain knowledge and the orchestration holds no formatting.
 */

const WIDTH = 92;

/** A thin horizontal rule. */
export function rule(): void {
    console.log('-'.repeat(WIDTH));
}

/** A heavy horizontal rule. */
export function heavyRule(): void {
    console.log('='.repeat(WIDTH));
}

export function blank(): void {
    console.log('');
}

/** A top-level banner: heavy rule, text, heavy rule. */
export function heading(text: string): void {
    blank();
    heavyRule();
    console.log(text);
    heavyRule();
}

/** A section divider with a caption. */
export function section(text: string): void {
    blank();
    rule();
    console.log(text);
    rule();
}

/**
 * A `label   value` row, padded so columns line up across the whole run.
 */
export function field(label: string, value: string, indent = 2, labelWidth = 24): void {
    const pad = ' '.repeat(indent);
    const padded = label.length >= labelWidth ? `${label} ` : label.padEnd(labelWidth, ' ');
    const continuation = `${' '.repeat(indent + labelWidth)}`;
    const lines = value.split('\n');
    console.log(`${pad}${padded}${lines[0] ?? ''}`);
    for (const line of lines.slice(1)) {
        console.log(`${continuation}${line}`);
    }
}

/** Greedy word wrap, so prose stays inside the terminal without the caller counting. */
export function wrap(text: string, width = WIDTH, indent = 2): string {
    const pad = ' '.repeat(indent);
    const words = text.split(/\s+/).filter((word) => word.length > 0);
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
        if (current.length === 0) {
            current = word;
        } else if (current.length + 1 + word.length <= width - indent) {
            current += ` ${word}`;
        } else {
            lines.push(`${pad}${current}`);
            current = word;
        }
    }
    if (current.length > 0) {
        lines.push(`${pad}${current}`);
    }
    return lines.join('\n');
}

/** A wrapped prose paragraph. */
export function paragraph(text: string, indent = 2): void {
    console.log(wrap(text, WIDTH, indent));
}

/**
 * A fixed-width table with a header and a rule under it.
 *
 * Columns are padded to the widest cell so the output stays readable when an address or a
 * signature is longer than expected.
 */
export function table(headers: readonly string[], rows: readonly (readonly string[])[]): void {
    const widths = headers.map((header, column) =>
        Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
    );
    const render = (cells: readonly string[]): string =>
        cells
            .map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column] ?? 0, ' ')))
            .join('  ')
            .trimEnd();
    console.log(`  ${render(headers)}`);
    console.log(`  ${widths.map((width) => '-'.repeat(width)).join('  ')}`);
    for (const row of rows) {
        console.log(`  ${render(row)}`);
    }
}

/** Thousands separators, for lamports and compute units. */
export function group(value: bigint | number): string {
    return value.toLocaleString('en-US');
}

/** Lamports rendered as SOL with four decimals, for balances that are not the point. */
export function sol(lamports: bigint): string {
    const negative = lamports < 0n;
    const absolute = negative ? -lamports : lamports;
    const whole = absolute / 1_000_000_000n;
    const fraction = (absolute % 1_000_000_000n).toString().padStart(9, '0').slice(0, 4);
    return `${negative ? '-' : ''}${whole}.${fraction} SOL`;
}

/** Shorten a base58 value for a one-line diff, keeping enough to eyeball it. */
export function abbreviate(value: string, head = 16, tail = 6): string {
    if (value.length <= head + tail + 3) {
        return value;
    }
    return `${value.slice(0, head)}...${value.slice(-tail)}`;
}
