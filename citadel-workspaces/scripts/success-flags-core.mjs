/**
 * The discard finder behind check-success-flags-are-checked.mjs, separate so its
 * own test can aim it at a small project and see what it counts.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');

/** Every `file::callee` whose boolean answer is dropped, under `root`/src. */
export function findDiscards(root) {
  const configPath = resolve(root, 'tsconfig.app.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile).config;
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();

  /**
   * A function typed to return the literal `true` (`requestResponse<true>`) can
   * only succeed or reject: there is no `false` to drop, so the failure is already
   * a throw the caller sees.
   */
  const isTrueLiteral = (type) => (type.flags & ts.TypeFlags.BooleanLiteral) !== 0 && checker.typeToString(type) === 'true';
  const isBoolean = (type) => (type.flags & ts.TypeFlags.BooleanLike) !== 0 && !isTrueLiteral(type);

  /** `Promise<boolean>` and `boolean` are the same question asked twice. */
  const unwrapPromise = (type) => {
    if (type.getSymbol()?.getName() === 'Promise') {
      const args = checker.getTypeArguments(type);
      if (args?.length === 1) return args[0];
    }
    return type;
  };

  const found = [];
  for (const sourceFile of program.getSourceFiles()) {
    const file = sourceFile.fileName;
    if (!file.startsWith(`${root}/src`)) continue;
    // Tests discard results deliberately, to drive a path rather than judge it.
    if (file.includes('__tests__') || /\.test\.tsx?$/.test(file)) continue;

    const visit = (node) => {
      if (ts.isExpressionStatement(node)) {
        let expression = node.expression;
        if (ts.isAwaitExpression(expression)) expression = expression.expression;
        if (ts.isVoidExpression(expression)) {
          expression = expression.expression;
          if (ts.isAwaitExpression(expression)) expression = expression.expression;
        }
        if (ts.isCallExpression(expression)) {
          const signature = checker.getResolvedSignature(expression);
          const declaration = signature?.getDeclaration?.();
          const declaredIn = declaration?.getSourceFile?.().fileName ?? '';
          if (signature && declaredIn.startsWith(`${root}/src`)) {
            if (isBoolean(unwrapPromise(checker.getReturnTypeOfSignature(signature)))) {
              const callee = expression.expression;
              const name = ts.isPropertyAccessExpression(callee) ? callee.name.getText() : callee.getText();
              // Keyed by file and callee, NOT by line: a line number changes
              // whenever anything above it does, and a baseline that churns is a
              // baseline nobody reads.
              found.push(`${file.slice(root.length + 1)}::${name}`);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return found;
}
