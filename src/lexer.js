// Turns raw .ax source text into a flat list of tokens.
// No newline tokens on purpose - every value in AXIS is "self delimiting"
// (numbers, tuples, identifiers all have a clear end) so the parser never
// needs to know where a line ended, just where the next token starts.

const SINGLE_CHAR_TOKENS = {
  "{": "LBRACE",
  "}": "RBRACE",
  "(": "LPAREN",
  ")": "RPAREN",
  "[": "LBRACKET",
  "]": "RBRACKET",
  ":": "COLON",
  ",": "COMMA",
  ".": "DOT",
  "+": "PLUS",
  "-": "MINUS",
  "*": "STAR",
  "/": "SLASH",
  "%": "PERCENT",
  "?": "QUESTION",
};

function isDigit(ch) {
  return ch >= "0" && ch <= "9";
}

function isIdentStart(ch) {
  return /[A-Za-z_]/.test(ch);
}

function isIdentPart(ch) {
  return /[A-Za-z0-9_]/.test(ch);
}

export class AxisSyntaxError extends Error {
  constructor(message, line, column) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = "AxisSyntaxError";
    this.line = line;
    this.column = column;
  }
}

// `onComment(line, col, text)`, when given, is called for every `//` line
// comment at the exact point it's otherwise silently discarded - every
// other caller (parser.js, and every existing test) keeps working
// unchanged, since comments still contribute zero tokens either way. This
// is the one thing src/format.js needs from the lexer: a way to detect a
// comment exists (so it can refuse to format, rather than silently
// deleting it - comments carry no AST representation at all) without a
// second, hand-rolled scanner duplicating this one's string/comment rules.
export function tokenize(source, { onComment } = {}) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;

  function peek(offset = 0) {
    return source[i + offset];
  }

  function advance() {
    const ch = source[i++];
    if (ch === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  }

  while (i < source.length) {
    const ch = peek();

    // whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }

    // line comments
    if (ch === "/" && peek(1) === "/") {
      const startLine = line;
      const startCol = col;
      let text = "";
      while (i < source.length && peek() !== "\n") text += advance();
      onComment?.(startLine, startCol, text);
      continue;
    }

    const startLine = line;
    const startCol = col;

    // arrow: ->
    if (ch === "-" && peek(1) === ">") {
      advance();
      advance();
      tokens.push({ type: "ARROW", value: "->", line: startLine, col: startCol });
      continue;
    }

    // compound assignment: += -= *= /=
    if ((ch === "+" || ch === "-" || ch === "*" || ch === "/") && peek(1) === "=") {
      const type = { "+": "PLUSEQ", "-": "MINUSEQ", "*": "STAREQ", "/": "SLASHEQ" }[ch];
      advance();
      advance();
      tokens.push({ type, value: ch + "=", line: startLine, col: startCol });
      continue;
    }

    // a minus directly glued to a digit is read as a negative number literal
    // (so "-45deg" is one token). Write a space around "-" when you mean
    // subtraction and the right side is a bare number, e.g. "5 - 3" not
    // "5 -3" - otherwise it reads as two adjacent numbers.
    if (ch === "-" && isDigit(peek(1))) {
      let text = advance(); // consume '-'
      while (isDigit(peek())) text += advance();
      if (peek() === "." && isDigit(peek(1))) {
        text += advance();
        while (isDigit(peek())) text += advance();
      }
      let unit = "";
      while (peek() && /[A-Za-z%]/.test(peek())) unit += advance();
      tokens.push({
        type: "NUMBER",
        value: parseFloat(text),
        unit: unit || null,
        line: startLine,
        col: startCol,
      });
      continue;
    }

    if (isDigit(ch)) {
      let text = "";
      while (isDigit(peek())) text += advance();
      if (peek() === "." && isDigit(peek(1))) {
        text += advance();
        while (isDigit(peek())) text += advance();
      }
      let unit = "";
      while (peek() && /[A-Za-z%]/.test(peek())) unit += advance();
      tokens.push({
        type: "NUMBER",
        value: parseFloat(text),
        unit: unit || null,
        line: startLine,
        col: startCol,
      });
      continue;
    }

    if (isIdentStart(ch)) {
      let text = "";
      while (peek() && isIdentPart(peek())) text += advance();
      tokens.push({ type: "IDENT", value: text, line: startLine, col: startCol });
      continue;
    }

    if (ch === '"') {
      advance(); // opening quote
      let text = "";
      while (peek() !== undefined && peek() !== '"') {
        if (peek() === "\\" && peek(1) === '"') {
          advance();
          text += advance();
        } else {
          text += advance();
        }
      }
      if (peek() !== '"') {
        throw new AxisSyntaxError("unterminated string", startLine, startCol);
      }
      advance(); // closing quote
      tokens.push({ type: "STRING", value: text, line: startLine, col: startCol });
      continue;
    }

    // two-character operators
    if (ch === "=" && peek(1) === "=") {
      advance();
      advance();
      tokens.push({ type: "EQEQ", value: "==", line: startLine, col: startCol });
      continue;
    }
    if (ch === "!" && peek(1) === "=") {
      advance();
      advance();
      tokens.push({ type: "BANGEQ", value: "!=", line: startLine, col: startCol });
      continue;
    }
    if (ch === "<" && peek(1) === "=") {
      advance();
      advance();
      tokens.push({ type: "LTE", value: "<=", line: startLine, col: startCol });
      continue;
    }
    if (ch === ">" && peek(1) === "=") {
      advance();
      advance();
      tokens.push({ type: "GTE", value: ">=", line: startLine, col: startCol });
      continue;
    }
    if (ch === "&" && peek(1) === "&") {
      advance();
      advance();
      tokens.push({ type: "AND", value: "&&", line: startLine, col: startCol });
      continue;
    }
    if (ch === "|" && peek(1) === "|") {
      advance();
      advance();
      tokens.push({ type: "OR", value: "||", line: startLine, col: startCol });
      continue;
    }

    // one-character operators/punctuation not covered above
    if (ch === "=") {
      advance();
      tokens.push({ type: "EQ", value: "=", line: startLine, col: startCol });
      continue;
    }
    if (ch === "!") {
      advance();
      tokens.push({ type: "BANG", value: "!", line: startLine, col: startCol });
      continue;
    }
    if (ch === "<") {
      advance();
      tokens.push({ type: "LT", value: "<", line: startLine, col: startCol });
      continue;
    }
    if (ch === ">") {
      advance();
      tokens.push({ type: "GT", value: ">", line: startLine, col: startCol });
      continue;
    }

    if (SINGLE_CHAR_TOKENS[ch]) {
      advance();
      tokens.push({ type: SINGLE_CHAR_TOKENS[ch], value: ch, line: startLine, col: startCol });
      continue;
    }

    throw new AxisSyntaxError(`unexpected character '${ch}'`, startLine, startCol);
  }

  tokens.push({ type: "EOF", value: null, line, col });
  return tokens;
}
