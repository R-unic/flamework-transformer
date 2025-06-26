import ts from "typescript";

import { isTupleType } from "./isTupleType";
import type { TransformState } from "../../classes/transformState";

export function getParameterCount(state: TransformState, signature: ts.Signature) {
	const length = signature.parameters.length;
	if (ts.signatureHasRestParameter(signature)) {
		const restType = state.typeChecker.getTypeOfSymbol(signature.parameters[length - 1]);
		if (isTupleType(state, restType)) {
			return length + restType.target.fixedLength - (restType.target.hasRestElement ? 0 : 1);
		}
	}
	return length;
}
