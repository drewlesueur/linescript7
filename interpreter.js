"use strict";

// Simple interpreter for the EXAMPLE.txt language.

class Lexer {
  constructor(source, stringLiterals) {
    this.source = source;
    this.stringLiterals = stringLiterals;
    this.pos = 0;
    this.tokens = [];
    this.tokenize();
    this.index = 0;
  }

  tokenize() {
    const s = this.source;
    const isAlpha = (c) => /[A-Za-z_]/.test(c);
    const isNum = (c) => /[0-9]/.test(c);

    while (this.pos < s.length) {
      const c = s[this.pos];
      if (c === " " || c === "\t" || c === "\r") {
        this.pos += 1;
        continue;
      }
      if (c === "\n") {
        this.tokens.push({ type: "NEWLINE" });
        this.pos += 1;
        continue;
      }
      if (c === '"') {
        let out = "";
        this.pos += 1;
        while (this.pos < s.length) {
          const ch = s[this.pos];
          if (ch === '"') {
            this.pos += 1;
            break;
          }
          if (ch === "\\") {
            const next = s[this.pos + 1] || "";
            if (next === '"' || next === "\\") {
              out += next;
              this.pos += 2;
              continue;
            }
            if (next === "n") {
              out += "\n";
              this.pos += 2;
              continue;
            }
            if (next === "t") {
              out += "\t";
              this.pos += 2;
              continue;
            }
          }
          out += ch;
          this.pos += 1;
        }
        this.tokens.push({ type: "STRING", value: out });
        continue;
      }

      if (isNum(c)) {
        let start = this.pos;
        while (this.pos < s.length && /[0-9.]/.test(s[this.pos])) this.pos += 1;
        const raw = s.slice(start, this.pos);
        this.tokens.push({ type: "NUMBER", value: Number(raw) });
        continue;
      }

      if (isAlpha(c)) {
        let start = this.pos;
        while (this.pos < s.length && /[A-Za-z0-9_]/.test(s[this.pos])) this.pos += 1;
        const raw = s.slice(start, this.pos);
        if (Object.prototype.hasOwnProperty.call(this.stringLiterals, raw)) {
          this.tokens.push({ type: "STRING", value: this.stringLiterals[raw] });
          continue;
        }
        this.tokens.push({ type: "IDENT", value: raw });
        continue;
      }

      const two = s.slice(this.pos, this.pos + 2);
      if ([">=", "<=", "==", "!="].includes(two)) {
        this.tokens.push({ type: "OP", value: two });
        this.pos += 2;
        continue;
      }
      if (["+", "-", "*", "/", "=", ">", "<", ".", ",", ":", "[", "]", "{", "}", "(", ")", ";"].includes(c)) {
        this.tokens.push({ type: "OP", value: c });
        this.pos += 1;
        continue;
      }

      throw new Error(`Unexpected character: ${c}`);
    }
    this.tokens.push({ type: "EOF" });
  }

  peek(offset = 0) {
    return this.tokens[this.index + offset] || { type: "EOF" };
  }

  next() {
    const t = this.peek();
    this.index += 1;
    return t;
  }

  match(type, value) {
    const t = this.peek();
    if (t.type !== type) return false;
    if (value !== undefined && t.value !== value) return false;
    this.index += 1;
    return true;
  }
}

function preprocess(source) {
  const lines = source.split(/\r?\n/);
  const stringLiterals = {};
  let mlIndex = 0;
  const outLines = [];

  const stripComments = (line) => {
    let out = "";
    let inString = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (c === '"') inString = !inString;
      if (c === "#" && !inString) break;
      out += c;
    }
    return out;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = stripComments(raw);
    if (line.trim() === "") {
      outLines.push("");
      continue;
    }

    if (/\bSTRING\b\s*$/.test(line)) {
      const prefix = line.replace(/\s*$/, "");
      const placeholder = `__MLSTR_${mlIndex}__`;
      mlIndex += 1;
      const buffer = [];
      i += 1;
      while (i < lines.length && lines[i].trim() !== "END") {
        buffer.push(lines[i]);
        i += 1;
      }
      stringLiterals[placeholder] = buffer.join("\n");
      outLines.push(`${prefix} ${placeholder}`);
      continue;
    }

    const m = line.match(/\bSTRING\b(.*)$/);
    if (m) {
      const rest = m[1];
      if (rest.trim() !== "") {
        const placeholder = `__MLSTR_${mlIndex}__`;
        mlIndex += 1;
        stringLiterals[placeholder] = rest.replace(/^\s+/, "");
        const replaced = line.replace(/\bSTRING\b.*$/, `STRING ${placeholder}`);
        outLines.push(replaced);
        continue;
      }
    }

    outLines.push(line);
  }

  return { source: outLines.join("\n"), stringLiterals };
}

class Parser {
  constructor(lexer, functionArity) {
    this.lexer = lexer;
    this.functionArity = functionArity;
  }

  parseProgram() {
    const body = [];
    while (!this.check("EOF")) {
      if (this.check("NEWLINE")) {
        this.lexer.next();
        continue;
      }
      body.push(this.parseStatement());
    }
    return { type: "Program", body };
  }

  parseStatement() {
    if (this.check("IDENT") && this.lexer.peek(1).type === "OP" && this.lexer.peek(1).value === ":") {
      return this.parseLabeledStatement();
    }
    if (this.matchKeyword("IF")) return this.parseIfWithLabel(null);
    if (this.matchKeyword("WHILE")) return this.parseWhile();
    if (this.matchKeyword("FOR")) return this.parseFor();
    if (this.matchKeyword("FUNC")) return this.parseFunc();
    if (this.matchKeyword("RETURN")) {
      const expr = this.parseExpression();
      this.consumeEnd();
      return { type: "Return", expr };
    }
    if (this.matchKeyword("GOTO")) {
      const label = this.expectIdent();
      this.consumeEnd();
      return { type: "Goto", label };
    }
    if (this.matchKeyword("BREAK")) {
      let label = null;
      if (this.check("IDENT")) label = this.expectIdent();
      this.consumeEnd();
      return { type: "Break", label };
    }
    if (this.matchKeyword("CONTINUE")) {
      let label = null;
      if (this.check("IDENT")) label = this.expectIdent();
      this.consumeEnd();
      return { type: "Continue", label };
    }
    if (this.matchKeyword("GLOBAL")) {
      const name = this.expectIdent();
      this.expect("OP", "=");
      const value = this.parseExpression();
      this.consumeEnd();
      return { type: "GlobalAssign", name, value };
    }

    const expr = this.parseExpression();
    if (this.match("OP", "=")) {
      if (!this.isLValue(expr)) throw new Error("Invalid assignment target");
      const value = this.parseExpression();
      this.consumeEnd();
      return { type: "Assign", target: expr, value };
    }
    this.consumeEnd();
    return { type: "ExprStmt", expr };
  }

  parseIfWithLabel(label) {
    const cond = this.parseExpression();
    this.consumeEnd();
    const branches = [{ cond, body: this.parseBlock(["ELSE", "END"]) }];
    let elseBody = null;

    while (this.matchKeyword("ELSE")) {
      if (this.matchKeyword("IF")) {
        const c = this.parseExpression();
        this.consumeEnd();
        branches.push({ cond: c, body: this.parseBlock(["ELSE", "END"]) });
        continue;
      }
      this.consumeEnd();
      elseBody = this.parseBlock(["END"]);
      break;
    }
    this.expectKeyword("END");
    this.consumeEnd();
    return { type: "If", branches, elseBody, label };
  }

  parseWhile() {
    return this.parseWhileWithLabel(null);
  }

  parseWhileWithLabel(label) {
    const cond = this.parseExpression();
    this.consumeEnd();
    const body = this.parseBlock(["END"]);
    this.expectKeyword("END");
    this.consumeEnd();
    return { type: "While", cond, body, label };
  }

  parseFor() {
    return this.parseForWithLabel(null);
  }

  parseForWithLabel(label) {
    if (this.matchKeyword("EACH")) {
      const first = this.expectIdent();
      let second = null;
      if (this.check("IDENT") && this.lexer.peek().value !== "IN") second = this.expectIdent();
      this.expectKeyword("IN");
      const iterable = this.parseExpression();
      this.consumeEnd();
      const body = this.parseBlock(["END"]);
      this.expectKeyword("END");
      this.consumeEnd();
      return {
        type: "ForEach",
        keyVar: second ? first : null,
        valVar: second ? second : first,
        iterable,
        body,
        label,
      };
    }

    const name = this.expectIdent();
    this.expectKeyword("FROM");
    const start = this.parseExpression();
    this.expectKeyword("TO");
    const end = this.parseExpression();
    this.consumeEnd();
    const body = this.parseBlock(["END"]);
    this.expectKeyword("END");
    this.consumeEnd();
    return { type: "For", name, start, end, body, label };
  }

  parseLabeledStatement() {
    const label = this.expectIdent();
    this.expect("OP", ":");
    if (this.matchKeyword("FOR")) return this.parseForWithLabel(label);
    if (this.matchKeyword("WHILE")) return this.parseWhileWithLabel(label);
    if (this.matchKeyword("IF")) return this.parseIfWithLabel(label);
    this.consumeEnd();
    return { type: "Label", label };
  }

  parseFunc() {
    const name = this.expectIdent();
    const params = [];
    while (!this.check("NEWLINE") && !this.check("EOF") && !this.check("OP", ";")) {
      params.push(this.expectIdent());
    }
    this.consumeEnd();
    const body = this.parseBlock(["END"]);
    this.expectKeyword("END");
    this.consumeEnd();
    return { type: "FuncDef", name, params, body };
  }

  parseBlock(endKeywords) {
    const body = [];
    while (!this.check("EOF")) {
      if (this.check("NEWLINE")) {
        this.lexer.next();
        continue;
      }
      if (this.check("IDENT")) {
        const v = this.lexer.peek().value;
        if (endKeywords.includes(v)) break;
      }
      body.push(this.parseStatement());
    }
    return body;
  }

  parseExpression(precedence = 0) {
    let left = this.parsePrefix();
    while (true) {
      const op = this.peekOperator();
      const prec = this.getPrecedence(op);
      if (prec <= precedence) break;
      this.lexer.next();
      const right = this.parseExpression(prec);
      left = { type: "Binary", op, left, right };
    }
    return left;
  }

  parsePrefix() {
    if (this.match("OP", "(")) {
      const expr = this.parseExpression();
      this.expect("OP", ")");
      return expr;
    }
    if (this.match("OP", "-")) {
      return { type: "Unary", op: "-", expr: this.parseExpression(8) };
    }
    if (this.matchKeyword("NOT")) {
      return { type: "Unary", op: "NOT", expr: this.parseExpression(8) };
    }

    const t = this.lexer.peek();
    if (t.type === "NUMBER") {
      this.lexer.next();
      return { type: "Literal", value: t.value };
    }
    if (t.type === "STRING") {
      this.lexer.next();
      return { type: "Literal", value: t.value };
    }

    if (this.matchKeyword("TRUE")) return { type: "Literal", value: true };
    if (this.matchKeyword("FALSE")) return { type: "Literal", value: false };
    if (this.matchKeyword("NULL")) return { type: "Literal", value: null };

    if (t.type === "IDENT") {
      const name = t.value;
      this.lexer.next();
      if (this.functionArity[name] !== undefined) {
        const arity = this.functionArity[name];
        const args = [];
        for (let i = 0; i < arity; i += 1) {
          if (this.isArgBoundary()) break;
          args.push(this.parseExpression(9));
        }
        return this.parsePostfix({ type: "Call", name, args });
      }
      return this.parsePostfix({ type: "Identifier", name });
    }

    if (this.match("OP", "[")) {
      const items = [];
      this.skipNewlines();
      while (!this.check("OP", "]")) {
        items.push(this.parseExpression());
        this.skipNewlines();
        if (this.match("OP", ",")) continue;
        this.skipNewlines();
      }
      this.expect("OP", "]");
      return { type: "ArrayLiteral", items };
    }

    if (this.match("OP", "{")) {
      const pairs = [];
      this.skipNewlines();
      while (!this.check("OP", "}")) {
        let key;
        if (this.check("IDENT")) key = this.lexer.next().value;
        else if (this.check("STRING")) key = this.lexer.next().value;
        else throw new Error("Invalid object key");
        this.expect("OP", ":");
        const value = this.parseExpression();
        pairs.push({ key, value });
        this.skipNewlines();
        if (this.match("OP", ",")) continue;
        this.skipNewlines();
      }
      this.expect("OP", "}");
      return { type: "ObjectLiteral", pairs };
    }

    throw new Error(`Unexpected token: ${t.type} ${t.value || ""}`);
  }

  parsePostfix(expr) {
    while (true) {
      if (this.match("OP", ".")) {
        const name = this.expectIdent();
        expr = { type: "Member", object: expr, property: name };
        continue;
      }
      if (this.match("OP", "[")) {
        const index = this.parseExpression();
        this.expect("OP", "]");
        expr = { type: "Index", object: expr, index };
        continue;
      }
      break;
    }
    return expr;
  }

  isLValue(expr) {
    return expr.type === "Identifier" || expr.type === "Member" || expr.type === "Index";
  }

  consumeEnd() {
    while (this.match("NEWLINE") || this.match("OP", ";")) {
      // consume
    }
  }

  skipNewlines() {
    while (this.match("NEWLINE")) {
      // consume
    }
  }

  isArgBoundary() {
    const t = this.lexer.peek();
    if (t.type === "NEWLINE" || t.type === "EOF") return true;
    if (t.type === "OP" && [";", "]", ")", "}"].includes(t.value)) return true;
    if (t.type === "IDENT" && ["ELSE", "END"].includes(t.value)) return true;
    return false;
  }

  getPrecedence(op) {
    if (!op) return 0;
    if (["*", "/"].includes(op)) return 7;
    if (["+", "-"].includes(op)) return 6;
    if ([">", ">=", "<", "<="].includes(op)) return 5;
    if (["IS", "ISNT", "==", "!="].includes(op)) return 4;
    if (op === "AND") return 3;
    if (op === "OR") return 2;
    return 0;
  }

  peekOperator() {
    const t = this.lexer.peek();
    if (t.type === "OP") return t.value;
    if (t.type === "IDENT") {
      const v = t.value;
      if (["AND", "OR", "IS", "ISNT"].includes(v)) return v;
    }
    return null;
  }

  check(type, value) {
    const t = this.lexer.peek();
    if (t.type !== type) return false;
    if (value !== undefined && t.value !== value) return false;
    return true;
  }

  match(type, value) {
    return this.lexer.match(type, value);
  }

  expect(type, value) {
    const t = this.lexer.next();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new Error(`Expected ${type} ${value || ""}`);
    }
    return t;
  }

  expectIdent() {
    const t = this.lexer.next();
    if (t.type !== "IDENT") throw new Error("Expected identifier");
    return t.value;
  }

  matchKeyword(word) {
    const t = this.lexer.peek();
    if (t.type === "IDENT" && t.value === word) {
      this.lexer.next();
      return true;
    }
    return false;
  }

  expectKeyword(word) {
    const t = this.lexer.next();
    if (t.type !== "IDENT" || t.value !== word) throw new Error(`Expected ${word}`);
  }
}

class Environment {
  constructor(parent = null) {
    this.parent = parent;
    this.vars = new Map();
  }

  has(name) {
    if (this.vars.has(name)) return true;
    if (this.parent) return this.parent.has(name);
    return false;
  }

  get(name) {
    if (this.vars.has(name)) return this.vars.get(name);
    if (this.parent) return this.parent.get(name);
    return null;
  }

  set(name, value) {
    if (this.vars.has(name)) {
      this.vars.set(name, value);
      return;
    }
    this.vars.set(name, value);
  }

  define(name, value) {
    this.vars.set(name, value);
  }
}

class Interpreter {
  constructor(options = {}) {
    this.output = [];
    this.stack = [];
    this.random = options.random || (() => Math.random());
    this.builtins = this.createBuiltins();
  }

  createBuiltins() {
    return {
      PRINT: { arity: 1, fn: (args) => { this.output.push(this.formatValue(args[0])); return args[0]; } },
      LEN: { arity: 1, fn: ([v]) => {
        if (v === null || v === undefined) return 0;
        if (Array.isArray(v) || typeof v === "string") return v.length;
        if (typeof v === "object") return Object.keys(v).length;
        return 0;
      } },
      SUM_ARRAY: { arity: 1, fn: ([arr]) => {
        if (!Array.isArray(arr)) return 0;
        return arr.reduce((sum, v) => sum + this.toNumber(v), 0);
      } },
      SUBSTR: { arity: 3, fn: ([s, start, len]) => this.substrValue(s, start, len) },
      SLICE: { arity: 3, fn: ([s, start, end]) => this.sliceRange(s, start, end) },
      STRING: { arity: 1, fn: ([s]) => this.toString(s) },
      TRIM: { arity: 1, fn: ([s]) => this.toString(s).trim() },
      STARTS_WITH: { arity: 2, fn: ([s, prefix]) => this.toString(s).startsWith(this.toString(prefix)) },
      ENDS_WITH: { arity: 2, fn: ([s, suffix]) => this.toString(s).endsWith(this.toString(suffix)) },
      SPLIT: { arity: 2, fn: ([s, delim]) => this.toString(s).split(this.toString(delim)) },
      JOIN: { arity: 2, fn: ([arr, delim]) => Array.isArray(arr) ? arr.map((v) => this.toString(v)).join(this.toString(delim)) : "" },
      UPPER: { arity: 1, fn: ([s]) => this.toString(s).toUpperCase() },
      RAND: { arity: 2, fn: ([min, max]) => {
        const a = Math.floor(this.toNumber(min));
        const b = Math.floor(this.toNumber(max));
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        return lo + Math.floor(this.random() * (hi - lo + 1));
      } },
      PUSH: { arity: 2, fn: ([arr, v]) => { if (Array.isArray(arr)) arr.push(v); return arr.length; } },
      POP: { arity: 1, fn: ([arr]) => Array.isArray(arr) && arr.length ? arr.pop() : null },
      UNSHIFT: { arity: 2, fn: ([arr, v]) => { if (Array.isArray(arr)) arr.unshift(v); return arr.length; } },
      SHIFT: { arity: 1, fn: ([arr]) => Array.isArray(arr) && arr.length ? arr.shift() : null },
      IT: { arity: 0, fn: () => (this.stack.length ? this.stack.pop() : null) },
      EXEC: { arity: 1, fn: ([cmd]) => this.execCommand(cmd, true) },
      EXEC2: { arity: 1, fn: ([cmd]) => this.execCommand(cmd, false) },
      EXEC_COMBINED: { arity: 1, fn: ([cmd]) => this.execCombined(cmd) },
    };
  }

  run(source) {
    const { source: pre, stringLiterals } = preprocess(source);
    const functionArity = this.collectFunctionArity(pre);
    const lexer = new Lexer(pre, stringLiterals);
    const parser = new Parser(lexer, functionArity);
    const program = parser.parseProgram();
    const globalEnv = new Environment();
    this.globalEnv = globalEnv;
    const functions = new Map();

    for (const [name, def] of Object.entries(this.builtins)) {
      functions.set(name, def);
    }

    for (const stmt of program.body) {
      if (stmt.type === "FuncDef") {
        functions.set(stmt.name, { arity: stmt.params.length, node: stmt });
      }
    }

    const topRes = this.execBlock(program.body, globalEnv, functions);
    if (topRes && topRes.type === "goto") throw new Error(`Unknown label: ${topRes.label}`);
    return { env: globalEnv, output: this.output.slice() };
  }

  collectFunctionArity(source) {
    const arity = {};
    for (const [name, def] of Object.entries(this.builtins)) {
      arity[name] = def.arity;
    }
    const lines = source.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*FUNC\s+([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/);
      if (!m) continue;
      const name = m[1];
      const paramsRaw = m[2].trim();
      const params = paramsRaw ? paramsRaw.split(/\s+/) : [];
      arity[name] = params.length;
    }
    return arity;
  }

  execBlock(stmts, env, functions) {
    let lastExpr = null;
    const labelMap = new Map();
    for (let i = 0; i < stmts.length; i += 1) {
      const stmt = stmts[i];
      if (stmt.type === "Label") labelMap.set(stmt.label, i);
      if (stmt.type === "For" || stmt.type === "ForEach" || stmt.type === "While" || stmt.type === "If") {
        if (stmt.label) labelMap.set(stmt.label, i);
      }
    }
    for (let i = 0; i < stmts.length; i += 1) {
      const stmt = stmts[i];
      const res = this.exec(stmt, env, functions);
      if (res && res.type) {
        if (res.type === "return") return res;
        if (res.type === "break") return res;
        if (res.type === "continue") return res;
        if (res.type === "goto") {
          if (labelMap.has(res.label)) {
            i = labelMap.get(res.label);
            continue;
          }
          return res;
        }
      }
      if (stmt.type === "ExprStmt") lastExpr = res;
    }
    return { type: "ok", value: lastExpr };
  }

  exec(stmt, env, functions) {
    switch (stmt.type) {
      case "Assign": {
        const value = this.evalExpr(stmt.value, env, functions);
        this.assign(stmt.target, value, env, functions);
        return value;
      }
      case "GlobalAssign": {
        const value = this.evalExpr(stmt.value, env, functions);
        if (!this.globalEnv) throw new Error("Global environment not initialized");
        this.globalEnv.set(stmt.name, value);
        return value;
      }
      case "ExprStmt": {
        const value = this.evalExpr(stmt.expr, env, functions);
        this.stack.push(value);
        return value;
      }
      case "If": {
        for (const branch of stmt.branches) {
          if (this.isTruthy(this.evalExpr(branch.cond, env, functions))) {
            const res = this.execBlock(branch.body, env, functions);
            if (res.type === "break" && res.label && res.label === stmt.label) return null;
            if (res.type === "continue" && res.label && res.label === stmt.label) {
              throw new Error(`CONTINUE cannot target IF label: ${stmt.label}`);
            }
            if (res.type !== "ok") return res;
            return null;
          }
        }
        if (stmt.elseBody) {
          const res = this.execBlock(stmt.elseBody, env, functions);
          if (res.type === "break" && res.label && res.label === stmt.label) return null;
          if (res.type === "continue" && res.label && res.label === stmt.label) {
            throw new Error(`CONTINUE cannot target IF label: ${stmt.label}`);
          }
          if (res.type !== "ok") return res;
        }
        return null;
      }
      case "While": {
        while (this.isTruthy(this.evalExpr(stmt.cond, env, functions))) {
          const res = this.execBlock(stmt.body, env, functions);
          if (res.type === "break") {
            if (!res.label || res.label === stmt.label) break;
            return res;
          }
          if (res.type === "continue") {
            if (!res.label || res.label === stmt.label) continue;
            return res;
          }
          if (res.type === "return") return res;
        }
        return null;
      }
      case "For": {
        const start = this.toNumber(this.evalExpr(stmt.start, env, functions));
        const end = this.toNumber(this.evalExpr(stmt.end, env, functions));
        const step = start <= end ? 1 : -1;
        for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
          env.set(stmt.name, i);
          const res = this.execBlock(stmt.body, env, functions);
          if (res.type === "break") {
            if (!res.label || res.label === stmt.label) break;
            return res;
          }
          if (res.type === "continue") {
            if (!res.label || res.label === stmt.label) continue;
            return res;
          }
          if (res.type === "return") return res;
        }
        return null;
      }
      case "ForEach": {
        const iterable = this.evalExpr(stmt.iterable, env, functions);
        if (Array.isArray(iterable)) {
          for (let i = 0; i < iterable.length; i += 1) {
            if (stmt.keyVar) env.set(stmt.keyVar, i + 1);
            env.set(stmt.valVar, iterable[i]);
            const res = this.execBlock(stmt.body, env, functions);
            if (res.type === "break") {
              if (!res.label || res.label === stmt.label) break;
              return res;
            }
            if (res.type === "continue") {
              if (!res.label || res.label === stmt.label) continue;
              return res;
            }
            if (res.type === "return") return res;
          }
        } else if (iterable && typeof iterable === "object") {
          for (const key of Object.keys(iterable)) {
            if (stmt.keyVar) env.set(stmt.keyVar, key);
            env.set(stmt.valVar, iterable[key]);
            const res = this.execBlock(stmt.body, env, functions);
            if (res.type === "break") {
              if (!res.label || res.label === stmt.label) break;
              return res;
            }
            if (res.type === "continue") {
              if (!res.label || res.label === stmt.label) continue;
              return res;
            }
            if (res.type === "return") return res;
          }
        }
        return null;
      }
      case "FuncDef":
        return null;
      case "Return":
        return { type: "return", value: this.evalExpr(stmt.expr, env, functions) };
      case "Goto":
        return { type: "goto", label: stmt.label };
      case "Break":
        return { type: "break", label: stmt.label || null };
      case "Continue":
        return { type: "continue", label: stmt.label || null };
      case "Label":
        return null;
      default:
        throw new Error(`Unknown statement: ${stmt.type}`);
    }
  }

  evalExpr(expr, env, functions) {
    switch (expr.type) {
      case "Literal":
        return expr.value;
      case "Identifier":
        return env.get(expr.name);
      case "Binary": {
        const left = this.evalExpr(expr.left, env, functions);
        const right = this.evalExpr(expr.right, env, functions);
        return this.evalBinary(expr.op, left, right);
      }
      case "Unary": {
        const value = this.evalExpr(expr.expr, env, functions);
        if (expr.op === "-") return -this.toNumber(value);
        if (expr.op === "NOT") return !this.isTruthy(value);
        throw new Error(`Unknown unary op ${expr.op}`);
      }
      case "Call": {
        return this.callFunction(expr.name, expr.args, env, functions);
      }
      case "ArrayLiteral":
        return expr.items.map((item) => this.evalExpr(item, env, functions));
      case "ObjectLiteral": {
        const obj = {};
        for (const pair of expr.pairs) {
          obj[pair.key] = this.evalExpr(pair.value, env, functions);
        }
        return obj;
      }
      case "Member": {
        const obj = this.evalExpr(expr.object, env, functions);
        if (!obj || typeof obj !== "object") return null;
        return Object.prototype.hasOwnProperty.call(obj, expr.property) ? obj[expr.property] : null;
      }
      case "Index": {
        const obj = this.evalExpr(expr.object, env, functions);
        const idx = this.toNumber(this.evalExpr(expr.index, env, functions));
        if (Array.isArray(obj)) {
          const i = Math.floor(idx) - 1;
          if (i < 0 || i >= obj.length) return null;
          return obj[i] === undefined ? null : obj[i];
        }
        if (typeof obj === "string") {
          const i = Math.floor(idx) - 1;
          if (i < 0 || i >= obj.length) return null;
          return obj[i];
        }
        return null;
      }
      default:
        throw new Error(`Unknown expression: ${expr.type}`);
    }
  }

  callFunction(name, argsExpr, env, functions) {
    const fn = functions.get(name);
    if (!fn) throw new Error(`Unknown function: ${name}`);
    const arity = fn.arity;
    const args = argsExpr.map((a) => this.evalExpr(a, env, functions));
    if (args.length < arity) {
      const missing = arity - args.length;
      if (this.stack.length < missing) throw new Error(`Not enough stack values for ${name}`);
      const pulled = [];
      for (let i = 0; i < missing; i += 1) {
        pulled.push(this.stack.pop());
      }
      pulled.reverse();
      args.unshift(...pulled);
    }
    if (args.length > arity) throw new Error(`Too many args for ${name}`);

    if (fn.fn) return fn.fn(args);
    const local = new Environment(this.globalEnv);
    for (let i = 0; i < fn.node.params.length; i += 1) {
      local.define(fn.node.params[i], args[i]);
    }
    const res = this.execBlock(fn.node.body, local, functions);
    if (res.type === "goto") throw new Error(`Unknown label: ${res.label}`);
    if (res.type === "return") return res.value;
    return res.value;
  }

  assign(target, value, env, functions) {
    if (target.type === "Identifier") {
      env.set(target.name, value);
      return;
    }
    if (target.type === "Member") {
      const obj = this.evalExpr(target.object, env, functions);
      if (!obj || typeof obj !== "object") throw new Error("Invalid member assignment");
      obj[target.property] = value;
      return;
    }
    if (target.type === "Index") {
      const obj = this.evalExpr(target.object, env, functions);
      const idx = this.toNumber(this.evalExpr(target.index, env, functions));
      if (!Array.isArray(obj)) throw new Error("Index assignment expects array");
      const i = Math.floor(idx) - 1;
      if (i < 0) throw new Error("Index must be >= 1");
      while (obj.length <= i) obj.push(null);
      obj[i] = value;
      return;
    }
    throw new Error("Invalid assignment target");
  }

  evalBinary(op, left, right) {
    if (op === "+") {
      if (typeof left === "string" || typeof right === "string") return this.toString(left) + this.toString(right);
      return this.toNumber(left) + this.toNumber(right);
    }
    if (op === "-") return this.toNumber(left) - this.toNumber(right);
    if (op === "*") return this.toNumber(left) * this.toNumber(right);
    if (op === "/") return this.toNumber(left) / this.toNumber(right);
    if (op === ">") return this.toNumber(left) > this.toNumber(right);
    if (op === ">=") return this.toNumber(left) >= this.toNumber(right);
    if (op === "<") return this.toNumber(left) < this.toNumber(right);
    if (op === "<=") return this.toNumber(left) <= this.toNumber(right);
    if (op === "AND") return this.isTruthy(left) && this.isTruthy(right);
    if (op === "OR") return this.isTruthy(left) || this.isTruthy(right);
    if (op === "IS" || op === "==") return this.isEqual(left, right);
    if (op === "ISNT" || op === "!=") return !this.isEqual(left, right);
    throw new Error(`Unknown operator ${op}`);
  }

  isEqual(a, b) {
    if (a === null && b === null) return true;
    if (typeof a !== "object" && typeof b !== "object") return a === b;
    return a === b;
  }

  isTruthy(v) {
    return !!v;
  }

  toNumber(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string") {
      const n = Number(v);
      return Number.isNaN(n) ? 0 : n;
    }
    return 0;
  }

  toString(v) {
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
    if (Array.isArray(v)) return v.map((x) => this.toString(x)).join(",");
    if (typeof v === "object") return "[object]";
    return String(v);
  }

  formatValue(v) {
    return this.toString(v);
  }

  execCommand(cmd, throwOnNonZero) {
    const { execSync, spawnSync } = require("child_process");
    const command = this.toString(cmd);
    try {
      const out = execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      if (throwOnNonZero) return out;
      return { stdout: out, stderr: "", code: 0 };
    } catch (err) {
      if (throwOnNonZero) {
        const stderr = err.stderr ? err.stderr.toString("utf8") : "";
        const message = stderr || err.message || "EXEC failed";
        throw new Error(message.trim());
      }
      const stdout = err.stdout ? err.stdout.toString("utf8") : "";
      const stderr = err.stderr ? err.stderr.toString("utf8") : "";
      const code = typeof err.status === "number" ? err.status : 1;
      return { stdout, stderr, code };
    }
  }

  execCombined(cmd) {
    const { spawnSync } = require("child_process");
    const command = this.toString(cmd);
    const res = spawnSync(command, { shell: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (res.error) throw new Error(res.error.message);
    const output = `${res.stdout || ""}${res.stderr || ""}`;
    if (res.status !== 0) {
      const message = output.trim() || `EXEC_COMBINED failed with code ${res.status}`;
      throw new Error(message);
    }
    return output;
  }

  substrValue(value, start, len) {
    if (Array.isArray(value)) {
      const arrLen = value.length;
      let st = Math.floor(this.toNumber(start));
      if (st < 0) st = arrLen + st + 1;
      if (st < 1) st = 1;
      let ln = Math.floor(this.toNumber(len));
      if (ln < 0) return value.slice();
      ln = Math.max(0, ln);
      if (ln <= 0) return [];
      const startIdx = st - 1;
      if (startIdx >= arrLen) return [];
      return value.slice(startIdx, startIdx + ln);
    }
    const str = this.toString(value);
    const strLen = str.length;
    let st = Math.floor(this.toNumber(start));
    if (st < 0) st = strLen + st + 1;
    if (st < 1) st = 1;
    let ln = Math.floor(this.toNumber(len));
    if (ln < 0) return str;
    ln = Math.max(0, ln);
    if (ln <= 0) return "";
    if (st - 1 >= strLen) return "";
    return str.substring(st - 1, st - 1 + ln);
  }

  sliceRange(value, start, end) {
    if (Array.isArray(value)) {
      const arrLen = value.length;
      let st = Math.floor(this.toNumber(start));
      let en = Math.floor(this.toNumber(end));
      if (st < 0) st = arrLen + st + 1;
      if (en < 0) en = arrLen + en + 1;
      if (st < 1) st = 1;
      if (en > arrLen) en = arrLen;
      if (en < st) return [];
      const startIdx = st - 1;
      const endIdx = en; // slice end is exclusive
      return value.slice(startIdx, endIdx);
    }
    const str = this.toString(value);
    const strLen = str.length;
    let st = Math.floor(this.toNumber(start));
    let en = Math.floor(this.toNumber(end));
    if (st < 0) st = strLen + st + 1;
    if (en < 0) en = strLen + en + 1;
    if (st < 1) st = 1;
    if (en > strLen) en = strLen;
    if (en < st) return "";
    const startIdx = st - 1;
    const endIdx = en; // substring end is exclusive
    return str.substring(startIdx, endIdx);
  }
}

function runScript(source, options) {
  const interpreter = new Interpreter(options);
  return interpreter.run(source);
}

module.exports = { runScript, Interpreter };

if (require.main === module) {
  const fs = require("fs");

  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node interpreter.js <script-file>");
    process.exit(1);
  }

  const source = fs.readFileSync(file, "utf8");
  const result = runScript(source);
  if (result.output.length) {
    process.stdout.write(result.output.join("\n"));
    process.stdout.write("\n");
  }
}
