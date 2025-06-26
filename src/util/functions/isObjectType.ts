import ts from "typescript";

export function isObjectType(type: ts.Type, considerIntersections: false): type is ts.TypeReference;
export function isObjectType(type: ts.Type, considerIntersections?: boolean): type is ts.TypeReference | ts.IntersectionType;
export function isObjectType(
	type: ts.Type,
	considerIntersections = true,
): type is ts.TypeReference | ts.IntersectionType {
	return type.isIntersection()
		? type.types.every((t) => isObjectType(t, considerIntersections))
		: (type.flags & ts.TypeFlags.Object) !== 0;
}
