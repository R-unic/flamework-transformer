import type ts from "typescript";

export function isTrueType(elementsType: ts.Type): elementsType is ts.LiteralType {
	return (
		"intrinsicName" in elementsType &&
		typeof elementsType.intrinsicName === "string" &&
		elementsType.intrinsicName === "true"
	);
}
