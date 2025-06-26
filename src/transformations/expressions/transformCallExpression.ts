import ts from "typescript";
import { TransformState } from "../../classes/transformState";
import { transformNode } from "../transformNode";
import { transformUserMacro } from "../transformUserMacro";
import { transformAstMacro } from "../transformAstMacro";
import { f } from "../../util/factory";

export function transformCallExpression(state: TransformState, node: ts.CallExpression) {
  const symbol = state.getSymbol(node.expression);

  if (symbol) {
    const isUserMacro = state.isUserMacro(symbol);
    if (isUserMacro || state.isAstMacro(symbol)) {
      // We skip `super()` expressions as we likely do not have enough information to evaluate it.
      if (f.is.superExpression(node.expression)) {
        return state.transform(node);
      }

      const signature = state.typeChecker.getResolvedSignature(node);
      if (signature) {
        return (
          (isUserMacro
            ? transformUserMacro(state, node, signature)
            : transformAstMacro(state, node, signature)) ?? state.transform(node)
        );
      }
    }
  }

  return ts.visitEachChild(node, (node) => transformNode(state, node), state.context);
}
