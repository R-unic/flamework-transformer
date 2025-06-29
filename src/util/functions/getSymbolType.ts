import type ts from "typescript";

export function getSymbolType(symbol: ts.Symbol, typeChecker: ts.TypeChecker): ts.Type | undefined {
	const declarations = symbol.getDeclarations();
	let type: ts.Type | undefined;

	if (declarations && declarations.length > 0) {
		const declaration = declarations[0];
		const symbolType = typeChecker.getTypeOfSymbolAtLocation(symbol, declaration);
		type = symbolType;
	}

	return type;
}
