import { tokenize } from "./lexer.js";
import { parse } from "./parser.js";
import { interpret } from "./interpreter.js";

// Full pipeline: source text -> tokens -> AST -> scene graph.
export function run(source) {
  const tokens = tokenize(source);
  const program = parse(tokens);
  return interpret(program);
}

export { tokenize, parse, interpret };
