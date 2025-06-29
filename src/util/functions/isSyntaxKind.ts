import ts from "typescript";

export function isSyntaxKind<K extends ts.SyntaxKind = ts.SyntaxKind>(value: unknown): value is K {
	return typeof value === "number" && ts.SyntaxKind[value] !== undefined;
}
