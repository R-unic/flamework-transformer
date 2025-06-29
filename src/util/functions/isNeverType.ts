import ts from "typescript";

export function isNeverType(type: ts.Type): boolean {
	return (type.flags & ts.TypeFlags.Never) !== 0;
}
