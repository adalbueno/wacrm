/**
 * Safe arithmetic evaluator for a numeric automation field after
 * `{{webhook.*}}` interpolation — e.g. a step's `value` field holds
 * the string `"{{webhook.Commissions.charge_amount}} / 100"`,
 * interpolate() turns that into `"8473 / 100"`, and this turns *that*
 * into `84.73`. Handles the common "webhook sends the amount in
 * cents" case without the user doing the math by hand.
 *
 * Deliberately NOT `eval`/`Function` — a hand-rolled recursive-descent
 * parser over a tiny grammar (numbers, + - * /, parentheses, unary
 * +/-). The input can contain arbitrary leftover text from a webhook
 * payload field that wasn't actually numeric, so this must fail
 * closed (return null) on anything it doesn't fully recognize, not
 * guess.
 *
 * Grammar:
 *   expression := term (('+' | '-') term)*
 *   term       := factor (('*' | '/') factor)*
 *   factor     := number | '(' expression ')' | ('+' | '-') factor
 */

type Token =
  | { type: 'num'; value: number }
  | { type: 'op'; value: '+' | '-' | '*' | '/' }
  | { type: 'lparen' }
  | { type: 'rparen' };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/') {
      tokens.push({ type: 'op', value: c });
      i++;
      continue;
    }
    if (c >= '0' && c <= '9') {
      let j = i;
      let dotSeen = false;
      while (
        j < input.length &&
        ((input[j] >= '0' && input[j] <= '9') || input[j] === '.')
      ) {
        if (input[j] === '.') {
          if (dotSeen) throw new Error('malformed number');
          dotSeen = true;
        }
        j++;
      }
      tokens.push({ type: 'num', value: Number(input.slice(i, j)) });
      i = j;
      continue;
    }
    throw new Error(`unexpected character: ${c}`);
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  atEnd(): boolean {
    return this.pos >= this.tokens.length;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    const tok = this.tokens[this.pos];
    if (!tok) throw new Error('unexpected end of expression');
    this.pos++;
    return tok;
  }

  parseExpression(): number {
    let value = this.parseTerm();
    for (;;) {
      const tok = this.peek();
      if (!tok || tok.type !== 'op' || (tok.value !== '+' && tok.value !== '-'))
        break;
      this.consume();
      const rhs = this.parseTerm();
      value = tok.value === '+' ? value + rhs : value - rhs;
    }
    return value;
  }

  private parseTerm(): number {
    let value = this.parseFactor();
    for (;;) {
      const tok = this.peek();
      if (!tok || tok.type !== 'op' || (tok.value !== '*' && tok.value !== '/'))
        break;
      this.consume();
      const rhs = this.parseFactor();
      if (tok.value === '*') {
        value = value * rhs;
      } else {
        if (rhs === 0) throw new Error('division by zero');
        value = value / rhs;
      }
    }
    return value;
  }

  private parseFactor(): number {
    const tok = this.consume();
    if (tok.type === 'op' && tok.value === '-') return -this.parseFactor();
    if (tok.type === 'op' && tok.value === '+') return this.parseFactor();
    if (tok.type === 'num') return tok.value;
    if (tok.type === 'lparen') {
      const value = this.parseExpression();
      const close = this.consume();
      if (close.type !== 'rparen') throw new Error('expected )');
      return value;
    }
    throw new Error('unexpected token');
  }
}

/**
 * Evaluates a basic arithmetic expression. Returns `null` — never
 * throws — for empty input, malformed syntax, trailing garbage,
 * division by zero, or a non-finite result, so callers can fall back
 * to a sane default instead of storing `NaN`/`Infinity`.
 */
export function evaluateNumericExpression(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const parser = new Parser(tokenize(trimmed));
    const value = parser.parseExpression();
    if (!parser.atEnd()) return null;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
