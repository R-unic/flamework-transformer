import ts from "typescript";
import { Diagnostics } from "../classes/diagnostics";
import { TransformState } from "../classes/transformState";
import { f } from "../util/factory";
import { NodeMetadata } from "../classes/nodeMetadata";
import { inspect } from "util";

export function transformAstMacro(
	state: TransformState,
	node: ts.CallExpression,
	signature: ts.Signature,
): ts.Expression | undefined {
	const signatureDeclaration = signature.getDeclaration();
	const nodeMetadata = new NodeMetadata(state, signatureDeclaration);
	const args = node.arguments ? [...node.arguments] : [];
	if (ts.isPropertyAccessExpression(node.expression)) {
		const hasThisArgument = signatureDeclaration.parameters.some((p) => p.name.getText() === "this");
		if (hasThisArgument) args.unshift(node.expression.expression);
	}

	const target = nodeMetadata.getSymbol("ast-macro-target")?.[0];
	if (target && (target.flags & ts.SymbolFlags.Type) !== 0 && target.declarations && target.declarations.length > 0) {
		return buildAstMacro(node, args, signature.getReturnType().checker.getTypeAtLocation(target.declarations[0]));
	}

	Diagnostics.error(node, `Could not find linked ast-macro-target`);
}

function buildAstMacro(node: ts.CallExpression, args: ts.Expression[], type: ts.Type): ts.Expression {
	const { checker } = type;

	function getPropertyType(objType: ts.Type, name: string): ts.Type | undefined {
		const prop = objType.getProperty(name);
		if (!prop) return undefined;

		return checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration! ?? prop.declarations?.[0]);
	}

	function buildFromType(type: ts.Type): ts.Expression {
		if (type.isNumberLiteral()) {
			return args[type.value];
		}

		const constraint = type.getConstraint();
		if (!isObjectType(type) && !(type.isTypeParameter() && constraint && isObjectType(constraint))) {
			return Diagnostics.error(
				node,
				"Expected type to be a class, interface, or argument mapping, got: " + type.checker.typeToString(type),
			);
		}

		const kindType = getPropertyType(type, "kind");
		if (kindType === undefined) {
			return Diagnostics.error(node, "Missing 'kind' property in type: " + inspect(type));
		}

		const kindLiteral = (kindType as ts.LiteralType).value as ts.SyntaxKind;
		if (typeof kindLiteral !== "number") {
			return Diagnostics.error(node, "'kind' must be a numeric literal");
		}

		function missingProp(name: string): string {
			return `Missing '${name}' property in ${ts.SyntaxKind[kindLiteral]}`;
		}

		switch (kindLiteral) {
			case ts.SyntaxKind.Identifier: {
				const textType = getPropertyType(type, "text");
				const text = (textType as ts.StringLiteralType)?.value;
				if (text === undefined) {
					return Diagnostics.error(node, missingProp("text"));
				}
				if (typeof text !== "string") {
					return Diagnostics.error(node, "Expected string literal for Identifier.text");
				}

				return f.identifier(text);
			}

			case ts.SyntaxKind.NumericLiteral: {
				const valueType = getPropertyType(type, "value");
				const value = (valueType as ts.NumberLiteralType)?.value;
				if (value === undefined) {
					return Diagnostics.error(node, missingProp("value"));
				}
				if (typeof value !== "number") {
					return Diagnostics.error(node, "Expected number literal for NumericLiteral.value");
				}

				return f.number(value);
			}

			case ts.SyntaxKind.StringLiteral: {
				const valueType = getPropertyType(type, "value");
				const value = (valueType as ts.StringLiteralType)?.value;
				if (value === undefined) {
					return Diagnostics.error(node, missingProp("value"));
				}
				if (typeof value !== "string") {
					return Diagnostics.error(node, "Expected string literal for StringLiteral.value");
				}

				return f.string(value);
			}

			case ts.SyntaxKind.ArrayLiteralExpression: {
				const elementsType = getPropertyType(type, "elements");
				if (elementsType === undefined) {
					return Diagnostics.error(node, missingProp("elements"));
				}

				const useArgs = isTrueType(elementsType);
				if (!isObjectType(elementsType) && !useArgs) {
					return Diagnostics.error(node, "Expected array literal type (or argument mappings) for 'elements'");
				}

				const elements = useArgs
					? args
					: elementsType.checker
						.getTypeArguments(elementsType)
						.map(buildFromType)
						.filter((v) => v !== undefined);

				return f.array(elements, elements.length > 3);
			}

			case ts.SyntaxKind.ParenthesizedExpression: {
				const expressionType = getPropertyType(type, "expression");
				if (!expressionType) {
					return Diagnostics.error(node, missingProp("expression"));
				}

				return f.parenthesized(buildFromType(expressionType));
			}

			case ts.SyntaxKind.PrefixUnaryExpression: {
				const operandType = getPropertyType(type, "operand");
				const operator = getPropertyType(type, "operator");
				if (!operandType) {
					return Diagnostics.error(node, missingProp("operand"));
				}
				if (!operator) {
					return Diagnostics.error(node, missingProp("operator"));
				}

				const operand = buildFromType(operandType);
				const operatorKind = (operator as ts.LiteralType).value;
				if (typeof operatorKind !== "number") {
					return Diagnostics.error(node, "operator.kind must be a SyntaxKind");
				}

				return f.prefixUnary(operand, operatorKind);
			}

			case ts.SyntaxKind.BinaryExpression: {
				const leftType = getPropertyType(type, "left");
				const rightType = getPropertyType(type, "right");
				const operator = getPropertyType(type, "operatorToken");
				if (!leftType || !rightType || !operator) {
					return Diagnostics.error(node, "BinaryExpression must have left, right, and operatorToken");
				}

				const left = buildFromType(leftType);
				const right = buildFromType(rightType);
				const operatorKind = (operator as ts.LiteralType).value;
				if (typeof operatorKind !== "number") {
					return Diagnostics.error(node, "operatorToken.kind must be a SyntaxKind");
				}

				return f.binary(left, operatorKind, right);
			}

			case ts.SyntaxKind.ElementAccessExpression: {
				const leftType = getPropertyType(type, "expression");
				const indexType = getPropertyType(type, "argumentExpression");
				if (leftType === undefined) {
					return Diagnostics.error(node, missingProp("expression"));
				}
				if (indexType === undefined) {
					return Diagnostics.error(node, missingProp("argumentExpression"));
				}

				const left = buildFromType(leftType);
				const index = buildFromType(indexType);
				return f.elementAccessExpression(left, index);
			}

			case ts.SyntaxKind.PropertyAccessExpression: {
				const leftType = getPropertyType(type, "expression");
				const nameType = getPropertyType(type, "name");
				if (leftType === undefined) {
					return Diagnostics.error(node, missingProp("expression"));
				}
				if (nameType === undefined) {
					return Diagnostics.error(node, missingProp("name"));
				}

				const left = buildFromType(leftType);
				const name = buildFromType(nameType);
				return f.propertyAccessExpression(left, name as ts.MemberName);
			}

			case ts.SyntaxKind.CallExpression: {
				const expressionType = getPropertyType(type, "expression");
				const argumentListType = getPropertyType(type, "argumentList");
				if (!expressionType) {
					return Diagnostics.error(node, missingProp("expression"));
				}
				const expr = buildFromType(expressionType);
				const args = buildArgumentList(argumentListType);
				return f.call(expr as ts.Expression, args);
			}

			default:
				Diagnostics.error(node, `Unsupported SyntaxKind: ${ts.SyntaxKind[kindLiteral]} (${kindLiteral})`);
		}
	}

	function buildArgumentList(type: ts.Type | undefined): ts.Expression[] {
		if (!type) return [];

		// TODO: validation
		if (isObjectType(type)) {
			const elements = checker.getTypeArguments(type as ts.TypeReference);
			return elements.map((t) => args[t.isLiteral() ? (t.value as number) : 0]).filter((v) => v !== undefined);
		} else if (isTrueType(type)) {
			return args;
		}

		return [];
	}

	return buildFromType(type) as ts.Expression;
}
function isTrueType(elementsType: ts.Type): elementsType is ts.LiteralType {
	return (
		"intrinsicName" in elementsType &&
		typeof elementsType.intrinsicName === "string" &&
		elementsType.intrinsicName === "true"
	);
}

function isObjectType(type: ts.Type): type is ts.TypeReference {
	return (type.flags & ts.TypeFlags.Object) !== 0;
}
