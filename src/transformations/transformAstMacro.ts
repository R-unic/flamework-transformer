import ts from "typescript";
import { Diagnostics } from "../classes/diagnostics";
import { TransformState } from "../classes/transformState";
import { f } from "../util/factory";
import { NodeMetadata } from "../classes/nodeMetadata";
import { inspect } from "util";
import { isObjectType } from "../util/functions/isObjectType";
import { getParameterCount } from "../util/functions/getParameterCount";
import { isUndefinedArgument } from "../util/functions/isUndefinedArgument";
import { getSymbolType } from "../util/functions/getSymbolType";
import { isNeverType } from "../util/functions/isNeverType";
import { isTrueType } from "../util/functions/isTrueType";
import { isSyntaxKind } from "../util/functions/isSyntaxKind";

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
		return buildAstMacro(state, node, args, state.typeChecker.getTypeAtLocation(target.declarations[0]));
	}

	const parameters = new Map<number, ts.Type>();
	let highestParameterIndex = -1;
	for (let i = 0; i < getParameterCount(state, signature); i++) {
		const targetParameterType = state.typeChecker.getParameterType(signature, i).getNonNullableType();
		const astType = state.typeChecker.getTypeOfPropertyOfType(targetParameterType, "_flamework_macro_many");
		if (!astType) continue;

		const macroTargetParameterIndex = i + (signature.thisParameter ? 1 : 0);
		if (!isUndefinedArgument(args[macroTargetParameterIndex])) {
			return Diagnostics.error(
				node,
				`Cannot explicitly pass AST macro target (expected ${macroTargetParameterIndex - 1} arguments, got ${args.length})`,
			);
		}

		parameters.set(i, astType);
		highestParameterIndex = Math.max(highestParameterIndex, i);
	}

	for (let i = 0; i <= highestParameterIndex; i++) {
		const astType = parameters.get(i);
		if (!astType) continue;

		return buildAstMacro(state, node, args, astType);
	}

	Diagnostics.error(
		node,
		"Could not find linked ast-macro-target metadata or parameter with type Modding.Many<MacroTarget>",
	);
}

function buildAstMacro(
	state: TransformState,
	node: ts.CallExpression,
	args: ts.Expression[],
	type: ts.Type,
): ts.Expression {
	const checker = state.typeChecker;

	function getPropertyType(objType: ts.Type, name: string): ts.Type | undefined {
		return checker.getTypeOfPropertyOfType(objType, name);
	}

	const registeredPrereqs = new Map<string, ts.Identifier>();
	function buildFromType(type: ts.Type): ts.Expression {
		// argument mapping (by position)
		if (type.isNumberLiteral()) {
			return args[type.value];
		}

		// prereq var mapping
		if (type.isStringLiteral() && registeredPrereqs.has(type.value)) {
			return registeredPrereqs.get(type.value)!;
		}

		// now expected to be an AST node interface
		const typeString = checker.typeToString(type);
		const constraint = type.getConstraint();
		const isObjectTypeParameter = type.isTypeParameter() && constraint && isObjectType(constraint);
		if (!isObjectType(type) && !isObjectTypeParameter) {
			return Diagnostics.error(
				node,
				"Expected type to be a class, interface, or argument mapping, got: " + typeString,
			);
		}

		registerAnyPrereqs(type);
		const kindType = getPropertyType(type, "kind");
		if (kindType === undefined) {
			return Diagnostics.error(node, "Missing 'kind' property in type: " + typeString);
		}

		const kindLiteral = (kindType as ts.LiteralType).value as ts.SyntaxKind;
		if (!isSyntaxKind(kindLiteral)) {
			return Diagnostics.error(node, "'kind' must be a SyntaxKind, got: " + checker.typeToString(kindType));
		}

		function missingProp(name: string): string {
			return `Missing '${name}' property in type: ${typeString}`;
		}

		function autoProp(name: string): string {
			return `Do not provide automatically generated property '${name}' in: ${typeString}`;
		}

		switch (kindLiteral) {
			case ts.SyntaxKind.Identifier: {
				const textType = getPropertyType(type, "text");
				const text = (textType as ts.StringLiteralType)?.value;
				if (text === undefined) {
					return Diagnostics.error(node, missingProp("text"));
				}
				if (typeof text !== "string") {
					return Diagnostics.error(
						node,
						"Expected string literal for Identifier.text, got: " + checker.typeToString(textType!),
					);
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
					return Diagnostics.error(
						node,
						"Expected number literal for NumericLiteral.value, got: " + checker.typeToString(valueType!),
					);
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
					return Diagnostics.error(
						node,
						"Expected string literal for StringLiteral.value, got: " + checker.typeToString(valueType!),
					);
				}

				return f.string(value);
			}

			case ts.SyntaxKind.ArrayLiteralExpression: {
				const elementsType = getPropertyType(type, "elements");
				if (elementsType === undefined) {
					return Diagnostics.error(node, missingProp("elements"));
				}

				const useArgs = isTrueType(elementsType);
				if (!isObjectType(elementsType, false) && !useArgs) {
					return Diagnostics.error(
						node,
						"Expected array literal type (or argument mappings) for 'elements', got: " + checker.typeToString(elementsType!),
					);
				}

				const elements = useArgs
					? args
					: checker
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
				if (!isSyntaxKind<ts.PrefixUnaryOperator>(operatorKind)) {
					return Diagnostics.error(
						node,
						"operator must be a SyntaxKind, got: " + checker.typeToString(operandType),
					);
				}

				return f.prefixUnary(operand, operatorKind);
			}

			case ts.SyntaxKind.BinaryExpression: {
				const leftType = getPropertyType(type, "left");
				const rightType = getPropertyType(type, "right");
				const operatorType = getPropertyType(type, "operatorToken");
				if (!leftType) {
					return Diagnostics.error(node, missingProp("left"));
				}
				if (!rightType) {
					return Diagnostics.error(node, missingProp("right"));
				}
				if (!operatorType) {
					return Diagnostics.error(node, missingProp("operatorToken"));
				}

				const left = buildFromType(leftType);
				const right = buildFromType(rightType);
				const operatorKind = (operatorType as ts.LiteralType).value;
				if (!isSyntaxKind<ts.BinaryOperator>(operatorKind)) {
					return Diagnostics.error(
						node,
						"operatorToken must be a SyntaxKind, got: " + checker.typeToString(operatorType),
					);
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

			case ts.SyntaxKind.SpreadElement: {
				const expressionType = getPropertyType(type, "expression");
				const parentType = getPropertyType(type, "parent");
				if (!expressionType) {
					return Diagnostics.error(node, missingProp("expression"));
				}
				if (parentType) {
					return Diagnostics.error(node, autoProp("parent"));
				}

				const expr = buildFromType(expressionType);
				return f.spread(expr);
			}

			case ts.SyntaxKind.CallExpression: {
				const expressionType = getPropertyType(type, "expression");
				const argumentsType = getPropertyType(type, "arguments");
				if (!expressionType) {
					return Diagnostics.error(node, missingProp("expression"));
				}

				const expr = buildFromType(expressionType);
				const args = buildArgumentList(argumentsType);
				return f.call(expr as ts.Expression, args);
			}

			case ts.SyntaxKind.NewExpression: {
				const expressionType = getPropertyType(type, "expression");
				const argumentsType = getPropertyType(type, "arguments");
				if (!expressionType) {
					return Diagnostics.error(node, missingProp("expression"));
				}

				const expr = buildFromType(expressionType);
				const args = buildArgumentList(argumentsType);
				return f.newExpression(expr as ts.Expression, args);
			}

			default: {
				const message = ts.isStatement(node)
					? "Statements are not supported and are not currently planned"
					: `Unsupported SyntaxKind: ${ts.SyntaxKind[kindLiteral]} (${kindLiteral})`;

				Diagnostics.error(node, message);
			}
		}
	}

	function registerAnyPrereqs(type: ts.TypeReference | ts.IntersectionType | ts.TypeParameter) {
		const prereqs = getPropertyType(type, "$vars");
		if (prereqs !== undefined && isObjectType(prereqs)) {
			const prereqEntries = prereqs
				.getProperties()
				.map<[string, ts.Type | undefined]>((symbol) => [symbol.name, getSymbolType(symbol, checker)])
				.filter((entry): entry is [string, ts.Type] => {
					const entryType = entry[1];
					return entryType !== undefined && !isNeverType(entryType);
				});

			for (const [name, type] of prereqEntries) {
				const expression = buildFromType(type);
				const identifier = ts.isIdentifier(expression) ? expression : state.pushToVar(name, expression);
				registeredPrereqs.set(name, identifier);
			}
		}
	}

	function buildArgumentList(type: ts.Type | undefined): ts.Expression[] {
		if (!type) return [];

		if (isObjectType(type)) {
			const elements = checker.getTypeArguments(type as ts.TypeReference);
			return elements.map(buildFromType).filter((v) => v !== undefined);
		} else if (isTrueType(type)) {
			return args;
		}

		Diagnostics.error(node, `Invalid argument list type: ${checker.typeToString(type)}`);
	}

	return buildFromType(type) as ts.Expression;
}